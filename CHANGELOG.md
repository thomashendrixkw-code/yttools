# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — 2026-09-05

First release.

### Added

- **MP4 downloads** at any resolution the video actually offers, with size
  estimates per resolution. Prefers H.264 + AAC so the result plays anywhere,
  falling back to AV1/VP9 only above 1080p where YouTube publishes no H.264.
- **MP3 extraction** at 128 / 192 / 320 kbps, with title, date and genre copied
  into ID3 tags.
- **Playlist batches** — pick entries from a checklist and receive one ZIP.
  A video that fails is skipped and listed in `SKIPPED.txt` rather than
  sinking the whole batch.
- **Two-phase progress**: a server-side download/convert phase streamed over
  Server-Sent Events, then the browser transfer measured locally.
- `POST /api/info`, `POST /api/download`, `GET /api/progress`, `GET /api/health`.
- Structured error codes for private, removed, age-restricted, region-blocked,
  members-only, live and DRM-protected videos, plus rate limits and timeouts.
- Dark mode, download history in `localStorage`, per-IP rate limiting.
- Dockerfile bundling Node, Python, yt-dlp and ffmpeg; runs as a non-root user
  with a healthcheck.
- 123 unit tests covering URL validation, error mapping and formatting.

### Security

- yt-dlp is spawned with an argument array, never a shell string.
- URLs are rebuilt from parsed components against a hostname allowlist;
  resolutions and bitrates are checked against fixed allowlists.
- `Content-Disposition` filenames are sanitised against header injection.
- `--ignore-config` prevents a stray `yt-dlp.conf` on the host from altering
  behaviour.
- Scratch directories are per-request, deleted when the response stream closes,
  and swept if a crash orphans one.

[unreleased]: https://github.com/thomashendrickx56/yttools/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/thomashendrickx56/yttools/releases/tag/v1.0.0
