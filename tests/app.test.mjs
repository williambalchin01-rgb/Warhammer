// End-to-end tests in a real browser. Steps share state and run in order, so
// each builds on the last the way a person would use the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, playwright, step, assert, finish } from "./harness.mjs";
import { serve } from "./server.mjs";

const SM = JSON.parse(readFileSync(join(ROOT, "data/space-marines.json"), "utf8"));
const DET = SM.detachments.find((d) => d.enhancements.length);
const ENH = DET.enhancements[0];

const srv = await serve(ROOT);
const { chromium } = playwright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await ctx.route("https://claude.ai/**", (r) => r.fulfill({ body: "claude" }));
const p = await ctx.newPage();
p.setDefaultTimeout(8000);

const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// ---- helpers ----------------------------------------------------------------

const vis = (sel) => p.locator(sel + ":visible");
const on = (id) => p.waitForFunction((v) => !document.getElementById(v).hidden, id);
const text = (sel) => p.textContent(sel);
const db = () => p.evaluate(() => JSON.parse(localStorage.getItem("painting.v1")));
const clipboard = () => p.evaluate(() => navigator.clipboard.readText());
const accept = () => p.once("dialog", (d) => d.accept());

async function pickOption(label) {
  await on("picker-view");
  await p.fill("#picker-search", label);
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await p.locator("#picker-rows .row-name").filter({ hasText: new RegExp("^" + esc + "$") }).first().click();
}

async function toRoot() {
  for (let i = 0; i < 4; i++) {
    if (await p.evaluate(() => !document.getElementById("tabs").hidden)) return;
    for (const sel of ["#op-back", "#unit-back", "#units-back", "#kt-back", "#list-back", "#scheme-back", "#rack-back", "#shop-back", "#claude-back"]) {
      const b = vis(sel);
      if (await b.count()) { await b.click(); break; }
    }
  }
}

async function tab(name) {
  await toRoot();
  await p.click("#tab-" + name);
}

async function reload() {
  await p.reload();
  await on("armies-view");
}

// ---- migration ---------------------------------------------------------------

await p.goto(srv.url + "index.html");
await p.evaluate(() => localStorage.setItem("painting.v1", JSON.stringify(
  [{ id: "a0", name: "Old Army", units: [{ id: "u0", name: "Tactical Squad", models: [5, 5, 5, 0, 0] }] }])));
await reload();

await step("migrates schema-1 data to the current schema in place", async () => {
  const d = await db();
  assert(d.schema === 4, "schema " + d.schema);
  for (const k of ["lists", "killteams", "paints", "schemes", "battles"]) assert(Array.isArray(d[k]) && !d[k].length, k);
  assert(d.armies[0].faction === null && d.armies[0].units[0].sheet === null, "defaults");
  assert(JSON.stringify(d.armies[0].units[0].schemes) === "[]", "unit schemes");
  assert(d.armies[0].units[0].models.join() === "5,5,5,0,0", "paint progress kept");
  assert(d.armies[0].id === "a0" && d.armies[0].units[0].id === "u0", "ids kept");
});

await step("the old army renders with its progress", async () => {
  const t = await text("#armies-rows");
  assert(t.includes("Old Army") && t.includes("3 of 5 based"), t);
});

// ---- collection and points ---------------------------------------------------

await step("sets a faction on an army", async () => {
  await vis(".row-main").filter({ hasText: "Old Army" }).click();
  await p.click("#army-faction");
  await pickOption("Space Marines");
  await on("units-view");
  assert((await text("#army-faction")) === "Space Marines", await text("#army-faction"));
});

await step("adds a unit from a datasheet with its size prefilled", async () => {
  await p.click("#units-add");
  await p.click("#unit-sheet-pick");
  await pickOption("Intercessor Squad");
  await on("add-unit-view");
  assert((await p.inputValue("#unit-name")) === "Intercessor Squad", "name");
  assert((await p.inputValue("#unit-count")) === "5", "size");
  await p.click("#unit-save");
  await on("units-view");
  assert((await text("#units-rows")).includes("80 pts"), await text("#units-rows"));
});

await step("army and collection totals show points", async () => {
  assert((await text("#army-sub")).includes("80 pts"), await text("#army-sub"));
  await p.click("#units-back");
  assert((await text("#grand-total")).includes("80 pts"), await text("#grand-total"));
});

