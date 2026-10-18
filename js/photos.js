// Scheme photos, kept in IndexedDB.
//
// localStorage holds a few megabytes of strings, which a handful of photos
// would exhaust, so images live in their own store keyed by scheme id. Every
// photo is shrunk on the way in: a reference shot only needs to show colours,
// not resolve brush strokes.

const DB_NAME = "painting-photos";
const STORE = "photos";
const MAX_EDGE = 1200;
const QUALITY = 0.82;

let opening = null;
const urls = new Map();

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      if (!("indexedDB" in self)) { reject(new Error("no indexedDB")); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { opening = null; throw e; });
  }
  return opening;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const available = () => open().then(() => true, () => false);

export const get = (id) => run("readonly", (s) => s.get(id));
export const keys = () => run("readonly", (s) => s.getAllKeys());

export async function put(id, blob) {
  await run("readwrite", (s) => s.put(blob, id));
  forget(id);
}

export async function remove(id) {
  await run("readwrite", (s) => s.delete(id));
  forget(id);
}

export async function clear() {
  await run("readwrite", (s) => s.clear());
  for (const id of [...urls.keys()]) forget(id);
}

function forget(id) {
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
}

/** An object URL for display, or null. Cached until the photo changes. */
export async function url(id) {
  if (urls.has(id)) return urls.get(id);
  let blob;
  try { blob = await get(id); } catch (e) { return null; }
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** Downscale a picked image to a JPEG no larger than MAX_EDGE on its long side. */
export async function shrink(file) {
  const src = await decode(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(src.image, 0, 0, w, h);
  if (src.close) src.close();
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", QUALITY));
}

async function decode(file) {
  if (self.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch (e) { /* fall back to an <img>, which every browser can decode */ }
  }
  const u = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = u;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(u);
  }
}

// ---- backup ----------------------------------------------------------------

export function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** A Blob from a backed-up data URL, or null if it isn't a plausible image. */
export function fromDataURL(s) {
  if (typeof s !== "string" || s.length > 8_000_000) return null;
  const m = DATA_URL.exec(s);
  if (!m) return null;
  let bin;
  try { bin = atob(m[2]); } catch (e) { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** Every stored photo as { schemeId: dataURL }, for the backup. */
export async function exportAll(schemeIds) {
  const out = {};
  let ids;
  try { ids = await keys(); } catch (e) { return out; }
  for (const id of ids) {
    if (!schemeIds.has(id)) continue;
    const blob = await get(id);
    if (blob) out[id] = await toDataURL(blob);
  }
  return out;
}
