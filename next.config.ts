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
};

export default nextConfig;
