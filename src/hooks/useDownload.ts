"use client";

import { useCallback, useRef, useState } from "react";

import { ApiClientError, filenameFromDisposition, saveBlob, startDownload } from "@/lib/api-client";
import type { ProgressEvent } from "@/lib/types";

/** What the UI needs to render the progress area. */
export interface DownloadState {
  active: boolean;
  /** Server-side phase, streamed over SSE. */
  server: ProgressEvent | null;
  /** 0-100 for the browser-side transfer, or null while it hasn't started. */
  transfer: number | null;
}

const IDLE: DownloadState = { active: false, server: null, transfer: null };

/**
 * `crypto.randomUUID` only exists in a secure context, so a plain-HTTP LAN
 * deployment needs a fallback. The id only has to be unique per process.
 */
function randomJobId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export interface RunDownloadArgs {
  url: string;
  type: "video" | "audio";
  quality: number;
  batchUrls?: string[];
  batchName?: string;
  /** Used as the filename if the server sends no `Content-Disposition`. */
  fallbackName: string;
}

/**
 * Drives one download from click to saved file.
 *
 * There are two progress phases and they measure different things:
 *   1. the server fetching and converting the media (reported over SSE), and
 *   2. that finished file transferring to the browser (measured locally).
 * Showing them as one bar would be a lie, so the UI labels them separately.
 */
export function useDownload() {
  const [state, setState] = useState<DownloadState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  /** Abort an in-flight download; the server kills yt-dlp when the socket drops. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const run = useCallback(async (args: RunDownloadArgs): Promise<string> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ active: true, server: { stage: "queued", percent: null }, transfer: null });

    // Correlates this request with its SSE progress channel.
    const jobId = randomJobId();
    const events = new EventSource(`/api/progress?jobId=${jobId}`);

    events.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data as string) as ProgressEvent;
        setState((current) => (current.active ? { ...current, server: event } : current));
      } catch {
        // A malformed frame is not worth failing the download over.
      }
    };
    // Progress is cosmetic: if the channel dies, the download carries on.
    events.onerror = () => events.close();

    try {
      const response = await startDownload(
        {
          url: args.url,
          type: args.type,
          quality: args.quality,
          jobId,
          ...(args.batchUrls ? { batchUrls: args.batchUrls } : {}),
          ...(args.batchName ? { batchName: args.batchName } : {}),
        },
        controller.signal,
      );

      const filename = filenameFromDisposition(
        response.headers.get("Content-Disposition"),
        args.fallbackName,
      );
      const contentType = response.headers.get("Content-Type") ?? "application/octet-stream";
      const declared = Number(response.headers.get("Content-Length") ?? 0);
      const total = Number.isFinite(declared) && declared > 0 ? declared : null;

      if (!response.body) throw new ApiClientError("UNKNOWN", "The server sent an empty response.");

      // Read the stream by hand so the transfer has a real progress bar. ZIP
      // responses have no Content-Length, so those stay indeterminate.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      setState((current) => ({ ...current, transfer: 0 }));

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        chunks.push(value);
        received += value.byteLength;
        if (total) {
          const pct = Math.min(100, Math.round((received / total) * 100));
          setState((current) => (current.active ? { ...current, transfer: pct } : current));
        }
      }

      saveBlob(new Blob(chunks as BlobPart[], { type: contentType }), filename);
      return filename;
    } finally {
      events.close();
      abortRef.current = null;
      setState(IDLE);
    }
  }, []);

  return { state, run, cancel };
}
