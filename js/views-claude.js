// "Ask Claude": turn a list into a ready-made prompt to paste into Claude.
//
// Nothing is sent from the app. The prompt is copied, Claude opens, and the
// conversation happens in the Claude app the user already pays for, so there
// is no API key to manage and no per-question bill.

import * as S from "./store.js";
import * as M from "./mfm.js";
import { el, show, pick, plural } from "./ui.js";
import { costing } from "./views-lists.js";
import * as K from "./kt.js";
import { sortedBattles, resultLabel, scoreLabel, dateLabel } from "./views-games.js";

const CLAUDE_URL = "https://claude.ai/new";
const SIZE_NAMES = { 1000: "Incursion", 2000: "Strike Force", 3000: "Onslaught" };

const ASKS = [
  {
    id: "play",
    label: "How should I play this list?",
    sub: "Game plan, unit roles, deployment, turn priorities",
    question: "Give me a game plan for this list: what each unit's job is, how to deploy, " +
      "and what to prioritise turn by turn. Point out the combos and synergies I should be using.",
  },
  {
    id: "review",
    label: "Review and improve this list",
    sub: "Weaknesses, and swaps from units you own",
    question: "Review this list. What are its weaknesses, what is it missing, and what would you change " +
      "within the battle size? Where you can, suggest swaps using units I already own (listed above), " +
      "and prefer painted ones.",
  },
  {
    id: "matchup",
    label: "Matchup advice",
    sub: "How to play into a particular army",
    question: "My next game is against {opponent}. How should I approach the matchup with this list? " +
      "What are their main threats, which of my units matter most, and how should I deploy?",
  },
  {
    id: "games",
    label: "Learn from my recent games",
    sub: "Uses your battle log",
    needsGames: true,
    question: "Look at my recent games with this list (above). What patterns do you see, " +
      "what am I doing wrong, and what should I try differently next game?",
  },
  {
    id: "own",
    label: "My own question",
    sub: "Write it yourself",
    question: "[Write your question here]",
  },
];

const KT_ASKS = [
  {
    id: "play",
    label: "How should I play this kill team?",
    sub: "Roles, set-up, turning-point priorities",
    question: "Give me a game plan for this kill team: what each operative's job is, how to set up, " +
      "and what to prioritise each turning point. Point out combos between operatives and the faction rules.",
  },
  {
    id: "review",
    label: "Review this roster",
    sub: "Operative and weapon choices",
    question: "Review this roster. Are these the right operatives and weapon options? " +
      "What would you change, using the other operative types listed above? Prefer painted models.",
  },
  {
    id: "matchup",
    label: "Matchup advice",
    sub: "How to play into a particular kill team",
    question: "My next game is against {opponent}. How should I approach the matchup with this kill team? " +
      "What are their main threats, which of my operatives matter most, and how should I set up?",
  },
  {
    id: "games",
    label: "Learn from my recent games",
    sub: "Uses your battle log",
    needsGames: true,
    question: "Look at my recent games with this kill team (above). What patterns do you see, " +
      "what am I doing wrong, and what should I try differently next game?",
  },
  { id: "own", label: "My own question", sub: "Write it yourself", question: "[Write your question here]" },
];

let refresh = () => {};
let listId = null;
let ktId = null;
let back = "list-view";

export function init(onChange) {
  refresh = onChange;
  wire();
}

export function ask(id) {
  const l = S.list(id);
  if (!l) return;
  listId = id;
  ktId = null;
  back = "list-view";
  const hasGames = S.db.battles.some((b) => b.listId === id);
  pick({
    title: "Ask Claude",
    back: "list-view",
    options: ASKS.filter((a) => !a.needsGames || hasGames)
      .map((a) => ({ value: a.id, label: a.label, sub: a.sub })),
    onPick: (askId) => {
      const a = ASKS.find((x) => x.id === askId);
      if (!a) { show("list-view"); return; }
      if (a.id === "matchup") pickOpponent(a);
      else open(a, null);
    },
  });
}

async function pickOpponent(a) {
  let factions = [];
  try { factions = (await M.index()).factions; } catch (e) { /* offline: free text below */ }
  const previous = [...new Set(S.db.battles.map((b) => b.opponent).filter(Boolean))];
  const options = previous.map((n) => ({ value: n, label: n, group: "Played before" }))
    .concat(factions.map((f) => ({ value: f.name, label: f.name, group: "Factions" })));
  pick({
    title: "Opponent",
    back: "list-view",
    allowNone: true,
    noneLabel: "I’ll type it in the prompt",
    options,
    onPick: (name) => open(a, name || "[opponent's army]"),
  });
}

