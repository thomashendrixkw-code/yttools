import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { parseDownloadRequest, parseYouTubeUrl } from "@/lib/validate";

/**
 * `parseYouTubeUrl` is the security boundary of the whole app: it is the only
 * thing standing between a request body and a spawned subprocess. These tests
 * pin both the shapes it must accept and the ones it must refuse.
 */
describe("parseYouTubeUrl", () => {
  describe("accepts and canonicalises", () => {
    const canonical = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    it.each([
      ["standard watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["no www", "https://youtube.com/watch?v=dQw4w9WgXcQ"],
      ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["music", "https://music.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["short link", "https://youtu.be/dQw4w9WgXcQ"],
      ["shorts", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
      ["embed", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
      ["live", "https://www.youtube.com/live/dQw4w9WgXcQ"],
      ["legacy /v/", "https://www.youtube.com/v/dQw4w9WgXcQ"],
      ["http scheme", "http://www.youtube.com/watch?v=dQw4w9WgXcQ"],
      ["no scheme at all", "youtu.be/dQw4w9WgXcQ"],
      ["surrounding whitespace", "  https://youtu.be/dQw4w9WgXcQ  "],
      ["extra query params", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=share"],
    ])("%s", (_label, input) => {
      const result = parseYouTubeUrl(input);
      expect(result.url).toBe(canonical);
      expect(result.isPlaylist).toBe(false);
    });

    it("treats a video inside a playlist as a single video", () => {
      // The user clicked a video, not the playlist — honour that.
      const result = parseYouTubeUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=4",
      );
      expect(result).toEqual({ url: canonical, isPlaylist: false });
    });

    it("recognises a bare playlist URL", () => {
      const result = parseYouTubeUrl("https://www.youtube.com/playlist?list=PLabc123");
      expect(result).toEqual({
        url: "https://www.youtube.com/playlist?list=PLabc123",
        isPlaylist: true,
      });
    });

    it("strips tracking params by rebuilding the URL from the ID", () => {
      const result = parseYouTubeUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=TRACKINGTOKEN&pp=abc",
      );
      expect(result.url).toBe(canonical);
      expect(result.url).not.toContain("si=");
    });
  });

  describe("rejects", () => {
    it.each([
      ["empty string", ""],
      ["whitespace only", "   "],
      ["non-string", 42],
      ["null", null],
      ["undefined", undefined],
      ["a non-YouTube host", "https://vimeo.com/watch?v=dQw4w9WgXcQ"],
      ["a lookalike host", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"],
      ["a subdomain attack", "https://evil.example.com/youtube.com/watch?v=dQw4w9WgXcQ"],
      ["a javascript: URL", "javascript:alert(1)"],
      ["a file: URL", "file:///etc/passwd"],
      ["YouTube with no video or list ID", "https://www.youtube.com/"],
      ["a channel page", "https://www.youtube.com/@someuser"],
      ["an ID with shell metacharacters", "https://www.youtube.com/watch?v=abc;rm%20-rf"],
      ["an ID with a quote", 'https://www.youtube.com/watch?v=abc"def'],
    ])("%s", (_label, input) => {
      expect(() => parseYouTubeUrl(input)).toThrow(AppError);
      try {
        parseYouTubeUrl(input);
      } catch (err) {
        expect((err as AppError).code).toBe("INVALID_URL");
      }
    });
  });
});

/** Body validation for `POST /api/download`. */
describe("parseDownloadRequest", () => {
  const base = { url: "https://youtu.be/dQw4w9WgXcQ", type: "video" as const, quality: 1080 };
  const canonical = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  it("accepts a valid video request", () => {
    expect(parseDownloadRequest(base)).toEqual({
      url: canonical,
      type: "video",
      quality: 1080,
      jobId: null,
      batchUrls: null,
      batchName: null,
    });
  });

  it("accepts a valid audio request", () => {
    const result = parseDownloadRequest({ ...base, type: "audio", quality: 320 });
    expect(result.type).toBe("audio");
    expect(result.quality).toBe(320);
  });

  it.each([
    ["a non-object body", "nope"],
    ["null", null],
    ["a missing type", { url: base.url, quality: 720 }],
    ["an unknown type", { ...base, type: "subtitles" }],
    ["a non-numeric quality", { ...base, quality: "1080" }],
    ["NaN quality", { ...base, quality: Number.NaN }],
    ["an unsupported resolution", { ...base, quality: 999 }],
    ["a resolution that is really a bitrate", { ...base, quality: 320 }],
    ["an unsupported bitrate", { ...base, type: "audio", quality: 256 }],
    ["an empty batch", { ...base, batchUrls: [] }],
    ["a non-array batch", { ...base, batchUrls: "a,b" }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseDownloadRequest(body)).toThrow(AppError);
  });

  it("caps batch size", () => {
    const tooMany = Array.from({ length: 26 }, () => base.url);
    try {
      parseDownloadRequest({ ...base, batchUrls: tooMany });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as AppError).code).toBe("PLAYLIST_TOO_LARGE");
    }
  });

  it("canonicalises every URL in a batch", () => {
    const result = parseDownloadRequest({
      ...base,
      batchUrls: ["youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=9"],
    });
    expect(result.batchUrls).toEqual([canonical, canonical]);
  });

  it("rejects a batch containing one bad URL", () => {
    expect(() =>
      parseDownloadRequest({ ...base, batchUrls: [base.url, "https://evil.example.com/x"] }),
    ).toThrow(AppError);
  });

  describe("jobId", () => {
    it("keeps a well-formed id", () => {
      expect(parseDownloadRequest({ ...base, jobId: "abc123_-XYZ" }).jobId).toBe("abc123_-XYZ");
    });

    it.each([
      ["path traversal", "../../etc/passwd"],
      ["a slash", "a/b"],
      ["a newline", "abc\ndef"],
      ["an over-long id", "x".repeat(65)],
      ["a non-string", 12345],
    ])("drops %s rather than failing the request", (_label, jobId) => {
      expect(parseDownloadRequest({ ...base, jobId }).jobId).toBeNull();
    });
  });

  describe("batchName sanitisation", () => {
    it("strips path and header-breaking characters", () => {
      const result = parseDownloadRequest({
        ...base,
        batchUrls: [base.url],
        batchName: 'My/Play:list*?<>|"\\name',
      });
      expect(result.batchName).toBe("My Play list name");
    });

    it("removes CRLF so a header cannot be injected", () => {
      const result = parseDownloadRequest({
        ...base,
        batchUrls: [base.url],
        batchName: "evil\r\nX-Injected: yes",
      });
      expect(result.batchName).not.toContain("\r");
      expect(result.batchName).not.toContain("\n");
    });

    it("caps length", () => {
      const result = parseDownloadRequest({
        ...base,
        batchUrls: [base.url],
        batchName: "n".repeat(200),
      });
      expect(result.batchName).toHaveLength(80);
    });

    it("returns null for a name that sanitises to nothing", () => {
      const result = parseDownloadRequest({ ...base, batchUrls: [base.url], batchName: "///" });
      expect(result.batchName).toBeNull();
    });
  });
});
