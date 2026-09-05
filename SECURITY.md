# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
private vulnerability reporting ("Report a vulnerability" under the Security
tab), which reaches the maintainer directly.

Include what you found, how to reproduce it, and what an attacker gains. You
will get an acknowledgement within a few days.

## Supported versions

The latest release on `main` is supported. This project has no LTS branches.

## Threat model

YT Tools takes a URL from an untrusted client and uses it to spawn a
subprocess. That is the whole risk surface, and the design treats it that way.

### What the code guarantees

- **No shell, ever.** `yt-dlp` is spawned with an argument array via
  `child_process.spawn`. No user input is ever concatenated into a command
  string, so shell metacharacters are inert.
- **URLs are rebuilt, not forwarded.** `parseYouTubeUrl` parses the input,
  checks the hostname against an allowlist, extracts the video or playlist ID,
  validates it against `^[A-Za-z0-9_-]{1,64}$`, and constructs a fresh
  canonical URL. The string the user sent never reaches yt-dlp.
- **Fixed allowlists for everything else.** Resolutions and bitrates are
  checked against enumerated sets; `jobId` and batch names are pattern-matched
  or sanitised.
- **No header injection.** `Content-Disposition` filenames have CR, LF, quotes
  and path separators stripped, and non-ASCII names go through RFC 5987
  encoding.
- **Host config is ignored.** `--ignore-config` stops a stray `yt-dlp.conf`
  from changing behaviour under the app's feet.
- **Nothing persists.** Each request downloads into its own `mkdtemp`
  directory, which is deleted when the response stream closes — on success,
  on failure, and on client disconnect. Orphans from a crash are swept.
- **Bounded work.** Per-IP rate limiting, a per-run timeout, and a cap on
  playlist batch size.

### What it does not protect against

- **Abuse when exposed publicly.** Anyone who can reach the app can make your
  server download large files and hammer YouTube from your IP — which will get
  that IP rate-limited or bot-challenged. **Put it behind authentication, a VPN,
  or your own network if it is reachable from the internet.** The built-in rate
  limiter is a courtesy, not a defence.
- **Disk exhaustion.** Concurrent downloads each need room for their file.
  Size `/tmp` for your traffic; `docker-compose.yml` uses an 8 GB tmpfs.
- **Multi-replica correctness.** Rate-limit counters and progress state live in
  process memory. Across replicas, each enforces its own limit.
- **yt-dlp itself.** It is a large program that parses hostile input from the
  internet. Keep it current — pin and bump `YT_DLP_VERSION` in the Dockerfile.

## Deliberate non-features

This project will not accept contributions that circumvent DRM, age
verification, or regional restrictions. `YT_DLP_COOKIES` exists so you can
download content **your own account already has legitimate access to**, not to
bypass a gate.
