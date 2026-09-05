import archiver from "archiver";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { AppError, toApiError } from "@/lib/errors";
import { contentDisposition, contentTypeFor } from "@/lib/format";
import { closeJob, publishProgress } from "@/lib/progress";
import { clientKey, enforceRateLimit } from "@/lib/rate-limit";
import { cleanupTempDir, createTempDir, sweepOrphanedTempDirs } from "@/lib/temp";
import { parseDownloadRequest, type ValidatedDownload } from "@/lib/validate";
import { downloadMedia } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard stop for a response nobody is reading, so scratch files can't leak. */
const STREAM_IDLE_LIMIT_MS = 30 * 60_000;

/**
 * `POST /api/download` — body `{ url, type, quality, jobId?, batchUrls?, batchName? }`.
 *
 * Downloads into a per-request scratch directory, streams the result back with
 * the right `Content-Type` / `Content-Disposition`, and deletes the scratch
 * directory as soon as the response stream closes — success, error, or client
 * disconnect alike. Nothing is ever persisted on the server.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  return runDownload(request, body);
}

/**
 * `GET /api/download?url=…&type=…&quality=…&jobId=…&smaller=1`
 *
 * Same work as the POST form, reachable by navigation. The browser can then
 * stream the response straight to disk with its own progress UI, instead of
 * JavaScript accumulating the whole file in memory before saving it — which
 * for a 1080p video means holding a quarter of a gigabyte twice over.
 *
 * Errors still return the JSON envelope; the client watches `/api/progress`
 * for them, since a failed navigation cannot surface one on its own.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return runDownload(request, {
    url: params.get("url") ?? undefined,
    type: params.get("type") ?? undefined,
    quality: Number(params.get("quality")),
    jobId: params.get("jobId") ?? undefined,
    preferSmaller: params.get("smaller") === "1",
  });
}

async function runDownload(request: Request, body: unknown) {
  let tempDir: string | null = null;
  let jobId: string | null = null;

  try {
    const req = parseDownloadRequest(body);
    jobId = req.jobId;

    // One unit per request, not per video: charging a 25-item playlist 25 units
    // would make batch downloads impossible under the default budget. Playlist
    // abuse is bounded by MAX_PLAYLIST_ITEMS and the per-run timeout instead.
    enforceRateLimit(clientKey(request));

    // Opportunistic housekeeping for directories orphaned by an earlier crash.
    void sweepOrphanedTempDirs();

    tempDir = await createTempDir();
    publishProgress(jobId, { stage: "queued", percent: null });

    const response = req.batchUrls
      ? await handleBatch(req, req.batchUrls, tempDir, request.signal, jobId)
      : await handleSingle(req, tempDir, request.signal, jobId);

    // Ownership of the scratch directory has moved to the response stream,
    // which deletes it on close. The catch block must not remove it early.
    tempDir = null;
    return response;
  } catch (err) {
    publishProgress(jobId, {
      stage: "error",
      percent: null,
      detail: err instanceof AppError ? err.message : "Download failed.",
    });
    await cleanupTempDir(tempDir);
    return toApiError(err);
  }
}

/* ------------------------------------------------------------------ *
 * Single video
 * ------------------------------------------------------------------ */

