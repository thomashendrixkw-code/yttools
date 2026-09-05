"use strict";

/**
 * Electron shell for YT Tools.
 *
 * The app is the same Next.js server that runs in Docker, started as a child
 * process on a loopback port and displayed in a window. Running it locally is
 * not just packaging convenience: it downloads from a residential IP, so it
 * avoids the datacenter blocking that makes cloud deployments unreliable, and
 * there is no origin timeout or public endpoint to secure.
 *
 * yt-dlp and ffmpeg ship inside the bundle, so nothing needs installing.
 */

const { app, BrowserWindow, shell, dialog, Notification } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const isDev = !app.isPackaged;

/** Resources live beside the app in production, in this folder in development. */
const resourcesRoot = isDev ? path.join(__dirname, "resources") : process.resourcesPath;

const isWindows = process.platform === "win32";

const SERVER_ENTRY = path.join(resourcesRoot, "server", "server.js");

// yt-dlp ships as a pure-Python zipapp run by the bundled interpreter. Pointing
// the server at a wrapper script instead would not work on Windows, where Node
// refuses to spawn .cmd files without a shell.
const PYTHON_PATH = isWindows
  ? path.join(resourcesRoot, "python", "python.exe")
  : path.join(resourcesRoot, "python", "bin", "python3");
const YT_DLP_ZIPAPP = path.join(resourcesRoot, "bin", "yt-dlp.pyz");
const FFMPEG_PATH = path.join(resourcesRoot, "bin", isWindows ? "ffmpeg.exe" : "ffmpeg");

let serverProcess = null;
let mainWindow = null;
let serverOrigin = null;

/** Ask the OS for a free port rather than guessing one that may be taken. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Resolve once the server answers its own health check. */
async function waitForServer(origin, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("The bundled server did not start in time.");
}

async function startServer() {
  if (!fs.existsSync(SERVER_ENTRY)) {
    throw new Error(
      `Server bundle missing at ${SERVER_ENTRY}.\n\nRun "npm run prepare-resources" in desktop/ first.`,
    );
  }

  const port = await findFreePort();
  serverOrigin = `http://127.0.0.1:${port}`;

  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: path.join(resourcesRoot, "server"),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      // Point the app at what we ship instead of whatever is on PATH.
      YT_DLP_PATH: PYTHON_PATH,
      YT_DLP_PREFIX_ARGS: JSON.stringify([YT_DLP_ZIPAPP]),
      FFMPEG_PATH,
      // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node,
      // so the bundle needs no separate Node runtime.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null && !app.isQuitting) {
      dialog.showErrorBox("YT Tools", `The bundled server stopped unexpectedly (code ${code}).`);
      app.quit();
    }
  });

  const health = await waitForServer(serverOrigin);
  console.log(
    `[main] server ready on ${serverOrigin} — yt-dlp ${health.ytDlp.version}, ffmpeg ${health.ffmpeg.version}`,
  );
  return serverOrigin;
}

function createWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 940,
    height: 900,
    minWidth: 420,
    minHeight: 560,
    show: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#fafafa",
    webPreferences: {
      // The window only ever loads our own loopback server; it needs no Node
      // access of its own, so keep the renderer sandboxed.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(origin);

  // Links to YouTube and the like belong in the real browser, not in here.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * The web UI triggers downloads through a hidden iframe. In a browser that
 * opens a save dialog; in the app we save straight to ~/Downloads and say so,
 * which is what a desktop downloader should do.
 */
function handleDownloads() {
  const { session } = require("electron");

  session.defaultSession.on("will-download", (_event, item) => {
    const target = path.join(app.getPath("downloads"), item.getFilename());
    item.setSavePath(uniquePath(target));

    item.once("done", (_e, state) => {
      const savedTo = item.getSavePath();
      if (state === "completed") {
        if (Notification.isSupported()) {
          const note = new Notification({
            title: "Download complete",
            body: path.basename(savedTo),
          });
          note.on("click", () => shell.showItemInFolder(savedTo));
          note.show();
        }
      } else if (state === "interrupted") {
        dialog.showErrorBox("YT Tools", `The download was interrupted:\n${item.getFilename()}`);
      }
    });
  });
}

/** Never silently overwrite: "clip.mp4" becomes "clip (2).mp4". */
function uniquePath(candidate) {
  if (!fs.existsSync(candidate)) return candidate;

  const dir = path.dirname(candidate);
  const ext = path.extname(candidate);
  const stem = path.basename(candidate, ext);

  for (let n = 2; n < 1000; n += 1) {
    const next = path.join(dir, `${stem} (${n})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  return candidate;
}

function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

app.whenReady().then(async () => {
  handleDownloads();

  try {
    const origin = await startServer();
    createWindow(origin);
  } catch (err) {
    dialog.showErrorBox("YT Tools", String(err && err.message ? err.message : err));
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverOrigin) createWindow(serverOrigin);
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopServer();
});

app.on("window-all-closed", () => {
  // Standard macOS behaviour is to stay in the dock, but this app is a single
  // window with a server behind it; closing it should release the server.
  stopServer();
  app.quit();
});

process.on("exit", stopServer);
