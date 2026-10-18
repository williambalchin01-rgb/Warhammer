// Kill teams: a roster of operatives that is also the models you paint.
//
// Each operative is one model with its own painting stage, its weapon choices
// and its datacard. The team wears paint schemes as a whole.

import * as S from "./store.js";
import * as K from "./kt.js";
import { el, show, clear, make, row, empty, pick, plural } from "./ui.js";

let refresh = () => {};
let openScheme = () => {};
let newScheme = () => {};
let askClaude = () => {};
let logGame = () => {};

let ktId = null;
let opId = null;
let editOps = false;
let draft = null;   // kill team form: { id | null, team }

export function init(onChange, hooks) {
  refresh = onChange;
  ({ openScheme, newScheme, askClaude, logGame } = hooks);
  wire();
}

const current = () => S.killteam(ktId);
const teamData = (k) => (k ? K.got(k.team) : null);
const opLabel = (o) => o.name && o.name !== o.type ? o.name : o.type;

// ---- list on the Armies tab ---------------------------------------------------

/** Rows for the Armies tab. Returns how many were drawn. */
export function renderKillteamRows(container, editing, onDelete) {
  clear(container);
  for (const k of S.db.killteams) {
    const t = teamData(k);
    const st = S.opStats(k.operatives);
    const issues = K.check(t, k);
    container.appendChild(row({
      name: k.name,
      badge: t ? t.name : null,
      sub: [plural(k.operatives.length, "operative"), st.total ? st.based + " painted" : null,
        issues.length ? "check roster" : null].filter(Boolean).join(" · "),
      pct: st.total ? st.pct : null,
      complete: st.done,
      onOpen: () => openKillteam(k.id),
      onDelete: editing ? () => onDelete(k) : null,
    }));
  }
  return S.db.killteams.length;
}

export function deleteKillteam(k) {
  if (!confirm("Delete the kill team “" + k.name + "”?")) return false;
  S.db.killteams = S.db.killteams.filter((x) => x.id !== k.id);
  for (const b of S.db.battles) if (b.ktId === k.id) b.ktId = null;
  S.save();
  return true;
}

// ---- new / edit kill team -------------------------------------------------------

export async function newKillteam() {
  draft = { id: null, team: null };
  el("ktf-title").textContent = "New kill team";
  el("ktf-name").value = "";
  el("ktf-delete").hidden = true;
  renderTeamChip();
  show("kt-form-view");
  el("ktf-name").focus({ preventScroll: true });
}

function editKillteam() {
  const k = current();
  if (!k) return;
  draft = { id: k.id, team: k.team };
  el("ktf-title").textContent = "Edit kill team";
  el("ktf-name").value = k.name;
  el("ktf-delete").hidden = false;
  renderTeamChip();
  show("kt-form-view");
}

async function renderTeamChip() {
  const chip = el("ktf-team");
  const hint = el("ktf-hint");
  let name = null;
  if (draft.team) {
    try { name = ((await K.index()).teams.find((t) => t.slug === draft.team) || {}).name; } catch (e) { /* offline */ }
  }
  chip.textContent = name || draft.team || "Choose a team";
  chip.dataset.unset = draft.team ? "false" : "true";
  // The team decides which operatives exist, so it is fixed once chosen.
  chip.disabled = !!draft.id;
  hint.textContent = draft.id ? "The team can’t be changed once operatives depend on it." : "";
  validate();
}

function validate() {
  el("ktf-save").disabled = !(el("ktf-name").value.trim() && draft && draft.team);
}

async function pickTeam() {
  let idx;
  try { idx = await K.index(); } catch (e) {
    alert("Kill Team data isn’t available offline yet. Connect once and try again.");
    return;
  }
  const name = el("ktf-name").value;
  pick({
    title: "Team",
    back: "kt-form-view",
    current: draft.team,
    options: idx.teams.map((t) => ({
      value: t.slug, label: t.name, sub: plural(t.operatives, "operative type") +
        (t.rulesVersion ? " · " + t.rulesVersion : ""),
    })),
    onPick: (slug) => {
      if (slug) {
        draft.team = slug;
        // Default the roster name to the team's name until the user types one.
        if (!name.trim()) el("ktf-name").value = (idx.teams.find((t) => t.slug === slug) || {}).name || "";
        else el("ktf-name").value = name;
      }
      renderTeamChip();
      show("kt-form-view");
    },
  });
}

