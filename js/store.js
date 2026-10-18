// State, persistence and schema migration.
//
// Everything the app owns lives under one localStorage key. The stored shape is
// versioned so that old backups stay restorable as the model grows.

export const STAGES = ["Not started", "Assembled", "Primed", "Base colours", "Details", "Based"];
export const LAST = STAGES.length - 1;
export const SCHEMA = 4;

export const PAINT_TYPES = [
  "Base", "Layer", "Shade", "Contrast", "Speedpaint", "Dry", "Technical",
  "Metallic", "Air", "Wash", "Ink", "Primer", "Other",
];
export const STEP_STAGES = [
  "Prime", "Base", "Shade", "Wash", "Layer", "Highlight", "Edge highlight",
  "Glaze", "Drybrush", "Contrast", "Detail", "Weathering", "Basing", "Varnish",
];

const KEY = "painting.v1";
const BACKUP_KEY = "painting.v1.backup";
const MAX_MODELS = 60;

// Never reassigned, so importers always see current state.
export const db = empty();

function empty() {
  return { schema: SCHEMA, armies: [], lists: [], killteams: [], paints: [], schemes: [], battles: [] };
}

export let storageOK = true;

let uidSeq = 0;
export function uid() {
  uidSeq++;
  return Date.now().toString(36) + "-" + uidSeq.toString(36) + "-" +
    Math.floor(Math.random() * 46656).toString(36);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? null : Math.max(lo, Math.min(hi, n));
};

/**
 * Keeps an id when it is sound and unseen, otherwise mints one. Ids must survive
 * a load: lists point at units, battles at lists, units at schemes, steps at
 * paints. One keeper per migration, shared across every collection.
 */
function keeper() {
  const seen = new Set();
  return (id) => {
    const ok = typeof id === "string" && id.length > 0 && id.length <= 64 && !seen.has(id);
    const out = ok ? id : uid();
    seen.add(out);
    return out;
  };
}

// Rebuild untrusted data field by field rather than trusting its shape.
function cleanArmies(raw, schemeIds, keepId) {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const armies = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return null;
    const name = str(a.name, 30);
    if (!name || !Array.isArray(a.units) || a.units.length > 200) return null;

    const units = [];
    for (const u of a.units) {
      if (!u || typeof u !== "object") return null;
      const uname = str(u.name, 40);
      if (!uname || !Array.isArray(u.models) || !u.models.length || u.models.length > MAX_MODELS) return null;
      const models = [];
      for (const s of u.models) {
        const n = parseInt(s, 10);
        if (isNaN(n)) return null;
        models.push(Math.max(0, Math.min(LAST, n)));
      }
      const schemes = (Array.isArray(u.schemes) ? u.schemes : [])
        .filter((id, i, all) => schemeIds.has(id) && all.indexOf(id) === i);
      units.push({ id: keepId(u.id), name: uname, sheet: str(u.sheet, 80) || null, models, schemes });
    }
    armies.push({ id: keepId(a.id), name, faction: str(a.faction, 40) || null, units });
  }
  return armies;
}

function cleanLists(raw, armies, keepId) {
  if (!Array.isArray(raw)) return [];
  const armyIds = new Set(armies.map((a) => a.id));
  const unitIds = new Set(armies.flatMap((a) => a.units.map((u) => u.id)));
  const lists = [];
  for (const l of raw.slice(0, 200)) {
    if (!l || typeof l !== "object") continue;
    const name = str(l.name, 40);
    if (!name || !armyIds.has(l.armyId)) continue;
    const size = Math.max(0, Math.min(20000, parseInt(l.size, 10) || 0));
    const entries = (Array.isArray(l.entries) ? l.entries : [])
      .filter((e) => e && unitIds.has(e.unitId))
      .slice(0, 200)
      .map((e) => ({ id: keepId(e.id), unitId: e.unitId, enhancement: str(e.enhancement, 80) || null }));
    lists.push({
      id: keepId(l.id),
      armyId: l.armyId,
      name,
      size,
      detachment: str(l.detachment, 80) || null,
      entries,
    });
  }
  return lists;
}

