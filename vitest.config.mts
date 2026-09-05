import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // The suite covers pure logic only — URL validation, error mapping and
    // formatting. Anything that shells out to yt-dlp belongs in a manual or
    // integration run, not here.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/api-client.ts"],
    },
  },
});
