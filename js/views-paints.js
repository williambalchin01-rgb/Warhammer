// Paints: the rack you own, schemes built from it, and what to buy next.
//
// A scheme is a reusable recipe ("Ultramarines armour"), not a per-model note:
// one recipe linked to every unit that wears it is what keeps colours
// consistent across an army painted over months.

import * as S from "./store.js";
import * as P from "./photos.js";
import { el, show, clear, make, row, empty, pick, plural } from "./ui.js";

const BRANDS = [
  "Citadel", "Vallejo", "Army Painter", "AK Interactive", "Scale75",
  "Pro Acryl", "Two Thin Coats", "Kimera",
];
const AREAS = [
  "Armour", "Trim", "Cloth", "Skin", "Metal", "Leather", "Weapon",
  "Lenses", "Base", "Details",
];

let refresh = () => {};
let jumpToUnit = () => {};
let jumpToKillteam = () => {};

let schemeId = null;
let schemeBack = { view: "paints-view", label: "Paints" };
let editSteps = false;
let schemeDraft = null;   // { id | null, linkUnitId, linkKtId, back }
let stepDraft = null;     // { stepId | null, stage, paintId, area, note }
let paintDraft = null;    // { id | null, type, returnTo }
let rackQuery = "";

export function init(onChange, onJumpToUnit, onJumpToKillteam) {
  refresh = onChange;
  jumpToUnit = onJumpToUnit;
  jumpToKillteam = onJumpToKillteam;
  wire();
}

const current = () => S.scheme(schemeId);

/** How many units and kill teams wear a scheme. */
function usageLabel(id) {
  const u = S.unitsUsing(id).length, k = S.killteamsUsing(id).length;
  return [u ? plural(u, "unit") : null, k ? plural(k, "kill team") : null].filter(Boolean).join(" and ");
}
const paintLabel = (p) => (p.brand ? p.brand + " " : "") + p.name;

function schemesUsingPaint(paintId) {
  return S.db.schemes.filter((sc) => sc.steps.some((st) => st.paintId === paintId));
}

// ---- paints root -----------------------------------------------------------

export function renderPaints() {
  const owned = S.db.paints.filter((p) => p.owned).length;
  const toBuy = S.db.paints.length - owned;
  el("paints-sub").textContent = [
    plural(S.db.schemes.length, "scheme"),
    plural(owned, "paint") + " owned",
    toBuy ? toBuy + " to buy" : null,
  ].filter(Boolean).join(" · ");

  const nav = clear(el("paints-nav"));
  nav.appendChild(row({
    name: "Paint rack",
    badge: plural(S.db.paints.length, "paint"),
    sub: S.db.paints.length ? "Everything you own, and anything you plan to buy" : "Add the paints you own",
    onOpen: openRack,
  }));
  nav.appendChild(row({
    name: "Shopping list",
    badge: toBuy ? toBuy + " to buy" : null,
    sub: toBuy ? "Paints your schemes need that you don’t own yet" : "Nothing to buy",
    onOpen: openShop,
  }));

  const rows = clear(el("paints-rows"));
  el("paints-heading").hidden = S.db.schemes.length === 0;
  el("paints-empty").hidden = S.db.schemes.length > 0;
  if (!S.db.schemes.length) {
    empty(el("paints-empty"),
      "No schemes yet. A scheme is a recipe you reuse across every unit that wears it.",
      "Create a scheme", () => newScheme({}));
  }

  for (const sc of S.db.schemes) {
    const used = usageLabel(sc.id);
    const missing = S.missingPaints(sc).length;
    rows.appendChild(row({
      name: sc.name,
      badge: plural(sc.steps.length, "step"),
      sub: [
        used ? "Used by " + used : "Not linked yet",
        missing ? missing + " to buy" : null,
      ].filter(Boolean).join(" · "),
      onOpen: () => openScheme(sc.id, { view: "paints-view", label: "Paints" }),
    }));
  }
}

