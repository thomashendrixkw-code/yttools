"use client";

import type { ApiError, ApiErrorCode, HealthResponse, InfoResponse } from "./types";

/** An error carrying the structured payload returned by our API routes. */
export class ApiClientError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/**
 * Convert a failed response into an `ApiClientError`. Falls back to a generic
 * message when the body isn't our JSON envelope (e.g. a proxy 502 page).
 */
async function toClientError(response: Response): Promise<ApiClientError> {
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (body.error?.message) {
      return new ApiClientError(body.error.code ?? "UNKNOWN", body.error.message, body.error.hint);
    }
  } catch {
    // Non-JSON body; fall through to the status-based message.
  }

  return new ApiClientError(
    "UNKNOWN",
    response.status === 429
      ? "Too many requests. Wait a moment and try again."
      : `The server responded with ${response.status}.`,
  );
}

/** `POST /api/info` — fetch metadata for a video or playlist URL. */
export async function fetchInfo(url: string, signal?: AbortSignal): Promise<InfoResponse> {
  const response = await fetch("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) throw await toClientError(response);
  return (await response.json()) as InfoResponse;
}

/** `GET /api/health` — used to warn when yt-dlp or ffmpeg is missing. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse | null> {
  try {
    const response = await fetch("/api/health", { signal });
    if (!response.ok) return null;
    return (await response.json()) as HealthResponse;
  } catch {
    // A failed health check should never block the UI.
    return null;
  }
}

/** Start a download and get back the raw response, ready to be streamed. */
export async function startDownload(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await toClientError(response);
  return response;
}

/**
 * Pull the filename out of a `Content-Disposition` header, preferring the
 * RFC 5987 `filename*` form so non-ASCII titles survive intact.
 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;

  const extended = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed encoding — fall through to the plain form.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() || fallback;
}

/** Hand a finished blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers; a short
  // delay is the standard workaround.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