function cleanPaints(raw, keepId) {
  if (!Array.isArray(raw)) return [];
  const paints = [];
  for (const p of raw.slice(0, 2000)) {
    if (!p || typeof p !== "object") continue;
    const name = str(p.name, 60);
    if (!name) continue;
    paints.push({
      id: keepId(p.id),
      name,
      brand: str(p.brand, 30),
      type: PAINT_TYPES.includes(p.type) ? p.type : "Other",
      owned: p.owned !== false,
      note: str(p.note, 120),
    });
  }
  return paints;
}

function cleanSchemes(raw, paintIds, keepId) {
  if (!Array.isArray(raw)) return [];
  const schemes = [];
  for (const sc of raw.slice(0, 500)) {
    if (!sc || typeof sc !== "object") continue;
    const name = str(sc.name, 40);
    if (!name) continue;
    const steps = (Array.isArray(sc.steps) ? sc.steps : []).slice(0, 100)
      .filter((st) => st && typeof st === "object")
      .map((st) => ({
        id: keepId(st.id),
        area: str(st.area, 30),
        stage: STEP_STAGES.includes(st.stage) ? st.stage : "Layer",
        paintId: paintIds.has(st.paintId) ? st.paintId : null,
        note: str(st.note, 160),
      }));
    schemes.push({ id: keepId(sc.id), name, note: str(sc.note, 600), steps });
  }
  return schemes;
}

function cleanKillteams(raw, schemeIds, keepId) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const k of raw.slice(0, 200)) {
    if (!k || typeof k !== "object") continue;
    const name = str(k.name, 40);
    const team = str(k.team, 60);
    if (!name || !team) continue;
    const operatives = (Array.isArray(k.operatives) ? k.operatives : []).slice(0, 60)
      .filter((o) => o && typeof o === "object" && str(o.type, 80))
      .map((o) => {
        const choices = {};
        if (o.choices && typeof o.choices === "object") {
          for (const [g, c] of Object.entries(o.choices).slice(0, 20)) {
            const gk = str(g, 60), cv = str(c, 120);
            if (gk && cv) choices[gk] = cv;
          }
        }
        return {
          id: keepId(o.id),
          type: str(o.type, 80),
          name: str(o.name, 40),
          stage: int(o.stage, 0, LAST) || 0,
          choices,
        };
      });
    const schemes = (Array.isArray(k.schemes) ? k.schemes : [])
      .filter((id, i, all) => schemeIds.has(id) && all.indexOf(id) === i);
    out.push({ id: keepId(k.id), name, team, operatives, schemes, notes: str(k.notes, 1000) });
  }
  return out;
}

function cleanBattles(raw, listIds, keepId, ktIds) {
  if (!Array.isArray(raw)) return [];
  const battles = [];
  for (const b of raw.slice(0, 2000)) {
    if (!b || typeof b !== "object") continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
    if (!date || !["W", "L", "D"].includes(b.result)) continue;
    battles.push({
      id: keepId(b.id),
      date,
      result: b.result,
      scoreFor: int(b.scoreFor, 0, 999),
      scoreAgainst: int(b.scoreAgainst, 0, 999),
      listId: listIds.has(b.listId) ? b.listId : null,
      ktId: ktIds.has(b.ktId) ? b.ktId : null,
      // Names are snapshotted so a game still reads properly after its list or
      // army is deleted.
      listName: str(b.listName, 40),
      armyName: str(b.armyName, 30),
      opponent: str(b.opponent, 40),
      mission: str(b.mission, 60),
      worked: str(b.worked, 1000),
      didnt: str(b.didnt, 1000),
    });
  }
  return battles;
}