// ---- one scheme --------------------------------------------------------------

export function openScheme(id, back) {
  schemeId = id;
  schemeBack = back || { view: "paints-view", label: "Paints" };
  editSteps = false;
  setEditSteps(false);
  renderScheme();
  show("scheme-view");
}

export function renderScheme() {
  const sc = current();
  if (!sc) return;

  el("scheme-back-label").textContent = schemeBack.label;
  el("scheme-title").textContent = sc.name;
  const used = S.unitsUsing(sc.id);
  const kts = S.killteamsUsing(sc.id);
  const missing = S.missingPaints(sc);
  const usage = usageLabel(sc.id);
  el("scheme-sub").textContent = [
    plural(sc.steps.length, "step"),
    usage ? "used by " + usage : null,
    missing.length ? missing.length + " to buy" : null,
  ].filter(Boolean).join(" · ");

  const note = el("scheme-note");
  note.textContent = sc.note;
  note.hidden = !sc.note;

  renderPhoto(sc);

  // Steps, in painting order: order is the recipe, so it is never re-sorted.
  const list = clear(el("scheme-steps"));
  el("scheme-steps-empty").hidden = sc.steps.length > 0;
  el("scheme-edit").hidden = sc.steps.length === 0;
  sc.steps.forEach((st, i) => {
    const p = S.paint(st.paintId);
    const li = make("li", "step");
    li.appendChild(make("div", "step-n", String(i + 1)));

    const main = make("button", "step-main");
    const head = make("div", "step-head");
    head.appendChild(make("span", "step-stage", st.stage));
    head.appendChild(make("span", p ? "step-paint" : "step-paint none", p ? p.name : "No paint"));
    main.appendChild(head);
    const bits = [st.area, p && p.brand, st.note].filter(Boolean);
    const sub = make("div", "step-sub", bits.join(" · "));
    if (p && !p.owned) {
      const buy = make("span", "step-buy", "need to buy");
      if (bits.length) sub.appendChild(document.createTextNode(" · "));
      sub.appendChild(buy);
    }
    main.appendChild(sub);
    main.addEventListener("click", () => openStepForm(st.id));
    li.appendChild(main);

    if (editSteps) {
      const ctl = make("div", "step-ctl");
      const up = make("button", "step-btn", "↑");
      up.setAttribute("aria-label", "Move step " + (i + 1) + " up");
      up.disabled = i === 0;
      up.addEventListener("click", () => moveStep(i, -1));
      const down = make("button", "step-btn", "↓");
      down.setAttribute("aria-label", "Move step " + (i + 1) + " down");
      down.disabled = i === sc.steps.length - 1;
      down.addEventListener("click", () => moveStep(i, 1));
      const del = make("button", "step-btn danger", "×");
      del.setAttribute("aria-label", "Delete step " + (i + 1));
      del.addEventListener("click", () => {
        sc.steps.splice(i, 1);
        S.save(); refresh();
      });
      ctl.append(up, down, del);
      li.appendChild(ctl);
    }
    list.appendChild(li);
  });

  // Units wearing this scheme.
  const usedList = clear(el("scheme-used"));
  for (const { army, unit } of used) {
    const st = S.stats([unit]);
    usedList.appendChild(row({
      name: unit.name,
      sub: army.name + " · " + st.based + " of " + st.total + " based",
      pct: st.pct,
      complete: st.done,
      onOpen: () => jumpToUnit(unit.id),
    }));
  }
  for (const k of kts) {
    const st = S.opStats(k.operatives);
    usedList.appendChild(row({
      name: k.name,
      sub: "Kill team \u00B7 " + st.based + " of " + st.total + " painted",
      pct: st.total ? st.pct : null,
      complete: st.done,
      onOpen: () => jumpToKillteam(k.id),
    }));
  }
  el("scheme-used-empty").hidden = used.length + kts.length > 0;
}

