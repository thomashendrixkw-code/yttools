# macOS app

A `.dmg` you drag into Applications. It bundles everything — the Next.js server, a Python
runtime, yt-dlp and ffmpeg — so there is nothing to install and nothing to configure.

Running locally is not only convenient. It sidesteps the two things that make a hosted
deployment awkward: YouTube throttles datacenter IPs hard, and a reverse proxy imposes a
timeout on the origin (see [DEPLOYMENT.md](DEPLOYMENT.md)). Neither applies on your own
machine.

## Installing

Download the DMG, open it, drag **YT Tools** into Applications.

The build is **not signed with an Apple Developer ID**, so the first launch needs one extra
step. Either:

- **Right-click the app → Open**, then confirm in the dialog; or
- clear the quarantine flag once:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/YT Tools.app"
  ```

Without this, macOS reports the app as damaged or from an unidentified developer. Signing it
properly requires a paid Apple Developer account; see [Signing](#signing-optional).

## What is inside

| Component           | Size    | Why it is bundled                                         |
| ------------------- | ------- | --------------------------------------------------------- |
| Electron 33         | ~250 MB | Window, and it doubles as the Node runtime for the server |
| CPython 3.12        | ~70 MB  | yt-dlp needs Python 3.10+; macOS only ships 3.9           |
| ffmpeg 6.0 (static) | ~43 MB  | MP3 encoding and merging video + audio                    |
| yt-dlp zipapp       | ~3 MB   | The downloader itself                                     |
| Next.js server      | ~49 MB  | The same server that runs in Docker                       |

DMG around 156 MB, installed app around 399 MB.

### Why not the official `yt-dlp_macos` binary

It is a PyInstaller one-file build that unpacks its whole runtime on **every** invocation.
Measured on an M-series Mac:

| Approach                         | `yt-dlp --version` |
| -------------------------------- | ------------------ |
| Bundled `yt-dlp_macos` (35 MB)   | **15–18 s**        |
| Bundled CPython + zipapp (73 MB) | **0.7–1.0 s**      |

That cost lands on every metadata fetch and every download, so it would have roughly doubled
the time of a 1080p download. Ad-hoc code signing made no difference, so it is the unpacking
itself, not Gatekeeper. Bundling Python costs ~35 MB more and is 20× faster.

macOS's own `/usr/bin/python3` cannot be used instead: it is 3.9.6, and yt-dlp refuses
anything below 3.10 with `ImportError: You are using an unsupported version of Python`.

### Why not Homebrew's ffmpeg

`otool -L` shows it linking 19 dylibs under `/opt/homebrew`. Copying it into an app bundle
would break on any machine without Homebrew. The `ffmpeg-static` build depends only on macOS
system frameworks, so it relocates cleanly. It is LGPL 2.1; the licence ships alongside it at
`Contents/Resources/bin/ffmpeg.LICENSE`.

## Downloads

Files go straight to `~/Downloads`, with a notification when each finishes — click it to
reveal the file in Finder. An existing `clip.mp4` is never overwritten; you get
`clip (2).mp4`.

## Building it yourself

```bash
npm ci                    # repo root
cd desktop
npm install
npm run dist              # -> desktop/dist/YT Tools-<version>-arm64.dmg
```

`npm run prepare-resources` alone assembles `desktop/resources/` without packaging, and
`npm start` runs the app unpackaged against those resources — useful while working on
`main.js`.

The prepare step caches what it downloads. To refresh:

```bash
rm -rf desktop/resources/python      # new CPython
rm -f  desktop/resources/bin/yt-dlp.pyz   # new yt-dlp
```

Keep yt-dlp current — YouTube changes break it regularly, and a bundled copy does not update
itself.

### Architecture

`electron-builder.yml` targets **arm64** only, because `ffmpeg-static` installs a binary for
the machine doing the build. For an Intel build, run the whole thing on an Intel Mac (or
under Rosetta) and change the `arch` list. The yt-dlp zipapp and the Python download are
already architecture-aware.

### CI

`.github/workflows/desktop.yml` builds the DMG on a macOS runner. It is **manual**
(`workflow_dispatch`) — a 400 MB app on every push would be wasteful. It verifies the bundle
actually carries its runtimes before uploading, and can attach the DMG to a release tag.

## Signing (optional)

With a paid Apple Developer account, in `desktop/electron-builder.yml`:

```yaml
mac:
  identity: "Developer ID Application: Your Name (TEAMID)"
  hardenedRuntime: true
```

`build/entitlements.mac.plist` is already written for it — the app needs
`disable-library-validation` because it spawns the bundled Python and ffmpeg. Then notarise:

```bash
xcrun notarytool submit "dist/YT Tools-1.0.0-arm64.dmg" \
  --apple-id you@example.com --team-id TEAMID --password APP_SPECIFIC_PASSWORD --wait
xcrun stapler staple "dist/YT Tools-1.0.0-arm64.dmg"
```

Users then get no warning at all.

## Troubleshooting

**"YT Tools is damaged and can't be opened"** — the quarantine flag. See
[Installing](#installing). The app is not damaged; macOS says this for any unsigned app
downloaded from the internet.

**The window is blank** — the bundled server failed to start. Launch from a terminal to see
why:

```bash
"/Applications/YT Tools.app/Contents/MacOS/YT Tools"
```

**Downloads fail with "YouTube is blocking requests"** — rare on a residential connection,
but if it happens, wait a few minutes. The bundled yt-dlp may also be out of date; rebuild
with a fresh one.
