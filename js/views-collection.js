// The collection: armies, the units in them, and per-model painting progress.

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, clear, make, row, empty, pick, plural } from "./ui.js";

let armyId = null, unitId = null;
let editArmies = false, editUnits = false, undoMode = false;
let resizing = null;   // the unit being resized, when add-unit-view is reused
let refresh = () => {};

export function init(onChange) {
  refresh = onChange;
  wire();
}

const currentArmy = () => S.army(armyId);
const currentUnit = () => S.unit(unitId);
const fac = (a) => (a && a.faction ? M.got(a.faction) : null);

const pointsLabel = (c) =>
  c.points ? M.fmt(c.points) + " pts" + (c.unpriced ? " + " + c.unpriced + " unlinked" : "")
           : (c.unpriced ? c.unpriced + " unlinked" : "");

// ---- armies --------------------------------------------------------------

export function renderArmies() {
  const rows = clear(el("armies-rows"));
  el("armies-empty").hidden = S.db.armies.length > 0;
  el("armies-edit").hidden = S.db.armies.length === 0;
  if (!S.db.armies.length) {
    empty(el("armies-empty"), "No armies yet.", "Add your first army", openAddArmy);
  }

  let points = 0, unpriced = 0;
  const all = [];
  for (const a of S.db.armies) {
    const c = M.collectionCost(fac(a), a.units);
    points += c.points;
    unpriced += c.unpriced;
    all.push(...a.units);
  }
  const g = S.stats(all);
  el("grand-total").textContent = g.total
    ? M.fmt(points) + " pts · " + g.based + " of " + g.total + " models based"
    : "No models yet";

  for (const a of S.db.armies) {
    const st = S.stats(a.units);
    const c = M.collectionCost(fac(a), a.units);
    const bits = [];
    if (st.total) bits.push(st.based + " of " + st.total + " based");
    bits.push(plural(a.units.length, "unit"));
    if (c.unpriced) bits.push(c.unpriced + " unlinked");
    rows.appendChild(row({
      name: a.name,
      badge: c.points ? M.fmt(c.points) + " pts" : null,
      sub: st.total ? bits.join(" · ") : "No units",
      pct: st.pct,
      complete: st.done,
      onOpen: () => openArmy(a.id),
      onDelete: editArmies ? () => {
        if (!confirm("Delete “" + a.name + "” and all its units?")) return;
        S.db.armies = S.db.armies.filter((x) => x.id !== a.id);
        S.db.lists = S.db.lists.filter((l) => l.armyId !== a.id);
        S.save(); refresh();
      } : null,
    }));
  }
}

export function openArmy(id) {
  armyId = id;
  setEdit("units", false);
  renderUnits();
  show("units-view");
}

// ---- units in an army ----------------------------------------------------

export function renderUnits() {
  const a = currentArmy();
  if (!a) return;
  const f = fac(a);

  el("army-title").textContent = a.name;
  const st = S.stats(a.units);
  const c = M.collectionCost(f, a.units);
  el("army-sub").textContent = st.total
    ? (c.points ? M.fmt(c.points) + " pts · " : "") + st.based + " of " + st.total + " models based"
    : "No models yet";

  const chip = el("army-faction");
  chip.textContent = f ? f.name : (a.faction || "Set faction");
  chip.dataset.unset = a.faction ? "false" : "true";
  el("units-edit").hidden = a.units.length === 0;

  const rows = clear(el("units-rows"));
  el("units-empty").hidden = a.units.length > 0;
  if (!a.units.length) {
    empty(el("units-empty"),
      a.faction ? "No units in this army yet." : "Set a faction, then add units to see points.",
      "Add a unit", openAddUnit);
  }

  for (const u of a.units) {
    const s = S.stats([u]);
    const cost = M.cost(M.sheet(f, u.sheet), u.models.length);
    const bits = [s.based + " of " + s.total + " based"];
    if (!u.sheet) bits.push("no datasheet");
    else if (cost && cost.over) bits.push("over max size");
    rows.appendChild(row({
      name: u.name,
      badge: cost ? M.fmt(cost.points) + " pts" : null,
      sub: bits.join(" · "),
      pct: s.pct,
      complete: s.done,
      onOpen: () => openUnit(u.id),
      onDelete: editUnits ? () => {
        if (!confirm("Delete “" + u.name + "”?")) return;
        a.units = a.units.filter((x) => x.id !== u.id);
        for (const l of S.db.lists) l.entries = l.entries.filter((e) => e.unitId !== u.id);
        S.save(); refresh();
      } : null,
    }));
  }
}

function openUnit(id) {
  unitId = id;
  setEdit("unit", false);
  renderUnit();
  show("unit-view");
}

// ---- one unit ------------------------------------------------------------

