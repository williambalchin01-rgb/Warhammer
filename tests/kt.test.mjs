// Kill Team data invariants and helpers, against the generated data/kt files.
// Catches a converter regression or an upstream format change after a sync.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, step, assert, finish } from "./harness.mjs";

const K = await import(join(ROOT, "js/kt.js"));
const dir = join(ROOT, "data/kt");
const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const index = read("index.json");
const teams = index.teams.map((t) => read(t.slug + ".json"));

await step("the index lists every team file, and nothing else", () => {
  const files = readdirSync(dir).filter((f) => !["index.json", "rules.json"].includes(f)).sort();
  assert(JSON.stringify(files) === JSON.stringify(index.teams.map((t) => t.slug + ".json").sort()), "index/file mismatch");
  assert(index.teams.length >= 40, "only " + index.teams.length + " teams");
});

await step("every operative has a full stat line", () => {
  for (const t of teams) for (const o of t.operatives) {
    assert(o.apl && o.move && o.save && o.wounds, t.name + " / " + o.name + " missing stats");
  }
});

await step("teams have a leader, bar fixed named-character rosters", () => {
  for (const t of teams) assert(t.operatives.length >= 2, t.name + " has " + t.operatives.length + " operative types");
  // Strike Force Variel is a fixed band of named characters; BSData tags none
  // of them Leader, and the app only asks for a leader where a team has one.
  const leaderless = teams.filter((t) => !t.operatives.some((o) => o.leader)).map((t) => t.name);
  assert(leaderless.length <= 2, "no leader: " + leaderless.join(", "));
});

await step("almost every operative carries a weapon", () => {
  const bare = teams.flatMap((t) => t.operatives.filter((o) =>
    !o.weapons.length && !o.options.some((g) => g.choices.some((c) => c.weapons.length))).map((o) => t.name + "/" + o.name));
  // Skulls, drones and beacons genuinely have none.
  assert(bare.length <= 10, bare.length + " unarmed: " + bare.join(", "));
});

await step("rules text is plain, not markdown", () => {
  const all = JSON.stringify(read("rules.json")) + teams.map((t) => JSON.stringify(t)).join("");
  // Emphasis is a short *run* inside one string. A trailing "Anti-PSYKER*" is
  // a footnote marker and genuine content, so quotes end a candidate run.
  const m = /\*[A-Za-z][^*"\\\n]{0,60}\*/.exec(all);
  assert(!m, "markdown emphasis left in text: " + (m && m[0]));
});

await step("Kasrkin: options, limits, composition", () => {
  const t = teams.find((x) => x.slug === "kasrkin");
  const sgt = K.opType(t, "Sergeant");
  assert(sgt.leader && sgt.options[0].choices.length === 4, "sergeant options");
  assert(K.opType(t, "Combat Medic").max === 1, "medic limit");
  assert(K.compositionLabel(t) === "Leader + 9 operatives", K.compositionLabel(t));
});

await step("weapons combine fixed kit and chosen options", () => {
  const t = teams.find((x) => x.slug === "kasrkin");
  const sgt = K.opType(t, "Sergeant");
  const names = K.weapons(sgt, { Weapons: "Plasma pistol; chainsword" }).map((w) => w.name);
  assert(names.includes("Chainsword") && names.some((n) => n.startsWith("Plasma pistol")), names.join());
  assert(JSON.stringify(K.defaultChoices(sgt)) === JSON.stringify({ Weapons: "Bolt pistol; power weapon" }), "defaults");
});

await step("composition checks flag the obvious problems only", () => {
  const t = teams.find((x) => x.slug === "kasrkin");
  const ok = { operatives: [{ type: "Sergeant" }].concat(
    ["Combat Medic", "Demo-Trooper", "Gunner with flamer", "Recon-Trooper", "Vox-Trooper", "Trooper", "Trooper", "Trooper", "Trooper"]
      .map((type) => ({ type }))) };
  assert(K.check(t, ok).length === 0, "valid roster flagged: " + K.check(t, ok).join(" "));
  const bad = { operatives: [{ type: "Combat Medic" }, { type: "Combat Medic" }] };
  const issues = K.check(t, bad).join(" ");
  assert(issues.includes("No leader") && issues.includes("limit is 1") && issues.includes("2 of 9"), issues);
});

finish();
