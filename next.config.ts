import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. Without it, Turbopack walks up looking for a lock
  // file and can land on the home directory.
  turbopack: { root: path.resolve(".") },

  // `standalone` emits a self-contained server bundle in .next/standalone,
  // which keeps the production Docker image small (see Dockerfile).
  output: "standalone",

  // `archiver` (used for playlist ZIP streaming) is CommonJS and relies on
  // dynamic requires, so it must stay external to the server bundle.
  serverExternalPackages: ["archiver"],

  images: {
    // Thumbnails are plain <img> tags pointing at YouTube's CDN, so the
    // optimiser is never used — but leaving it on makes Next trace `sharp`
    // and its libvips binaries into the standalone output: 27 MB of dead
    // weight in the desktop bundle.
    unoptimized: true,
  },
};

export default nextConfig;
