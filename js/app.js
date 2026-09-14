// Entry point: load state, warm the faction data it needs, wire the views.

// Shown on the Data screen. Bump it with any deploy worth telling apart, so a
// stale install can be spotted without guessing.
const APP_VERSION = "2026-09-14b";

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, initPicker } from "./ui.js";
import * as C from "./views-collection.js";
import * as L from "./views-lists.js";
import * as D from "./views-data.js";

/**
 * Re-render every screen, not just the visible one. Edits are committed from a
 * form view and then navigate back, so whatever is behind must already be up to
 * date by the time it is shown. Each render is a no-op when its subject is gone.
 */
function refresh() {
  C.renderArmies();
  C.renderUnits();
  C.renderUnit();
  L.renderLists();
  L.renderList();
  D.renderBackupNote();
  el("note").hidden = S.storageOK;
}

function tab(name) {
  el("tab-collection").setAttribute("aria-pressed", String(name === "armies-view"));
  el("tab-lists").setAttribute("aria-pressed", String(name === "lists-view"));
  show(name);
}

async function start() {
  S.load();

  // Warm every faction the collection references so the views can cost units
  // synchronously. Missing data degrades to "no points", never to a crash.
  await M.ensure(S.db.armies.map((a) => a.faction));

  C.init(refresh);
  L.init(refresh);
  D.init(refresh);
  initPicker();

  L.onJumpToUnit((u) => {
    for (const a of S.db.armies) {
      if (a.units.some((x) => x.id === u.id)) {
        C.openArmy(a.id);
        break;
      }
    }
  });

  el("tab-collection").addEventListener("click", () => tab("armies-view"));
  el("tab-lists").addEventListener("click", () => tab("lists-view"));

  refresh();
  tab("armies-view");

  const stamp = (points) => {
    el("data-version").textContent = "App " + APP_VERSION + " \u00B7 " + points;
  };
  stamp("checking points data\u2026");
  M.index()
    .then((idx) => stamp("MFM v" + idx.version + " (" + idx.lastUpdated + ")"))
    .catch(() => stamp("points data unavailable offline"));
}

start();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
