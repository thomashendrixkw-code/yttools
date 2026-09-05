"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, filenameFromDisposition, saveBlob, startDownload } from "@/lib/api-client";
import type { ProgressEvent } from "@/lib/types";

/** What the UI needs to render the progress area. */
export interface DownloadState {
  active: boolean;
  /** Server-side phase, streamed over SSE. */
  server: ProgressEvent | null;
}

const IDLE: DownloadState = { active: false, server: null };

/** Abandon a job that never reported completion, so the UI cannot wedge. */
const WATCHDOG_MS = 30 * 60_000;

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
  /** Trade codec compatibility for roughly half the bytes. */
  preferSmaller?: boolean;
  batchUrls?: string[];
  batchName?: string;
  /** Used as the filename if the server sends no `Content-Disposition`. */
  fallbackName: string;
}

/**
 * Drives one download from click to saved file.
 *
 * Single files are fetched by pointing a hidden iframe at `GET /api/download`,
 * which lets the browser stream the response straight to disk with its own
 * progress and resume support. The previous approach — reading the response in
 * JavaScript and assembling a Blob — held the entire file in memory twice over,
 * which for a 1080p video is roughly half a gigabyte and a visible stall.
 *
 * Playlist ZIPs still go through fetch, because a batch does not fit sensibly
 * in a query string. They are typically MP3s and far smaller.
 *
 * Progress and failures both arrive over `/api/progress`: a navigation cannot
 * report an error back to the page on its own.
 */
export function useDownload() {
  const [state, setState] = useState<DownloadState>(IDLE);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * `abortTransfer` must stay false on normal completion. The server reports
   * "done" as soon as the file is ready to stream, which is *before* the
   * browser has finished writing it — blanking the frame there aborts the
   * download the user is waiting for.
   */
  const teardown = useCallback((abortTransfer: boolean) => {
    eventsRef.current?.close();
    eventsRef.current = null;
    abortRef.current = null;
    if (abortTransfer && frameRef.current) frameRef.current.src = "about:blank";
  }, []);

  useEffect(() => {
    return () => {
      eventsRef.current?.close();
      abortRef.current?.abort();
      frameRef.current?.remove();
      frameRef.current = null;
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    teardown(true);
    setState(IDLE);
  }, [teardown]);

  /** The hidden frame that receives `Content-Disposition: attachment`. */
  const ensureFrame = useCallback((): HTMLIFrameElement => {
    if (frameRef.current?.isConnected) return frameRef.current;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.title = "File download";
    frame.style.display = "none";
    document.body.appendChild(frame);
    frameRef.current = frame;
    return frame;
  }, []);

  const run = useCallback(
    async (args: RunDownloadArgs): Promise<string> => {
      const jobId = randomJobId();
      setState({ active: true, server: { stage: "queued", percent: null } });

      const events = new EventSource(`/api/progress?jobId=${jobId}`);
      eventsRef.current = events;

      try {
        if (args.batchUrls) return await runBatch(args, jobId, events, setState, abortRef);
        return await runSingle(args, jobId, events, setState, ensureFrame());
      } finally {
        // Leave the frame alone: the browser is still writing the file.
        teardown(false);
        setState(IDLE);
      }
    },
    [ensureFrame, teardown],
  );

  return { state, run, cancel };
}

/* ------------------------------------------------------------------ */

type SetState = (updater: (current: DownloadState) => DownloadState) => void;

/** Single file: the browser does the transfer, SSE reports the server phase. */
function runSingle(
  args: RunDownloadArgs,
  jobId: string,
  events: EventSource,
  setState: React.Dispatch<React.SetStateAction<DownloadState>>,
  frame: HTMLIFrameElement,
): Promise<string> {
  const query = new URLSearchParams({
    url: args.url,
    type: args.type,
    quality: String(args.quality),
    jobId,
  });
  if (args.preferSmaller) query.set("smaller", "1");

  return new Promise<string>((resolve, reject) => {
    const watchdog = window.setTimeout(() => {
      reject(new ApiClientError("TIMEOUT", "The download did not finish in time."));
    }, WATCHDOG_MS);

    const settle = (fn: () => void) => {
      window.clearTimeout(watchdog);
      fn();
    };

    events.onmessage = (message) => {
      let event: ProgressEvent;
      try {
        event = JSON.parse(message.data as string) as ProgressEvent;
      } catch {
        return;
      }

      setState((current) => (current.active ? { ...current, server: event } : current));

      if (event.stage === "done") settle(() => resolve(args.fallbackName));
      if (event.stage === "error") {
        settle(() => reject(new ApiClientError("UNKNOWN", event.detail ?? "The download failed.")));
      }
    };

    // Progress is a convenience. Without it we cannot observe completion, so
    // hand off to the browser and let its own download UI take over.
    events.onerror = () => settle(() => resolve(args.fallbackName));

    frame.src = `/api/download?${query.toString()}`;
  });
}

/** Playlist ZIP: still fetched, since a batch cannot live in a query string. */
async function runBatch(
  args: RunDownloadArgs,
  jobId: string,
  events: EventSource,
  setState: React.Dispatch<React.SetStateAction<DownloadState>>,
  abortRef: React.MutableRefObject<AbortController | null>,
): Promise<string> {
  const controller = new AbortController();
  abortRef.current = controller;

  events.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data as string) as ProgressEvent;
      setState((current) => (current.active ? { ...current, server: event } : current));
    } catch {
      // A malformed frame is not worth failing the download over.
    }
  };
  events.onerror = () => events.close();

  const response = await startDownload(
    {
      url: args.url,
      type: args.type,
      quality: args.quality,
      jobId,
      batchUrls: args.batchUrls,
      ...(args.batchName ? { batchName: args.batchName } : {}),
      ...(args.preferSmaller ? { preferSmaller: true } : {}),
    },
    controller.signal,
  );

  const filename = filenameFromDisposition(
    response.headers.get("Content-Disposition"),
    args.fallbackName,
  );
  const blob = await response.blob();
  saveBlob(blob, filename);
  return filename;
}
