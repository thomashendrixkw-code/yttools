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
  onDownload: () => void;
  onCancel: () => void;
  state: DownloadState;
  /** Overrides the button label, e.g. "Download 6 videos as ZIP". */
  actionLabel?: string;
  disabled?: boolean;
}

const SELECT_CLASSES =
  "select-reset w-full rounded-xl border border-zinc-200 bg-white py-3 pl-4 pr-10 text-sm font-medium text-zinc-900 shadow-sm transition focus:border-rose-400 focus:outline-none focus:ring-4 focus:ring-rose-500/10 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-rose-500";

/** Format / quality picker plus the download action and its progress read-out. */
export function DownloadPanel({
  mode,
  onModeChange,
  qualities,
  videoHeight,
  onVideoHeightChange,
  audioBitrate,
  onAudioBitrateChange,
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
            className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
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
          className={
            busy
              ? "inline-flex h-[46px] items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-6 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              : "inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 text-sm font-semibold text-white shadow-sm shadow-rose-600/20 transition hover:bg-rose-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          }
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
      className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"
    >
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
            className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
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
 * A download has two measurable phases — the server pulling and converting the
 * media, then that file transferring to the browser. They are shown as one bar
 * with an explicit step label, because a single merged percentage would be
 * guesswork.
 */
function ProgressReadout({ state }: { state: DownloadState }) {
  const transferring = state.transfer !== null;
  const percent = transferring ? state.transfer : (state.server?.percent ?? null);
  const stage = state.server?.stage ?? "queued";

  const label = transferring
    ? "Saving to your device"
    : stage === "downloading"
      ? "Downloading from YouTube"
      : stage === "merging"
        ? "Merging video and audio"
        : stage === "converting"
          ? "Converting to MP3"
          : stage === "packaging"
            ? "Building ZIP archive"
            : stage === "done"
              ? "Finishing up"
              : "Preparing";

  const meta = [
    state.server?.detail,
    state.server?.speed,
    state.server?.eta ? `ETA ${state.server.eta}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {label}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            Step {transferring ? 2 : 1} of 2
          </span>
        </p>
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
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        {percent !== null ? (
          <div
            className="h-full rounded-full bg-rose-600 transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="animate-indeterminate h-full w-full rounded-full bg-rose-600" />
        )}
      </div>

      {meta && !transferring ? (
        <p className="mt-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-500">{meta}</p>
      ) : null}
    </div>
  );
}
