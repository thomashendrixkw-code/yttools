/**
 * Shared contracts between the route handlers and the client components.
 * Everything crossing the network boundary is declared here so the frontend
 * and backend cannot drift apart silently.
 */

/** A single downloadable video resolution offered to the user. */
export interface VideoQualityOption {
  /** Vertical resolution in pixels, e.g. 1080. Used as the `quality` value. */
  height: number;
  /** Human label, e.g. "1080p" or "1080p60". */
  label: string;
  /** Best-effort size estimate in bytes for video+audio, null when unknown. */
  approxBytes: number | null;
  /** Frames per second, when yt-dlp reports it. */
  fps: number | null;
}

/** Metadata for one video — either a standalone URL or a playlist entry. */
export interface MediaInfo {
  id: string;
  title: string;
  channel: string | null;
  channelUrl: string | null;
  /** Duration in seconds; null for live streams and some unavailable videos. */
  duration: number | null;
  thumbnail: string | null;
  uploadDate: string | null;
  viewCount: number | null;
  /** Canonical watch URL, used for the follow-up download request. */
  webpageUrl: string;
  isLive: boolean;
  /** Resolutions actually available for this video, highest first. */
  qualities: VideoQualityOption[];
}

/** Result of `POST /api/info` for a single video URL. */
export interface SingleInfoResponse {
  kind: "video";
  video: MediaInfo;
}

/** Result of `POST /api/info` for a playlist URL. */
export interface PlaylistInfoResponse {
  kind: "playlist";
  playlist: {
    id: string;
    title: string;
    channel: string | null;
    /** Total entries reported by YouTube, before the batch cap is applied. */
    totalCount: number;
    /** Entries returned, already capped at MAX_PLAYLIST_ITEMS. */
    entries: PlaylistEntry[];
    /** True when `entries` was truncated by the server-side cap. */
    truncated: boolean;
  };
}

/** A lightweight playlist row — no per-video format probing, for speed. */
export interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
}

export type InfoResponse = SingleInfoResponse | PlaylistInfoResponse;

/** Audio bitrates the UI exposes, in kbps. */
export const AUDIO_BITRATES = [128, 192, 320] as const;
export type AudioBitrate = (typeof AUDIO_BITRATES)[number];

/** Body accepted by `POST /api/download`. */
export interface DownloadRequest {
  url: string;
  type: "video" | "audio";
  /** Video: target height in px (e.g. 720). Audio: bitrate in kbps (e.g. 192). */
  quality: number;
  /**
   * Optional job id minted by the client. When present the server publishes
   * progress events to `GET /api/progress?jobId=...` for the duration.
   */
  jobId?: string;
  /**
   * When present, every listed URL is downloaded and the response is a ZIP
   * archive instead of a single media file. Used for playlist batches.
   */
  batchUrls?: string[];
  /** Optional label used to name the ZIP when `batchUrls` is present. */
  batchName?: string;
}

/** Every error the API returns uses this shape. */
export interface ApiError {
  error: {
    /** Stable machine-readable code the UI switches on. */
    code: ApiErrorCode;
    /** Sentence shown directly to the user. */
    message: string;
    /** Optional extra guidance, e.g. install instructions. */
    hint?: string;
  };
}

export type ApiErrorCode =
  | "INVALID_URL"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "PRIVATE_VIDEO"
  | "AGE_RESTRICTED"
  | "GEO_BLOCKED"
  | "MEMBERS_ONLY"
  | "LIVE_STREAM"
  | "DRM_PROTECTED"
  | "NO_MATCHING_FORMAT"
  | "PLAYLIST_TOO_LARGE"
  | "MISSING_BINARY"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "CONVERSION_FAILED"
  | "UNKNOWN";

/** Progress event streamed over SSE while a download runs. */
export interface ProgressEvent {
  /** Coarse phase label shown next to the bar. */
  stage: "queued" | "downloading" | "merging" | "converting" | "packaging" | "done" | "error";
  /** 0-100, or null when the phase has no measurable progress. */
  percent: number | null;
  /** e.g. "2.41MiB/s" straight from yt-dlp. */
  speed?: string;
  /** e.g. "00:12" straight from yt-dlp. */
  eta?: string;
  /** Free-text detail, e.g. the current playlist item. */
  detail?: string;
}

/** Result of `GET /api/health` — used to warn when the host is misconfigured. */
export interface HealthResponse {
  ytDlp: { available: boolean; version: string | null; path: string | null };
  ffmpeg: { available: boolean; version: string | null; path: string | null };
}
