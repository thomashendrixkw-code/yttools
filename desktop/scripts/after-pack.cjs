"use strict";

/**
 * Trims what Electron ships but this app never uses.
 *
 * On macOS, electron-builder's own `electronLanguages` only prunes the .lproj
 * stubs in Contents/Resources, which are empty — the real 40 MB of Chromium
 * locale bundles live inside the framework, and nothing touches them. On
 * Windows the same option does work (the locales sit in a plain `locales/`
 * directory), so there it is left to do its job and this hook only handles
 * SwiftShader.
 *
 * SwiftShader is Chromium's CPU rasteriser, a fallback for machines with no
 * usable GPU. Removing it leaves a clean GPU process — verified on macOS by
 * launching the packaged app and finding no gl_/viz_/gpu_ errors in its log.
 *
 * Do NOT extend this to ANGLE (libGLESv2 + libEGL, ~7 MB). Tried: the window
 * still paints, so a screenshot looks fine, but the log fills with "Exiting GPU
 * process due to errors during initialization" and the GPU process crashloops
 * into software compositing.
 */
const fs = require("node:fs");
const path = require("node:path");

const KEEP_LOCALE = "en";

/** Recursive byte size, for the saving report. */
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

const mib = (bytes) => `${(bytes / 1048576).toFixed(1)} MiB`;

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  const isMac = electronPlatformName === "darwin";

  const root = isMac
    ? path.join(appOutDir, `${context.packager.appInfo.productFilename}.app`)
    : appOutDir;
  if (!fs.existsSync(root)) return;

  const before = dirSize(root);
  const removed = [];

  if (isMac) {
    const framework = path.join(
      root,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
    );
    if (!fs.existsSync(framework)) {
      console.log("  [after-pack] Electron framework not found, skipping");
      return;
    }

    // Chromium falls back to en for any locale it cannot find.
    const resources = path.join(framework, "Resources");
    let locales = 0;
    for (const entry of fs.readdirSync(resources)) {
      if (entry.endsWith(".lproj") && entry !== `${KEEP_LOCALE}.lproj`) {
        fs.rmSync(path.join(resources, entry), { recursive: true, force: true });
        locales += 1;
      }
    }
    removed.push(`${locales} locales`);

    for (const dead of ["libvk_swiftshader.dylib", "vk_swiftshader_icd.json"]) {
      fs.rmSync(path.join(framework, "Libraries", dead), { force: true });
    }
    removed.push("SwiftShader");
  } else {
    // electron-builder's electronLanguages already pruned locales/ here.
    for (const dead of ["vk_swiftshader.dll", "vk_swiftshader_icd.json"]) {
      fs.rmSync(path.join(root, dead), { force: true });
    }
    removed.push("SwiftShader");
  }

  const after = dirSize(root);
  console.log(
    `  [after-pack] ${electronPlatformName}: removed ${removed.join(" + ")}: ` +
      `${mib(before)} -> ${mib(after)} (saved ${mib(before - after)})`,
  );
};