await step("a part-strength resize warns and reprices", async () => {
  await vis(".row-main").filter({ hasText: "Old Army" }).click();
  await vis(".row-main").filter({ hasText: "Intercessor Squad" }).click();
  await p.click("#unit-size");
  await p.fill("#unit-count", "7");
  await p.click("#unit-save");
  await vis(".row-main").filter({ hasText: "Intercessor Squad" }).click();
  assert((await text("#unit-sub")).includes("150 pts"), await text("#unit-sub"));
  assert((await text("#unit-warn")).includes("next size up"), "warning");
});

await step("shrinking a unit asks before dropping painted models", async () => {
  await vis(".stage").filter({ hasText: "Not started" }).locator(".chip").last().click();
  await p.click("#unit-size");
  await p.fill("#unit-count", "5");
  let asked = false;
  p.once("dialog", (d) => { asked = true; d.accept(); });
  await p.click("#unit-save");
  await on("units-view");
  assert(asked, "no confirmation");
});

// ---- lists ------------------------------------------------------------------

let listId;
await step("builds a list", async () => {
  await tab("lists");
  await p.click("#lists-add");
  await p.fill("#list-name", "Test 2k");
  await p.click("#list-save");
  await on("list-view");
  assert((await text("#list-size")).includes("Strike Force"), await text("#list-size"));
  listId = (await db()).lists[0].id;
});

await step("list ids survive a reload", async () => {
  await reload();
  assert((await db()).lists[0].id === listId, "list id changed on reload");
});

await step("adds units and totals them against the battle size", async () => {
  await tab("lists");
  await vis(".row-main").filter({ hasText: "Test 2k" }).click();
  for (const n of ["Tactical Squad", "Intercessor Squad"]) {
    await p.click("#list-add");
    await pickOption(n);
    await on("list-view");
  }
  const sub = await text("#list-sub");
  assert(sub.includes("of 2,000 pts") && sub.includes("left"), sub);
  assert((await text("#list-rows")).includes("no datasheet"), "unlinked not flagged");
});

await step("shows what is still to paint, and jumps to that unit", async () => {
  const s = await text("#list-summary");
  assert(s.includes("Still to paint") && s.includes("Tactical Squad"), s);
  await vis(".queue-btn").filter({ hasText: "Tactical Squad" }).click();
  await on("unit-view");
  assert((await text("#unit-title")) === "Tactical Squad", await text("#unit-title"));
});

await step("detachment and enhancement add points", async () => {
  await tab("lists");
  await vis(".row-main").filter({ hasText: "Test 2k" }).click();
  await p.click("#list-detachment");
  await pickOption(DET.name);
  await on("list-view");
  assert((await text("#list-detachment")).includes(DET.dp + " DP"), "DP");
  const pts = async () => parseInt((await text("#list-sub")).replace(/,/g, ""), 10);
  const before = await pts();
  await vis("#list-rows .row-main").first().click();
  await pickOption(ENH.name);
  await on("list-view");
  assert((await pts()) === before + ENH.points, "expected +" + ENH.points);
});

// ---- paints -----------------------------------------------------------------

async function addPaint(name, brand, owned) {
  await p.click("#rack-add");
  await on("paint-form-view");
  await p.fill("#paintf-name", name);
  await p.fill("#paintf-brand", brand);
  if (!owned) await p.uncheck("#paintf-owned");
  await p.click("#paintf-save");
  await on("rack-view");
}

await step("adds paints to the rack, grouped by brand", async () => {
  await tab("paints");
  await vis(".row-main").filter({ hasText: "Paint rack" }).click();
  await on("rack-view");
  await addPaint("Macragge Blue", "Citadel", true);
  await addPaint("Nuln Oil", "Citadel", true);
  await addPaint("Calgar Blue", "Citadel", false);
  await addPaint("Model Air Gold", "Vallejo", true);
  const groups = await p.locator("#rack-rows .group").allTextContents();
  assert(groups.join() === "Citadel,Vallejo", groups.join());
  assert((await text("#rack-sub")).includes("3 paints owned") && (await text("#rack-sub")).includes("1 to buy"),
    await text("#rack-sub"));
});

