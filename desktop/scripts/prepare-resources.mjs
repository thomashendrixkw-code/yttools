/**
 * Assembles everything the packaged app needs into desktop/resources/:
 *
 *   server/   the Next.js standalone build (same server that runs in Docker)
 *   bin/      yt-dlp and ffmpeg, so the app has no external prerequisites
 *
 * Run from desktop/ via `npm run prepare-resources`.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, "..");
const repoRoot = path.resolve(desktopDir, "..");
const resources = path.join(desktopDir, "resources");
const serverDir = path.join(resources, "server");
const binDir = path.join(resources, "bin");

// yt-dlp requires Python 3.10+. macOS only ships 3.9, and the official
// standalone yt-dlp_macos binary is a PyInstaller onefile that re-extracts its
// whole runtime on every invocation — measured at 15-18s per call, which would
// dwarf the download itself. Bundling a relocatable CPython plus the 2.9 MB
// zipapp costs ~35 MB more and brings that back to ~0.8s.
const YT_DLP_ZIPAPP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

const PYTHON_RELEASE = "20260901";
const PYTHON_VERSION = "3.12.14";
const IS_WINDOWS = process.platform === "win32";
const PYTHON_TRIPLE = IS_WINDOWS
  ? "x86_64-pc-windows-msvc"
  : process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : "x86_64-apple-darwin";
/** The Windows archive puts the interpreter at the root, not under bin/. */
const PYTHON_EXE = IS_WINDOWS ? ["python.exe"] : ["bin", "python3"];
const PYTHON_URL =
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/` +
  `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${PYTHON_TRIPLE}-install_only_stripped.tar.gz`;

const step = (msg) => console.log(`\n==> ${msg}`);

/** Fetch a URL to disk, retrying transient failures. */
async function download(url, dest, attempts = 3) {
  for (let i = 1; ; i += 1) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      if (i >= attempts) throw new Error(`downloading ${url}: ${err.message}`);
      console.log(`    attempt ${i} failed (${err.message}), retrying`);
    }
  }
}

/** Recursive byte size, for reporting what the pruning actually saved. */
function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

/* ------------------------------------------------------------------ */

step("Building the Next.js app");
execFileSync(IS_WINDOWS ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: repoRoot,
  stdio: "inherit",
  // On Windows npm is a .cmd, which Node refuses to spawn directly. The
  // arguments are static, so a shell introduces nothing here.
  shell: IS_WINDOWS,
});

const standalone = path.join(repoRoot, ".next", "standalone");
if (!existsSync(standalone)) {
  throw new Error('No .next/standalone — is `output: "standalone"` still set in next.config.ts?');
}

step("Assembling the server bundle");
rmSync(serverDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

// The standalone output is a self-contained server, but Next deliberately
// leaves static assets out of it.
cpSync(standalone, serverDir, { recursive: true });
cpSync(path.join(repoRoot, ".next", "static"), path.join(serverDir, ".next", "static"), {
  recursive: true,
});
if (existsSync(path.join(repoRoot, "public"))) {
  cpSync(path.join(repoRoot, "public"), path.join(serverDir, "public"), { recursive: true });
}

// Next traces sharp and its libvips binaries into the standalone output even
// with `images.unoptimized`, but this app never calls next/image — thumbnails
// are plain <img> tags pointing at YouTube's CDN. That is 26 MB of dead
// weight; the server boots and serves fine without it.
{
  const before = dirSize(serverDir);
  for (const dead of ["@img", "sharp"]) {
    rmSync(path.join(serverDir, "node_modules", dead), { recursive: true, force: true });
  }
  const after = dirSize(serverDir);
  console.log(
    `    dropped unused image optimiser: ${(before / 1048576).toFixed(0)} MiB -> ` +
      `${(after / 1048576).toFixed(0)} MiB`,
  );
}

if (!existsSync(path.join(serverDir, "server.js"))) {
  throw new Error("server.js missing from the assembled bundle");
}
// archiver is declared in serverExternalPackages, so Next must have traced it.
if (!existsSync(path.join(serverDir, "node_modules", "archiver"))) {
  throw new Error("archiver missing from the standalone bundle — playlist ZIPs would fail");
}

/* ------------------------------------------------------------------ */

step(`Fetching CPython ${PYTHON_VERSION} (${PYTHON_TRIPLE})`);
const pythonDir = path.join(resources, "python");
if (existsSync(path.join(pythonDir, ...PYTHON_EXE))) {
  console.log("    already present, keeping it (delete resources/python to refresh)");
} else {
  rmSync(pythonDir, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  const tarball = path.join(resources, "python.tar.gz");
  await download(PYTHON_URL, tarball);
  // The archive unpacks to a top-level "python/" directory.
  execFileSync("tar", ["xzf", tarball, "-C", resources], { stdio: "inherit" });
  rmSync(tarball, { force: true });
}

step("Pruning the Python runtime");
{
  // A CPython install carries a lot that yt-dlp never touches. __pycache__ is
  // deliberately *kept*: the bundle is read-only, so Python would otherwise
  // recompile the stdlib on every launch.
  //
  // Paths are spelled out per platform rather than pattern-matched. A loose
  // regex over `lib/` deleted threading.py on Windows, where the filesystem is
  // case-insensitive and `lib` resolves to the stdlib's `Lib`.
  const stdlib = IS_WINDOWS
    ? path.join(pythonDir, "Lib")
    : path.join(pythonDir, "lib", "python3.12");
  const before = dirSize(pythonDir);

  const doomed = [
    path.join(stdlib, "site-packages"), // pip; the bundle installs nothing
    path.join(stdlib, "ensurepip"),
    path.join(stdlib, "idlelib"),
    path.join(stdlib, "lib2to3"),
    path.join(stdlib, "pydoc_data"),
    path.join(stdlib, "turtledemo"),
    path.join(stdlib, "tkinter"),
    path.join(stdlib, "test"),
  ];

  if (IS_WINDOWS) {
    doomed.push(path.join(pythonDir, "tcl"));
    for (const dll of ["_tkinter.pyd", "tcl86t.dll", "tk86t.dll"]) {
      doomed.push(path.join(pythonDir, "DLLs", dll));
    }
  } else {
    doomed.push(path.join(pythonDir, "include"), path.join(pythonDir, "share"));

    // Tcl/Tk artefacts sit directly in lib/ on macOS. The trailing digit is
    // what keeps this off stdlib modules: "thread2.8.10" matches, but
    // "threading.py" does not.
    const lib = path.join(pythonDir, "lib");
    for (const entry of readdirSync(lib)) {
      if (/^(lib)?(tcl|tk|itcl|thread)[0-9]/i.test(entry)) doomed.push(path.join(lib, entry));
    }

    // Launcher scripts for the modules just removed; they would only fail.
    const pyBin = path.join(pythonDir, "bin");
    if (existsSync(pyBin)) {
      for (const entry of readdirSync(pyBin)) {
        if (/^(2to3|idle3?|pydoc3?|pip3?)/.test(entry)) doomed.push(path.join(pyBin, entry));
      }
    }
  }

  for (const target of doomed) rmSync(target, { recursive: true, force: true });

  const after = dirSize(pythonDir);
  console.log(
    `    ${(before / 1048576).toFixed(0)} MiB -> ${(after / 1048576).toFixed(0)} MiB` +
      `  (saved ${((before - after) / 1048576).toFixed(0)} MiB)`,
  );
}

// Pruning is the one step that can quietly break the interpreter, so prove the
// modules yt-dlp actually needs still import before going any further.
{
  const pythonExe = path.join(pythonDir, ...PYTHON_EXE);
  const probe =
    "import threading, ssl, json, sqlite3, ctypes, email, http.cookiejar, urllib.request";
  execFileSync(pythonExe, ["-c", probe], { stdio: "inherit" });
  console.log("    stdlib probe: ok");
}

step("Fetching the yt-dlp zipapp");
mkdirSync(binDir, { recursive: true });
const zipapp = path.join(binDir, "yt-dlp.pyz");
if (existsSync(zipapp)) {
  console.log("    already present, keeping it (delete it to refresh)");
} else {
  await download(YT_DLP_ZIPAPP_URL, zipapp);
}

// No wrapper script: the app is told to run `python <zipapp>` directly, which
// works identically on both platforms. See main.js.
rmSync(path.join(binDir, "yt-dlp"), { force: true });
rmSync(path.join(binDir, "yt-dlp_macos"), { force: true });

step("Collecting ffmpeg");
// ffmpeg-static ships a build whose only dependencies are macOS system
// frameworks, unlike Homebrew's, which links 19 dylibs under /opt/homebrew and
// would break on any machine without it.
const { default: ffmpegStatic } = await import("ffmpeg-static");
if (!ffmpegStatic) throw new Error("ffmpeg-static did not resolve a binary for this platform");
const ffmpegTarget = path.join(binDir, IS_WINDOWS ? "ffmpeg.exe" : "ffmpeg");
cpSync(ffmpegStatic, ffmpegTarget);
chmodSync(ffmpegTarget, 0o755);

// LGPL requires the licence to travel with the binary.
const ffmpegLicense = `${ffmpegStatic}.LICENSE`;
if (existsSync(ffmpegLicense)) cpSync(ffmpegLicense, path.join(binDir, "ffmpeg.LICENSE"));

/* ------------------------------------------------------------------ */

step("Verifying the bundled binaries run");
const pythonExe = path.join(pythonDir, ...PYTHON_EXE);
for (const [name, bin, args] of [
  ["yt-dlp", pythonExe, [zipapp, "--version"]],
  ["ffmpeg", ffmpegTarget, ["-version"]],
]) {
  const started = Date.now();
  const out = execFileSync(bin, args, { encoding: "utf8" }).split("\n")[0];
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`    ${name.padEnd(7)} ${elapsed.padStart(6)}s  ${out.trim()}`);
}

writeFileSync(
  path.join(resources, "BUILD_INFO.txt"),
  `Assembled ${new Date().toISOString()}\nnode ${process.version}\n`,
);

step("Resources ready");
for (const part of ["server", "python", "bin"]) {
  const dir = path.join(resources, part);
  if (existsSync(dir))
    console.log(`    ${part.padEnd(7)} ${(dirSize(dir) / 1048576).toFixed(0).padStart(4)} MiB`);
}