function moveStep(i, delta) {
  const sc = current();
  const j = i + delta;
  if (!sc || j < 0 || j >= sc.steps.length) return;
  [sc.steps[i], sc.steps[j]] = [sc.steps[j], sc.steps[i]];
  S.save(); refresh();
}

function setEditSteps(on) {
  editSteps = on;
  el("scheme-edit").setAttribute("aria-pressed", String(on));
  el("scheme-edit").textContent = on ? "Done" : "Edit";
}

async function renderPhoto(sc) {
  const box = el("scheme-photo");
  const img = el("scheme-photo-img");
  const id = sc.id;
  const u = await P.url(id);
  if (schemeId !== id) return;  // the user moved on while this loaded
  box.dataset.has = String(!!u);
  img.hidden = !u;
  if (u) img.src = u; else img.removeAttribute("src");
  el("scheme-photo-add").hidden = !!u;
  el("scheme-photo-actions").hidden = !u;
}

async function takePhoto(file) {
  const sc = current();
  if (!sc || !file) return;
  const status = el("scheme-photo-status");
  status.textContent = "Saving photo…";
  try {
    await P.put(sc.id, await P.shrink(file));
    status.textContent = "";
  } catch (e) {
    status.textContent = "Couldn’t save that photo here. Photos need storage this browser isn’t allowing.";
  }
  renderPhoto(sc);
}

function linkUnits() {
  const sc = current();
  if (!sc) return;
  const options = [];
  for (const a of S.db.armies) {
    for (const u of a.units) {
      const linked = u.schemes.includes(sc.id);
      options.push({
        value: u.id, label: u.name, group: a.name,
        sub: linked ? "Linked — tap to unlink" : null,
        badge: linked ? "✓" : null,
      });
    }
  }
  for (const k of S.db.killteams) {
    const linked = k.schemes.includes(sc.id);
    options.push({
      value: "kt:" + k.id, label: k.name, group: "Kill teams",
      sub: linked ? "Linked \u2014 tap to unlink" : null,
      badge: linked ? "\u2713" : null,
    });
  }
  if (!options.length) {
    alert("Add an army or a kill team first, then link this scheme to it.");
    return;
  }
  pick({
    title: "Link to units",
    back: "scheme-view",
    options,
    onPick: (unitId) => {
      const k = unitId && unitId.startsWith("kt:") ? S.killteam(unitId.slice(3)) : null;
      if (k) {
        k.schemes = k.schemes.includes(sc.id) ? k.schemes.filter((x) => x !== sc.id) : k.schemes.concat(sc.id);
        S.save();
      }
      const u = k ? null : S.unit(unitId);
      if (u) {
        u.schemes = u.schemes.includes(sc.id)
          ? u.schemes.filter((x) => x !== sc.id)
          : u.schemes.concat(sc.id);
        S.save();
      }
      refresh();
      show("scheme-view");
    },
  });
}

// ---- scheme details form -----------------------------------------------------

export function newScheme({ linkUnitId, linkKtId, back }) {
  schemeDraft = { id: null, linkUnitId: linkUnitId || null, linkKtId: linkKtId || null, back: back || null };
  el("schemef-title").textContent = "New scheme";
  el("schemef-name").value = "";
  el("schemef-note").value = "";
  el("schemef-save").disabled = true;
  el("schemef-delete").hidden = true;
  show("scheme-form-view");
  el("schemef-name").focus({ preventScroll: true });
}

function editScheme() {
  const sc = current();
  if (!sc) return;
  schemeDraft = { id: sc.id };
  el("schemef-title").textContent = "Edit scheme";
  el("schemef-name").value = sc.name;
  el("schemef-note").value = sc.note;
  el("schemef-save").disabled = false;
  el("schemef-delete").hidden = false;
  show("scheme-form-view");
}