await step("creates a scheme and adds steps in order", async () => {
  await p.click("#rack-back");
  await p.click("#paints-add");
  await p.fill("#schemef-name", "Ultramarines armour");
  await p.fill("#schemef-note", "Thin everything 2:1");
  await p.click("#schemef-save");
  await on("scheme-view");
  for (const [stage, paint, area] of [["Base", "Macragge Blue", "Armour"], ["Shade", "Nuln Oil", ""], ["Layer", "Calgar Blue", ""]]) {
    await p.click("#scheme-add");
    await on("step-form-view");
    await p.click("#stepf-stage");
    await pickOption(stage);
    await on("step-form-view");
    await p.click("#stepf-paint");
    await pickOption(paint);
    await on("step-form-view");
    if (area) await p.fill("#stepf-area", area);
    await p.click("#stepf-save");
    await on("scheme-view");
  }
  const paints = await p.locator("#scheme-steps .step-paint").allTextContents();
  assert(paints.join() === "Macragge Blue,Nuln Oil,Calgar Blue", paints.join());
  // A new step carries on the area of the one before it.
  const subs = await p.locator("#scheme-steps .step-sub").allTextContents();
  assert(subs.every((t) => t.includes("Armour")), subs.join(" | "));
  assert((await text("#scheme-steps")).includes("need to buy"), "unowned paint not flagged");
  assert((await text("#scheme-note")) === "Thin everything 2:1", "note");
});

await step("reorders and edits steps", async () => {
  await p.click("#scheme-edit");
  await p.click('#scheme-steps button[aria-label="Move step 3 up"]');
  let paints = await p.locator("#scheme-steps .step-paint").allTextContents();
  assert(paints.join() === "Macragge Blue,Calgar Blue,Nuln Oil", paints.join());
  await p.click("#scheme-edit");
  await vis("#scheme-steps .step-main").nth(2).click();
  await on("step-form-view");
  await p.fill("#stepf-note", "recesses only");
  await p.click("#stepf-save");
  await on("scheme-view");
  assert((await vis("#scheme-steps .step-sub").nth(2).textContent()).includes("recesses only"), "note not saved");
});

await step("adds a brand-new paint from inside a step", async () => {
  await p.click("#scheme-add");
  await on("step-form-view");
  await p.click("#stepf-paint");
  await pickOption("Add a new paint…");
  await on("paint-form-view");
  // Brand defaults to the last one added, since paints go in by the run.
  assert((await p.inputValue("#paintf-brand")) === "Vallejo", "brand default");
  await p.fill("#paintf-name", "Fenrisian Grey");
  await p.fill("#paintf-brand", "Citadel");
  await p.click("#paintf-save");
  await on("step-form-view");
  assert((await text("#stepf-paint")).includes("Fenrisian Grey"), await text("#stepf-paint"));
  await p.click("#stepf-save");
  await on("scheme-view");
  assert((await db()).paints.some((x) => x.name === "Fenrisian Grey" && x.brand === "Citadel"), "rack");
});

await step("the shopping list shows unowned paints and what needs them", async () => {
  await p.click("#scheme-back");
  await vis(".row-main").filter({ hasText: "Shopping list" }).click();
  await on("shop-view");
  const t = await text("#shop-rows");
  assert(t.includes("Calgar Blue") && t.includes("for Ultramarines armour"), t);
  await p.click("#shop-copy");
  assert((await clipboard()).includes("- Citadel Calgar Blue"), await clipboard());
  await p.click("#shop-rows .got");
  assert((await text("#shop-sub")) === "Nothing to buy", await text("#shop-sub"));
});

await step("links a scheme to a unit and opens it from the unit", async () => {
  await tab("collection");
  await vis(".row-main").filter({ hasText: "Old Army" }).click();
  await vis(".row-main").filter({ hasText: "Intercessor Squad" }).click();
  await vis("#unit-schemes .chip-btn").last().click();
  await pickOption("Ultramarines armour");
  await on("unit-view");
  await vis("#unit-schemes .chip-btn").filter({ hasText: "Ultramarines armour" }).click();
  await on("scheme-view");
  assert((await text("#scheme-back-label")) === "Intercessor Squad", "back label");
  assert((await text("#scheme-used")).includes("Intercessor Squad"), "used by");
  await p.click("#scheme-back");
  await on("unit-view");
});

await step("creates a new scheme straight from a unit", async () => {
  await vis("#unit-schemes .chip-btn").last().click();
  await pickOption("New scheme…");
  await on("scheme-form-view");
  await p.fill("#schemef-name", "Gold trim");
  await p.click("#schemef-save");
  await on("scheme-view");
  await p.click("#scheme-back");
  await on("unit-view");
  const chips = await vis("#unit-schemes .chip-btn").allTextContents();
  assert(chips.includes("Gold trim") && chips.includes("Ultramarines armour"), chips.join());
});

