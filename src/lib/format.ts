/** Presentation helpers shared by the server (filenames) and the client (UI). */

/** 3725 -> "1:02:05"; 95 -> "1:35". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--:--";

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/** 15_728_640 -> "15.0 MB". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return "—";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** 1234567 -> "1.2M views". */
export function formatViews(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count < 0) return null;
  if (count < 1000) return `${count} views`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K views`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  return `${(count / 1_000_000_000).toFixed(1)}B views`;
}

/** yt-dlp's "20240115" -> "15 Jan 2024". */
export function formatUploadDate(compact: string | null): string | null {
  if (!compact || !/^\d{8}$/.test(compact)) return null;
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build a `Content-Disposition` value that survives non-ASCII titles.
 *
 * Older clients read the plain `filename=` (ASCII-folded), while everything
 * modern prefers the RFC 5987 `filename*=` with the original characters.
 */
export function contentDisposition(filename: string): string {
  // Strip characters that would terminate the header or confuse a filesystem.
  const clean = filename.replace(/[\r\n"\\/:*?<>|]/g, "_").trim() || "download";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** Map a media file extension onto the MIME type browsers expect. */
export function contentTypeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/opus",
    ogg: "audio/ogg",
    wav: "audio/wav",
    zip: "application/zip",
  };
  return types[ext] ?? "application/octet-stream";
}
