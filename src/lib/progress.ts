import type { ProgressEvent } from "./types";

/**
 * Tiny in-process pub/sub used to stream yt-dlp progress to the browser.
 *
 * The download request and the SSE request are two separate HTTP calls, so they
 * are correlated by a client-minted `jobId`. State is per-process: with more
 * than one replica, the SSE request must land on the same instance (sticky
 * sessions) or the bar simply stays indeterminate — downloads still work.
 */
type Listener = (event: ProgressEvent) => void;

interface Job {
  listeners: Set<Listener>;
  last: ProgressEvent;
  createdAt: number;
}

const globalStore = globalThis as typeof globalThis & {
  __ytToolsJobs?: Map<string, Job>;
};
const jobs: Map<string, Job> = (globalStore.__ytToolsJobs ??= new Map());

/** Jobs older than this are swept even if nobody closed them cleanly. */
const JOB_TTL_MS = 30 * 60_000;

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function ensureJob(jobId: string): Job {
  let job = jobs.get(jobId);
  if (!job) {
    job = { listeners: new Set(), last: { stage: "queued", percent: null }, createdAt: Date.now() };
    jobs.set(jobId, job);
    sweep();
  }
  return job;
}

/** Publish an event to every subscriber of `jobId`. No-op without a job id. */
export function publishProgress(jobId: string | null, event: ProgressEvent): void {
  if (!jobId) return;
  const job = ensureJob(jobId);
  job.last = event;
  for (const listener of job.listeners) {
    try {
      listener(event);
    } catch {
      // A dead listener must never break the download it is reporting on.
    }
  }
}

/**
 * Subscribe to a job. Returns an unsubscribe function. The most recent event is
 * replayed immediately so a late-arriving SSE connection isn't stuck at 0%.
 */
export function subscribeProgress(jobId: string, listener: Listener): () => void {
  const job = ensureJob(jobId);
  job.listeners.add(listener);
  listener(job.last);

  return () => {
    job.listeners.delete(listener);
    if (job.listeners.size === 0 && (job.last.stage === "done" || job.last.stage === "error")) {
      jobs.delete(jobId);
    }
  };
}

/** Drop a finished job once its file has been handed to the client. */
export function closeJob(jobId: string | null): void {
  if (!jobId) return;
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.listeners.size === 0) jobs.delete(jobId);
}
