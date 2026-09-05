"use strict";

/**
 * electron-builder's `electronLanguages` only prunes the .lproj stubs in
 * Contents/Resources, which are empty. The real 40 MB of Chromium locale
 * bundles live inside the Electron framework, and nothing touches them.
 *
 * This hook removes those, plus the software Vulkan renderer, which exists as
 * a fallback for machines with no usable GPU — not a situation any Mac running
 * this app is in.
 */
const fs = require("node:fs");
const path = require("node:path");

const KEEP_LOCALES = new Set(["en.lproj"]);

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
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const framework = path.join(
    appPath,
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

  const before = dirSize(appPath);

  // Chromium falls back to en for any locale it cannot find.
  const resources = path.join(framework, "Resources");
  let removedLocales = 0;
  for (const entry of fs.readdirSync(resources)) {
    if (entry.endsWith(".lproj") && !KEEP_LOCALES.has(entry)) {
      fs.rmSync(path.join(resources, entry), { recursive: true, force: true });
      removedLocales += 1;
    }
  }

  // SwiftShader is Chromium's CPU rasteriser, used only when no GPU is
  // available. Removing it leaves a clean GPU process on macOS — verified by
  // launching the packaged app and finding no gl_/viz_/gpu_ errors in its log.
  //
  // Do NOT extend this to libGLESv2.dylib and libEGL.dylib (ANGLE, ~7 MB).
  // Tried: the window still paints, so a screenshot looks fine, but the log
  // fills with "Exiting GPU process due to errors during initialization" and
  // the GPU process crashloops into software compositing.
  for (const dead of ["libvk_swiftshader.dylib", "vk_swiftshader_icd.json"]) {
    fs.rmSync(path.join(framework, "Libraries", dead), { force: true });
  }

  const after = dirSize(appPath);
  console.log(
    `  [after-pack] removed ${removedLocales} locales + SwiftShader: ` +
      `${mib(before)} -> ${mib(after)} (saved ${mib(before - after)})`,
  );
};
