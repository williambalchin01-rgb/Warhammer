// Backup and restore. Everything lives in one localStorage key, and Safari
// evicts storage from PWAs that go unused, so an export is the only thing
// between the user and silently losing the lot.

import * as S from "./store.js";
import * as P from "./photos.js";
import { el, show, plural } from "./ui.js";

let refresh = () => {};

export function init(onChange) {
  refresh = onChange;
  wire();
}

const status = (msg) => { el("data-status").textContent = msg; };

export function renderBackupNote() {
  el("backup-line").hidden = S.isEmpty();
  const when = S.backupAt();
  const d = when ? new Date(when) : null;
  el("backup-open").textContent = !d || isNaN(d.getTime())
    ? "Never backed up · back up now"
    : "Last backup " + d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export async function openData() {
  const out = el("data-out");
  out.value = "";
  el("data-in").value = "";
  el("data-copy").disabled = el("data-download").disabled = true;
  status("Preparing backup\u2026");
  show("data-view");

  // Photos are folded in so a restore brings scheme references back too.
  const photos = await P.exportAll(new Set(S.db.schemes.map((sc) => sc.id)));
  out.value = S.exportData({ photos });
  el("data-copy").disabled = el("data-download").disabled = false;
  const n = Object.keys(photos).length;
  status(S.isEmpty()
    ? "Nothing to back up yet."
    : "Copy this somewhere safe \u2014 a note, an email to yourself, a file." +
      (n ? " Includes " + plural(n, "photo") + "." : ""));
}

function copy() {
  const ta = el("data-out");
  const done = () => { status("Copied. Now paste it somewhere outside the app."); S.markBackup(); renderBackupNote(); };
  const manual = () => {
    ta.removeAttribute("readonly");
    ta.focus();
    ta.select();
    try { ta.setSelectionRange(0, ta.value.length); } catch (e) { /* not selectable */ }
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.setAttribute("readonly", "");
    if (ok) done();
    else status("Couldn’t copy automatically — the text above is selected, copy it by hand.");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done, manual);
  } else {
    manual();
  }
}

function download() {
  try {
    const url = URL.createObjectURL(new Blob([el("data-out").value], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "painting-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    S.markBackup();
    renderBackupNote();
    status("Downloaded. On iPhone, Copy is the more reliable of the two.");
  } catch (e) {
    status("Download isn’t available here — use Copy instead.");
  }
}

async function restore() {
  const raw = el("data-in").value.trim();
  if (!raw) { status("Paste a backup into the Restore box first."); return; }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    status("That isn’t valid backup data.");
    return;
  }
  const next = S.migrate(parsed);
  if (!next) { status("That isn’t a Painting backup."); return; }

  const schemeIds = new Set(next.schemes.map((sc) => sc.id));
  const photos = [];
  if (parsed && parsed.photos && typeof parsed.photos === "object") {
    for (const [id, data] of Object.entries(parsed.photos)) {
      const blob = schemeIds.has(id) ? P.fromDataURL(data) : null;
      if (blob) photos.push([id, blob]);
    }
  }

  const models = next.armies.reduce((n, a) => n + a.units.reduce((m, u) => m + u.models.length, 0), 0);
  const summary = [
    plural(next.armies.length, "army", "armies"),
    plural(models, "model"),
    next.lists.length ? plural(next.lists.length, "list") : null,
    next.schemes.length ? plural(next.schemes.length, "scheme") : null,
    next.paints.length ? plural(next.paints.length, "paint") : null,
    next.battles.length ? plural(next.battles.length, "game") : null,
    photos.length ? plural(photos.length, "photo") : null,
  ].filter(Boolean).join(", ");

  if (!confirm("Replace everything with this backup?\n\n" + summary +
               "\n\nAnything currently in the app will be lost.")) return;
  S.replaceAll(next);
  try {
    await P.clear();
    for (const [id, blob] of photos) await P.put(id, blob);
  } catch (e) {
    status("Restored, but photos couldn\u2019t be saved in this browser.");
  }
  refresh();
  show("armies-view");
}

function wire() {
  el("data-open").addEventListener("click", openData);
  el("backup-open").addEventListener("click", openData);
  el("data-close").addEventListener("click", () => { refresh(); show("armies-view"); });
  el("data-copy").addEventListener("click", copy);
  el("data-download").addEventListener("click", download);
  el("data-restore").addEventListener("click", restore);
}
