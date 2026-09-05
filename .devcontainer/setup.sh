#!/usr/bin/env bash
# Installs the external binaries the app depends on, then the npm deps.
set -euo pipefail

echo "==> Installing ffmpeg"
sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends ffmpeg

echo "==> Installing yt-dlp"
sudo curl -fsSL \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

echo "==> Installing npm dependencies"
npm install

echo
echo "yt-dlp $(yt-dlp --version)"
ffmpeg -version | head -1
echo
cat <<'NOTE'
------------------------------------------------------------------------
Heads up: YouTube frequently blocks requests from datacenter IP addresses,
which is what Codespaces and other cloud VMs use. Metadata and downloads
may fail here with "YouTube is blocking requests from this server" even
though the app is working correctly.

If that happens, run the app on a local machine, or point YT_DLP_COOKIES
at cookies exported from a browser where you are signed in.
------------------------------------------------------------------------
NOTE
