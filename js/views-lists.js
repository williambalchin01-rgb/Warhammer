// Army lists: a selection over the collection, costed properly and checked
// against what is actually painted.

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, clear, make, row, empty, pick, plural } from "./ui.js";

const SIZES = [
  { points: 1000, name: "Incursion" },
  { points: 2000, name: "Strike Force" },
  { points: 3000, name: "Onslaught" },
];

let listId = null;
let editEntries = false;
let refresh = () => {};

export function init(onChange) {
  refresh = onChange;
  wire();
}

const current = () => S.list(listId);
const armyOf = (l) => (l ? S.army(l.armyId) : null);
const facOf = (l) => {
  const a = armyOf(l);
  return a && a.faction ? M.got(a.faction) : null;
};

/** Entry rows joined to their collection units, in list order. */
function resolve(l) {
  return l.entries
    .map((e) => ({ entry: e, unit: S.unit(e.unitId) }))
    .filter((r) => r.unit)
    .map((r) => ({ ...r, detachment: l.detachment }));
}

/**
 * Entries joined to their units, alongside the costed line for each. Keep the
 * two names distinct: listCost also returns `rows`, and spreading it over a key
 * of the same name silently replaced the entries with the costed lines.
 */
function costing(l) {
  const entries = resolve(l);
  const c = M.listCost(facOf(l), entries.map((r) => ({
    unit: r.unit, enhancement: r.entry.enhancement, detachment: l.detachment,
  })));
  return { entries, lines: c.rows, units: c.units, enhancements: c.enhancements, total: c.total };
}

// ---- all lists -----------------------------------------------------------

export function renderLists() {
  const rows = clear(el("lists-rows"));
  const has = S.db.lists.length > 0;
  el("lists-empty").hidden = has;
  el("lists-edit").hidden = !has;
  el("lists-add").disabled = S.db.armies.length === 0;

  if (!has) {
    empty(el("lists-empty"),
      S.db.armies.length ? "No lists yet." : "Add an army first, then build a list from it.",
      S.db.armies.length ? "Build a list" : null, openAddList);
  }

  for (const l of S.db.lists) {
    const a = armyOf(l);
    const { entries, total } = costing(l);
    const st = S.stats(entries.map((r) => r.unit));
    const over = l.size && total > l.size;
    rows.appendChild(row({
      name: l.name,
      badge: M.fmt(total) + (l.size ? " / " + M.fmt(l.size) : "") + " pts",
      sub: [a ? a.name : "?", plural(entries.length, "unit"), over ? "over limit" : null]
        .filter(Boolean).join(" · "),
      pct: st.pct,
      complete: st.done,
      onOpen: () => openList(l.id),
      onDelete: editEntries ? () => {
        if (!confirm("Delete the list “" + l.name + "”?")) return;
        S.db.lists = S.db.lists.filter((x) => x.id !== l.id);
        S.save(); refresh();
      } : null,
    }));
  }
}

export function openList(id) {
  listId = id;
  renderList();
  show("list-view");
}

// ---- one list ------------------------------------------------------------

