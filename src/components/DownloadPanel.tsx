"use client";

import { DownloadIcon, MusicIcon, SpinnerIcon, VideoIcon } from "./Icons";
import type { DownloadState } from "@/hooks/useDownload";
import { formatBytes } from "@/lib/format";
import { AUDIO_BITRATES, type VideoQualityOption } from "@/lib/types";

export type DownloadMode = "video" | "audio";

interface DownloadPanelProps {
  mode: DownloadMode;
  onModeChange: (mode: DownloadMode) => void;
  qualities: VideoQualityOption[];
  videoHeight: number | null;
  onVideoHeightChange: (height: number) => void;
  audioBitrate: number;
  onAudioBitrateChange: (bitrate: number) => void;
  preferSmaller: boolean;
  onPreferSmallerChange: (value: boolean) => void;
  onDownload: () => void;
  onCancel: () => void;
  state: DownloadState;
  /** Overrides the button label, e.g. "Download 6 videos as ZIP". */
  actionLabel?: string;
  disabled?: boolean;
}

const SELECT_CLASSES = "field select-reset py-3 pl-4 pr-10 font-medium disabled:opacity-60";

/** Format / quality picker plus the download action and its progress read-out. */
export function DownloadPanel({
  mode,
  onModeChange,
  qualities,
  videoHeight,
  onVideoHeightChange,
  audioBitrate,
  onAudioBitrateChange,
  preferSmaller,
  onPreferSmallerChange,
  onDownload,
  onCancel,
  state,
  actionLabel,
  disabled,
}: DownloadPanelProps) {
  const busy = state.active;
  const noVideoFormats = mode === "video" && qualities.length === 0;

  return (
    <div className="space-y-4">
      <ModeTabs mode={mode} onChange={onModeChange} disabled={busy} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label
            htmlFor="quality-select"
            className="mb-2 block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
          >
            {mode === "video" ? "Resolution" : "Bitrate"}
          </label>

          <div className="relative">
            {mode === "video" ? (
              <select
                id="quality-select"
                value={videoHeight ?? ""}
                onChange={(event) => onVideoHeightChange(Number(event.target.value))}
                disabled={busy || noVideoFormats}
                className={SELECT_CLASSES}
              >
                {qualities.map((quality) => (
                  <option key={quality.height} value={quality.height}>
                    {quality.label}
                    {quality.approxBytes ? ` — about ${formatBytes(quality.approxBytes)}` : ""}
                  </option>
                ))}
                {noVideoFormats ? <option value="">No formats available</option> : null}
              </select>
            ) : (
              <select
                id="quality-select"
                value={audioBitrate}
                onChange={(event) => onAudioBitrateChange(Number(event.target.value))}
                disabled={busy}
                className={SELECT_CLASSES}
              >
                {AUDIO_BITRATES.map((bitrate) => (
                  <option key={bitrate} value={bitrate}>
                    {bitrate} kbps
                    {bitrate === 320
                      ? " — best quality"
                      : bitrate === 128
                        ? " — smallest file"
                        : ""}
                  </option>
                ))}
              </select>
            )}

            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            >
              <path
                d="m5 8 5 5 5-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <button
          type="button"
          onClick={busy ? onCancel : onDownload}
          // Cancel must always stay clickable, even when the start conditions
          // that gate the download button no longer hold.
          disabled={busy ? false : disabled || noVideoFormats}
          className={`inline-flex h-[46px] items-center justify-center gap-2 rounded-xl px-6 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 ${
            busy ? "btn-neutral" : "btn-primary text-white disabled:cursor-not-allowed"
          }`}
        >
          {busy ? (
            <>
              <SpinnerIcon className="size-4 animate-spin" />
              Cancel
            </>
          ) : (
            <>
              <DownloadIcon className="size-4" />
              {actionLabel ?? (mode === "video" ? "Download MP4" : "Download MP3")}
            </>
          )}
        </button>
      </div>

      {mode === "video" && !noVideoFormats ? (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-0.5">
          <input
            type="checkbox"
            checked={preferSmaller}
            disabled={busy}
            onChange={(event) => onPreferSmallerChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-zinc-300 text-rose-600 focus:ring-rose-500 disabled:cursor-not-allowed dark:border-zinc-700 dark:bg-zinc-800"
          />
          <span className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              Smaller file, much faster
            </span>{" "}
            — picks AV1 or VP9 over H.264. Around half the bytes at the same resolution, so it
            downloads in roughly a third of the time, but needs a reasonably recent device or
            player.
          </span>
        </label>
      ) : null}

      {noVideoFormats ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          This item has no downloadable video formats. Try the Audio tab instead.
        </p>
      ) : null}

      {busy ? <ProgressReadout state={state} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ModeTabs({
  mode,
  onChange,
  disabled,
}: {
  mode: DownloadMode;
  onChange: (mode: DownloadMode) => void;
  disabled: boolean;
}) {
  const tabs = [
    { id: "video" as const, label: "Video (MP4)", Icon: VideoIcon },
    { id: "audio" as const, label: "Audio (MP3)", Icon: MusicIcon },
  ];

  return (
    <div
      role="tablist"
      aria-label="Download format"
      className="inset-panel relative grid grid-cols-2 gap-1 rounded-xl p-1"
    >
      {/* One travelling pill rather than two swapped backgrounds — the movement
          is what tells you the tabs are two states of a single control. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white shadow-sm ring-1 ring-zinc-900/5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-zinc-800 dark:ring-white/10 ${
          mode === "audio" ? "translate-x-[calc(100%+0.25rem)]" : "translate-x-0"
        }`}
      />

      {tabs.map(({ id, label, Icon }) => {
        const selected = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`relative z-10 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Reports the server-side phase only. The transfer to disk is handled by the
 * browser's own download UI, so inventing a second bar here would duplicate it
 * and, worse, guess at numbers this page can no longer observe.
 */
function ProgressReadout({ state }: { state: DownloadState }) {
  const stage = state.server?.stage ?? "queued";
  const percent = state.server?.percent ?? null;

  const label =
    stage === "downloading"
      ? "Downloading from YouTube"
      : stage === "merging"
        ? "Merging video and audio"
        : stage === "converting"
          ? "Converting to MP3"
          : stage === "packaging"
            ? "Building ZIP archive"
            : stage === "done"
              ? "Handing off to your browser"
              : "Preparing";

  const meta = [
    state.server?.detail,
    state.server?.speed,
    state.server?.eta ? `ETA ${state.server.eta}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="inset-panel animate-reveal rounded-xl p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</p>
        {percent !== null ? (
          <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {percent}%
          </p>
        ) : null}
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== null ? { "aria-valuenow": percent } : {})}
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800"
      >
        {percent !== null ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="animate-indeterminate h-full w-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600" />
        )}
      </div>

      {meta ? (
        <p className="mt-2.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-500">{meta}</p>
      ) : null}
    </div>
  );
}