async function saveKillteam() {
  const name = el("ktf-name").value.trim().slice(0, 40);
  if (!name || !draft || !draft.team) return;
  if (draft.id) {
    current().name = name;
    S.save(); refresh();
    show("kt-view");
    return;
  }
  const k = { id: S.uid(), name, team: draft.team, operatives: [], schemes: [], notes: "" };
  S.db.killteams.push(k);
  S.save();
  await K.ensure([k.team]);
  refresh();
  openKillteam(k.id);
}

// ---- roster -----------------------------------------------------------------------

export async function openKillteam(id) {
  ktId = id;
  setEditOps(false);
  const k = current();
  if (k) await K.ensure([k.team]);
  renderKillteam();
  show("kt-view");
}

export function renderKillteam() {
  const k = current();
  if (!k) return;
  const t = teamData(k);
  const st = S.opStats(k.operatives);

  el("kt-title").textContent = k.name;
  el("kt-sub").textContent = [
    plural(k.operatives.length, "operative"),
    st.total ? st.based + " of " + st.total + " painted" : null,
  ].filter(Boolean).join(" · ");
  const chip = el("kt-team");
  chip.textContent = t ? t.name + (t.rulesVersion ? " · " + t.rulesVersion : "") : k.team;
  el("kt-composition").textContent = t ? K.compositionLabel(t) : "Team data unavailable offline";

  const issues = K.check(t, k);
  const warn = el("kt-warn");
  warn.hidden = !issues.length || !k.operatives.length;
  warn.textContent = issues.join(" ");

  renderKtSchemes(k);

  const rows = clear(el("kt-rows"));
  el("kt-empty").hidden = k.operatives.length > 0;
  el("kt-edit").hidden = k.operatives.length === 0;
  if (!k.operatives.length) {
    empty(el("kt-empty"), "No operatives yet. Start with your leader.", "Add an operative", addOperative);
  }
  // Leader first, then in the order they were added.
  const ordered = k.operatives.slice().sort((a, b) => {
    const la = (K.opType(t, a.type) || {}).leader ? 0 : 1;
    const lb = (K.opType(t, b.type) || {}).leader ? 0 : 1;
    return la - lb;
  });
  for (const o of ordered) {
    const type = K.opType(t, o.type);
    // One name per weapon: "Plasma pistol (standard)" and "(supercharge)" are
    // two profiles of the same gun.
    const ws = [...new Set(K.weapons(type, o.choices).map((w) => w.name.replace(/\s*\([^)]*\)$/, "")))];
    rows.appendChild(row({
      name: opLabel(o),
      badge: type ? "W" + type.wounds + " · APL" + type.apl : null,
      sub: [o.name && o.name !== o.type ? o.type : null, ws.join(", ") || null, S.STAGES[o.stage]]
        .filter(Boolean).join(" · "),
      pct: o.stage / S.LAST,
      complete: o.stage === S.LAST,
      onOpen: () => openOperative(o.id),
      onDelete: editOps ? () => {
        if (!confirm("Remove " + opLabel(o) + " from the roster?")) return;
        k.operatives = k.operatives.filter((x) => x.id !== o.id);
        S.save(); refresh();
      } : null,
    }));
  }

  renderTeamRules(t);

  const games = S.db.battles.filter((b) => b.ktId === k.id);
  const rec = el("kt-record");
  rec.hidden = games.length === 0;
  if (games.length) {
    const r = S.record(games);
    rec.textContent = "Record with this kill team: " + r.W + "W " + r.L + "L " + r.D + "D";
  }
  el("kt-ask").disabled = k.operatives.length === 0;
}

function renderKtSchemes(k) {
  const strip = clear(el("kt-schemes"));
  for (const id of k.schemes) {
    const sc = S.scheme(id);
    if (!sc) continue;
    const b = make("button", "chip-btn", sc.name);
    b.addEventListener("click", () => openScheme(sc.id, { view: "kt-view", label: k.name }));
    strip.appendChild(b);
  }
  const add = make("button", "chip-btn", k.schemes.length ? "+ Scheme" : "+ Link a paint scheme");
  add.dataset.unset = "true";
  add.addEventListener("click", () => linkScheme(k));
  strip.appendChild(add);
}

