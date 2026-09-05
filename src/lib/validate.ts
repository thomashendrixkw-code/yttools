import { AppError } from "./errors";
import { AUDIO_BITRATES, type AudioBitrate, type DownloadRequest } from "./types";

/** Hostnames we accept. Anything else is rejected before yt-dlp is spawned. */
const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/** Heights the UI may request. Guards against absurd values reaching yt-dlp. */
const ALLOWED_HEIGHTS = new Set([144, 240, 360, 480, 720, 1080, 1440, 2160, 4320]);

/**
 * Validate and canonicalise a user-supplied YouTube URL.
 *
 * This is the security boundary for the whole app: the returned string is the
 * only thing handed to yt-dlp, and it is always rebuilt from parsed components
 * rather than passed through verbatim.
 */
export function parseYouTubeUrl(raw: unknown): { url: string; isPlaylist: boolean } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new AppError("INVALID_URL", "Paste a YouTube URL to get started.");
  }

  const trimmed = raw.trim();
  // Be forgiving about a missing scheme — people copy "youtu.be/..." all the time.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new AppError("INVALID_URL", "That doesn't look like a valid URL.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AppError("INVALID_URL", "Only http and https URLs are supported.");
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new AppError(
      "INVALID_URL",
      "Only YouTube links are supported (youtube.com or youtu.be).",
    );
  }

  const listId = parsed.searchParams.get("list");
  const videoId = extractVideoId(parsed);

  // A "watch?v=...&list=..." URL is a video inside a playlist. We treat it as a
  // single video: that is what the user clicked on. Bare "playlist?list=..."
  // and "watch?list=..." without a video are handled as playlists.
  if (videoId) {
    return { url: `https://www.youtube.com/watch?v=${videoId}`, isPlaylist: false };
  }

  if (listId && isSafeId(listId)) {
    return { url: `https://www.youtube.com/playlist?list=${listId}`, isPlaylist: true };
  }

  throw new AppError(
    "INVALID_URL",
    "Couldn't find a video or playlist ID in that link. Try the full watch URL.",
  );
}

/** Pull the 11-character video ID out of any of YouTube's URL shapes. */
function extractVideoId(parsed: URL): string | null {
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);

  // youtu.be/<id>
  if (host.endsWith("youtu.be")) {
    const candidate = segments[0];
    return candidate && isSafeId(candidate) ? candidate : null;
  }

  // youtube.com/watch?v=<id>
  const queryId = parsed.searchParams.get("v");
  if (queryId && isSafeId(queryId)) return queryId;

  // youtube.com/{shorts,live,embed,v}/<id>
  const [prefix, candidate] = segments;
  if (prefix && candidate && ["shorts", "live", "embed", "v"].includes(prefix)) {
    return isSafeId(candidate) ? candidate : null;
  }

  return null;
}

/** YouTube IDs are URL-safe base64-ish. Reject anything else outright. */
function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export interface ValidatedDownload {
  url: string;
  type: "video" | "audio";
  /** Target height in px for video, bitrate in kbps for audio. */
  quality: number;
  jobId: string | null;
  batchUrls: string[] | null;
  /** Sanitised ZIP base name for batch downloads. */
  batchName: string | null;
  /** Trade codec compatibility for fewer bytes. */
  preferSmaller: boolean;
}

/** Validate the `POST /api/download` body end to end. */
export function parseDownloadRequest(body: unknown): ValidatedDownload {
  if (typeof body !== "object" || body === null) {
    throw new AppError("INVALID_REQUEST", "Malformed request body.");
  }

  const { url, type, quality, jobId, batchUrls, batchName, preferSmaller } =
    body as Partial<DownloadRequest>;

  if (type !== "video" && type !== "audio") {
    throw new AppError("INVALID_REQUEST", '`type` must be either "video" or "audio".');
  }

  if (typeof quality !== "number" || !Number.isFinite(quality)) {
    throw new AppError("INVALID_REQUEST", "`quality` must be a number.");
  }

  if (type === "video" && !ALLOWED_HEIGHTS.has(quality)) {
    throw new AppError("INVALID_REQUEST", "That video resolution isn't supported.");
  }

  if (type === "audio" && !AUDIO_BITRATES.includes(quality as AudioBitrate)) {
    throw new AppError("INVALID_REQUEST", "Bitrate must be 128, 192, or 320 kbps.");
  }

  const maxItems = Number(process.env.MAX_PLAYLIST_ITEMS ?? 25);
  let validatedBatch: string[] | null = null;

  if (batchUrls !== undefined) {
    if (!Array.isArray(batchUrls) || batchUrls.length === 0) {
      throw new AppError("INVALID_REQUEST", "`batchUrls` must be a non-empty array.");
    }
    if (batchUrls.length > maxItems) {
      throw new AppError(
        "PLAYLIST_TOO_LARGE",
        `Batch downloads are capped at ${maxItems} videos. Select fewer items.`,
      );
    }
    // Each entry goes through the same canonicalisation as a single download.
    validatedBatch = batchUrls.map((entry) => parseYouTubeUrl(entry).url);
  }

  return {
    url: parseYouTubeUrl(url).url,
    type,
    quality,
    jobId: typeof jobId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(jobId) ? jobId : null,
    batchUrls: validatedBatch,
    batchName: sanitiseBatchName(batchName),
    preferSmaller: preferSmaller === true,
  };
}

/**
 * The batch name only ever becomes a ZIP filename, so strip anything that
 * could break out of a path or terminate an HTTP header.
 */
function sanitiseBatchName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value
    .replace(/[\r\n\t"\\/:*?<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return clean.length > 0 ? clean : null;
}