function saveScheme() {
  const name = el("schemef-name").value.trim();
  if (!name || !schemeDraft) return;
  const note = el("schemef-note").value.trim().slice(0, 600);

  if (schemeDraft.id) {
    const sc = S.scheme(schemeDraft.id);
    if (sc) { sc.name = name.slice(0, 40); sc.note = note; }
    S.save(); refresh();
    show("scheme-view");
    return;
  }

  const sc = { id: S.uid(), name: name.slice(0, 40), note, steps: [] };
  S.db.schemes.push(sc);
  let back = { view: "paints-view", label: "Paints" };
  if (schemeDraft.linkUnitId) {
    const u = S.unit(schemeDraft.linkUnitId);
    if (u) u.schemes.push(sc.id);
  }
  if (schemeDraft.linkKtId) {
    const k = S.killteam(schemeDraft.linkKtId);
    if (k) k.schemes.push(sc.id);
  }
  if (schemeDraft.back) back = schemeDraft.back;
  S.save();
  refresh();
  openScheme(sc.id, back);
}

async function deleteScheme() {
  const sc = S.scheme(schemeDraft && schemeDraft.id);
  if (!sc) return;
  const used = usageLabel(sc.id);
  if (!confirm("Delete the scheme “" + sc.name + "”?" +
      (used ? "\n\nIt will be unlinked from " + used + "." : ""))) return;
  S.db.schemes = S.db.schemes.filter((x) => x.id !== sc.id);
  for (const a of S.db.armies) for (const u of a.units) u.schemes = u.schemes.filter((x) => x !== sc.id);
  for (const k of S.db.killteams) k.schemes = k.schemes.filter((x) => x !== sc.id);
  S.save();
  try { await P.remove(sc.id); } catch (e) { /* no photo store; nothing to remove */ }
  const back = schemeBack.view === "scheme-view" ? "paints-view" : schemeBack.view;
  refresh();
  show(back);
}

// ---- step form -----------------------------------------------------------------

function openStepForm(stepId) {
  const sc = current();
  if (!sc) return;
  const st = stepId ? sc.steps.find((x) => x.id === stepId) : null;
  const last = sc.steps[sc.steps.length - 1];
  stepDraft = st
    ? { stepId: st.id, stage: st.stage, paintId: st.paintId, area: st.area, note: st.note }
    // A new step usually continues the area of the one before it.
    : { stepId: null, stage: last ? nextStage(last.stage) : "Prime", paintId: null, area: last ? last.area : "", note: "" };

  el("stepf-title").textContent = st ? "Edit step" : "Add step";
  el("stepf-area").value = stepDraft.area;
  el("stepf-note").value = stepDraft.note;
  fillDatalist("area-list", AREAS.concat(S.db.schemes.flatMap((x) => x.steps.map((s2) => s2.area))));
  renderStepChips();
  show("step-form-view");
}

function nextStage(stage) {
  const order = ["Prime", "Base", "Shade", "Layer", "Highlight", "Edge highlight"];
  const i = order.indexOf(stage);
  return i >= 0 && i < order.length - 1 ? order[i + 1] : stage;
}

function renderStepChips() {
  el("stepf-stage").textContent = stepDraft.stage;
  const p = S.paint(stepDraft.paintId);
  const chip = el("stepf-paint");
  chip.textContent = p ? paintLabel(p) + (p.owned ? "" : " (to buy)") : "Choose a paint";
  chip.dataset.unset = p ? "false" : "true";
}

function captureStepFields() {
  stepDraft.area = el("stepf-area").value.trim();
  stepDraft.note = el("stepf-note").value.trim();
}

function pickStage() {
  captureStepFields();
  pick({
    title: "Stage",
    back: "step-form-view",
    current: stepDraft.stage,
    options: S.STEP_STAGES.map((x) => ({ value: x, label: x })),
    onPick: (v) => {
      if (v) stepDraft.stage = v;
      renderStepChips();
      show("step-form-view");
    },
  });
}