async function handleSingle(
  req: ValidatedDownload,
  tempDir: string,
  signal: AbortSignal,
  jobId: string | null,
): Promise<Response> {
  const file = await downloadMedia({
    url: req.url,
    type: req.type,
    quality: req.quality,
    destDir: tempDir,
    preferSmaller: req.preferSmaller,
    signal,
    onProgress: (event) => publishProgress(jobId, event),
  });

  publishProgress(jobId, { stage: "done", percent: 100 });

  const stream = fileStream(file.path, () => {
    void cleanupTempDir(tempDir);
    closeJob(jobId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": contentTypeFor(file.filename),
      "Content-Disposition": contentDisposition(file.filename),
      // Lets the browser render a real transfer progress bar.
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/* ------------------------------------------------------------------ *
 * Playlist batch
 * ------------------------------------------------------------------ */

async function handleBatch(
  req: ValidatedDownload,
  urls: string[],
  tempDir: string,
  signal: AbortSignal,
  jobId: string | null,
): Promise<Response> {
  const downloaded: Array<{ path: string; name: string }> = [];
  const skipped: string[] = [];

  for (const [index, url] of urls.entries()) {
    if (signal.aborted) throw new AppError("UNKNOWN", "The download was cancelled.", 499);

    const itemDir = path.join(tempDir, `item-${index}`);
    await mkdir(itemDir, { recursive: true });

    try {
      const file = await downloadMedia({
        url,
        type: req.type,
        quality: req.quality,
        destDir: itemDir,
        preferSmaller: req.preferSmaller,
        signal,
        onProgress: (event) =>
          publishProgress(jobId, {
            ...event,
            // Rescale each item's 0-100 onto its slice of the overall bar.
            percent:
              event.percent === null
                ? null
                : Math.round(((index + event.percent / 100) / urls.length) * 100),
            detail: `Item ${index + 1} of ${urls.length}`,
          }),
      });
      downloaded.push({ path: file.path, name: file.filename });
    } catch (err) {
      // One unavailable video shouldn't sink a 20-item batch; note it and move on.
      const reason = err instanceof AppError ? err.message : "Download failed.";
      skipped.push(`${url} — ${reason}`);
      console.warn("[download] skipping batch item", url, reason);
    }
  }

  if (downloaded.length === 0) {
    throw new AppError(
      "NOT_FOUND",
      "None of the selected videos could be downloaded.",
      502,
      skipped[0],
    );
  }

  publishProgress(jobId, { stage: "packaging", percent: null, detail: "Building ZIP" });

  const archive = archiver("zip", {
    // Media files are already compressed; storing is far faster and just as small.
    zlib: { level: 0 },
  });

  archive.on("warning", (err) => console.warn("[zip] warning", err));
  archive.on("error", (err) => console.error("[zip] error", err));

  const used = new Set<string>();
  for (const entry of downloaded) {
    archive.file(entry.path, { name: uniqueName(entry.name, used) });
  }

  if (skipped.length > 0) {
    archive.append(
      `These videos were skipped:\n\n${skipped.map((line) => `- ${line}`).join("\n")}\n`,
      { name: "SKIPPED.txt" },
    );
  }

  // Not awaited: finalize resolves only once the archive has been fully read,
  // and the reader is the HTTP response we are about to return.
  void archive.finalize();

  publishProgress(jobId, { stage: "done", percent: 100 });

  const cleanup = () => {
    void cleanupTempDir(tempDir);
    closeJob(jobId);
  };
  archive.on("close", cleanup);
  archive.on("end", cleanup);

  const label = req.batchName ?? "youtube-batch";
  const zipName = `${label} (${downloaded.length} ${req.type === "audio" ? "MP3" : "MP4"}).zip`;

  return new Response(
    Readable.toWeb(archive as unknown as Readable) as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(zipName),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Read a file as a web stream, running `onDone` exactly once when the stream
 * closes — whether it finished, errored, or the client hung up.
 */
function fileStream(filePath: string, onDone: () => void): ReadableStream<Uint8Array> {
  const node = createReadStream(filePath);

  // If a client opens the response and then stalls forever, tear it down so the
  // scratch directory is still reclaimed.
  const idleGuard = setTimeout(() => node.destroy(), STREAM_IDLE_LIMIT_MS);

  node.on("close", () => {
    clearTimeout(idleGuard);
    onDone();
  });
  node.on("error", (err) => console.error("[download] read stream failed", err));

  return Readable.toWeb(node) as ReadableStream<Uint8Array>;
}

/** Two playlist entries can share a title; keep ZIP entry names distinct. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";

  let counter = 2;
  let candidate = `${stem} (${counter})${ext}`;
  while (used.has(candidate)) {
    counter += 1;
    candidate = `${stem} (${counter})${ext}`;
  }

  used.add(candidate);
  return candidate;
}
