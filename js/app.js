// Entry point: load state, warm the faction data it needs, wire the views.

// Shown on the Data screen. Bump it with any deploy worth telling apart, so a
// stale install can be spotted without guessing.
const APP_VERSION = "2026-10-18b";

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, initPicker } from "./ui.js";
import * as C from "./views-collection.js";
import * as L from "./views-lists.js";
import * as D from "./views-data.js";
import * as PV from "./views-paints.js";
import * as G from "./views-games.js";
import * as Q from "./views-claude.js";
import * as K from "./kt.js";
import * as KV from "./views-kt.js";

const TABS = [
  ["tab-collection", "armies-view"],
  ["tab-lists", "lists-view"],
  ["tab-paints", "paints-view"],
  ["tab-games", "games-view"],
];

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
  PV.renderPaints();
  PV.renderScheme();
  PV.renderRack();
  PV.renderShop();
  KV.renderKillteam();
  KV.renderOperative();
  G.renderGames();
  D.renderBackupNote();
  el("note").hidden = S.storageOK;
}

function tab(name) {
  for (const [id, view] of TABS) el(id).setAttribute("aria-pressed", String(view === name));
  show(name);
}

async function start() {
  S.load();

  // Warm every faction the collection references so the views can cost units
  // synchronously. Missing data degrades to "no points", never to a crash.
  await M.ensure(S.db.armies.map((a) => a.faction));
  await K.ensure(S.db.killteams.map((k) => k.team));

  C.init(refresh);
  L.init(refresh);
  D.init(refresh);
  PV.init(refresh, (unitId) => C.openUnitById(unitId), (id) => KV.openKillteam(id));
  KV.init(refresh, {
    openScheme: PV.openScheme, newScheme: PV.newScheme,
    askClaude: Q.askKt, logGame: G.logGame,
  });
  G.init(refresh);
  Q.init(refresh);
  initPicker();

  // Cross-screen jumps go through here so the view modules don't import each other.
  C.onSchemes(PV.openScheme, PV.newScheme);
  L.onJumpToUnit((u) => C.openUnitById(u.id));
  L.onListActions(Q.ask, G.logGame);
  C.onKillteams({ rows: KV.renderKillteamRows, create: KV.newKillteam, remove: KV.deleteKillteam });

  for (const [id, view] of TABS) el(id).addEventListener("click", () => tab(view));

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
