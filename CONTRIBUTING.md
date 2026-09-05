# Contributing

Thanks for taking the time. This is a small project, so the process is light.

## Getting set up

You need Node 20+ (see `.nvmrc`), plus `yt-dlp` and `ffmpeg` on your `PATH`.

```bash
brew install yt-dlp ffmpeg     # macOS; see README for other platforms
npm install
npm run dev                    # http://localhost:3000
```

`GET /api/health` tells you whether the binaries were found. The UI shows a
banner if either is missing.

## Before you open a PR

```bash
npm run check     # typecheck + lint + tests
npm run build     # catches anything the above misses
```

`npm run format` applies Prettier. CI runs all of these plus a Docker build.

## Scripts

| Script                  | What it does                 |
| ----------------------- | ---------------------------- |
| `npm run dev`           | Dev server with hot reload   |
| `npm run build`         | Production build             |
| `npm start`             | Serve the production build   |
| `npm run typecheck`     | `tsc --noEmit`               |
| `npm run lint`          | ESLint (Next.js flat config) |
| `npm run format`        | Prettier, write mode         |
| `npm run format:check`  | Prettier, check only         |
| `npm test`              | Vitest, single run           |
| `npm run test:watch`    | Vitest, watch mode           |
| `npm run test:coverage` | Vitest with V8 coverage      |
| `npm run check`         | typecheck + lint + test      |

## What the tests cover

`tests/` covers pure logic only — URL validation, yt-dlp error mapping, and
formatting. These are the parts where a regression is silent and dangerous:
`parseYouTubeUrl` is the boundary between a request body and a spawned
subprocess, and the error patterns are the only thing standing between a user
and a generic "something went wrong".

Anything that shells out to yt-dlp is **not** unit-tested — it would depend on
YouTube being reachable and on a specific video still existing. Test those paths
by hand against a Creative Commons or public-domain video.

## Code conventions

- **TypeScript everywhere**, `strict` plus `noUncheckedIndexedAccess`. No `any`
  in application code; use `unknown` and narrow.
- **Comments explain why, not what.** If a line needs a comment to say what it
  does, rename something instead.
- **Every network-facing shape lives in `src/lib/types.ts`** so the client and
  the route handlers cannot drift apart.
- **Errors are structured.** Throw `AppError` with a code from `ApiErrorCode`;
  route handlers funnel everything through `toApiError`.
- **Never build a shell string.** yt-dlp is always spawned with an argument
  array. If you find yourself interpolating user input into a command, stop.

## Areas that need care

- **`src/lib/validate.ts`** is the security boundary. Changes here want tests.
- **`src/lib/ytdlp.ts`** parses yt-dlp's output. yt-dlp changes its wording
  occasionally; `tests/errors.test.ts` uses real stderr strings, so update them
  together.
- **Scratch directories.** Every path out of `POST /api/download` must delete
  its temp directory — success, failure, and client disconnect alike.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), e.g.:

```
feat(api): support playlist batches as a ZIP
fix(ytdlp): match yt-dlp's real geo-block wording
docs: document the sticky-session requirement
```

## Reporting bugs

Open an issue with the URL you used (if it is public), what you expected, what
happened, and the output of `GET /api/health`. For anything security-related,
see [SECURITY.md](SECURITY.md) instead.
