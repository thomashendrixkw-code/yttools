/**
 * Assembles everything the packaged app needs into desktop/resources/:
 *
 *   server/   the Next.js standalone build (same server that runs in Docker)
 *   bin/      yt-dlp and ffmpeg, so the app has no external prerequisites
 *
 * Run from desktop/ via `npm run prepare-resources`.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const PYTHON_TRIPLE = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
const PYTHON_URL =
  `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/` +
  `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${PYTHON_TRIPLE}-install_only_stripped.tar.gz`;

const step = (msg) => console.log(`\n==> ${msg}`);

/* ------------------------------------------------------------------ */

step("Building the Next.js app");
execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });

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
if (existsSync(path.join(pythonDir, "bin", "python3"))) {
  console.log("    already present, keeping it (delete resources/python to refresh)");
} else {
  rmSync(pythonDir, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  const tarball = path.join(resources, "python.tar.gz");
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", tarball, PYTHON_URL], { stdio: "inherit" });
  // The archive unpacks to a top-level "python/" directory.
  execFileSync("tar", ["xzf", tarball, "-C", resources], { stdio: "inherit" });
  rmSync(tarball, { force: true });
}

step("Fetching the yt-dlp zipapp");
mkdirSync(binDir, { recursive: true });
const zipapp = path.join(binDir, "yt-dlp.pyz");
if (existsSync(zipapp)) {
  console.log("    already present, keeping it (delete it to refresh)");
} else {
  execFileSync("curl", ["-fsSL", "--retry", "3", "-o", zipapp, YT_DLP_ZIPAPP_URL], {
    stdio: "inherit",
  });
}

// A shell shim so the app can treat yt-dlp as an ordinary executable and keep
// using YT_DLP_PATH, with no knowledge of how it is packaged.
const shim = path.join(binDir, "yt-dlp");
writeFileSync(
  shim,
  `#!/bin/sh
# Runs the bundled yt-dlp zipapp with the bundled CPython.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/../python/bin/python3" "$DIR/yt-dlp.pyz" "$@"
`,
);
chmodSync(shim, 0o755);
// The standalone binary, if a previous build left one behind, is dead weight.
rmSync(path.join(binDir, "yt-dlp_macos"), { force: true });

step("Collecting ffmpeg");
// ffmpeg-static ships a build whose only dependencies are macOS system
// frameworks, unlike Homebrew's, which links 19 dylibs under /opt/homebrew and
// would break on any machine without it.
const { default: ffmpegStatic } = await import("ffmpeg-static");
if (!ffmpegStatic) throw new Error("ffmpeg-static did not resolve a binary for this platform");
const ffmpegTarget = path.join(binDir, "ffmpeg");
cpSync(ffmpegStatic, ffmpegTarget);
chmodSync(ffmpegTarget, 0o755);

// LGPL requires the licence to travel with the binary.
const ffmpegLicense = `${ffmpegStatic}.LICENSE`;
if (existsSync(ffmpegLicense)) cpSync(ffmpegLicense, path.join(binDir, "ffmpeg.LICENSE"));

/* ------------------------------------------------------------------ */

step("Verifying the bundled binaries run");
for (const [name, bin, flag] of [
  ["yt-dlp", shim, "--version"],
  ["ffmpeg", ffmpegTarget, "-version"],
]) {
  const started = Date.now();
  const out = execFileSync(bin, [flag], { encoding: "utf8" }).split("\n")[0];
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`    ${name.padEnd(7)} ${elapsed.padStart(6)}s  ${out.trim()}`);
}

writeFileSync(
  path.join(resources, "BUILD_INFO.txt"),
  `Assembled ${new Date().toISOString()}\nnode ${process.version}\n`,
);

step("Resources ready");
