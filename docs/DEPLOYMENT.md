# Deployment

## Why this cannot run on a serverless platform

Cloudflare Pages/Workers, Vercel functions, Netlify functions and Deno Deploy all fail on
the same three requirements, and no configuration works around them:

| Requirement                                                  | Where                                      |
| ------------------------------------------------------------ | ------------------------------------------ |
| `child_process.spawn()` to run yt-dlp                        | `src/lib/ytdlp.ts`, `src/lib/binaries.ts`  |
| A writable filesystem (`mkdtemp`, `os.tmpdir`, read streams) | `src/lib/temp.ts`, `src/lib/info-cache.ts` |
| The `yt-dlp` (Python) and `ffmpeg` (native) binaries         | installed by the `Dockerfile`              |

Workers has no process model and no filesystem at all. `@opennextjs/cloudflare` will happily
build a Next.js app for Workers, but it cannot give you a subprocess — so it does not help
here. **This app needs a container.**

Cloudflare still has a useful role: see [Putting Cloudflare in front](#putting-cloudflare-in-front).

## Deploying the container

The `Dockerfile` bundles Node, Python, yt-dlp and ffmpeg, runs as a non-root user, and is
built and smoke-tested by CI on every push.

### Fly.io (recommended)

`fly.toml` is included and ready.

```bash
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --copy-config    # edit `app` and `primary_region` first
fly deploy
fly open
```

Check it came up correctly:

```bash
curl -s https://<your-app>.fly.dev/api/health
# {"ytDlp":{"available":true,...},"ffmpeg":{"available":true,...}}
```

### Render

`render.yaml` is included. Create a Blueprint from the repository, or a Web Service with
runtime **Docker**. Avoid the free instance type: it has too little disk for large temp
files, and it sleeps.

### Railway

`railway.json` is included.

```bash
npm i -g @railway/cli && railway login
railway init && railway up
```

## Sizing

Each in-flight download writes the whole file to disk before streaming it out, so:

- **Disk** — the largest video you expect, times your concurrency. A 4K download of a
  10-minute video is over 1.5 GB. `fly.toml` caps concurrency at 4 soft / 8 hard for this
  reason.
- **Memory** — 1–2 GB is plenty. The merge is a stream copy, not a re-encode.
- **CPU** — mostly idle. MP3 extraction is the only real CPU work; two shared cores are fine.

## Putting Cloudflare in front

Point an `A`/`CNAME` record at your deployment. Everything below matters more than the DNS
record itself.

### The 125-second problem — read this first

Cloudflare returns **Error 524** if the origin has not produced an HTTP response within
**125 seconds**. That timeout is not adjustable below the Enterprise plan (Enterprise can
raise it to 6000s).

This app is unusually exposed to it. It downloads the video **and merges it** before
emitting a single byte, so time-to-first-byte is the whole server-side job:

```
time to first byte  ≈  (video bytes + audio bytes) / origin throughput  +  merge
```

Measured on a 10-minute 1080p60 video, from an origin sustaining ~10 MiB/s:

| Download              | Bytes   | Time to first byte | Behind a proxied Cloudflare |
| --------------------- | ------- | ------------------ | --------------------------- |
| 1080p, "Smaller file" | 122 MB  | ~19 s              | fine                        |
| 1080p, H.264          | 256 MB  | ~29–36 s           | fine                        |
| 2160p, same video     | 1.37 GB | ~130 s             | **524**                     |

So: typical 1080p is comfortable, **4K is not**, and a slow origin drags everything toward
the limit proportionally. There is no response-body size limit — Cloudflare will happily
proxy a 2 GB download once it has started. The problem is purely how long the origin takes
to start.

Three ways to deal with it, in the order Cloudflare itself recommends:

1. **Serve the app from a DNS-only (grey cloud) record.** Downloads bypass the proxy
   entirely and the timeout disappears. You keep Cloudflare DNS but lose WAF, caching and
   DDoS protection on that hostname.
2. **Split it.** Proxy the app on `yttools.example.com` (orange cloud) for the UI, and
   expose a DNS-only `dl.yttools.example.com` for downloads. More moving parts, but you
   keep protection on the part that faces the internet.
3. **Accept the ceiling.** If nobody downloads 4K, a proxied record is fine. Consider
   removing `2160` and `4320` from `ALLOWED_HEIGHTS` in `src/lib/validate.ts` so users get
   a clear error instead of a 524.

### Authentication — do not skip this

An open instance lets anyone make your server download gigabytes and hammer YouTube from
your IP, which gets that IP bot-challenged. The built-in rate limiter is a courtesy, not a
defence.

**Cloudflare Access** solves this well and is free for up to 50 users:

1. Zero Trust dashboard → Access → Applications → Add a self-hosted application.
2. Set the domain to your hostname.
3. Add a policy — e.g. allow only specific email addresses, or your own domain.

Visitors then authenticate at Cloudflare's edge and the origin is never reachable without a
valid token. Note that Access requires the hostname to be **proxied**, so it does not
combine with the grey-cloud workaround above — if you need both, use the split-hostname
approach and protect at least the UI.

### Cache and WAF rules

- **Do not cache `/api/*`.** Responses are per-request and often huge. Add a Cache Rule with
  _Bypass cache_ for `starts_with(http.request.uri.path, "/api/")`. The app already sends
  `Cache-Control: no-store`, but an explicit rule is clearer.
- **Rate limiting.** A Cloudflare rate-limiting rule on `/api/download` is worth having in
  addition to the app's own per-IP limiter, which is per-process and resets on redeploy.
- **`/api/progress` is Server-Sent Events.** It is long-lived and must not be buffered. The
  app already sends `X-Accel-Buffering: no`; do not enable any transformation on it.

## Multiple instances

Rate-limit counters, the progress pub/sub and the metadata cache all live in process memory.
With more than one instance you want session affinity, otherwise the progress bar falls back
to indeterminate, the metadata cache misses more often, and each instance enforces its own
rate limit. For a self-hosted tool, one instance is usually the right answer.

## Keeping it working

yt-dlp needs regular updates or YouTube changes will break it. `YT_DLP_VERSION` is pinned in
the `Dockerfile`; bump it and redeploy periodically. Dependabot watches the base image but
not that pin.
