import { describe, expect, it } from "vitest";

import { AppError, fromYtDlpStderr } from "@/lib/errors";

/**
 * These strings are copied from real yt-dlp stderr output. If yt-dlp ever
 * rewords them, this suite is what catches the resulting misclassification —
 * the user would otherwise just see a generic failure.
 */
describe("fromYtDlpStderr", () => {
  it.each([
    [
      "PRIVATE_VIDEO",
      403,
      "ERROR: [youtube] abc123: Private video. Sign in if you've been granted access to this video",
    ],
    [
      "AGE_RESTRICTED",
      403,
      "ERROR: [youtube] abc123: Sign in to confirm your age. This video may be inappropriate for some users.",
    ],
    [
      "MEMBERS_ONLY",
      403,
      "ERROR: [youtube] abc123: Join this channel to get access to members-only content",
    ],
    [
      "GEO_BLOCKED",
      451,
      "ERROR: [youtube] abc123: Video unavailable. The uploader has not made this video available in your country",
    ],
    [
      "GEO_BLOCKED",
      451,
      "ERROR: [youtube] abc123: The uploader has blocked it in your country on copyright grounds",
    ],
    ["DRM_PROTECTED", 403, "ERROR: [youtube] abc123: This video is DRM protected"],
    ["LIVE_STREAM", 400, "ERROR: [youtube] abc123: This live event will begin in 3 hours."],
    [
      "NO_MATCHING_FORMAT",
      422,
      "ERROR: [youtube] abc123: Requested format is not available. Use --list-formats for a list of available formats",
    ],
    ["NOT_FOUND", 404, "ERROR: [youtube] abc123: Video unavailable"],
    ["NOT_FOUND", 404, "ERROR: [youtube] abc123: This video has been removed by the uploader"],
    ["INVALID_URL", 400, "ERROR: Unsupported URL: https://example.com/foo"],
    ["CONVERSION_FAILED", 500, "ERROR: Postprocessing: ffmpeg exited with code 1"],
  ])("maps %s (%i)", (code, status, stderr) => {
    const error = fromYtDlpStderr(stderr, 1);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
  });

  /**
   * YouTube refuses datacenter traffic under several different wordings
   * depending on which stage of extraction failed. All of them mean the same
   * thing to the user, so all of them must land on the same code — otherwise
   * running in Codespaces or CI produces a bare 502 with no explanation.
   */
  describe("blocked by YouTube", () => {
    it.each([
      "ERROR: [youtube] abc123: Sign in to confirm you're not a bot. Use --cookies-from-browser",
      "ERROR: [youtube] abc123: Failed to extract any player response",
      "ERROR: [youtube] abc123: All player responses are invalid. Your IP is likely being blocked",
      "ERROR: [youtube] abc123: The following content is not available on this app",
      "ERROR: [youtube] abc123: Requested content is not available, rate-limit reached",
      "ERROR: unable to download video data: HTTP Error 403: Forbidden",
    ])("classifies %s", (stderr) => {
      const error = fromYtDlpStderr(stderr, 1);
      expect(error.code).toBe("BLOCKED_BY_YOUTUBE");
      expect(error.status).toBe(429);
      expect(error.hint).toMatch(/datacenter|cookies/i);
    });

    it("is not confused with the age gate", () => {
      expect(fromYtDlpStderr("Sign in to confirm your age", 1).code).toBe("AGE_RESTRICTED");
    });

    it("does not swallow a genuinely removed video", () => {
      expect(fromYtDlpStderr("ERROR: [youtube] abc: Video unavailable", 1).code).toBe("NOT_FOUND");
    });
  });

  it("falls back to a generic 502 for unrecognised output", () => {
    const error = fromYtDlpStderr("ERROR: something nobody has seen before", 2);
    expect(error.code).toBe("UNKNOWN");
    expect(error.status).toBe(502);
    expect(error.hint).toContain("2");
    expect(error.hint).toContain("server log");
  });

  it("never leaks raw stderr in the user-facing message", () => {
    const stderr = "ERROR: /var/folders/xyz/T/yttools-abc123/secret.mp4 failed at 0x7fff";
    const error = fromYtDlpStderr(stderr, 1);
    expect(error.message).not.toContain("/var/folders");
    expect(error.message).not.toContain("yttools-");
  });
});

describe("AppError", () => {
  it("defaults to a 400 status", () => {
    expect(new AppError("INVALID_URL", "nope").status).toBe(400);
  });

  it("carries an optional hint", () => {
    const error = new AppError("MISSING_BINARY", "no yt-dlp", 503, "brew install yt-dlp");
    expect(error.hint).toBe("brew install yt-dlp");
    expect(error.name).toBe("AppError");
  });
});