function linkScheme(k) {
  pick({
    title: "Paint scheme",
    back: "kt-view",
    options: [{ value: "__new", label: "New scheme…", sub: "Create a recipe and link it to this kill team" }]
      .concat(S.db.schemes.map((sc) => {
        const linked = k.schemes.includes(sc.id);
        return { value: sc.id, label: sc.name, badge: linked ? "✓" : plural(sc.steps.length, "step"),
          sub: linked ? "Linked — tap to unlink" : null };
      })),
    onPick: (id) => {
      if (id === "__new") { newScheme({ linkKtId: k.id, back: { view: "kt-view", label: k.name } }); return; }
      if (id) {
        k.schemes = k.schemes.includes(id) ? k.schemes.filter((x) => x !== id) : k.schemes.concat(id);
        S.save();
      }
      refresh();
      show("kt-view");
    },
  });
}

function renderTeamRules(t) {
  const box = clear(el("kt-rules"));
  if (!t) return;
  const section = (title, items) => {
    if (!items.length) return;
    const d = make("details", "rules-block");
    d.appendChild(make("summary", null, title + " (" + items.length + ")"));
    for (const it of items) {
      const p = make("div", "rule");
      p.appendChild(make("div", "rule-name", it.name));
      if (it.text) p.appendChild(make("div", "rule-text", it.text));
      d.appendChild(p);
    }
    box.appendChild(d);
  };
  section("Faction rules", t.rules);
  const byType = new Map();
  for (const r of t.reference || []) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type).push(r);
  }
  for (const [type, items] of byType) section(type, items);
  section("Faction equipment", t.equipment);
  section("Universal equipment", K.universalEquipment());
}

function setEditOps(on) {
  editOps = on;
  el("kt-edit").setAttribute("aria-pressed", String(on));
  el("kt-edit").textContent = on ? "Done" : "Edit";
}

function addOperative() {
  const k = current(), t = teamData(k);
  if (!t) { alert("Team data isn’t available offline yet. Connect once and try again."); return; }
  const counts = new Map();
  for (const o of k.operatives) counts.set(o.type, (counts.get(o.type) || 0) + 1);
  pick({
    title: "Add operative",
    back: "kt-view",
    options: t.operatives.map((x) => {
      const have = counts.get(x.name) || 0;
      return {
        value: x.name,
        label: x.name,
        group: x.leader ? "Leader" : "Operatives",
        badge: have ? "×" + have : null,
        sub: ["APL " + x.apl, "Move " + x.move, "Save " + x.save, "W " + x.wounds,
          x.max != null ? "max " + x.max : null].filter(Boolean).join(" · "),
      };
    }).sort((a, b) => (a.group === "Leader" ? 0 : 1) - (b.group === "Leader" ? 0 : 1)),
    onPick: (name) => {
      const type = K.opType(t, name);
      if (!type) { show("kt-view"); return; }
      const o = { id: S.uid(), type: name, name: "", stage: 0, choices: K.defaultChoices(type) };
      k.operatives.push(o);
      S.save(); refresh();
      show("kt-view");
    },
  });
}

// ---- operative datacard -----------------------------------------------------------

function openOperative(id) {
  opId = id;
  renderOperative();
  show("op-view");
}

const currentOp = () => {
  const k = current();
  return k ? k.operatives.find((o) => o.id === opId) || null : null;
};

