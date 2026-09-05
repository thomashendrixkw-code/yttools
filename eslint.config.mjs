import next from "eslint-config-next/core-web-vitals";

/**
 * Next.js' recommended flat config (which bundles the TypeScript, React Hooks
 * and Core Web Vitals rule sets) plus the paths ESLint should not walk.
 *
 * Rule overrides belong inside the config object that declares the owning
 * plugin, so prefer an inline eslint-disable comment with a reason over adding
 * a project-wide exception here.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      ".next/types/**",
      // Generated: the assembled desktop bundle and its packaged output.
      "desktop/resources/**",
      "desktop/dist/**",
      "desktop/node_modules/**",
    ],
  },
  ...next,
];

export default config;