// ---- kill teams ------------------------------------------------------------

export function askKt(id) {
  const k = S.killteam(id);
  if (!k) return;
  ktId = id;
  listId = null;
  back = "kt-view";
  const hasGames = S.db.battles.some((b) => b.ktId === id);
  pick({
    title: "Ask Claude",
    back: "kt-view",
    options: KT_ASKS.filter((a) => !a.needsGames || hasGames)
      .map((a) => ({ value: a.id, label: a.label, sub: a.sub })),
    onPick: async (askId) => {
      const a = KT_ASKS.find((x) => x.id === askId);
      if (!a) { show("kt-view"); return; }
      if (a.id !== "matchup") { openKt(a, null); return; }
      let teams = [];
      try { teams = (await K.index()).teams; } catch (e) { /* offline: type it in */ }
      pick({
        title: "Opponent",
        back: "kt-view",
        allowNone: true,
        noneLabel: "I\u2019ll type it in the prompt",
        options: teams.map((t) => ({ value: t.name, label: t.name })),
        onPick: (name) => openKt(a, name || "[opponent's kill team]"),
      });
    },
  });
}

function openKt(a, opponent) {
  const k = S.killteam(ktId);
  if (!k) return;
  el("claude-text").value = buildKtPrompt(k, a, opponent);
  el("claude-back-label").textContent = k.name;
  el("claude-sub").textContent = a.label;
  el("claude-status").textContent = "";
  show("claude-view");
}

const wpn = (w) => w.name + " (" + [w.atk, w.hit, w.dmg].join("/") + (w.wr && w.wr !== "-" ? ", " + w.wr : "") + ")";
const oneLine = (s) => (s || "").replace(/\s*\n\s*/g, " ").trim();

/** A Kill Team prompt carries the real datacards, so Claude works from the rules, not memory. */
export function buildKtPrompt(k, a, opponent) {
  const t = K.got(k.team);
  const out = [];
  out.push("I play Warhammer 40,000: Kill Team (2024 edition). Here is my kill team.", "");
  out.push("Kill team: " + k.name + (t ? " (" + t.name + ")" : ""));
  if (t && t.rulesVersion) out.push("Rules version: " + t.rulesVersion);
  out.push("");

  if (t && t.rules.length) {
    out.push("Faction rules:");
    for (const r of t.rules) out.push("- " + r.name + ": " + oneLine(r.text));
    out.push("");
  }

  out.push("Operatives:");
  if (!k.operatives.length) out.push("- (none yet)");
  for (const o of k.operatives) {
    const type = K.opType(t, o.type);
    const label = o.name && o.name !== o.type ? o.name + " [" + o.type + "]" : o.type;
    if (!type) { out.push("- " + label); continue; }
    const ws = K.weapons(type, o.choices).map(wpn).join("; ");
    out.push("- " + label + ": APL " + type.apl + ", Move " + type.move + ", Save " + type.save +
      ", Wounds " + type.wounds + ". Weapons: " + (ws || "none") + ". " +
      (o.stage === S.LAST ? "Painted." : "Unpainted."));
    for (const ab of type.abilities.concat(type.actions)) out.push("    " + ab.name + ": " + oneLine(ab.text));
  }

  if (a.id === "review" && t) {
    const used = new Set(k.operatives.map((o) => o.type));
    const spare = t.operatives.filter((x) => !used.has(x.name)).map((x) => x.name);
    if (spare.length) out.push("", "Other operative types this team can take: " + spare.join(", ") + ".");
  }

  const games = sortedBattles(S.db.battles.filter((b) => b.ktId === k.id)).slice(0, a.id === "games" ? 10 : 5);
  if (games.length && a.id !== "own") {
    out.push("", "Recent games with this kill team:");
    for (const b of games) out.push("- " + gameLine(b));
  }

  out.push("", a.question.replace("{opponent}", opponent || "[opponent's kill team]"), "");
  out.push("Team data is from BSData's Kill Team catalogues. Ploys and equipment aren't included above. " +
    "If you're not sure of a current rule, say so rather than guessing, and tell me what to check.");
  return out.join("\n");
}

async function open(a, opponent) {
  const l = S.list(listId);
  if (!l) return;
  let mfm = null;
  try { mfm = await M.index(); } catch (e) { /* the prompt just won't cite a version */ }
  el("claude-text").value = buildPrompt(l, a, opponent, mfm);
  el("claude-back-label").textContent = l.name;
  el("claude-sub").textContent = a.label;
  el("claude-status").textContent = "";
  show("claude-view");
}

