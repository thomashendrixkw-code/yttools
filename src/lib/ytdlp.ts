import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { requireBinary, resolveBinary } from "./binaries";
import { AppError, fromYtDlpStderr } from "./errors";
import { dropInfo, lookupInfo, storeInfo } from "./info-cache";
import { findOutputFile } from "./temp";
import type { MediaInfo, PlaylistEntry, ProgressEvent, VideoQualityOption } from "./types";

const DOWNLOAD_TIMEOUT_MS = Number(process.env.DOWNLOAD_TIMEOUT_MS ?? 900_000);
const INFO_TIMEOUT_MS = 60_000;

/** Markers injected via --progress-template so progress lines are unambiguous. */
const DL_MARKER = "[[DL]]";
const PP_MARKER = "[[PP]]";

/** Strips ANSI escapes. yt-dlp disables colour on a pipe, but be defensive. */
const ANSI_RE = new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g");

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

interface RunOptions {
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  /** Called for each complete stdout line, as it arrives. */
  onStdoutLine?: (line: string) => void;
}

/**
 * Spawn yt-dlp with an argument array — never a shell string, so no user input
 * can ever be interpreted as a shell metacharacter.
 */
async function runYtDlp({ args, timeoutMs, signal, onStdoutLine }: RunOptions): Promise<RunResult> {
  const ytDlp = await requireBinary("yt-dlp");

  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(ytDlp.path, args, {
      signal,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!onStdoutLine) return;

      // Emit whole lines only; yt-dlp's --newline mode writes one update per line.
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) onStdoutLine(line.replace(ANSI_RE, ""));
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Cap stderr so a pathological run cannot exhaust memory.
      if (stderr.length < 64_000) stderr += chunk;
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        reject(new AppError("UNKNOWN", "The download was cancelled.", 499));
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (pending && onStdoutLine) onStdoutLine(pending.replace(ANSI_RE, ""));
      if (timedOut) {
        reject(
          new AppError(
            "TIMEOUT",
            "The download took too long and was stopped.",
            504,
            "Try a lower resolution, or raise DOWNLOAD_TIMEOUT_MS on the server.",
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * yt-dlp's stderr is the only real diagnostic when a run fails, and the client
 * deliberately never sees it (it can contain filesystem paths). Log it so the
 * operator can, then map it to a safe user-facing error.
 */
function failFromStderr(stderr: string, code: number | null): AppError {
  const detail = stderr.trim();
  console.error(
    `[yt-dlp] exited with code ${code ?? "null"}\n${detail.slice(-4000) || "(no stderr output)"}`,
  );
  return fromYtDlpStderr(detail, code);
}

/** Arguments shared by every invocation. */
function baseArgs(): string[] {
  const args = [
    // Ignore any yt-dlp config on the host so behaviour is reproducible.
    "--ignore-config",
    "--no-warnings",
    "--no-mtime",
    "--retries",
    "3",
    "--socket-timeout",
    "20",
  ];

  const cookies = process.env.YT_DLP_COOKIES;
  if (cookies) args.push("--cookies", cookies);

  return args;
}

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

/** The subset of yt-dlp's `-J` output that we actually consume. */
interface RawFormat {
  format_id?: string;
  ext?: string;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  tbr?: number | null;
}

interface RawInfo {
  _type?: string;
  id?: string;
  title?: string;
  channel?: string | null;
  uploader?: string | null;
  channel_url?: string | null;
  uploader_url?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  thumbnails?: Array<{ url?: string; preference?: number; height?: number }>;
  upload_date?: string | null;
  view_count?: number | null;
  webpage_url?: string | null;
  url?: string | null;
  is_live?: boolean | null;
  live_status?: string | null;
  formats?: RawFormat[];
  entries?: RawInfo[];
  playlist_count?: number | null;
}

/**
 * Run `yt-dlp -J` and parse the resulting JSON document. The raw text comes
 * back alongside the parsed form so it can be handed to the info cache
 * verbatim — re-serialising our narrowed `RawInfo` would drop the fields
 * yt-dlp needs to resume without re-extracting.
 */
async function dumpJson(
  args: string[],
  signal?: AbortSignal,
): Promise<{ info: RawInfo; raw: string }> {
  const result = await runYtDlp({ args, timeoutMs: INFO_TIMEOUT_MS, signal });

  if (result.code !== 0) throw failFromStderr(result.stderr, result.code);

  try {
    return { info: JSON.parse(result.stdout) as RawInfo, raw: result.stdout };
  } catch {
    throw new AppError("UNKNOWN", "yt-dlp returned a response we couldn't read.", 502);
  }
}

/** Pick the largest available thumbnail, preferring the one yt-dlp recommends. */
function pickThumbnail(info: RawInfo): string | null {
  if (info.thumbnail) return info.thumbnail;
  const candidates = (info.thumbnails ?? []).filter((t): t is { url: string; height?: number } =>
    Boolean(t.url),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return candidates[0]?.url ?? null;
}

/**
 * Collapse yt-dlp's format list into the handful of resolutions worth showing.
 *
 * YouTube returns dozens of formats per video (separate video-only and
 * audio-only tracks in several codecs). Users care about one axis — height —
 * so we keep the best entry per height and add the smallest audio track's size
 * to produce a realistic combined estimate.
 */
function buildQualityOptions(formats: RawFormat[]): VideoQualityOption[] {
  const videoFormats = formats.filter(
    (f) => typeof f.height === "number" && f.height > 0 && f.vcodec && f.vcodec !== "none",
  );

  // Smallest audio-only track, used to estimate the size of a merged download.
  const audioSizes = formats
    .filter((f) => f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"))
    .map((f) => f.filesize ?? f.filesize_approx ?? null)
    .filter((size): size is number => typeof size === "number");
  const audioBytes = audioSizes.length > 0 ? Math.min(...audioSizes) : 0;

  const byHeight = new Map<
    number,
    { fps: number | null; bytes: number | null; hasAudio: boolean }
  >();

  for (const format of videoFormats) {
    const height = format.height as number;
    const bytes = format.filesize ?? format.filesize_approx ?? null;
    const hasAudio = Boolean(format.acodec && format.acodec !== "none");
    const existing = byHeight.get(height);

    // Prefer an entry we can actually size, then the higher frame rate.
    const better =
      !existing ||
      (bytes !== null && existing.bytes === null) ||
      (format.fps ?? 0) > (existing.fps ?? 0);

    if (better) byHeight.set(height, { fps: format.fps ?? null, bytes, hasAudio });
  }

  return [...byHeight.entries()]
    .map(([height, meta]) => ({
      height,
      label: meta.fps && meta.fps >= 50 ? `${height}p${Math.round(meta.fps)}` : `${height}p`,
      approxBytes: meta.bytes === null ? null : meta.bytes + (meta.hasAudio ? 0 : audioBytes),
      fps: meta.fps,
    }))
    .sort((a, b) => b.height - a.height);
}

/** Map a raw yt-dlp info dict onto our `MediaInfo` contract. */
function toMediaInfo(info: RawInfo, fallbackUrl: string): MediaInfo {
  const isLive = Boolean(info.is_live) || info.live_status === "is_live";

  return {
    id: info.id ?? "",
    title: info.title ?? "Untitled",
    channel: info.channel ?? info.uploader ?? null,
    channelUrl: info.channel_url ?? info.uploader_url ?? null,
    duration: typeof info.duration === "number" ? Math.round(info.duration) : null,
    thumbnail: pickThumbnail(info),
    uploadDate: info.upload_date ?? null,
    viewCount: typeof info.view_count === "number" ? info.view_count : null,
    webpageUrl: info.webpage_url ?? fallbackUrl,
    isLive,
    qualities: buildQualityOptions(info.formats ?? []),
  };
}

/** Fetch full metadata (including formats) for a single video. */
export async function fetchVideoInfo(url: string, signal?: AbortSignal): Promise<MediaInfo> {
  const { info, raw } = await dumpJson([...baseArgs(), "-J", "--no-playlist", url], signal);

  if (info._type === "playlist") {
    throw new AppError("INVALID_URL", "That link resolved to a playlist, not a single video.");
  }

  const media = toMediaInfo(info, url);

  if (media.isLive) {
    throw new AppError(
      "LIVE_STREAM",
      "That video is currently live. Try again once the stream has ended.",
    );
  }

  if (media.qualities.length === 0) {
    throw new AppError("NO_MATCHING_FORMAT", "No downloadable video formats were found.", 422);
  }

  // The download that almost certainly follows can now skip extraction.
  await storeInfo(url, raw);

  return media;
}

export interface PlaylistInfo {
  id: string;
  title: string;
  channel: string | null;
  totalCount: number;
  entries: PlaylistEntry[];
  truncated: boolean;
}

/**
 * Fetch a playlist's contents. Uses `--flat-playlist` so YouTube is queried
 * once instead of once per video — probing formats for 200 videos would take
 * minutes, and we only need titles here.
 */
export async function fetchPlaylistInfo(
  url: string,
  maxItems: number,
  signal?: AbortSignal,
): Promise<PlaylistInfo> {
  const { info } = await dumpJson(
    [
      ...baseArgs(),
      "-J",
      "--flat-playlist",
      "--playlist-end",
      // Fetch one extra so we can tell "exactly at the cap" from "truncated".
      String(maxItems + 1),
      url,
    ],
    signal,
  );

  const rawEntries = (info.entries ?? []).filter((entry) => Boolean(entry?.id));
  const truncated = rawEntries.length > maxItems;
  const entries: PlaylistEntry[] = rawEntries.slice(0, maxItems).map((entry) => ({
    id: entry.id ?? "",
    title: entry.title ?? "Untitled",
    duration: typeof entry.duration === "number" ? Math.round(entry.duration) : null,
    thumbnail: pickThumbnail(entry),
    webpageUrl: entry.webpage_url ?? entry.url ?? `https://www.youtube.com/watch?v=${entry.id}`,
  }));

  if (entries.length === 0) {
    throw new AppError("NOT_FOUND", "That playlist is empty or unavailable.", 404);
  }

  return {
    id: info.id ?? "",
    title: info.title ?? "Untitled playlist",
    channel: info.channel ?? info.uploader ?? null,
    totalCount: info.playlist_count ?? rawEntries.length,
    entries,
    truncated,
  };
}

/* ------------------------------------------------------------------ *
 * Download
 * ------------------------------------------------------------------ */

/**
 * Build the format selector for a video download.
 *
 * Preference order: an H.264 video track plus an AAC audio track (these merge
 * into MP4 without re-encoding), then any separate tracks at that height, then
 * a progressive single-file format, then whatever exists.
 */
function videoFormatSelector(height: number, canMerge: boolean, preferSmaller: boolean): string {
  // Without ffmpeg, yt-dlp cannot combine separate tracks — it would leave two
  // files behind and we would ship a silent video. Restrict to progressive
  // (single-file, audio included) formats instead, which top out at 720p.
  if (!canMerge) {
    return [`b[height<=${height}][ext=mp4]`, `b[height<=${height}]`, "b"].join("/");
  }

  // Smallest-first: let --format-sort pick the leanest track at this height,
  // whatever the codec. YouTube's VP9 rendition is routinely a third smaller
  // than its H.264 one at the same resolution, which is the only lever that
  // actually reduces bytes on the wire.
  if (preferSmaller) {
    return [`bv*[height<=${height}]+ba`, `b[height<=${height}]`, "b"].join("/");
  }

  return [
    // H.264 + AAC first: universally playable, and merges into MP4 untouched.
    `bv*[height<=${height}][vcodec^=avc1]+ba[ext=m4a]`,
    // Then any MP4-compatible track (AV1/VP9) — needed above 1080p, where
    // YouTube often publishes no H.264 rendition at all.
    `bv*[height<=${height}][ext=mp4]+ba[ext=m4a]`,
    `bv*[height<=${height}]+ba`,
    `b[height<=${height}][ext=mp4]`,
    `b[height<=${height}]`,
    "b",
  ].join("/");
}

export interface DownloadOptions {
  url: string;
  type: "video" | "audio";
  /** Height in px for video, bitrate in kbps for audio. */
  quality: number;
  destDir: string;
  /** Trade codec compatibility for fewer bytes. See videoFormatSelector. */
  preferSmaller?: boolean;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
}

export interface DownloadedFile {
  path: string;
  size: number;
  filename: string;
}

/**
 * Download one video into `destDir` and return the resulting file.
 *
 * The output template writes into a directory the caller owns exclusively, so
 * the finished file is simply whatever ends up in there — no need to predict
 * yt-dlp's sanitised filename.
 */
export async function downloadMedia({
  url,
  type,
  quality,
  destDir,
  preferSmaller = false,
  onProgress,
  signal,
}: DownloadOptions): Promise<DownloadedFile> {
  const ffmpeg = await resolveBinary("ffmpeg");

  // Audio always needs ffmpeg (for MP3 encoding); video needs it whenever the
  // chosen streams must be merged, which is every resolution above 720p.
  if (type === "audio" && !ffmpeg) await requireBinary("ffmpeg");

  const outputTemplate = path.join(destDir, "%(title).120B [%(id)s].%(ext)s");

  /**
   * `infoJson` is a path to a cached `yt-dlp -J` document. Supplying it skips
   * re-extracting a video `/api/info` already described, which is worth ~3.6s
   * on every download.
   */
  function buildArgs(infoJson: string | null): string[] {
    const args = [
      ...baseArgs(),
      "--no-playlist",
      "--newline",
      "--progress",
      "--progress-template",
      `download:${DL_MARKER}%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s`,
      "--progress-template",
      `postprocess:${PP_MARKER}%(progress.postprocessor)s|%(progress.status)s`,
      "-o",
      outputTemplate,
    ];

    if (ffmpeg) args.push("--ffmpeg-location", ffmpeg.path);

    if (type === "video") {
      args.push("-f", videoFormatSelector(quality, ffmpeg !== null, preferSmaller));
      if (preferSmaller) {
        // Highest resolution within the cap, then the smallest file at it.
        args.push("-S", "res,+size,+br");
        // Smallest-first can land on VP9/Opus, which MP4 cannot always hold.
        args.push("--merge-output-format", "mp4/webm/mkv");
      } else {
        args.push("--merge-output-format", "mp4");
      }
    } else {
      args.push(
        "-f",
        "ba/b",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        `${quality}K`,
        // Copies title/artist/date into ID3 tags. Handled by ffmpeg, no extra deps.
        "--embed-metadata",
      );
    }

    // With a cached document yt-dlp works from it instead of a URL.
    if (infoJson) args.push("--load-info-json", infoJson);
    else args.push(url);

    return args;
  }

  /**
   * yt-dlp reports each stream's progress from 0-100 independently. A fresh
   * tracker per attempt keeps a retry from inheriting the previous phase.
   */
  function makeLineHandler(): (line: string) => void {
    let phase = 0;
    let lastPercent = -1;

    return (line: string) => {
      if (!onProgress) return;

      if (line.startsWith(DL_MARKER)) {
        const [percentStr = "", speed = "", eta = ""] = line.slice(DL_MARKER.length).split("|");
        const percent = Number.parseFloat(percentStr.replace("%", "").trim());
        if (!Number.isFinite(percent)) return;

        // A large drop means yt-dlp moved on to the next stream.
        if (percent + 5 < lastPercent) phase += 1;
        lastPercent = percent;

        const detail = type !== "video" ? undefined : phase > 0 ? "Audio track" : "Video track";

        onProgress({
          stage: "downloading",
          percent: Math.max(0, Math.min(100, percent)),
          speed: speed.trim() || undefined,
          eta: eta.trim() || undefined,
          detail,
        });
        return;
      }

      if (line.startsWith(PP_MARKER)) {
        const [processor = ""] = line.slice(PP_MARKER.length).split("|");
        const name = processor.trim();
        // Post-processing has no measurable progress, so the bar goes
        // indeterminate rather than sitting at a misleading 100%.
        onProgress({
          stage: type === "audio" ? "converting" : "merging",
          percent: null,
          detail: name === "NA" || name === "" ? undefined : name,
        });
      }
    };
  }

  const attempt = (infoJson: string | null) =>
    runYtDlp({
      args: buildArgs(infoJson),
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      signal,
      onStdoutLine: makeLineHandler(),
    });

  const cachedInfo = lookupInfo(url);
  let result = await attempt(cachedInfo);

  if (result.code !== 0 && cachedInfo && !signal?.aborted) {
    // The cached document embeds URLs that expire. A failure while using it is
    // more likely staleness than a real problem with the video, so drop the
    // entry and give it one honest attempt with a fresh extraction.
    console.warn("[yt-dlp] cached info failed; retrying with a fresh extraction");
    await dropInfo(url);
    await rm(destDir, { recursive: true, force: true });
    await mkdir(destDir, { recursive: true });
    result = await attempt(null);
  }

  if (result.code !== 0) throw failFromStderr(result.stderr, result.code);

  const file = await findOutputFile(destDir);
  if (!file) {
    throw new AppError(
      "CONVERSION_FAILED",
      "The download finished but produced no file.",
      500,
      result.stderr.trim().slice(-300) || undefined,
    );
  }

  return { ...file, filename: path.basename(file.path) };
}
