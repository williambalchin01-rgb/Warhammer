// Service worker: works offline, and an update reaches an installed copy on
// the next launch. Changed files are served from memory, never written to disk.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, playwright, step, assert, finish } from "./harness.mjs";
import { serve } from "./server.mjs";

const srv = await serve(ROOT);
const { chromium } = playwright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: "allow" });
const p = await ctx.newPage();
p.setDefaultTimeout(8000);
const ready = () => p.waitForFunction(() => !document.getElementById("armies-view").hidden);

await p.goto(srv.url);
await ready();
await p.evaluate(() => navigator.serviceWorker.ready);
await p.waitForTimeout(400);

await step("the service worker controls the page", async () => {
  assert(await p.evaluate(() => !!navigator.serviceWorker.controller), "not controlled");
});

await step("the app opens offline", async () => {
  await ctx.setOffline(true);
  await p.reload();
  await ready();
  await ctx.setOffline(false);
});

await step("an updated page reaches an installed copy", async () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  srv.overrides.set("/index.html", html.replace("<title>Painting</title>", "<title>Painting v2</title>"));
  srv.overrides.set("/", srv.overrides.get("/index.html"));
  await p.reload();
  await ready();
  assert((await p.title()) === "Painting v2", "saw " + (await p.title()));
});

await step("the updated page is what gets cached for offline", async () => {
  await ctx.setOffline(true);
  await p.reload();
  await ready();
  assert((await p.title()) === "Painting v2", "saw " + (await p.title()));
  await ctx.setOffline(false);
});

await step("an updated module reaches an installed copy", async () => {
  const js = readFileSync(join(ROOT, "js/ui.js"), "utf8");
  srv.overrides.set("/js/ui.js", js + "\nexport const MARKER = 1;\n");
  await p.reload();
  await ready();
  const got = await p.evaluate(() => fetch("./js/ui.js").then((r) => r.text()));
  assert(got.includes("MARKER"), "stale module");
});

srv.overrides.clear();
await browser.close();
await srv.close();
finish();
