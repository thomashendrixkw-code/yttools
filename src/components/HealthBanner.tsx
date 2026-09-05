"use client";

import { AlertIcon } from "./Icons";
import type { HealthResponse } from "@/lib/types";

/**
 * Warns up front when a required binary is missing, rather than letting the
 * first download fail with a confusing 503.
 */
export function HealthBanner({ health }: { health: HealthResponse | null }) {
  if (!health) return null;

  const missing: string[] = [];
  if (!health.ytDlp.available) missing.push("yt-dlp");
  if (!health.ffmpeg.available) missing.push("ffmpeg");
  if (missing.length === 0) return null;

  const isBlocking = !health.ytDlp.available;

  return (
    <div
      role="alert"
      className={`mb-6 flex gap-3 rounded-xl p-4 ring-1 ${
        isBlocking
          ? "bg-rose-50 text-rose-900 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:ring-rose-900/50"
          : "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/50"
      }`}
    >
      <AlertIcon className="mt-0.5 size-5 shrink-0" />
      <div className="text-sm">
        <p className="font-semibold">
          {missing.join(" and ")} {missing.length > 1 ? "are" : "is"} not installed on this server.
        </p>
        <p className="mt-1 text-xs leading-relaxed opacity-90">
          {isBlocking
            ? "Downloads will fail until yt-dlp is available. "
            : "Video downloads above 720p and all MP3 conversions need ffmpeg. "}
          Install with{" "}
          <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.7rem] dark:bg-white/10">
            brew install {missing.join(" ")}
          </code>{" "}
          on macOS, or run the app with the bundled Dockerfile.
        </p>
      </div>
    </div>
  );
}