// Accepts any shape the app has ever written: a bare array (schema 1) or the
// versioned envelope (2 onwards). Returns null if it isn't ours.
export function migrate(raw) {
  const env = Array.isArray(raw) ? { schema: 1, armies: raw } : raw;
  if (!env || typeof env !== "object") return null;
  const keepId = keeper();
  // Order matters: each collection is checked against the ones it points at.
  const paints = cleanPaints(env.paints, keepId);
  const schemes = cleanSchemes(env.schemes, new Set(paints.map((p) => p.id)), keepId);
  const armies = cleanArmies(env.armies, new Set(schemes.map((sc) => sc.id)), keepId);
  if (!armies) return null;
  const lists = cleanLists(env.lists, armies, keepId);
  const killteams = cleanKillteams(env.killteams, new Set(schemes.map((sc) => sc.id)), keepId);
  const battles = cleanBattles(env.battles, new Set(lists.map((l) => l.id)), keepId,
    new Set(killteams.map((k) => k.id)));
  return { schema: SCHEMA, armies, lists, killteams, paints, schemes, battles };
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    storageOK = false;
  }
  let next = null;
  if (raw) {
    try {
      next = migrate(JSON.parse(raw));
    } catch (e) {
      next = null;
    }
  }
  // Unreadable data is kept rather than overwritten: a later save would destroy
  // whatever is really in there, and the user may still be able to recover it.
  if (raw && !next) storageOK = false;
  Object.assign(db, next || empty());

  // Write the upgraded shape back at once. Migrating lazily would leave anyone
  // who opens the app and changes nothing sitting on the old schema.
  if (next && raw !== JSON.stringify(db)) save();
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    storageOK = false;
  }
}

export function replaceAll(next) {
  Object.assign(db, empty(), next, { schema: SCHEMA });
  save();
}

/** The stored model as backup JSON; photos are added by the caller. */
export function exportData(extra) {
  return JSON.stringify(Object.assign({
    schema: SCHEMA,
    armies: db.armies, lists: db.lists, killteams: db.killteams,
    paints: db.paints, schemes: db.schemes, battles: db.battles,
  }, extra || {}));
}

export const isEmpty = () =>
  !db.armies.length && !db.killteams.length && !db.paints.length && !db.schemes.length && !db.battles.length;

export function backupAt() {
  try {
    return localStorage.getItem(BACKUP_KEY);
  } catch (e) {
    return null;
  }
}

export function markBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, new Date().toISOString());
  } catch (e) { /* a failed timestamp must not fail the backup */ }
}

// ---- lookups -------------------------------------------------------------

export const army = (id) => db.armies.find((a) => a.id === id) || null;
export const list = (id) => db.lists.find((l) => l.id === id) || null;
export const paint = (id) => db.paints.find((p) => p.id === id) || null;
export const scheme = (id) => db.schemes.find((sc) => sc.id === id) || null;
export const battle = (id) => db.battles.find((b) => b.id === id) || null;
export const killteam = (id) => db.killteams.find((k) => k.id === id) || null;

/** Kill teams wearing a scheme. */
export const killteamsUsing = (schemeId) => db.killteams.filter((k) => k.schemes.includes(schemeId));

/** Painting progress across kill team operatives: one model each. */
export function opStats(ops) {
  const total = ops.length;
  const based = ops.filter((o) => o.stage === LAST).length;
  const steps = ops.reduce((n, o) => n + o.stage, 0);
  return { total, based, pct: total ? steps / (total * LAST) : 0, done: total > 0 && based === total };
}

export function armyOfUnit(unitId) {
  return db.armies.find((a) => a.units.some((u) => u.id === unitId)) || null;
}

/** Every unit, across armies, that uses a scheme. */
export function unitsUsing(schemeId) {
  const out = [];
  for (const a of db.armies) for (const u of a.units) if (u.schemes.includes(schemeId)) out.push({ army: a, unit: u });
  return out;
}

/** Paints a scheme calls for that are not on the rack yet, without repeats. */
export function missingPaints(sc) {
  const out = [];
  for (const st of sc.steps) {
    const p = paint(st.paintId);
    if (p && !p.owned && !out.includes(p)) out.push(p);
  }
  return out;
}

export function record(battles) {
  const r = { W: 0, L: 0, D: 0 };
  for (const b of battles) r[b.result]++;
  return r;
}

export function unit(id) {
  for (const a of db.armies) {
    const u = a.units.find((x) => x.id === id);
    if (u) return u;
  }
  return null;
}

export function stats(units) {
  let total = 0, based = 0, steps = 0;
  for (const u of units) {
    total += u.models.length;
    for (const s of u.models) {
      steps += s;
      if (s === LAST) based++;
    }
  }
  return { total, based, pct: total ? steps / (total * LAST) : 0, done: total > 0 && based === total };
}

export function resize(u, n) {
  const size = Math.max(1, Math.min(MAX_MODELS, n));
  while (u.models.length > size) u.models.pop();
  while (u.models.length < size) u.models.push(0);
}

export { MAX_MODELS };
