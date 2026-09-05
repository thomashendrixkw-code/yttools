import { NextResponse } from "next/server";

import { toApiError } from "@/lib/errors";
import { clientKey, enforceRateLimit } from "@/lib/rate-limit";
import type { InfoResponse } from "@/lib/types";
import { parseYouTubeUrl } from "@/lib/validate";
import { fetchPlaylistInfo, fetchVideoInfo } from "@/lib/ytdlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/info` — body `{ url }`.
 *
 * Runs `yt-dlp -J` and returns either a single video's metadata (title,
 * thumbnail, duration, channel, available resolutions) or, for a playlist URL,
 * the list of entries it contains.
 */
export async function POST(request: Request) {
  try {
    enforceRateLimit(clientKey(request));

    const body: unknown = await request.json().catch(() => null);
    const { url, isPlaylist } = parseYouTubeUrl(
      typeof body === "object" && body !== null ? (body as { url?: unknown }).url : undefined,
    );

    if (isPlaylist) {
      const maxItems = Number(process.env.MAX_PLAYLIST_ITEMS ?? 25);
      const playlist = await fetchPlaylistInfo(url, maxItems, request.signal);
      return NextResponse.json<InfoResponse>(
        { kind: "playlist", playlist },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const video = await fetchVideoInfo(url, request.signal);
    return NextResponse.json<InfoResponse>(
      { kind: "video", video },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return toApiError(err);
  }
}
