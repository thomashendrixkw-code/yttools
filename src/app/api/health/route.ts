import { NextResponse } from "next/server";

import { resolveBinary } from "@/lib/binaries";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/health` — reports whether the external binaries this app depends on
 * are present. The UI polls this once on mount so a misconfigured host shows a
 * banner up front instead of failing on the first download.
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  const [ytDlp, ffmpeg] = await Promise.all([resolveBinary("yt-dlp"), resolveBinary("ffmpeg")]);

  return NextResponse.json<HealthResponse>(
    {
      ytDlp: {
        available: Boolean(ytDlp),
        version: ytDlp?.version ?? null,
        path: ytDlp?.path ?? null,
      },
      ffmpeg: {
        available: Boolean(ffmpeg),
        version: ffmpeg?.version ?? null,
        path: ffmpeg?.path ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
