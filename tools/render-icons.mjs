// Regenerates the app icons from tools/icon.svg.
//
//   node tools/render-icons.mjs
//
// Chromium does the rasterising, so gradients and arcs come out exactly as the
// browser draws them. Sizes are fixed by the manifest and by iOS.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const svg = readFileSync(join(here, "icon.svg"), "utf8");

const OUT = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "apple-touch-icon.png"],
];

const browser = await chromium.launch();
for (const [size, name] of OUT) {
  const ctx = await browser.newContext({ viewport: { width: size, height: size } });
  const page = await ctx.newPage();
  // No transparency: iOS composites the home screen icon onto black.
  await page.setContent(
    `<style>html,body{margin:0;background:#080C10}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  writeFileSync(join(root, name), await page.screenshot({ omitBackground: false }));
  console.log(name, size + "x" + size);
}
await browser.close();