export function renderOperative() {
  const k = current(), o = currentOp();
  if (!k || !o) return;
  const t = teamData(k);
  const type = K.opType(t, o.type);

  el("op-back-label").textContent = k.name;
  el("op-title").textContent = opLabel(o);
  el("op-sub").textContent = [o.name && o.name !== o.type ? o.type : null,
    type ? type.keywords.filter((x) => x !== o.type && x !== t.name).join(", ") : "Datacard unavailable offline"]
    .filter(Boolean).join(" · ");

  // Stats
  const stats = clear(el("op-stats"));
  for (const [label, v] of [["APL", type && type.apl], ["Move", type && type.move], ["Save", type && type.save], ["Wounds", type && type.wounds]]) {
    const c = make("div", "stat");
    c.appendChild(make("div", "stat-v", v || "–"));
    c.appendChild(make("div", "stat-l", label));
    stats.appendChild(c);
  }

  // Painting stage: one model, so one stage.
  const stages = clear(el("op-stage"));
  S.STAGES.forEach((label, i) => {
    const b = make("button", "stage-pick", label);
    b.setAttribute("aria-pressed", String(o.stage === i));
    b.addEventListener("click", () => { o.stage = i; S.save(); refresh(); });
    stages.appendChild(b);
  });

  // Weapon options
  const opts = clear(el("op-options"));
  for (const g of (type ? type.options : [])) {
    const f = make("div", "opt");
    f.appendChild(make("div", "stage-name", g.name === "Weapons" ? "Loadout" : g.name));
    const chosen = o.choices[g.name];
    const b = make("button", "chip-btn", chosen || "None");
    b.dataset.unset = chosen ? "false" : "true";
    b.addEventListener("click", () => pickOption(o, g));
    f.appendChild(b);
    opts.appendChild(f);
  }
  el("op-options-wrap").hidden = !(type && type.options.length);

  // Weapons
  const ws = K.weapons(type, o.choices);
  const table = clear(el("op-weapons"));
  if (ws.length) {
    const head = make("div", "wpn wpn-head");
    for (const h of ["", "ATK", "HIT", "DMG"]) head.appendChild(make("div", null, h));
    table.appendChild(head);
    for (const w of ws) {
      const r = make("div", "wpn");
      const n = make("div", "wpn-name");
      n.appendChild(make("span", "wpn-kind", w.kind === "melee" ? "⚔" : w.kind === "ranged" ? "⌖" : ""));
      n.appendChild(document.createTextNode(w.name));
      r.appendChild(n);
      r.appendChild(make("div", null, w.atk));
      r.appendChild(make("div", null, w.hit));
      r.appendChild(make("div", null, w.dmg));
      if (w.wr && w.wr !== "-") r.appendChild(make("div", "wpn-wr", w.wr));
      table.appendChild(r);
    }
  } else {
    table.appendChild(make("p", "hint", "No weapons."));
  }

  // Abilities, actions, and what each weapon rule means.
  const abil = clear(el("op-abilities"));
  const block = (title, items) => {
    if (!items || !items.length) return;
    abil.appendChild(make("div", "group", title));
    for (const it of items) {
      const p = make("div", "rule");
      p.appendChild(make("div", "rule-name", it.name));
      if (it.text) p.appendChild(make("div", "rule-text", it.text));
      abil.appendChild(p);
    }
  };
  if (type) {
    block("Abilities", type.abilities);
    block("Unique actions", type.actions);
    block("Psychic powers", type.psychic);
  }
  block("Weapon rules", K.weaponRules(ws));
}

function pickOption(o, g) {
  pick({
    title: g.name,
    back: "op-view",
    current: o.choices[g.name] || null,
    allowNone: !(g.min > 0),
    noneLabel: "None",
    options: g.choices.map((c) => ({
      value: c.name, label: c.name,
      sub: c.weapons.map((w) => w.name + " " + w.atk + "/" + w.hit + "/" + w.dmg).join(" · ") || null,
    })),
    onPick: (name) => {
      if (name) o.choices[g.name] = name; else delete o.choices[g.name];
      S.save(); refresh();
      show("op-view");
    },
  });
}

// ---- wiring -------------------------------------------------------------------------

function wire() {
  el("ktf-name").addEventListener("input", validate);
  el("ktf-team").addEventListener("click", pickTeam);
  el("ktf-save").addEventListener("click", saveKillteam);
  el("ktf-cancel").addEventListener("click", () => {
    const back = draft && draft.id ? "kt-view" : "armies-view";
    draft = null;
    show(back);
  });
  el("ktf-delete").addEventListener("click", () => {
    const k = current();
    if (k && deleteKillteam(k)) { refresh(); show("armies-view"); }
  });

  el("kt-back").addEventListener("click", () => { refresh(); show("armies-view"); });
  el("kt-team").addEventListener("click", editKillteam);
  el("kt-edit").addEventListener("click", () => { setEditOps(!editOps); renderKillteam(); });
  el("kt-add").addEventListener("click", addOperative);
  el("kt-ask").addEventListener("click", () => askClaude(ktId));
  el("kt-log").addEventListener("click", () => logGame({ ktId, back: "kt-view" }));

  el("op-back").addEventListener("click", () => { refresh(); show("kt-view"); });
  el("op-rename").addEventListener("click", () => {
    const o = currentOp();
    if (!o) return;
    const n = prompt("Name this operative (leave blank to use its type)", o.name || "");
    if (n === null) return;
    o.name = n.trim().slice(0, 40);
    S.save(); refresh();
  });
}
