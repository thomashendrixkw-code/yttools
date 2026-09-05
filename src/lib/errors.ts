import { NextResponse } from "next/server";
import type { ApiError, ApiErrorCode } from "./types";

/** An error that already carries a user-facing message and HTTP status. */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number = 400,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * yt-dlp reports every failure as free-form English on stderr. These patterns
 * translate the ones users actually hit into structured codes the UI can act
 * on. Order matters: the first match wins, so put specific patterns first.
 */
const STDERR_PATTERNS: Array<{
  pattern: RegExp;
  code: ApiErrorCode;
  status: number;
  message: string;
  hint?: string;
}> = [
  {
    pattern: /private video|this video is private/i,
    code: "PRIVATE_VIDEO",
    status: 403,
    message: "This video is private, so it can't be downloaded.",
  },
  {
    pattern: /sign in to confirm your age|age-restricted|inappropriate for some users/i,
    code: "AGE_RESTRICTED",
    status: 403,
    message: "This video is age-restricted.",
    hint: "This tool does not bypass age gates. Download it from an account that already has access, using your own exported cookies.",
  },
  {
    pattern: /members[- ]only|join this channel/i,
    code: "MEMBERS_ONLY",
    status: 403,
    message: "This video is for channel members only.",
  },
  {
    // yt-dlp phrases this as "The uploader has not made this video available
    // in your country", which the narrower "not available in your country"
    // never matched — it fell through to NOT_FOUND instead.
    pattern:
      /available in your country|blocked it in your country|geo[- ]?restricted|not available from your location/i,
    code: "GEO_BLOCKED",
    status: 451,
    message: "This video isn't available in the server's region.",
    hint: "This tool does not bypass region locks.",
  },
  {
    pattern: /drm|protected content/i,
    code: "DRM_PROTECTED",
    status: 403,
    message: "This video is DRM-protected and cannot be downloaded.",
  },
  {
    pattern: /is live|live event will begin|premieres in/i,
    code: "LIVE_STREAM",
    status: 400,
    message: "This is a live or upcoming stream. Try again once it has finished.",
  },
  {
    pattern: /requested format (is )?not available|no video formats found/i,
    code: "NO_MATCHING_FORMAT",
    status: 422,
    message: "That quality isn't available for this video. Pick a different one.",
  },
  {
    pattern:
      /video unavailable|has been removed|does not exist|account associated with this video has been terminated/i,
    code: "NOT_FOUND",
    status: 404,
    message: "That video is unavailable — it may have been removed or made private.",
  },
  {
    pattern: /unsupported url|is not a valid url/i,
    code: "INVALID_URL",
    status: 400,
    message: "That URL isn't a supported YouTube link.",
  },
  {
    // YouTube challenges or refuses traffic it judges automated. This is the
    // norm from a datacenter IP — Codespaces, CI runners, most cloud VMs — and
    // it surfaces under several different wordings depending on which stage
    // of extraction failed.
    pattern:
      /confirm you'?re not a bot|failed to extract any player response|all player responses are invalid|not available on this app|rate[- ]?limit reached|unable to download video data: HTTP Error 403/i,
    code: "BLOCKED_BY_YOUTUBE",
    status: 429,
    message: "YouTube is blocking requests from this server.",
    hint: "This is expected from a datacenter IP (GitHub Codespaces, CI runners, most cloud VMs). Run the app from a residential connection, or set YT_DLP_COOKIES to cookies exported from a browser where you are signed in.",
  },
  {
    pattern: /ffmpeg|postprocessing|conversion failed/i,
    code: "CONVERSION_FAILED",
    status: 500,
    message: "The media downloaded, but converting it failed.",
    hint: "Check that ffmpeg is installed and on PATH.",
  },
];

/**
 * Turn raw yt-dlp stderr into a structured AppError. Falls back to a generic
 * message so we never leak stack traces or filesystem paths to the client.
 */
export function fromYtDlpStderr(stderr: string, exitCode: number | null): AppError {
  for (const entry of STDERR_PATTERNS) {
    if (entry.pattern.test(stderr)) {
      return new AppError(entry.code, entry.message, entry.status, entry.hint);
    }
  }

  return new AppError(
    "UNKNOWN",
    "yt-dlp couldn't process that video.",
    502,
    // The full stderr is logged server-side but deliberately not returned, so
    // say where to find it rather than leaving the operator guessing.
    `yt-dlp exited with code ${exitCode ?? "null"}. The full error was written to the server log.`,
  );
}

/** Narrow the loosely-typed errors thrown by `requireBinary`. */
function isTaggedError(err: unknown): err is Error & { code: string; hint?: string } {
  return err instanceof Error && typeof (err as { code?: unknown }).code === "string";
}

/**
 * Single funnel for every route handler's catch block: converts anything
 * thrown into the `ApiError` envelope with an appropriate status code.
 */
export function toApiError(err: unknown): NextResponse<ApiError> {
  if (err instanceof AppError) {
    return NextResponse.json<ApiError>(
      { error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) } },
      { status: err.status },
    );
  }

  if (isTaggedError(err) && err.code === "MISSING_BINARY") {
    return NextResponse.json<ApiError>(
      {
        error: {
          code: "MISSING_BINARY",
          message: err.message,
          ...(err.hint ? { hint: err.hint } : {}),
        },
      },
      { status: 503 },
    );
  }

  // Anything unrecognised is a bug on our side — log it, tell the user nothing
  // specific, and return 500.
  console.error("[api] unhandled error:", err);
  return NextResponse.json<ApiError>(
    {
      error: { code: "UNKNOWN", message: "Something went wrong on the server. Please try again." },
    },
    { status: 500 },
  );
}
