"use client";

import { formatDuration } from "@/lib/format";
import type { PlaylistInfoResponse } from "@/lib/types";

interface PlaylistPickerProps {
  playlist: PlaylistInfoResponse["playlist"];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  disabled: boolean;
}

/** Checklist of playlist entries; the selection drives the ZIP batch download. */
export function PlaylistPicker({
  playlist,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  disabled,
}: PlaylistPickerProps) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {playlist.title}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {playlist.channel ? `${playlist.channel} · ` : ""}
            {selected.size} of {playlist.entries.length} selected
            {playlist.truncated
              ? ` (first ${playlist.entries.length} of ${playlist.totalCount})`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 gap-3 text-xs font-medium">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={disabled}
            className="text-rose-600 transition hover:text-rose-500 disabled:opacity-50 dark:text-rose-400"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onSelectNone}
            disabled={disabled}
            className="text-zinc-500 transition hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
          >
            Clear
          </button>
        </div>
      </div>

      {playlist.truncated ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          This playlist has {playlist.totalCount} videos. Only the first {playlist.entries.length}{" "}
          are shown — the server caps batch size to keep downloads manageable.
        </p>
      ) : null}

      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {playlist.entries.map((entry, index) => {
          const checked = selected.has(entry.id);
          return (
            <li key={entry.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition ${
                  checked
                    ? "bg-rose-50 dark:bg-rose-950/30"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(entry.id)}
                  className="size-4 shrink-0 rounded border-zinc-300 text-rose-600 focus:ring-rose-500 dark:border-zinc-700 dark:bg-zinc-800"
                />

                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                  {index + 1}
                </span>

                <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
                  {entry.title}
                </span>

                <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                  {formatDuration(entry.duration)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
