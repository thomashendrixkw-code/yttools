# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **macOS desktop app.** An Electron shell in `desktop/` that runs the same
  Next.js server on a loopback port and bundles CPython 3.12, the yt-dlp zipapp
  and a static ffmpeg, so the `.dmg` has no prerequisites. Downloads land in
  ~/Downloads with a notification. Built by a manual CI workflow that verifies
  the bundle actually carries its runtimes.

- "Smaller file" option, selecting YouTube's AV1/VP9 rendition instead of H.264
  at the same resolution: roughly half the bytes, so a 1080p download finishes in
  about a third less time. Off by default, since H.264 plays on anything.
- `GET /api/download`, so the browser can stream a download straight to disk.
- Deployment configs for Fly.io, Render and Railway, plus `docs/DEPLOYMENT.md`
  covering sizing and running behind Cloudflare — notably that Cloudflare's
  125s origin timeout makes 4K downloads return a 524 on a proxied record,
  since the server produces the whole file before sending a byte.
- Metadata extraction is cached between `/api/info` and `/api/download`
  (`--load-info-json`), removing a duplicated 2-4s extraction per download.

### Changed

- Single downloads no longer pass through a `Blob` in the page. A 1080p file was
  held in memory twice over — roughly half a gigabyte — before being saved.
  Playlist ZIPs still use the previous path.
- The progress panel reports the server phase only; the browser's own download
  UI owns the transfer.

### Added

- `BLOCKED_BY_YOUTUBE` error code (HTTP 429) covering the several wordings yt-dlp
  produces when YouTube refuses a request — common from datacenter IPs such as
  GitHub Codespaces and CI runners. These previously fell through to a bare 502.
- Devcontainer that installs `yt-dlp` and `ffmpeg`, so the project runs in
  Codespaces without manual setup.
- App icon, so `/favicon.ico` no longer 404s.

### Changed

- New brand mark: a downward triangle over a tray bar, on a gradient squircle.
  The previous icon was a red rounded square containing a white play triangle —
  effectively YouTube's own mark, which this project should not imitate.
- Visual refresh throughout: layered surface shadows, a gradient primary action,
  a sliding tab indicator, a tighter type scale, and a calmer legal panel.

### Fixed

- yt-dlp's stderr is now logged server-side on failure. It was discarded
  entirely, which left an unrecognised failure with no diagnostic anywhere.
- The generic 502 hint now says where to find the real error.

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

[unreleased]: https://github.com/thomashendrixkw-code/yttools/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/thomashendrixkw-code/yttools/releases/tag/v1.0.0