function pickPaint() {
  captureStepFields();
  const options = [{ value: "__new", label: "Add a new paint…", sub: "Put it on your rack and use it here" }]
    .concat(sortedPaints().map((p) => ({
      value: p.id,
      label: p.name,
      group: p.brand || "No brand",
      badge: p.type,
      sub: p.owned ? null : "Not owned yet",
    })));
  pick({
    title: "Paint",
    back: "step-form-view",
    current: stepDraft.paintId,
    allowNone: true,
    noneLabel: "No paint (technique only)",
    options,
    onPick: (v) => {
      if (v === "__new") { openPaintForm(null, "step-form-view"); return; }
      stepDraft.paintId = v;
      renderStepChips();
      show("step-form-view");
    },
  });
}

function saveStep() {
  const sc = current();
  if (!sc || !stepDraft) return;
  captureStepFields();
  const fields = {
    area: stepDraft.area.slice(0, 30),
    stage: stepDraft.stage,
    paintId: stepDraft.paintId,
    note: stepDraft.note.slice(0, 160),
  };
  if (stepDraft.stepId) {
    const st = sc.steps.find((x) => x.id === stepDraft.stepId);
    if (st) Object.assign(st, fields);
  } else {
    sc.steps.push(Object.assign({ id: S.uid() }, fields));
  }
  stepDraft = null;
  S.save(); refresh();
  show("scheme-view");
}

// ---- rack ----------------------------------------------------------------------

function sortedPaints() {
  return S.db.paints.slice().sort((a, b) =>
    (a.brand || "￿").localeCompare(b.brand || "￿") || a.name.localeCompare(b.name));
}

function openRack() {
  rackQuery = "";
  el("rack-search").value = "";
  renderRack();
  show("rack-view");
}

export function renderRack() {
  const owned = S.db.paints.filter((p) => p.owned).length;
  el("rack-sub").textContent = plural(owned, "paint") + " owned" +
    (S.db.paints.length > owned ? " · " + (S.db.paints.length - owned) + " to buy" : "");

  const q = rackQuery.trim().toLowerCase();
  const hits = sortedPaints().filter((p) =>
    !q || (p.name + " " + p.brand + " " + p.type).toLowerCase().includes(q));

  el("rack-search").hidden = S.db.paints.length < 8;
  const rows = clear(el("rack-rows"));
  el("rack-empty").hidden = hits.length > 0;
  if (!S.db.paints.length) {
    empty(el("rack-empty"), "Your rack is empty. Add the paints you own — and any you want to buy.",
      "Add a paint", () => openPaintForm(null, "rack-view"));
  } else if (!hits.length) {
    empty(el("rack-empty"), "No paints match.");
  }

  let group = null;
  for (const p of hits) {
    const g = p.brand || "No brand";
    if (!q && g !== group) { group = g; rows.appendChild(make("li", "group", g)); }
    const uses = schemesUsingPaint(p.id).length;
    rows.appendChild(row({
      name: p.name,
      badge: p.type,
      sub: [
        q ? g : null,
        p.owned ? null : "Not owned yet",
        uses ? "In " + plural(uses, "scheme") : null,
        p.note || null,
      ].filter(Boolean).join(" · ") || null,
      onOpen: () => openPaintForm(p.id, "rack-view"),
    }));
  }
}

// ---- paint form ----------------------------------------------------------------

function openPaintForm(id, returnTo) {
  const p = id ? S.paint(id) : null;
  paintDraft = { id: p ? p.id : null, type: p ? p.type : "Base", returnTo };
  el("paintf-title").textContent = p ? "Edit paint" : "Add paint";
  el("paintf-name").value = p ? p.name : "";
  el("paintf-brand").value = p ? p.brand : lastBrand();
  el("paintf-note").value = p ? p.note : "";
  el("paintf-owned").checked = p ? p.owned : true;
  el("paintf-save").disabled = !p;
  el("paintf-delete").hidden = !p;
  fillDatalist("brand-list", BRANDS.concat(S.db.paints.map((x) => x.brand)));
  renderPaintType();
  show("paint-form-view");
  if (!p) el("paintf-name").focus({ preventScroll: true });
}