export function renderUnit() {
  const u = currentUnit(), a = currentArmy();
  if (!u || !a) return;
  const f = fac(a);
  const sh = M.sheet(f, u.sheet);
  const cost = M.cost(sh, u.models.length);

  el("unit-back-label").textContent = a.name;
  el("unit-title").textContent = u.name;
  const s = S.stats([u]);
  const bits = [];
  if (cost) bits.push(M.fmt(cost.points) + " pts");
  bits.push(s.based + " of " + s.total + " based");
  el("unit-sub").textContent = bits.join(" · ");

  const warn = el("unit-warn");
  if (cost && cost.over) {
    warn.hidden = false;
    warn.textContent = "This unit has more models than the datasheet allows (max " +
      cost.max + "). Points shown are for " + cost.max + ".";
  } else if (cost && !cost.exact) {
    warn.hidden = false;
    warn.textContent = "Datasheet sizes are " + cost.sizes.join(" or ") +
      " models. A part-strength unit pays the next size up.";
  } else {
    warn.hidden = true;
  }

  el("unit-hint").textContent = undoMode
    ? "Tap a model to step it back one stage."
    : "Tap a model to advance it. Tap a stage's arrow to advance the whole group.";

  const wrap = clear(el("stages"));
  S.STAGES.forEach((label, idx) => {
    const at = [];
    u.models.forEach((st, i) => { if (st === idx) at.push(i); });

    const box = make("div", "stage");
    if (!at.length) box.dataset.empty = "true";

    const top = make("div", "stage-top");
    top.appendChild(make("div", "stage-name", label));
    top.appendChild(make("div", "stage-count", String(at.length)));
    if (at.length && idx < S.LAST && !undoMode) {
      const push = make("button", "push", "All →");
      push.setAttribute("aria-label", "Advance all models at " + label);
      push.addEventListener("click", () => {
        for (const i of at) u.models[i] = idx + 1;
        S.save(); refresh();
      });
      top.appendChild(push);
    }
    box.appendChild(top);

    if (at.length) {
      const chips = make("div", "chips");
      for (const i of at) {
        const b = make("button", "chip", String(i + 1));
        b.style.background = idx === 0
          ? "var(--line)"
          : "rgba(var(--done-rgb)," + (0.2 + 0.8 * (idx / S.LAST)).toFixed(2) + ")";
        b.setAttribute("aria-label", "Model " + (i + 1) + " at " + label);
        b.addEventListener("click", () => {
          if (undoMode) { if (u.models[i] > 0) u.models[i]--; }
          else if (u.models[i] < S.LAST) u.models[i]++;
          S.save(); refresh();
        });
        chips.appendChild(b);
      }
      box.appendChild(chips);
    }
    wrap.appendChild(box);
  });
}

// ---- edit toggles --------------------------------------------------------

function setEdit(which, on) {
  const map = {
    armies: ["armies-edit", "Edit", (v) => (editArmies = v)],
    units: ["units-edit", "Edit", (v) => (editUnits = v)],
    unit: ["unit-edit", "Undo", (v) => (undoMode = v)],
  };
  const [id, label, set] = map[which];
  set(on);
  el(id).setAttribute("aria-pressed", String(on));
  el(id).textContent = on ? "Done" : label;
}

// ---- add / edit forms ----------------------------------------------------

let newArmyFaction = null;

function openAddArmy() {
  newArmyFaction = null;
  el("army-name").value = "";
  el("army-save").disabled = true;
  renderArmyFactionChip();
  show("add-army-view");
  el("army-name").focus({ preventScroll: true });
}

function renderArmyFactionChip() {
  const f = newArmyFaction;
  const btn = el("army-faction-pick");
  btn.textContent = f ? f.name : "Choose a faction";
  btn.dataset.unset = f ? "false" : "true";
}

async function pickFaction(back, onPicked) {
  let idx;
  try {
    idx = await M.index();
  } catch (e) {
    alert("Faction data isn't available offline yet. Connect once and try again.");
    return;
  }
  pick({
    title: "Faction",
    back,
    allowNone: true,
    noneLabel: "No faction (no points)",
    options: idx.factions.map((f) => ({
      value: f.slug, label: f.name, sub: plural(f.units, "datasheet"),
    })),
    onPick: async (slug) => {
      if (slug) await M.ensure([slug]);
      onPicked(slug);
    },
  });
}

let editingUnitSheet = null;

function openAddUnit() {
  resizing = null;
  editingUnitSheet = null;
  el("unit-form-title").textContent = "Add unit";
  el("unit-name").value = "";
  el("unit-count").value = "10";
  el("unit-save").disabled = true;
  renderSheetChip();
  show("add-unit-view");
  el("unit-name").focus({ preventScroll: true });
}

function openResize() {
  const u = currentUnit();
  if (!u) return;
  resizing = u;
  editingUnitSheet = u.sheet;
  el("unit-form-title").textContent = "Edit unit";
  el("unit-name").value = u.name;
  el("unit-count").value = String(u.models.length);
  el("unit-save").disabled = false;
  renderSheetChip();
  show("add-unit-view");
}

