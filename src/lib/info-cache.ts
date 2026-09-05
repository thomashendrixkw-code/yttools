import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Caches the JSON yt-dlp produces during metadata extraction so the follow-up
 * download can skip extracting the same video a second time.
 *
 * Extraction costs ~2-4s and is pure overhead: `/api/info` has already done it
 * by the time the user picks a quality and clicks download. Passing the saved
 * document back via `--load-info-json` measured 4.61s -> 0.97s on the same
 * download, and unlike anything network-related that saving is deterministic.
 *
 * The cached document embeds time-limited googlevideo URLs, so entries are
 * short-lived and every consumer must be able to fall back to a fresh
 * extraction when a cached download fails.
 */
const CACHE_DIR = path.join(os.tmpdir(), "yttools-infocache");

/** Comfortably inside googlevideo's URL lifetime. */
const TTL_MS = 20 * 60_000;

interface Entry {
  file: string;
  expiresAt: number;
}

// Survives Next.js dev-mode module reloads.
const globalStore = globalThis as typeof globalThis & {
  __ytToolsInfoCache?: Map<string, Entry>;
};
const entries: Map<string, Entry> = (globalStore.__ytToolsInfoCache ??= new Map());

function fileFor(url: string): string {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${digest}.info.json`);
}

/** Remove expired entries and their files. Cheap; called on every access. */
function sweep(): void {
  const now = Date.now();
  for (const [url, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(url);
      void rm(entry.file, { force: true }).catch(() => {});
    }
  }
}

/** Persist the raw `yt-dlp -J` document for `url`. Never throws. */
export async function storeInfo(url: string, rawJson: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const file = fileFor(url);
    await writeFile(file, rawJson, "utf8");
    entries.set(url, { file, expiresAt: Date.now() + TTL_MS });
    sweep();
  } catch (err) {
    // A cache that cannot be written is a missed optimisation, not a failure.
    console.error("[info-cache] could not store", err);
  }
}

/** Path to a still-valid cached document for `url`, or null. */
export function lookupInfo(url: string): string | null {
  sweep();
  const entry = entries.get(url);
  return entry && entry.expiresAt > Date.now() ? entry.file : null;
}

/** Forget `url`, e.g. after a cached download failed on an expired URL. */
export async function dropInfo(url: string): Promise<void> {
  const entry = entries.get(url);
  if (!entry) return;
  entries.delete(url);
  await rm(entry.file, { force: true }).catch(() => {});
}