/** The prompt itself. Plain text, laid out so it reads well pasted into a chat. */
export function buildPrompt(l, a, opponent, mfm) {
  const army = S.army(l.armyId);
  const fac = army && army.faction ? M.got(army.faction) : null;
  const { entries, lines, total } = costing(l);
  const det = M.detachment(fac, l.detachment);
  const out = [];

  out.push("I play Warhammer 40,000 (11th edition). Here is my army list.", "");
  out.push("Army: " + (army ? army.name : "Unknown") + (fac ? " (" + fac.name + ")" : ""));
  out.push("List: " + l.name);
  const size = l.size ? (SIZE_NAMES[l.size] ? SIZE_NAMES[l.size] + ", " : "") + M.fmt(l.size) + " pts" : "not set";
  out.push("Battle size: " + size + ". List total: " + M.fmt(total) + " pts.");
  out.push("Detachment: " + (det ? det.name + (det.dp != null ? " (" + det.dp + " DP)" : "") : (l.detachment || "not chosen yet")));
  out.push("");

  out.push("Units:");
  if (!entries.length) out.push("- (none yet)");
  entries.forEach((r, i) => out.push("- " + unitLine(r.unit, lines[i], r.entry.enhancement)));

  if (a.id === "review" && army) {
    const inList = new Set(entries.map((r) => r.unit.id));
    const spare = army.units.filter((u) => !inList.has(u.id));
    if (spare.length) {
      out.push("", "Other units I own but haven't included:");
      for (const u of spare) {
        const c = M.cost(M.sheet(fac, u.sheet), u.models.length);
        out.push("- " + unitLine(u, c ? { points: c.points, priced: true, enh: 0 } : null, null));
      }
    }
  }

  const games = sortedBattles(S.db.battles.filter((b) => b.listId === l.id))
    .slice(0, a.id === "games" ? 10 : 5);
  if (games.length && a.id !== "own") {
    out.push("", "Recent games with this list:");
    for (const b of games) out.push("- " + gameLine(b));
  }

  out.push("", a.question.replace("{opponent}", opponent || "[opponent's army]"), "");
  out.push((mfm ? "Points are from the Munitorum Field Manual (v" + mfm.version + ", " + mfm.lastUpdated + "). " : "") +
    "If you're not sure of a current datasheet ability, stratagem or rule, say so rather than guessing, " +
    "and tell me what to check.");
  return out.join("\n");
}

function unitLine(u, line, enhancement) {
  const bits = [plural(u.models.length, "model")];
  bits.push(line && line.priced ? M.fmt(line.points - (line.enh || 0)) + " pts" : "points not set");
  if (enhancement) bits.push("enhancement: " + enhancement + (line && line.enh ? " (+" + line.enh + " pts)" : ""));
  const st = S.stats([u]);
  bits.push(st.done ? "painted" : "unpainted");
  const sheet = u.sheet && u.sheet !== u.name ? " [" + u.sheet + "]" : "";
  return u.name + sheet + ": " + bits.join(", ");
}

function gameLine(b) {
  const head = dateLabel(b.date) + ": " + resultLabel(b.result) +
    (scoreLabel(b) ? " " + scoreLabel(b) : "") +
    (b.opponent ? " vs " + b.opponent : "") +
    (b.mission ? ", " + b.mission : "") + ".";
  return [head, b.worked ? "Worked: " + b.worked : null, b.didnt ? "Didn't work: " + b.didnt : null]
    .filter(Boolean).join(" ");
}

// ---- copying -------------------------------------------------------------

function status(msg) { el("claude-status").textContent = msg; }

function copyManually() {
  const ta = el("claude-text");
  ta.focus();
  ta.select();
  try { ta.setSelectionRange(0, ta.value.length); } catch (e) { /* not selectable */ }
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  return ok;
}

function copy() {
  const text = el("claude-text").value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => copyManually());
  }
  return Promise.resolve(copyManually());
}

function wire() {
  el("claude-back").addEventListener("click", () => { refresh(); show(back); });

  el("claude-copy").addEventListener("click", async () => {
    status((await copy()) ? "Copied. Paste it into a new chat in Claude." : "Couldn’t copy automatically — select the text and copy it.");
  });

  // A real link, so opening Claude survives popup blockers; the copy starts in
  // the same tap, before the browser leaves the page.
  const link = el("claude-open");
  link.href = CLAUDE_URL;
  link.addEventListener("click", (e) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el("claude-text").value).catch(() => {});
      status("Copied — paste it into the new chat.");
      return;
    }
    e.preventDefault();
    const ok = copyManually();
    status(ok ? "Copied — paste it into the new chat." : "Copy the text above, then paste it into Claude.");
    window.open(CLAUDE_URL, "_blank", "noopener");
  });
}