function renderSheetChip() {
  const a = currentArmy(), f = fac(a);
  const btn = el("unit-sheet-pick");
  btn.textContent = editingUnitSheet || (a && a.faction ? "Choose a datasheet" : "Set the army's faction first");
  btn.dataset.unset = editingUnitSheet ? "false" : "true";
  btn.disabled = !(a && a.faction);

  const sh = M.sheet(f, editingUnitSheet);
  const hint = el("unit-size-hint");
  if (sh) {
    const s = M.sizes(sh);
    const c = M.cost(sh, parseInt(el("unit-count").value, 10) || 1);
    hint.textContent = "Datasheet sizes: " + s.join(" or ") + " models · " +
      M.fmt(c.points) + " pts at this size.";
  } else {
    hint.textContent = "Link a datasheet to track points automatically.";
  }
}

function pickSheet() {
  const a = currentArmy(), f = fac(a);
  if (!f) return;
  pick({
    title: "Datasheet",
    back: "add-unit-view",
    allowNone: true,
    noneLabel: "No datasheet (no points)",
    current: editingUnitSheet,
    options: f.units.map((u) => {
      const c = M.cost(u, M.sizes(u)[0]);
      return {
        value: u.name,
        label: u.name,
        group: u.group || null,
        badge: c ? M.fmt(c.points) + " pts" : null,
        sub: M.sizes(u).join("/") + " models",
      };
    }),
    onPick: (name) => {
      editingUnitSheet = name;
      if (name) {
        const sh = M.sheet(f, name);
        if (!el("unit-name").value.trim() || !resizing) el("unit-name").value = name;
        el("unit-count").value = String(M.sizes(sh)[0]);
      }
      el("unit-save").disabled = !el("unit-name").value.trim();
      renderSheetChip();
      show("add-unit-view");
    },
  });
}

function commitUnit() {
  const a = currentArmy();
  const name = el("unit-name").value.trim();
  if (!name || !a) return;
  const n = Math.max(1, Math.min(S.MAX_MODELS, parseInt(el("unit-count").value, 10) || 1));

  if (resizing) {
    const dropped = resizing.models.slice(n).filter((s) => s > 0).length;
    if (dropped && !confirm("Removing " + plural(dropped, "model") +
        " that you have already started painting. Continue?")) return;
    resizing.name = name;
    resizing.sheet = editingUnitSheet;
    S.resize(resizing, n);
  } else {
    a.units.push({
      id: S.uid(), name, sheet: editingUnitSheet,
      models: Array.from({ length: n }, () => 0),
    });
  }
  resizing = null;
  S.save();
  refresh();
  show("units-view");
}

// ---- wiring --------------------------------------------------------------

function wire() {
  el("armies-edit").addEventListener("click", () => { setEdit("armies", !editArmies); renderArmies(); });
  el("units-edit").addEventListener("click", () => { setEdit("units", !editUnits); renderUnits(); });
  el("unit-edit").addEventListener("click", () => { setEdit("unit", !undoMode); renderUnit(); });
  el("unit-size").addEventListener("click", openResize);

  el("units-back").addEventListener("click", () => { renderArmies(); show("armies-view"); });
  el("unit-back").addEventListener("click", () => { renderUnits(); show("units-view"); });

  el("armies-add").addEventListener("click", openAddArmy);
  el("units-add").addEventListener("click", openAddUnit);

  el("army-faction").addEventListener("click", () => {
    pickFaction("units-view", (slug) => {
      const a = currentArmy();
      if (a) { a.faction = slug; S.save(); }
      renderUnits();
      show("units-view");
    });
  });

  el("army-faction-pick").addEventListener("click", () => {
    pickFaction("add-army-view", async (slug) => {
      newArmyFaction = null;
      if (slug) {
        const idx = await M.index();
        newArmyFaction = idx.factions.find((f) => f.slug === slug) || null;
      }
      renderArmyFactionChip();
      show("add-army-view");
    });
  });

  el("unit-sheet-pick").addEventListener("click", pickSheet);
  el("unit-count").addEventListener("input", renderSheetChip);

  el("army-cancel").addEventListener("click", () => show("armies-view"));
  el("unit-cancel").addEventListener("click", () => show(resizing ? "unit-view" : "units-view"));

  const armyName = el("army-name");
  armyName.addEventListener("input", () => { el("army-save").disabled = !armyName.value.trim(); });
  const commitArmy = () => {
    const n = armyName.value.trim();
    if (!n) return;
    S.db.armies.push({
      id: S.uid(), name: n,
      faction: newArmyFaction ? newArmyFaction.slug : null,
      units: [],
    });
    S.save(); refresh(); show("armies-view");
  };
  el("army-save").addEventListener("click", commitArmy);
  armyName.addEventListener("keydown", (e) => { if (e.key === "Enter") commitArmy(); });

  const unitName = el("unit-name");
  unitName.addEventListener("input", () => { el("unit-save").disabled = !unitName.value.trim(); });
  el("unit-save").addEventListener("click", commitUnit);
  el("unit-count").addEventListener("keydown", (e) => { if (e.key === "Enter") commitUnit(); });
}

export { openAddArmy };
