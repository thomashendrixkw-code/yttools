# Desktop apps

A `.dmg` for macOS and an `.exe` installer for Windows. Both bundle everything — the
Next.js server, a Python runtime, yt-dlp and ffmpeg — so there is nothing to install and
nothing to configure.

Running locally is not only convenient. It sidesteps the two things that make a hosted
deployment awkward: YouTube throttles datacenter IPs hard, and a reverse proxy imposes a
timeout on the origin (see [DEPLOYMENT.md](DEPLOYMENT.md)). Neither applies on your own
machine.

## Installing

Neither build is code-signed, so each system warns once. That is the only awkward step.

### macOS

Open the DMG and drag **YT Tools** into Applications. Then either **right-click the app →
Open** and confirm, or clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/YT Tools.app"
```

Without it, macOS reports the app as damaged or from an unidentified developer.

### Windows

Run `YT Tools Setup 1.0.0.exe`. SmartScreen will show _"Windows protected your PC"_ — click
**More info**, then **Run anyway**. That warning appears for any installer Microsoft has not
seen signed; it is not a malware finding.

The installer is per-user, so it needs no administrator rights.

## What is inside

| Component             | Size    | Why it is bundled                                         |
| --------------------- | ------- | --------------------------------------------------------- |
| Electron 33 (pruned)  | ~185 MB | Window, and it doubles as the Node runtime for the server |
| CPython 3.12 (pruned) | ~48 MB  | yt-dlp needs Python 3.10+; macOS only ships 3.9           |
| ffmpeg 6.0 (static)   | ~44 MB  | MP3 encoding and merging video + audio                    |
| Next.js server        | ~18 MB  | The same server that runs in Docker                       |
| yt-dlp zipapp         | ~3 MB   | The downloader itself                                     |

DMG around 119 MB (installed app ~309 MB); Windows installer around 107 MB
(installed ~360 MB, since Chromium's Windows build and its ffmpeg are larger).

### How it got there

The first working build was 409 MB / 156 MB. Four cuts, each verified against the
packaged app rather than assumed:

| Removed                           | Saved | Why it was safe                                                                                                                                                              |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharp` + `@img` from the server  | 27 MB | Next traces the image optimiser into the standalone build even with `images.unoptimized`, but thumbnails are plain `<img>` tags. Verified the server still boots and serves. |
| 54 Chromium locale bundles        | 40 MB | The UI is English only and Chromium falls back to `en`.                                                                                                                      |
| SwiftShader (`libvk_swiftshader`) | 16 MB | Chromium's CPU rasteriser, only used when no GPU exists. Verified: no `gl_`/`viz_`/`gpu_` errors in the packaged app's log.                                                  |
| CPython stdlib it never uses      | 18 MB | pip, ensurepip, idlelib, lib2to3, pydoc_data, tkinter and Tcl/Tk. Verified yt-dlp still extracts metadata.                                                                   |

`__pycache__` is deliberately **kept**: the bundle is read-only, so removing it would
make Python recompile the stdlib on every launch to save 4 MB.

`electron-builder`'s own `electronLanguages` option does not do the locale job — its
`getLocalesConfig` points at `Contents/Resources`, where the `.lproj` directories are
empty stubs. The real 40 MB sits inside the Electron framework, so
`scripts/after-pack.cjs` handles it.

### What was tried and rejected

- **Removing ANGLE** (`libGLESv2` + `libEGL`, ~7 MB). The window still paints, so a
  screenshot looks fine — but the log fills with _"Exiting GPU process due to errors
  during initialization"_ and Chromium crashloops into software compositing. The
  screenshot alone would have hidden this.
- **Replacing Electron with a native shell plus Node.** Electron's framework is 185 MB;
  the `node` binary alone is **229 MB**. Electron serving as both window and Node runtime
  is the cheaper arrangement here, not the expensive one.

The largest remaining item is ffmpeg at 44 MB. A build configured with
`--disable-everything` plus only the demuxers, muxers and the LAME encoder this app
actually uses would land around 10–15 MB, but it means compiling ffmpeg from source in CI
and risks a format that silently stops merging. Not attempted.

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

### Platforms and architectures

`npm run dist` builds for whatever machine you are on; `dist:mac` and `dist:win` are
explicit. **You cannot cross-build**: `ffmpeg-static` installs the binary for the current
platform, and an NSIS installer needs Wine when built from macOS. Build each target on its
own machine, or let CI do it.

Current targets are macOS **arm64** and Windows **x64**. For macOS on Intel, build on an
Intel Mac and add `x64` to the `arch` list. The yt-dlp zipapp is pure Python, and the
CPython download is already platform- and architecture-aware.

### CI

`.github/workflows/desktop.yml` builds both installers, on a macOS runner and a Windows
runner. It is **manual** (`workflow_dispatch`) — a 300 MB app per platform on every push
would be wasteful.

Building proves little on its own, so each job then **executes the bundled runtimes from
inside the packaged output** (`python … yt-dlp.pyz --version`, `ffmpeg -version`). That is
what confirms the promise of the bundle: that neither needs anything installed on the
machine. It can also attach both installers to a release tag.

## Signing (optional)

### Windows

SmartScreen stops warning once the installer is signed with an OV or EV certificate from a
Windows CA. Set `CSC_LINK` and `CSC_KEY_PASSWORD` in the build environment and
electron-builder picks them up. Note that OV certificates still accrue SmartScreen
reputation slowly; EV certificates start trusted.

### macOS

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

**"YT Tools is damaged and can't be opened"** (macOS) — the quarantine flag. See
[Installing](#installing). The app is not damaged; macOS says this for any unsigned app
downloaded from the internet.

**"Windows protected your PC"** — SmartScreen, because the installer is unsigned. Click
**More info** then **Run anyway**.

**The window is blank** — the bundled server failed to start. Launch from a terminal to see
why:

```bash
# macOS
"/Applications/YT Tools.app/Contents/MacOS/YT Tools"
```

```powershell
# Windows
& "$env:LOCALAPPDATA\Programs\yt-tools\YT Tools.exe"
```

**Downloads fail with "YouTube is blocking requests"** — rare on a residential connection,
but if it happens, wait a few minutes. The bundled yt-dlp may also be out of date; rebuild
with a fresh one.
