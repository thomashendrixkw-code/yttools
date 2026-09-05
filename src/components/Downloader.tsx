"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DownloadPanel, type DownloadMode } from "./DownloadPanel";
import { Footer } from "./Footer";
import { HealthBanner } from "./HealthBanner";
import { HistoryPanel } from "./HistoryPanel";
import { LogoIcon } from "./Icons";
import { MediaCard } from "./MediaCard";
import { PlaylistPicker } from "./PlaylistPicker";
import { ThemeToggle } from "./ThemeToggle";
import { useToast } from "./Toaster";
import { UrlForm } from "./UrlForm";
import { useDownload } from "@/hooks/useDownload";
import { useHistory, type HistoryEntry } from "@/hooks/useHistory";
import { ApiClientError, fetchHealth, fetchInfo } from "@/lib/api-client";
import type { HealthResponse, InfoResponse, VideoQualityOption } from "@/lib/types";

/**
 * Playlists are fetched with `--flat-playlist`, which skips per-video format
 * probing for speed — so we offer a standard ladder instead. yt-dlp's
 * `height<=N` selector falls back to the next best available per video.
 */
const PLAYLIST_HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

/** Ignore the AbortError a cancelled fetch throws; it isn't a failure. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function Downloader() {
  const toast = useToast();
  const history = useHistory();
  const download = useDownload();

  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<InfoResponse | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const [mode, setMode] = useState<DownloadMode>("video");
  const [videoHeight, setVideoHeight] = useState<number | null>(null);
  const [audioBitrate, setAudioBitrate] = useState(192);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const infoAbort = useRef<AbortController | null>(null);

  // One health probe per visit; it only tells us whether the binaries exist.
  useEffect(() => {
    const controller = new AbortController();
    void fetchHealth(controller.signal).then(setHealth);
    return () => controller.abort();
  }, []);

  /** Fetch metadata for `target` (defaults to whatever is in the input). */
  const runFetch = useCallback(
    async (target?: string) => {
      const candidate = (target ?? url).trim();
      if (candidate.length === 0) return;

      infoAbort.current?.abort();
      const controller = new AbortController();
      infoAbort.current = controller;

      setLoadingInfo(true);
      setInfo(null);

      try {
        const result = await fetchInfo(candidate, controller.signal);
        setInfo(result);

        if (result.kind === "video") {
          // Default to the best resolution at or below 1080p — the sweet spot
          // between quality and a download that finishes this decade.
          const heights = result.video.qualities.map((quality) => quality.height);
          const preferred = heights.find((height) => height <= 1080) ?? heights[0] ?? null;
          setVideoHeight(preferred);
        } else {
          setVideoHeight(720);
          setSelectedIds(new Set(result.playlist.entries.map((entry) => entry.id)));
        }
      } catch (err) {
        if (isAbort(err)) return;
        const apiError = err instanceof ApiClientError ? err : null;
        toast.push("error", apiError?.message ?? "Couldn't fetch that video.", apiError?.hint);
      } finally {
        setLoadingInfo(false);
      }
    },
    [toast, url],
  );

  /** Resolutions offered for the current selection. */
  const qualities = useMemo<VideoQualityOption[]>(() => {
    if (!info) return [];
    if (info.kind === "video") return info.video.qualities;
    return PLAYLIST_HEIGHTS.map((height) => ({
      height,
      label: `${height}p`,
      approxBytes: null,
      fps: null,
    }));
  }, [info]);

  const selectedCount = selectedIds.size;

  const handleDownload = useCallback(async () => {
    if (!info) return;

    const quality = mode === "video" ? videoHeight : audioBitrate;
    if (quality === null) {
      toast.push("error", "Pick a quality first.");
      return;
    }

    const extension = mode === "video" ? "mp4" : "mp3";

    try {
      if (info.kind === "playlist") {
        const chosen = info.playlist.entries.filter((entry) => selectedIds.has(entry.id));
        if (chosen.length === 0) {
          toast.push("error", "Select at least one video from the playlist.");
          return;
        }

        const filename = await download.run({
          url: info.playlist.entries[0]?.webpageUrl ?? url,
          type: mode,
          quality,
          batchUrls: chosen.map((entry) => entry.webpageUrl),
          batchName: info.playlist.title,
          fallbackName: `${info.playlist.title}.zip`,
        });

        history.add({
          id: info.playlist.id || info.playlist.title,
          title: `${info.playlist.title} (${chosen.length} items)`,
          thumbnail: chosen[0]?.thumbnail ?? null,
          url,
          type: mode,
          quality,
        });
        toast.push("success", "Download ready", filename);
        return;
      }

      const video = info.video;
      const filename = await download.run({
        url: video.webpageUrl,
        type: mode,
        quality,
        fallbackName: `${video.title}.${extension}`,
      });

      history.add({
        id: video.id,
        title: video.title,
        thumbnail: video.thumbnail,
        url: video.webpageUrl,
        type: mode,
        quality,
      });
      toast.push("success", "Download ready", filename);
    } catch (err) {
      if (isAbort(err)) {
        toast.push("info", "Download cancelled.");
        return;
      }
      const apiError = err instanceof ApiClientError ? err : null;
      toast.push("error", apiError?.message ?? "The download failed.", apiError?.hint);
    }
  }, [audioBitrate, download, history, info, mode, selectedIds, toast, url, videoHeight]);

  const handleReuse = useCallback(
    (entry: HistoryEntry) => {
      setUrl(entry.url);
      setMode(entry.type);
      if (entry.type === "audio") setAudioBitrate(entry.quality);
      void runFetch(entry.url);
    },
    [runFetch],
  );

  const toggleEntry = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const busy = download.state.active;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <LogoIcon className="size-9 drop-shadow-sm" />
          <span className="text-[1.0625rem] font-semibold tracking-[-0.015em] text-zinc-900 dark:text-zinc-50">
            YT Tools
          </span>
        </div>
        <ThemeToggle />
      </header>

      <div className="mb-9">
        <h1 className="text-[2rem] font-bold leading-[1.1] tracking-[-0.03em] text-zinc-900 sm:text-[2.75rem] dark:text-zinc-50">
          Download video or
          <br className="hidden sm:block" /> extract audio
        </h1>
        <p className="mt-3.5 max-w-md text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Paste a YouTube link to save it as an MP4, or pull just the audio as an MP3. Nothing is
          stored on the server.
        </p>
      </div>

      <HealthBanner health={health} />

      <div className="surface rounded-2xl p-4 sm:p-6">
        <UrlForm
          value={url}
          onChange={setUrl}
          onSubmit={() => void runFetch()}
          loading={loadingInfo}
          disabled={busy}
        />

        {info ? (
          <div className="animate-reveal mt-6 space-y-6 border-t border-zinc-900/5 pt-6 dark:border-white/10">
            {info.kind === "video" ? (
              <MediaCard video={info.video} />
            ) : (
              <PlaylistPicker
                playlist={info.playlist}
                selected={selectedIds}
                onToggle={toggleEntry}
                onSelectAll={() =>
                  setSelectedIds(new Set(info.playlist.entries.map((entry) => entry.id)))
                }
                onSelectNone={() => setSelectedIds(new Set())}
                disabled={busy}
              />
            )}

            <DownloadPanel
              mode={mode}
              onModeChange={setMode}
              qualities={qualities}
              videoHeight={videoHeight}
              onVideoHeightChange={setVideoHeight}
              audioBitrate={audioBitrate}
              onAudioBitrateChange={setAudioBitrate}
              onDownload={() => void handleDownload()}
              onCancel={download.cancel}
              state={download.state}
              actionLabel={
                info.kind === "playlist" ? `Download ${selectedCount} as ZIP` : undefined
              }
              disabled={info.kind === "playlist" && selectedCount === 0}
            />
          </div>
        ) : null}
      </div>

      {!info && !loadingInfo ? (
        <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Works with watch links, youtu.be short links, Shorts, and playlists.
        </p>
      ) : null}

      <HistoryPanel entries={history.entries} onClear={history.clear} onReuse={handleReuse} />

      <Footer />
    </div>
  );
}