export function renderList() {
  const l = current();
  if (!l) return;
  const a = armyOf(l), f = facOf(l);
  const { entries, lines, units, enhancements, total } = costing(l);

  el("list-back-label").textContent = "Lists";
  el("list-title").textContent = l.name;

  const over = l.size && total > l.size;
  const sub = el("list-sub");
  sub.textContent = M.fmt(total) + (l.size ? " of " + M.fmt(l.size) : "") + " pts" +
    (over ? " · " + M.fmt(total - l.size) + " over" : l.size ? " · " + M.fmt(l.size - total) + " left" : "");
  sub.dataset.over = String(!!over);

  const sizeChip = el("list-size");
  const named = SIZES.find((s) => s.points === l.size);
  sizeChip.textContent = l.size ? (named ? named.name + " · " + M.fmt(l.size) : M.fmt(l.size) + " pts") : "Set battle size";
  sizeChip.dataset.unset = l.size ? "false" : "true";

  const det = M.detachment(f, l.detachment);
  const detChip = el("list-detachment");
  detChip.textContent = det ? det.name + (det.dp != null ? " · " + det.dp + " DP" : "")
                            : (l.detachment || "Set detachment");
  detChip.dataset.unset = l.detachment ? "false" : "true";
  detChip.disabled = !f;

  // Entries
  const body = clear(el("list-rows"));
  el("list-empty").hidden = entries.length > 0;
  if (!entries.length) {
    empty(el("list-empty"),
      a && a.units.length ? "Nothing in this list yet." : "This army has no units to add yet.",
      a && a.units.length ? "Add a unit" : null, addEntry);
  }

  entries.forEach((r, i) => {
    const line = lines[i];
    const st = S.stats([r.unit]);
    const bits = [plural(r.unit.models.length, "model"), st.done ? "painted" : st.based + " based"];
    if (line.copy > 1) bits.push(line.copy + (line.copy === 2 ? "nd" : line.copy === 3 ? "rd" : "th"));
    if (r.entry.enhancement) bits.push(r.entry.enhancement + " +" + line.enh);
    if (!line.priced) bits.push("no datasheet");

    const li = row({
      name: r.unit.name,
      badge: line.priced ? M.fmt(line.points) + " pts" : null,
      sub: bits.join(" · "),
      pct: st.pct,
      complete: st.done,
      onOpen: () => pickEnhancement(r.entry),
      onDelete: editEntries ? () => {
        l.entries = l.entries.filter((e) => e.id !== r.entry.id);
        S.save(); refresh();
      } : null,
    });
    body.appendChild(li);
  });

  el("list-edit").hidden = entries.length === 0;
  el("list-add").disabled = !(a && a.units.length);

  // Summary: what is actually ready to put on the table. Unit costs come from
  // the same costed lines as the rows above, so surcharges are not counted twice.
  let readyPts = 0;
  const pending = [];
  entries.forEach((r, i) => {
    if (S.stats([r.unit]).done) readyPts += lines[i].points - lines[i].enh;
    else pending.push(r);
  });

  const box = clear(el("list-summary"));
  box.hidden = entries.length === 0;
  if (entries.length) {
    const head = make("div", "summary-head");
    head.appendChild(make("div", "stage-name", "Ready to play"));
    head.appendChild(make("div", "stage-count", Math.round(units ? (readyPts / units) * 100 : 0) + "%"));
    box.appendChild(head);
    box.appendChild(make("p", "summary-line",
      M.fmt(readyPts) + " of " + M.fmt(units) + " pts fully based" +
      (enhancements ? " · " + M.fmt(enhancements) + " pts of enhancements" : "")));

    if (pending.length) {
      box.appendChild(make("div", "stage-name summary-sub", "Still to paint"));
      const ul = make("ul", "queue");
      for (const r of pending) {
        const s = S.stats([r.unit]);
        const li = make("li", "queue-item");
        const b = make("button", "queue-btn");
        b.appendChild(make("span", "queue-name", r.unit.name));
        b.appendChild(make("span", "queue-count", (s.total - s.based) + " left"));
        b.addEventListener("click", () => openUnitFromList(r.unit));
        li.appendChild(b);
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
  }
}

let jumpToUnit = () => {};
export function onJumpToUnit(fn) { jumpToUnit = fn; }
const openUnitFromList = (u) => jumpToUnit(u);

// ---- actions -------------------------------------------------------------

function addEntry() {
  const l = current(), a = armyOf(l), f = facOf(l);
  if (!a) return;
  const used = new Set(l.entries.map((e) => e.unitId));
  const options = a.units.filter((u) => !used.has(u.id)).map((u) => {
    const c = M.cost(M.sheet(f, u.sheet), u.models.length);
    const st = S.stats([u]);
    return {
      value: u.id,
      label: u.name,
      badge: c ? M.fmt(c.points) + " pts" : null,
      sub: plural(u.models.length, "model") + " · " + (st.done ? "painted" : st.based + " based"),
    };
  });
  if (!options.length) {
    alert("Every unit in " + a.name + " is already in this list.");
    return;
  }
  pick({
    title: "Add unit",
    back: "list-view",
    options,
    onPick: (unitId) => {
      if (unitId) {
        l.entries.push({ id: S.uid(), unitId, enhancement: null });
        S.save();
      }
      renderList();
      show("list-view");
    },
  });
}

function pickEnhancement(entry) {
  const l = current(), f = facOf(l);
  const det = M.detachment(f, l.detachment);
  if (!det || !det.enhancements.length) {
    alert(det ? "This detachment has no enhancements." : "Choose a detachment first.");
    return;
  }
  pick({
    title: "Enhancement",
    back: "list-view",
    allowNone: true,
    noneLabel: "No enhancement",
    current: entry.enhancement,
    options: det.enhancements.map((e) => ({
      value: e.name, label: e.name, badge: "+" + e.points + " pts",
    })),
    onPick: (name) => {
      entry.enhancement = name;
      S.save();
      renderList();
      show("list-view");
    },
  });
}

function pickSize() {
  const l = current();
  pick({
    title: "Battle size",
    back: "list-view",
    current: l.size,
    options: SIZES.map((s) => ({
      value: s.points, label: s.name, badge: M.fmt(s.points) + " pts",
    })).concat([{ value: "custom", label: "Custom…" }]),
    onPick: (v) => {
      if (v === "custom") {
        const n = parseInt(prompt("Battle size in points", String(l.size || 2000)), 10);
        if (!isNaN(n)) l.size = Math.max(0, Math.min(20000, n));
      } else if (v != null) {
        l.size = v;
      }
      S.save();
      renderList();
      show("list-view");
    },
  });
}

function pickDetachment() {
  const l = current(), f = facOf(l);
  if (!f) return;
  pick({
    title: "Detachment",
    back: "list-view",
    allowNone: true,
    noneLabel: "No detachment",
    current: l.detachment,
    options: f.detachments.map((d) => ({
      value: d.name,
      label: d.name,
      badge: d.dp != null ? d.dp + " DP" : null,
      sub: plural(d.enhancements.length, "enhancement"),
    })),
    onPick: (name) => {
      if (name !== l.detachment) {
        // Enhancements belong to a detachment, so they cannot survive the swap.
        for (const e of l.entries) e.enhancement = null;
      }
      l.detachment = name;
      S.save();
      renderList();
      show("list-view");
    },
  });
}

// ---- new list ------------------------------------------------------------

let newListArmy = null;

function openAddList() {
  if (!S.db.armies.length) return;
  newListArmy = S.db.armies[0];
  el("list-name").value = "";
  el("list-points").value = "2000";
  el("list-save").disabled = true;
  renderListArmyChip();
  show("add-list-view");
  el("list-name").focus({ preventScroll: true });
}

function renderListArmyChip() {
  const btn = el("list-army-pick");
  btn.textContent = newListArmy ? newListArmy.name : "Choose an army";
  btn.dataset.unset = newListArmy ? "false" : "true";
}

function commitList() {
  const name = el("list-name").value.trim();
  if (!name || !newListArmy) return;
  const size = Math.max(0, Math.min(20000, parseInt(el("list-points").value, 10) || 0));
  const l = { id: S.uid(), armyId: newListArmy.id, name, size, detachment: null, entries: [] };
  S.db.lists.push(l);
  S.save();
  listId = l.id;
  refresh();
  renderList();
  show("list-view");
}

// ---- wiring --------------------------------------------------------------

function wire() {
  el("lists-add").addEventListener("click", openAddList);
  el("lists-edit").addEventListener("click", () => {
    editEntries = !editEntries;
    el("lists-edit").setAttribute("aria-pressed", String(editEntries));
    el("lists-edit").textContent = editEntries ? "Done" : "Edit";
    renderLists();
  });

  el("list-back").addEventListener("click", () => { renderLists(); show("lists-view"); });
  el("list-add").addEventListener("click", addEntry);
  el("list-edit").addEventListener("click", () => {
    editEntries = !editEntries;
    el("list-edit").setAttribute("aria-pressed", String(editEntries));
    el("list-edit").textContent = editEntries ? "Done" : "Edit";
    renderList();
  });
  el("list-size").addEventListener("click", pickSize);
  el("list-detachment").addEventListener("click", pickDetachment);

  el("list-army-pick").addEventListener("click", () => {
    pick({
      title: "Army",
      back: "add-list-view",
      current: newListArmy ? newListArmy.id : null,
      options: S.db.armies.map((a) => ({
        value: a.id, label: a.name, sub: plural(a.units.length, "unit"),
      })),
      onPick: (id) => {
        newListArmy = S.army(id) || newListArmy;
        renderListArmyChip();
        show("add-list-view");
      },
    });
  });

  const name = el("list-name");
  name.addEventListener("input", () => { el("list-save").disabled = !name.value.trim(); });
  el("list-save").addEventListener("click", commitList);
  el("list-points").addEventListener("keydown", (e) => { if (e.key === "Enter") commitList(); });
  el("list-cancel").addEventListener("click", () => show("lists-view"));
}