// Paints tend to be added in runs from one brand, so default to the last used.
function lastBrand() {
  const last = S.db.paints[S.db.paints.length - 1];
  return last ? last.brand : "Citadel";
}

function renderPaintType() {
  el("paintf-type").textContent = paintDraft.type;
}

function pickPaintType() {
  const draft = {
    name: el("paintf-name").value, brand: el("paintf-brand").value,
    note: el("paintf-note").value, owned: el("paintf-owned").checked,
  };
  pick({
    title: "Paint type",
    back: "paint-form-view",
    current: paintDraft.type,
    options: S.PAINT_TYPES.map((x) => ({ value: x, label: x })),
    onPick: (v) => {
      if (v) paintDraft.type = v;
      el("paintf-name").value = draft.name;
      el("paintf-brand").value = draft.brand;
      el("paintf-note").value = draft.note;
      el("paintf-owned").checked = draft.owned;
      renderPaintType();
      show("paint-form-view");
    },
  });
}

function savePaint() {
  const name = el("paintf-name").value.trim();
  if (!name || !paintDraft) return;
  const fields = {
    name: name.slice(0, 60),
    brand: el("paintf-brand").value.trim().slice(0, 30),
    type: paintDraft.type,
    owned: el("paintf-owned").checked,
    note: el("paintf-note").value.trim().slice(0, 120),
  };
  let id = paintDraft.id;
  if (id) {
    Object.assign(S.paint(id), fields);
  } else {
    id = S.uid();
    S.db.paints.push(Object.assign({ id }, fields));
  }
  const returnTo = paintDraft.returnTo;
  paintDraft = null;
  S.save();
  refresh();
  if (returnTo === "step-form-view" && stepDraft) {
    stepDraft.paintId = id;
    el("stepf-area").value = stepDraft.area;
    el("stepf-note").value = stepDraft.note;
    renderStepChips();
  }
  show(returnTo || "rack-view");
}

function deletePaint() {
  const p = S.paint(paintDraft && paintDraft.id);
  if (!p) return;
  const uses = schemesUsingPaint(p.id);
  if (!confirm("Delete “" + paintLabel(p) + "”?" +
      (uses.length ? "\n\nIt’s used in " + plural(uses.length, "scheme") +
        "; those steps will show no paint." : ""))) return;
  S.db.paints = S.db.paints.filter((x) => x.id !== p.id);
  for (const sc of S.db.schemes) for (const st of sc.steps) if (st.paintId === p.id) st.paintId = null;
  const returnTo = paintDraft.returnTo === "step-form-view" ? "rack-view" : paintDraft.returnTo;
  paintDraft = null;
  S.save(); refresh();
  show(returnTo || "rack-view");
}

// ---- shopping list -------------------------------------------------------------

function openShop() {
  el("shop-status").textContent = "";
  renderShop();
  show("shop-view");
}

export function renderShop() {
  const wanted = sortedPaints().filter((p) => !p.owned);
  el("shop-sub").textContent = wanted.length ? plural(wanted.length, "paint") + " to buy" : "Nothing to buy";
  el("shop-copy").disabled = wanted.length === 0;

  const rows = clear(el("shop-rows"));
  el("shop-empty").hidden = wanted.length > 0;
  if (!wanted.length) {
    empty(el("shop-empty"),
      "Nothing to buy. Mark a paint as not owned on your rack, or pick one you don’t have in a scheme.");
  }
  for (const p of wanted) {
    const uses = schemesUsingPaint(p.id);
    const li = make("li", "row");
    const main = make("button", "row-main");
    const head = make("div", "row-head");
    head.appendChild(make("div", "row-name", p.name));
    head.appendChild(make("div", "row-badge", p.type));
    main.appendChild(head);
    main.appendChild(make("div", "row-sub", [
      p.brand,
      uses.length ? "for " + uses.map((x) => x.name).join(", ") : null,
    ].filter(Boolean).join(" · ") || " "));
    main.addEventListener("click", () => openPaintForm(p.id, "shop-view"));
    li.appendChild(main);
    const got = make("button", "got", "Got it");
    got.setAttribute("aria-label", "Mark " + p.name + " as owned");
    got.addEventListener("click", () => {
      p.owned = true;
      S.save(); refresh();
    });
    li.appendChild(got);
    rows.appendChild(li);
  }
}

