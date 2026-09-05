import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PREFIX = "yttools-";

/**
 * Create a private scratch directory for one download. Every job gets its own
 * directory so that "the finished file" is simply "the only file in here",
 * which avoids brittle filename prediction from yt-dlp's output template.
 */
export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), PREFIX));
}

/** Remove a scratch directory. Safe to call twice; never throws. */
export async function cleanupTempDir(dir: string | null): Promise<void> {
  if (!dir) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error("[temp] failed to remove scratch dir", dir, err);
  }
}

/**
 * The single media file yt-dlp produced, or null when the directory is empty.
 * Partial artefacts (`.part`, `.ytdl`, `.temp`) are ignored — if yt-dlp exited
 * cleanly they should already be gone, but a killed process can leave them.
 */
export async function findOutputFile(dir: string): Promise<{ path: string; size: number } | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isFile() && !/\.(part|ytdl|temp)$/i.test(entry.name))
    .map((entry) => path.join(dir, entry.name));

  if (candidates.length === 0) return null;

  // With multiple leftovers (rare), prefer the largest — that is the real media.
  const sized = await Promise.all(
    candidates.map(async (file) => ({ path: file, size: (await stat(file)).size })),
  );
  sized.sort((a, b) => b.size - a.size);
  return sized[0] ?? null;
}

/**
 * Safety net for scratch directories orphaned by a crash or a hard restart:
 * anything older than `maxAgeMs` is removed. Called opportunistically at the
 * start of each download rather than on a timer, so it costs nothing when idle.
 */
export async function sweepOrphanedTempDirs(maxAgeMs = 60 * 60_000): Promise<void> {
  try {
    const tmp = os.tmpdir();
    const entries = await readdir(tmp, { withFileTypes: true });
    const now = Date.now();

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(PREFIX))
        .map(async (entry) => {
          const full = path.join(tmp, entry.name);
          try {
            const info = await stat(full);
            if (now - info.mtimeMs > maxAgeMs) await rm(full, { recursive: true, force: true });
          } catch {
            // Another request may have cleaned it up first — that is fine.
          }
        }),
    );
  } catch (err) {
    console.error("[temp] orphan sweep failed", err);
  }
}
