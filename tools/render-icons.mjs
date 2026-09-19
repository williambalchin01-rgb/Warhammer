// Regenerates the app icons from tools/icon-source.jpg.
//
//   node tools/render-icons.mjs
//
// The source is a mock-up: the artwork appears twice, on tiles with rounded
// corners already drawn in. iOS and Android apply their own corner mask, so
// baked-in rounding would show as a dark halo. This lifts the artwork out of
// the first tile and re-lays it on a clean, full-bleed square.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const source = readFileSync(join(here, "icon-source.jpg"));

const GROUND = "#2B2321";        // the tile ground, sampled from the source
const CROP = { x: 133, y: 107, w: 437, h: 452 };

// Keep the artwork inside the middle 80%, which is all a maskable icon is
// guaranteed to show.
const COVERAGE = 0.78;

const OUT = [
  [512, "icon-512.png"],
  [192, "icon-192.png"],
  [180, "apple-touch-icon.png"],
];

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

for (const [size, name] of OUT) {
  const dataUrl = await page.evaluate(async ({ url, size, GROUND, CROP, COVERAGE }) => {
    const img = new Image();
    img.src = url;
    await img.decode();

    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";

    // Opaque ground: iOS composites home-screen icons onto black, so any
    // transparency would read as a hole.
    g.fillStyle = GROUND;
    g.fillRect(0, 0, size, size);

    const scale = (size * COVERAGE) / CROP.h;
    const dw = CROP.w * scale;
    const dh = CROP.h * scale;
    g.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h,
                (size - dw) / 2, (size - dh) / 2, dw, dh);
    return c.toDataURL("image/png");
  }, { url: "data:image/jpeg;base64," + source.toString("base64"), size, GROUND, CROP, COVERAGE });

  writeFileSync(join(root, name), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(name, size + "x" + size);
}
await browser.close();
