// The costing arithmetic, against the real generated points data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, step, assert, finish } from "./harness.mjs";

const { cost, sizes, listCost, sheet } = await import(join(ROOT, "js/mfm.js"));
const sm = JSON.parse(readFileSync(join(ROOT, "data/space-marines.json"), "utf8"));
const eq = (got, want, what) =>
  assert(JSON.stringify(got) === JSON.stringify(want), what + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

const agg = sheet(sm, "Aggressor Squad");
const icp = sheet(sm, "Intercessor Squad");
const adx = sheet(sm, "Adrax Agatone");
const u = (name, n) => ({ unit: { sheet: name, models: Array(n).fill(0) }, enhancement: null });

await step("exact sizes cost their listed price", () => {
  eq(cost(icp, 5).points, 80, "5 Intercessors");
  eq(cost(icp, 10).points, 150, "10 Intercessors");
});
await step("a part-strength unit pays the next size up", () => {
  eq(cost(icp, 7).points, 150, "7 Intercessors");
  eq(cost(icp, 7).exact, false, "flagged inexact");
});
await step("over the maximum is flagged and charged the maximum", () => {
  eq(cost(icp, 11).over, true, "flag");
  eq(cost(icp, 11).points, 150, "price");
});
await step("legal sizes are exposed", () => eq(sizes(icp), [5, 10], "sizes"));
await step("repeat selections pick up their surcharge", () => {
  eq(cost(agg, 3, 1).points, 80, "1st");
  eq(cost(agg, 3, 2).points, 80, "2nd");
  eq(cost(agg, 3, 3).points, 90, "3rd");
  eq(cost(agg, 6, 4).points, 175, "4th at full size");
});
await step("single-model characters", () => eq(cost(adx, 1).points, 80, "Adrax"));
await step("lists apply thresholds in entry order", () => {
  const three = listCost(sm, [u("Aggressor Squad", 3), u("Aggressor Squad", 3), u("Aggressor Squad", 3)]);
  eq(three.total, 250, "total");
  eq(three.rows.map((r) => r.copy), [1, 2, 3], "copies");
});
await step("thresholds count per datasheet, not overall", () => {
  eq(listCost(sm, [u("Intercessor Squad", 5), u("Aggressor Squad", 3), u("Intercessor Squad", 10)]).total, 310, "total");
});
await step("enhancements come from the detachment and add on top", () => {
  const det = sm.detachments.find((d) => d.enhancements.length);
  const enh = det.enhancements[0];
  const r = listCost(sm, [{ unit: { sheet: "Adrax Agatone", models: [0] }, enhancement: enh.name, detachment: det.name }]);
  eq(r.total, 80 + enh.points, "total");
  eq(r.enhancements, enh.points, "enhancement total");
});
await step("unlinked units cost nothing and are flagged", () => {
  const r = listCost(sm, [{ unit: { sheet: null, models: [0, 0] }, enhancement: null }]);
  eq(r.total, 0, "total");
  eq(r.rows[0].priced, false, "flag");
  eq(cost(null, 5), null, "no datasheet");
});

finish();