await step("a scheme photo is stored, survives reload and goes into the backup", async () => {
  const png = await p.screenshot({ clip: { x: 0, y: 0, width: 60, height: 40 } });
  await vis("#unit-schemes .chip-btn").filter({ hasText: "Ultramarines armour" }).click();
  await on("scheme-view");
  await p.setInputFiles("#scheme-photo-input", { name: "ref.png", mimeType: "image/png", buffer: png });
  await p.waitForFunction(() => !document.getElementById("scheme-photo-img").hidden);
  await reload();
  await tab("paints");
  await vis(".row-main").filter({ hasText: "Ultramarines armour" }).click();
  await p.waitForFunction(() => !document.getElementById("scheme-photo-img").hidden);
  await p.click("#scheme-back");
  await toRoot();
  await p.click("#tab-collection");
  await p.click("#data-open");
  await p.waitForFunction(() => document.getElementById("data-out").value.length > 0);
  const backup = JSON.parse(await p.inputValue("#data-out"));
  const sc = backup.schemes.find((x) => x.name === "Ultramarines armour");
  assert(backup.photos && /^data:image\/jpeg;base64,/.test(backup.photos[sc.id]), "photo missing from backup");
  await p.click("#data-close");
});

await step("deleting a paint leaves its steps showing no paint", async () => {
  await tab("paints");
  await vis(".row-main").filter({ hasText: "Paint rack" }).click();
  await vis("#rack-rows .row-main").filter({ hasText: "Nuln Oil" }).click();
  await on("paint-form-view");
  accept();
  await p.click("#paintf-delete");
  await on("rack-view");
  await p.click("#rack-back");
  await vis(".row-main").filter({ hasText: "Ultramarines armour" }).click();
  assert((await text("#scheme-steps")).includes("No paint"), await text("#scheme-steps"));
  await p.click("#scheme-back");
});

// ---- games --------------------------------------------------------------------

await step("logs a game from a list and shows the record there", async () => {
  await tab("lists");
  await vis(".row-main").filter({ hasText: "Test 2k" }).click();
  await p.click("#list-log");
  await on("battle-form-view");
  assert((await text("#battlef-list")) === "Test 2k", "list prefilled");
  assert(await p.isDisabled("#battlef-save"), "save enabled before a result");
  await p.click('#battlef-result button[data-r="L"]');
  await p.fill("#battlef-date", "2026-10-12");
  await p.fill("#battlef-for", "65");
  await p.fill("#battlef-against", "80");
  await p.fill("#battlef-opp", "Necrons");
  await p.fill("#battlef-mission", "Only War");
  await p.fill("#battlef-worked", "Intercessors held the middle");
  await p.fill("#battlef-didnt", "Deployed the Tacticals too far forward");
  await p.click("#battlef-save");
  await on("list-view");
  assert((await text("#list-record")).includes("0W 1L 0D"), await text("#list-record"));
});

await step("the games tab lists games, newest first, with the record", async () => {
  await tab("games");
  await p.click("#games-add");
  await p.click('#battlef-result button[data-r="W"]');
  await p.fill("#battlef-date", "2026-10-15");
  await p.fill("#battlef-opp", "Orks");
  await p.click("#battlef-save");
  await on("games-view");
  const names = await p.locator("#games-rows .row-name").allTextContents();
  assert(names.join() === "vs Orks,vs Necrons", names.join());
  assert((await text("#games-sub")).includes("1W 1L 0D"), await text("#games-sub"));
  assert((await text("#games-rows")).includes("Loss 65–80"), await text("#games-rows"));
});

await step("edits and deletes a game", async () => {
  await vis("#games-rows .row-main").filter({ hasText: "vs Orks" }).click();
  await on("battle-form-view");
  await p.click('#battlef-result button[data-r="D"]');
  await p.click("#battlef-save");
  await on("games-view");
  assert((await text("#games-sub")).includes("0W 1L 1D"), await text("#games-sub"));
  await vis("#games-rows .row-main").filter({ hasText: "vs Orks" }).click();
  accept();
  await p.click("#battlef-delete");
  await on("games-view");
  assert((await p.locator("#games-rows .row").count()) === 1, "not deleted");
});

// ---- ask claude -----------------------------------------------------------------

