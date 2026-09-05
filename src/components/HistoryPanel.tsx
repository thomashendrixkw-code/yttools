"use client";

import { MusicIcon, TrashIcon, VideoIcon } from "./Icons";
import type { HistoryEntry } from "@/hooks/useHistory";

interface HistoryPanelProps {
  entries: readonly HistoryEntry[];
  onClear: () => void;
  /** Re-runs a past download by loading its URL back into the form. */
  onReuse: (entry: HistoryEntry) => void;
}

/** Relative timestamps, cheap enough to compute on every render. */
function relativeTime(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Recent downloads, kept in localStorage only — never sent to the server. */
export function HistoryPanel({ entries, onClear, onReuse }: HistoryPanelProps) {
  if (entries.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Recent downloads</h2>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 transition hover:text-rose-600 dark:hover:text-rose-400"
        >
          <TrashIcon className="size-3.5" />
          Clear
        </button>
      </div>

      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white/70 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/50">
        {entries.map((entry) => (
          <li key={`${entry.id}-${entry.type}`}>
            <button
              type="button"
              onClick={() => onReuse(entry)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              <span
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
                  entry.type === "audio"
                    ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                    : "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
                }`}
              >
                {entry.type === "audio" ? (
                  <MusicIcon className="size-4" />
                ) : (
                  <VideoIcon className="size-4" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-800 dark:text-zinc-200">
                  {entry.title}
                </span>
                <span className="block text-xs text-zinc-500">
                  {entry.type === "audio" ? `${entry.quality} kbps MP3` : `${entry.quality}p MP4`} ·{" "}
                  {relativeTime(entry.at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-600">
        Stored in this browser only. The server keeps no record of what you download.
      </p>
    </section>
  );
}
