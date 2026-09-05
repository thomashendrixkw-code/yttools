import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BinaryName = "yt-dlp" | "ffmpeg";

export interface ResolvedBinary {
  path: string;
  version: string | null;
}

/**
 * Resolved binaries are cached for the lifetime of the process — the host's
 * PATH does not change under us, and re-running `--version` on every request
 * would add ~50ms of pure overhead per download.
 */
const cache = new Map<BinaryName, ResolvedBinary | null>();

const ENV_OVERRIDE: Record<BinaryName, string> = {
  "yt-dlp": "YT_DLP_PATH",
  ffmpeg: "FFMPEG_PATH",
};

/** True when `candidate` exists and is executable by this process. */
async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk PATH looking for `name`. We do this by hand rather than shelling out to
 * `which` so that no user-controlled string ever reaches a shell.
 */
async function searchPath(name: string): Promise<string | null> {
  const pathEnv = process.env.PATH ?? "";
  const extraDirs = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  const dirs = [...pathEnv.split(path.delimiter), ...extraDirs].filter(Boolean);

  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

/**
 * Arguments to place before every yt-dlp invocation.
 *
 * The desktop build ships a Python interpreter plus yt-dlp as a zipapp, so
 * `YT_DLP_PATH` is the interpreter and this is the script it must run. Going
 * through a shell wrapper instead would not work on Windows, where Node
 * refuses to spawn `.cmd` files without `shell: true`.
 */
export function ytDlpPrefixArgs(): string[] {
  const raw = process.env.YT_DLP_PREFIX_ARGS;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === "string") : [];
  } catch {
    console.error("[binaries] YT_DLP_PREFIX_ARGS is not a JSON array; ignoring it");
    return [];
  }
}

/** Ask a binary for its version string; failure is non-fatal. */
async function readVersion(binPath: string, name: BinaryName): Promise<string | null> {
  try {
    // ffmpeg uses a single dash and rejects `--version`; yt-dlp wants two.
    const flag = name === "ffmpeg" ? "-version" : "--version";
    const argv = name === "yt-dlp" ? [...ytDlpPrefixArgs(), flag] : [flag];
    const { stdout } = await execFileAsync(binPath, argv, { timeout: 10_000 });
    const first = stdout.trim().split("\n")[0] ?? "";
    // ffmpeg prints "ffmpeg version 6.1.1 Copyright ..."; yt-dlp prints a bare date-version.
    if (name === "ffmpeg") return first.replace(/^ffmpeg version\s*/i, "").split(" ")[0] ?? null;
    return first || null;
  } catch {
    return null;
  }
}

/**
 * Locate a required external binary, honouring the `YT_DLP_PATH` /
 * `FFMPEG_PATH` env overrides before falling back to a PATH search.
 * Returns null when the binary is not installed.
 */
export async function resolveBinary(name: BinaryName): Promise<ResolvedBinary | null> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const override = process.env[ENV_OVERRIDE[name]];
  const found = override && (await isExecutable(override)) ? override : await searchPath(name);

  const result: ResolvedBinary | null = found
    ? { path: found, version: await readVersion(found, name) }
    : null;

  cache.set(name, result);
  return result;
}

/**
 * Resolve a binary or throw a user-facing error explaining how to install it.
 * Route handlers let this bubble up to `toApiError`.
 */
export async function requireBinary(name: BinaryName): Promise<ResolvedBinary> {
  const bin = await resolveBinary(name);
  if (bin) return bin;

  const install =
    name === "yt-dlp"
      ? "Install it with `brew install yt-dlp` (macOS), `pipx install yt-dlp`, or use the provided Dockerfile."
      : "Install it with `brew install ffmpeg` (macOS), `apt-get install ffmpeg` (Debian/Ubuntu), or use the provided Dockerfile.";

  const error = new Error(`${name} is not installed on the server.`) as Error & {
    code: string;
    hint: string;
  };
  error.code = "MISSING_BINARY";
  error.hint = install;
  throw error;
}