async function askFor(label, opponent) {
  await tab("lists");
  await vis(".row-main").filter({ hasText: "Test 2k" }).click();
  await p.click("#list-ask");
  await pickOption(label);
  if (opponent) await pickOption(opponent);
  await on("claude-view");
  return p.inputValue("#claude-text");
}

await step("builds a game-plan prompt from the list and its games", async () => {
  const t = await askFor("How should I play this list?");
  for (const want of ["Old Army (Space Marines)", "List: Test 2k", "Strike Force, 2,000 pts",
    DET.name + " (" + DET.dp + " DP)", "Intercessor Squad: 5 models, 80 pts", "Tactical Squad: 5 models, points not set",
    "enhancement: " + ENH.name, "12 Oct 2026: Loss 65–80 vs Necrons, Only War.",
    "Worked: Intercessors held the middle", "game plan", "say so rather than guessing"]) {
    assert(t.includes(want), "missing: " + want);
  }
});

await step("matchup and review prompts carry the opponent and spare units", async () => {
  let t = await askFor("Matchup advice", "Orks");
  assert(t.includes("against Orks"), "opponent");
  // Add a unit to the army that isn't in the list, so review can suggest it.
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("painting.v1"));
    d.armies[0].units.push({ id: "spare", name: "Hellblaster Squad", sheet: "Hellblaster Squad", models: [5, 5, 5, 5, 5], schemes: [] });
    localStorage.setItem("painting.v1", JSON.stringify(d));
  });
  await reload();
  t = await askFor("Review and improve this list");
  assert(t.includes("Other units I own but haven't included:") && t.includes("Hellblaster Squad: 5 models"), t.slice(0, 600));
  assert(t.includes("Hellblaster Squad: 5 models") && /Hellblaster Squad: 5 models, [\d,]+ pts, painted/.test(t), "spare unit line");
});

await step("copies the prompt and opens Claude", async () => {
  const t = await p.inputValue("#claude-text");
  await p.click("#claude-copy");
  assert((await clipboard()) === t, "copy only");
  await p.evaluate(() => navigator.clipboard.writeText(""));
  const [popup] = await Promise.all([p.waitForEvent("popup"), p.click("#claude-open")]);
  assert(popup.url().startsWith("https://claude.ai/new"), popup.url());
  await popup.close();
  assert((await clipboard()) === t, "copy and open");
});

// ---- kill teams -------------------------------------------------------------------

await step("creates a kill team from the Armies tab", async () => {
  await tab("collection");
  await p.click("#armies-add");
  await pickOption("Kill team");
  await on("kt-form-view");
  assert(await p.isDisabled("#ktf-save"), "save enabled before a team");
  await p.click("#ktf-team");
  await pickOption("Kasrkin");
  await on("kt-form-view");
  assert((await p.inputValue("#ktf-name")) === "Kasrkin", "name not defaulted");
  await p.fill("#ktf-name", "Cadian Kasrkin");
  await p.click("#ktf-save");
  await on("kt-view");
  assert((await text("#kt-title")) === "Cadian Kasrkin", await text("#kt-title"));
  assert((await text("#kt-composition")) === "Leader + 9 operatives", await text("#kt-composition"));
});

async function addOp(name) {
  await p.click("#kt-add");
  await pickOption(name);
  await on("kt-view");
}

await step("adds operatives, leader first, and warns on roster limits", async () => {
  await addOp("Combat Medic");
  await addOp("Sergeant");
  await addOp("Combat Medic");
  const names = await p.locator("#kt-rows .row-name").allTextContents();
  assert(names[0] === "Sergeant", "leader not first: " + names.join());
  const w = await text("#kt-warn");
  assert(w.includes("2 \u00D7 Combat Medic; the limit is 1.") && w.includes("2 of 9 operatives chosen."), w);
  await p.click("#kt-edit");
  accept();
  await vis("#kt-rows .delete").last().click();
  await p.click("#kt-edit");
  assert(!(await text("#kt-warn")).includes("Combat Medic"), "limit warning stayed");
});

