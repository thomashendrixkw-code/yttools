"use client";

import { ClockIcon } from "./Icons";
import { formatDuration, formatUploadDate, formatViews } from "@/lib/format";
import type { MediaInfo } from "@/lib/types";

/** Thumbnail + title + channel for the fetched video. */
export function MediaCard({ video }: { video: MediaInfo }) {
  const views = formatViews(video.viewCount);
  const uploaded = formatUploadDate(video.uploadDate);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
      <div className="relative w-full shrink-0 overflow-hidden rounded-xl bg-zinc-200 ring-1 ring-zinc-900/5 sm:w-56 dark:bg-zinc-800 dark:ring-white/10">
        <div className="aspect-video">
          {video.thumbnail ? (
            // A plain <img>: thumbnails come from YouTube's CDN on domains that
            // change over time, which next/image would require whitelisting.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnail} alt="" loading="lazy" className="size-full object-cover" />
          ) : null}
        </div>

        {video.duration !== null ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white backdrop-blur-sm">
            {formatDuration(video.duration)}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold leading-snug tracking-[-0.01em] text-zinc-900 dark:text-zinc-50">
          {video.title}
        </h2>

        {video.channel ? (
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{video.channel}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <ClockIcon className="size-3.5" />
            {formatDuration(video.duration)}
          </span>
          {views ? (
            <>
              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                ·
              </span>
              <span>{views}</span>
            </>
          ) : null}
          {uploaded ? (
            <>
              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                ·
              </span>
              <span>{uploaded}</span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
