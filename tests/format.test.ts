import { describe, expect, it } from "vitest";

import {
  contentDisposition,
  contentTypeFor,
  formatBytes,
  formatDuration,
  formatUploadDate,
  formatViews,
} from "@/lib/format";

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [9, "0:09"],
    [95, "1:35"],
    [635, "10:35"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("formats %i seconds as %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it.each([null, Number.NaN, -5, Number.POSITIVE_INFINITY])(
    "falls back to a placeholder for %s",
    (input) => {
      expect(formatDuration(input)).toBe("--:--");
    },
  );
});

describe("formatBytes", () => {
  it.each([
    [500, "500 B"],
    [1024, "1.0 KB"],
    [15_728_640, "15.0 MB"],
    [1_234_567_890, "1.1 GB"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it.each([null, 0, -1, Number.NaN])("uses an em dash for %s", (input) => {
    expect(formatBytes(input)).toBe("—");
  });
});

describe("formatViews", () => {
  it.each([
    [0, "0 views"],
    [999, "999 views"],
    [1500, "1.5K views"],
    [23_352_374, "23.4M views"],
    [1_500_000_000, "1.5B views"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatViews(input)).toBe(expected);
  });

  it("returns null when the count is unknown", () => {
    expect(formatViews(null)).toBeNull();
  });
});

describe("formatUploadDate", () => {
  it("parses yt-dlp's compact date", () => {
    expect(formatUploadDate("20141110")).toBe("10 Nov 2014");
  });

  it.each([null, "", "2014-11-10", "not-a-date", "201411"])("returns null for %s", (input) => {
    expect(formatUploadDate(input)).toBeNull();
  });
});

/**
 * `Content-Disposition` is built from a video title, which is attacker-supplied
 * as far as this server is concerned. It must never be able to terminate the
 * header or escape the filename.
 */
describe("contentDisposition", () => {
  it("emits both the ASCII and RFC 5987 forms", () => {
    const header = contentDisposition("Video.mp4");
    expect(header).toBe("attachment; filename=\"Video.mp4\"; filename*=UTF-8''Video.mp4");
  });

  it("preserves non-ASCII titles in the extended form", () => {
    const header = contentDisposition("Ärger für Alle.mp3");
    expect(header).toContain('filename="_rger f_r Alle.mp3"');
    expect(header).toContain("filename*=UTF-8''%C3%84rger%20f%C3%BCr%20Alle.mp3");
  });

  it.each([
    ["a double quote", 'evil".mp4'],
    ["a carriage return", "evil\r\nX-Injected: yes.mp4"],
    ["a line feed", "evil\nX-Injected: yes.mp4"],
    ["a path separator", "../../etc/passwd"],
    ["a backslash", "evil\\path.mp4"],
  ])("neutralises %s", (_label, filename) => {
    const header = contentDisposition(filename);
    // Exactly one quoted segment, and no raw newlines anywhere.
    expect(header.match(/"/g)).toHaveLength(2);
    expect(header).not.toMatch(/[\r\n]/);
  });

  it("falls back to a default when nothing survives sanitisation", () => {
    expect(contentDisposition("///")).toContain('filename="___"');
    expect(contentDisposition("")).toContain('filename="download"');
  });
});

describe("contentTypeFor", () => {
  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.webm", "video/webm"],
    ["clip.mkv", "video/x-matroska"],
    ["song.mp3", "audio/mpeg"],
    ["song.m4a", "audio/mp4"],
    ["song.opus", "audio/opus"],
    ["batch.zip", "application/zip"],
    ["CLIP.MP4", "video/mp4"],
  ])("maps %s to %s", (filename, expected) => {
    expect(contentTypeFor(filename)).toBe(expected);
  });

  it.each(["mystery.bin", "no-extension", "trailing."])(
    "falls back to octet-stream for %s",
    (filename) => {
      expect(contentTypeFor(filename)).toBe("application/octet-stream");
    },
  );
});