await step("shows the datacard and switches weapon options", async () => {
  await vis("#kt-rows .row-main").filter({ hasText: "Sergeant" }).click();
  await on("op-view");
  const stats = await p.locator("#op-stats .stat-v").allTextContents();
  assert(stats.join("|") === '3|6"|4+|9', stats.join("|"));
  let ws = await p.locator("#op-weapons .wpn-name").allTextContents();
  assert(ws.some((x) => x.includes("Power weapon")) && ws.some((x) => x.includes("Bolt pistol")), ws.join());
  assert((await text("#op-abilities")).includes("Lethal x+"), "weapon rule glossary missing");
  await vis("#op-options .chip-btn").first().click();
  await pickOption("Plasma pistol; chainsword");
  await on("op-view");
  ws = await p.locator("#op-weapons .wpn-name").allTextContents();
  assert(ws.some((x) => x.includes("Chainsword")) && !ws.some((x) => x.includes("Power weapon")), ws.join());
  assert((await text("#op-abilities")).includes("Veteran Leadership"), "abilities missing");
});

await step("tracks painting per operative and renames", async () => {
  await vis("#op-stage .stage-pick").filter({ hasText: "Based" }).click();
  p.once("dialog", (d) => d.accept("Sergeant Varro"));
  await p.click("#op-rename");
  assert((await text("#op-title")) === "Sergeant Varro", await text("#op-title"));
  await p.click("#op-back");
  await on("kt-view");
  assert((await text("#kt-sub")).includes("1 of 2 painted"), await text("#kt-sub"));
  await p.click("#kt-back");
  assert((await text("#killteam-rows")).includes("1 painted"), await text("#killteam-rows"));
  assert(!(await p.locator("#kt-heading").isHidden()), "kill teams heading");
});

await step("a kill team wears a paint scheme", async () => {
  await vis("#killteam-rows .row-main").first().click();
  await on("kt-view");
  await vis("#kt-schemes .chip-btn").last().click();
  await pickOption("Gold trim");
  await on("kt-view");
  await vis("#kt-schemes .chip-btn").filter({ hasText: "Gold trim" }).click();
  await on("scheme-view");
  assert((await text("#scheme-used")).includes("Cadian Kasrkin"), "kill team missing from used by");
  assert((await text("#scheme-sub")).includes("1 kill team"), await text("#scheme-sub"));
  await p.click("#scheme-back");
  await on("kt-view");
});

await step("logs a game with a kill team", async () => {
  await p.click("#kt-log");
  await on("battle-form-view");
  assert((await text("#battlef-list")) === "Cadian Kasrkin", "kill team not prefilled");
  await p.click('#battlef-result button[data-r="W"]');
  await p.fill("#battlef-opp", "Wyrmblade");
  await p.fill("#battlef-worked", "Medic kept the gunner alive");
  await p.click("#battlef-save");
  await on("kt-view");
  assert((await text("#kt-record")).includes("1W 0L 0D"), await text("#kt-record"));
  await tab("games");
  assert((await text("#games-rows")).includes("Cadian Kasrkin"), await text("#games-rows"));
});

await step("Ask Claude for a kill team carries the real datacards", async () => {
  await tab("collection");
  await vis("#killteam-rows .row-main").first().click();
  await p.click("#kt-ask");
  await pickOption("How should I play this kill team?");
  await on("claude-view");
  const t = await p.inputValue("#claude-text");
  for (const want of ["Kill Team (2024 edition)", "Kill team: Cadian Kasrkin (Kasrkin)", "Skill at Arms:",
    'Sergeant Varro [Sergeant]: APL 3, Move 6", Save 4+, Wounds 9.', "Chainsword (", "Painted.",
    "Veteran Leadership:", "vs Wyrmblade", "Ploys and equipment aren't included"]) {
    assert(t.includes(want), "missing: " + want);
  }
  await p.click("#claude-back");
  await on("kt-view");
});

// ---- backup ------------------------------------------------------------------------