function copyShop() {
  const wanted = sortedPaints().filter((p) => !p.owned);
  const text = "Paints to buy\n" + wanted.map((p) =>
    "- " + paintLabel(p) + (p.type !== "Other" ? " (" + p.type + ")" : "")).join("\n");
  const done = () => { el("shop-status").textContent = "Copied."; };
  const fail = () => { el("shop-status").textContent = "Couldn’t copy here."; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fail);
  else fail();
}

// ---- helpers -------------------------------------------------------------------

function fillDatalist(id, values) {
  const dl = clear(el(id));
  const seen = new Set();
  for (const v of values) {
    const t = (v || "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const o = document.createElement("option");
    o.value = t;
    dl.appendChild(o);
  }
}

// ---- wiring --------------------------------------------------------------------

function wire() {
  el("paints-add").addEventListener("click", () => newScheme({}));

  el("scheme-back").addEventListener("click", () => { refresh(); show(schemeBack.view); });
  el("scheme-edit").addEventListener("click", () => { setEditSteps(!editSteps); renderScheme(); });
  el("scheme-add").addEventListener("click", () => openStepForm(null));
  el("scheme-details").addEventListener("click", editScheme);
  el("scheme-link").addEventListener("click", linkUnits);
  // "Add" and "Change" are <label for> the file input: the one way to open the
  // iOS photo picker that survives every browser, so they need no handler here.
  el("scheme-photo-remove").addEventListener("click", async () => {
    const sc = current();
    if (!sc || !confirm("Remove this photo?")) return;
    try { await P.remove(sc.id); } catch (e) { /* nothing stored */ }
    renderPhoto(sc);
  });
  el("scheme-photo-input").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    takePhoto(f);
  });

  const sName = el("schemef-name");
  sName.addEventListener("input", () => { el("schemef-save").disabled = !sName.value.trim(); });
  el("schemef-save").addEventListener("click", saveScheme);
  el("schemef-cancel").addEventListener("click", () => {
    const back = schemeDraft && schemeDraft.id ? "scheme-view"
      : (schemeDraft && schemeDraft.back ? schemeDraft.back.view : "paints-view");
    schemeDraft = null;
    show(back);
  });
  el("schemef-delete").addEventListener("click", deleteScheme);

  el("stepf-stage").addEventListener("click", pickStage);
  el("stepf-paint").addEventListener("click", pickPaint);
  el("stepf-save").addEventListener("click", saveStep);
  el("stepf-cancel").addEventListener("click", () => { stepDraft = null; show("scheme-view"); });

  el("rack-back").addEventListener("click", () => { refresh(); show("paints-view"); });
  el("rack-add").addEventListener("click", () => openPaintForm(null, "rack-view"));
  el("rack-search").addEventListener("input", (e) => { rackQuery = e.target.value; renderRack(); });

  const pName = el("paintf-name");
  pName.addEventListener("input", () => { el("paintf-save").disabled = !pName.value.trim(); });
  el("paintf-type").addEventListener("click", pickPaintType);
  el("paintf-save").addEventListener("click", savePaint);
  el("paintf-cancel").addEventListener("click", () => {
    const back = paintDraft ? paintDraft.returnTo : "rack-view";
    paintDraft = null;
    show(back || "rack-view");
  });
  el("paintf-delete").addEventListener("click", deletePaint);

  el("shop-back").addEventListener("click", () => { refresh(); show("paints-view"); });
  el("shop-copy").addEventListener("click", copyShop);
}
