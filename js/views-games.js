// The battle log: what happened, and what you would do differently.
//
// Notes on what worked and what didn't are the point. They are also what the
// "Ask Claude" prompts draw on, so advice comes from your own games rather
// than generic tips.

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, clear, row, empty, pick, plural } from "./ui.js";

const RESULT = { W: "Win", L: "Loss", D: "Draw" };

let refresh = () => {};
let draft = null;   // { id | null, result, listId, back }

export function init(onChange) {
  refresh = onChange;
  wire();
}

export const resultLabel = (r) => RESULT[r] || r;

export function scoreLabel(b) {
  return b.scoreFor != null && b.scoreAgainst != null ? b.scoreFor + "–" + b.scoreAgainst : "";
}

export function dateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function recordLabel(battles) {
  const r = S.record(battles);
  return r.W + "W " + r.L + "L " + r.D + "D";
}

/** Newest first; within a day, the most recently logged first. */
export function sortedBattles(battles) {
  return battles
    .map((b, i) => ({ b, i }))
    .sort((x, y) => y.b.date.localeCompare(x.b.date) || y.i - x.i)
    .map((x) => x.b);
}

// ---- log -------------------------------------------------------------------

export function renderGames() {
  const all = sortedBattles(S.db.battles);
  el("games-sub").textContent = all.length
    ? plural(all.length, "game") + " · " + recordLabel(all)
    : "Record your games to learn from them";

  const rows = clear(el("games-rows"));
  el("games-empty").hidden = all.length > 0;
  if (!all.length) {
    empty(el("games-empty"),
      "No games logged yet. Note what worked and what didn’t after each game — that’s where the learning is.",
      "Log a game", () => logGame({}));
  }

  for (const b of all) {
    const list = S.list(b.listId);
    rows.appendChild(row({
      name: b.opponent ? "vs " + b.opponent : "Unnamed opponent",
      badge: [resultLabel(b.result), scoreLabel(b)].filter(Boolean).join(" "),
      sub: [dateLabel(b.date), list ? list.name : b.listName, b.mission].filter(Boolean).join(" · "),
      onOpen: () => editGame(b.id),
    }));
  }
}

// ---- form ------------------------------------------------------------------

export function logGame({ listId, back }) {
  draft = { id: null, result: null, listId: listId || null, back: back || "games-view" };
  el("battlef-title").textContent = "Log a game";
  el("battlef-date").value = today();
  el("battlef-for").value = "";
  el("battlef-against").value = "";
  el("battlef-opp").value = "";
  el("battlef-mission").value = "";
  el("battlef-worked").value = "";
  el("battlef-didnt").value = "";
  el("battlef-delete").hidden = true;
  openForm();
}

function editGame(id) {
  const b = S.battle(id);
  if (!b) return;
  draft = { id: b.id, result: b.result, listId: b.listId, back: "games-view" };
  el("battlef-title").textContent = "Edit game";
  el("battlef-date").value = b.date;
  el("battlef-for").value = b.scoreFor != null ? String(b.scoreFor) : "";
  el("battlef-against").value = b.scoreAgainst != null ? String(b.scoreAgainst) : "";
  el("battlef-opp").value = b.opponent;
  el("battlef-mission").value = b.mission;
  el("battlef-worked").value = b.worked;
  el("battlef-didnt").value = b.didnt;
  el("battlef-delete").hidden = false;
  openForm();
}

function openForm() {
  renderResult();
  renderListChip();
  validate();
  fillOpponents();
  show("battle-form-view");
}

// Local date, not UTC: a game logged at 11pm belongs to that evening.
function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function fillOpponents() {
  const names = S.db.battles.map((b) => b.opponent);
  try {
    const idx = await M.index();
    names.push(...idx.factions.map((f) => f.name));
  } catch (e) { /* offline: previous opponents only */ }
  const dl = clear(el("faction-list"));
  const seen = new Set();
  for (const n of names) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  }
}

function renderResult() {
  for (const b of el("battlef-result").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.r === draft.result));
  }
}

function renderListChip() {
  const l = S.list(draft.listId);
  const chip = el("battlef-list");
  chip.textContent = l ? l.name : "No list";
  chip.dataset.unset = l ? "false" : "true";
}

function validate() {
  el("battlef-save").disabled = !(draft && draft.result && /^\d{4}-\d{2}-\d{2}$/.test(el("battlef-date").value));
}

function pickList() {
  pick({
    title: "List",
    back: "battle-form-view",
    current: draft.listId,
    allowNone: true,
    noneLabel: "No list",
    options: S.db.lists.map((l) => {
      const a = S.army(l.armyId);
      return { value: l.id, label: l.name, sub: a ? a.name : null };
    }),
    onPick: (id) => {
      draft.listId = id;
      renderListChip();
      show("battle-form-view");
    },
  });
}

function save() {
  if (!draft || !draft.result) return;
  const date = el("battlef-date").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const num = (id) => {
    const n = parseInt(el(id).value, 10);
    return isNaN(n) ? null : Math.max(0, Math.min(999, n));
  };
  const l = S.list(draft.listId);
  const a = l ? S.army(l.armyId) : null;
  const fields = {
    date,
    result: draft.result,
    scoreFor: num("battlef-for"),
    scoreAgainst: num("battlef-against"),
    listId: l ? l.id : null,
    listName: l ? l.name : "",
    armyName: a ? a.name : "",
    opponent: el("battlef-opp").value.trim().slice(0, 40),
    mission: el("battlef-mission").value.trim().slice(0, 60),
    worked: el("battlef-worked").value.trim().slice(0, 1000),
    didnt: el("battlef-didnt").value.trim().slice(0, 1000),
  };
  if (draft.id) {
    const b = S.battle(draft.id);
    // Keep the snapshot names when the list has since been deleted.
    if (b && !l) { fields.listName = b.listName; fields.armyName = b.armyName; }
    Object.assign(b, fields);
  } else {
    S.db.battles.push(Object.assign({ id: S.uid() }, fields));
  }
  const back = draft.back;
  draft = null;
  S.save(); refresh();
  show(back);
}

function remove() {
  const b = S.battle(draft && draft.id);
  if (!b || !confirm("Delete this game from the log?")) return;
  S.db.battles = S.db.battles.filter((x) => x.id !== b.id);
  draft = null;
  S.save(); refresh();
  show("games-view");
}

function wire() {
  el("games-add").addEventListener("click", () => logGame({}));
  for (const b of el("battlef-result").querySelectorAll("button")) {
    b.addEventListener("click", () => { draft.result = b.dataset.r; renderResult(); validate(); });
  }
  el("battlef-date").addEventListener("input", validate);
  el("battlef-list").addEventListener("click", pickList);
  el("battlef-save").addEventListener("click", save);
  el("battlef-cancel").addEventListener("click", () => {
    const back = draft ? draft.back : "games-view";
    draft = null;
    show(back);
  });
  el("battlef-delete").addEventListener("click", remove);
}