await step("a full backup round-trips everything, photos included", async () => {
  await toRoot();
  await p.click("#tab-collection");
  await p.click("#data-open");
  await p.waitForFunction(() => document.getElementById("data-out").value.length > 0);
  const backup = await p.inputValue("#data-out");
  await p.evaluate(async () => {
    localStorage.clear();
    await new Promise((r) => { const q = indexedDB.deleteDatabase("painting-photos"); q.onsuccess = q.onerror = q.onblocked = r; });
  });
  await reload();
  assert((await p.locator("#armies-rows .row").count()) === 0, "not cleared");
  await p.click("#tab-collection");
  // Empty app: open the data screen via the backup link is hidden, so use the bar button.
  await p.click("#data-open");
  await p.fill("#data-in", backup);
  accept();
  await p.click("#data-restore");
  await on("armies-view");
  const d = await db();
  assert(d.schemes.length === 2 && d.paints.length === 4 && d.battles.length === 2 && d.lists.length === 1 &&
    d.killteams.length === 1, JSON.stringify({ s: d.schemes.length, p: d.paints.length, b: d.battles.length,
    l: d.lists.length, k: d.killteams.length }));
  assert(d.battles.some((b) => b.listId === d.lists[0].id), "battle lost its list");
  assert(d.battles.some((b) => b.ktId === d.killteams[0].id), "battle lost its kill team");
  const k = d.killteams[0];
  assert(k.operatives.length === 2 && k.operatives.some((o) => o.name === "Sergeant Varro" && o.stage === 5 &&
    o.choices.Weapons === "Plasma pistol; chainsword"), JSON.stringify(k.operatives));
  await tab("paints");
  await vis(".row-main").filter({ hasText: "Ultramarines armour" }).click();
  await p.waitForFunction(() => !document.getElementById("scheme-photo-img").hidden);
});

await step("deleting a kill team keeps its games, by name", async () => {
  await tab("collection");
  await p.click("#armies-edit");
  accept();
  await vis("#killteam-rows .delete").first().click();
  await p.click("#armies-edit");
  assert((await p.locator("#killteam-rows .row").count()) === 0, "not deleted");
  await tab("games");
  assert((await text("#games-rows")).includes("Cadian Kasrkin"), await text("#games-rows"));
  assert((await db()).battles.every((b) => b.ktId === null), "dangling kill team id");
});

await step("a schema-2 backup still restores", async () => {
  await toRoot();
  await p.click("#tab-collection");
  await p.click("#data-open");
  await p.fill("#data-in", JSON.stringify({ schema: 2,
    armies: [{ id: "x", name: "Legacy", faction: null, units: [{ id: "y", name: "Boyz", sheet: null, models: [0, 1, 2] }] }],
    lists: [{ id: "l", armyId: "x", name: "Old list", size: 1000, detachment: null, entries: [{ id: "e", unitId: "y" }] }] }));
  accept();
  await p.click("#data-restore");
  await on("armies-view");
  const d = await db();
  assert(d.schema === 4 && d.armies[0].name === "Legacy" && d.lists[0].id === "l", JSON.stringify(d).slice(0, 200));
  assert(d.schemes.length === 0 && d.battles.length === 0, "stale data survived");
});

await step("a game outlives its list, keeping the list's name", async () => {
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("painting.v1"));
    d.battles = [{ id: "b", date: "2026-10-01", result: "W", listId: "l", listName: "Old list", opponent: "Tau" }];
    localStorage.setItem("painting.v1", JSON.stringify(d));
  });
  await reload();
  await tab("lists");
  await p.click("#lists-edit");
  accept();
  await vis("#lists-rows .delete").first().click();
  await tab("games");
  assert((await text("#games-rows")).includes("Old list"), await text("#games-rows"));
  assert((await db()).battles[0].listId === null, "dangling list id");
});

await step("rejects junk on restore", async () => {
  await toRoot();
  await p.click("#tab-collection");
  await p.click("#data-open");
  for (const junk of ["not json", '{"schema":3}', '[{"name":"X","units":[{"name":"Y","models":[]}]}]']) {
    await p.fill("#data-in", junk);
    await p.click("#data-restore");
    assert(/isn.t (valid backup data|a Painting backup)/.test(await text("#data-status")), junk);
  }
  await p.click("#data-close");
});

await step("shows the build stamp and points data version", async () => {
  await p.click("#data-open");
  await p.waitForFunction(() => /MFM v/.test(document.getElementById("data-version").textContent));
  assert(/^App \d{4}-\d{2}-\d{2}/.test(await text("#data-version")), await text("#data-version"));
  await p.click("#data-close");
});

await step("no sideways scrolling at 320px on any root screen", async () => {
  await p.setViewportSize({ width: 320, height: 640 });
  for (const t of ["collection", "lists", "paints", "games"]) {
    await tab(t);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert(!over, "overflow on " + t);
    const clipped = await p.evaluate(() => [...document.querySelectorAll(".tab")]
      .some((b) => b.scrollWidth > b.clientWidth + 1));
    assert(!clipped, "tab label clipped");
  }
});

await browser.close();
await srv.close();
finish(errors.length ? "\nPAGE ERRORS:\n  " + errors.join("\n  ") : "no page errors");
if (errors.length) process.exitCode = 1;
