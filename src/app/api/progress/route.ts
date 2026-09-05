import { subscribeProgress } from "@/lib/progress";
import type { ProgressEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/progress?jobId=...` — Server-Sent Events stream of download
 * progress for one job.
 *
 * The browser opens this immediately before it POSTs to `/api/download` with
 * the same `jobId`. It is purely cosmetic: if the connection never opens (or
 * lands on a different replica), the download itself is unaffected and the UI
 * falls back to an indeterminate bar.
 */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");

  if (!jobId || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    return new Response("Missing or malformed jobId", { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      unsubscribe = subscribeProgress(jobId, send);

      // Comment frames keep proxies from closing an idle connection, and give
      // us a cheap way to notice the client has gone away.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime — nothing to do.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Stops nginx from buffering the stream into uselessness.
      "X-Accel-Buffering": "no",
    },
  });
}
