// State, persistence and schema migration.
//
// Everything the app owns lives under one localStorage key. The stored shape is
// versioned so that old backups stay restorable as the model grows.

export const STAGES = ["Not started", "Assembled", "Primed", "Base colours", "Details", "Based"];
export const LAST = STAGES.length - 1;
export const SCHEMA = 2;

const KEY = "painting.v1";
const BACKUP_KEY = "painting.v1.backup";
const MAX_MODELS = 60;

// Never reassigned, so importers always see current state.
export const db = { schema: SCHEMA, armies: [], lists: [] };

export let storageOK = true;

let uidSeq = 0;
export function uid() {
  uidSeq++;
  return Date.now().toString(36) + "-" + uidSeq.toString(36) + "-" +
    Math.floor(Math.random() * 46656).toString(36);
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Rebuild untrusted data field by field rather than trusting its shape. Ids are
// preserved where sound, because lists reference units by id.
function cleanArmies(raw) {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const seen = new Set();
  const keepId = (id) => {
    const ok = typeof id === "string" && id.length > 0 && id.length <= 64 && !seen.has(id);
    const out = ok ? id : uid();
    seen.add(out);
    return out;
  };

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
      units.push({ id: keepId(u.id), name: uname, sheet: str(u.sheet, 80) || null, models });
    }
    armies.push({ id: keepId(a.id), name, faction: str(a.faction, 40) || null, units });
  }
  return armies;
}

function cleanLists(raw, armies) {
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
      .map((e) => ({ id: uid(), unitId: e.unitId, enhancement: str(e.enhancement, 80) || null }));
    lists.push({
      id: uid(),
      armyId: l.armyId,
      name,
      size,
      detachment: str(l.detachment, 80) || null,
      entries,
    });
  }
  return lists;
}

// Accepts any shape the app has ever written: a bare array (schema 1) or the
// versioned envelope. Returns null if it isn't ours.
export function migrate(raw) {
  const env = Array.isArray(raw) ? { schema: 1, armies: raw, lists: [] } : raw;
  if (!env || typeof env !== "object") return null;
  const armies = cleanArmies(env.armies);
  if (!armies) return null;
  return { schema: SCHEMA, armies, lists: cleanLists(env.lists, armies) };
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
  Object.assign(db, next || { schema: SCHEMA, armies: [], lists: [] });

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
  db.schema = SCHEMA;
  db.armies = next.armies;
  db.lists = next.lists;
  save();
}

export function exportJSON() {
  return JSON.stringify({ schema: SCHEMA, armies: db.armies, lists: db.lists });
}

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
