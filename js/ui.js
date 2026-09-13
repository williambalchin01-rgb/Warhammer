// Shared DOM helpers, view switching, and the one reusable picker screen.

export const el = (id) => document.getElementById(id);

export const VIEWS = [
  "armies-view", "units-view", "unit-view",
  "lists-view", "list-view",
  "add-army-view", "add-unit-view", "add-list-view",
  "picker-view", "data-view",
];

let current = "armies-view";
export const currentView = () => current;

export function show(name) {
  current = name;
  for (const v of VIEWS) el(v).hidden = v !== name;
  el("tabs").hidden = !(name === "armies-view" || name === "lists-view");
  window.scrollTo(0, 0);
}

export function clear(node) {
  node.textContent = "";
  return node;
}

export function make(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** A tappable row with a name, a sub-line, and an optional progress bar. */
export function row({ name, sub, pct, complete, onOpen, onDelete, badge }) {
  const li = make("li", "row");
  const main = make("button", "row-main");

  const head = make("div", "row-head");
  head.appendChild(make("div", "row-name", name));
  if (badge != null) head.appendChild(make("div", "row-badge", badge));
  main.appendChild(head);

  if (sub) main.appendChild(make("div", "row-sub", sub));

  if (pct != null) {
    const track = make("div", "track");
    const fill = make("div", "fill");
    fill.style.width = Math.round(pct * 100) + "%";
    if (complete) fill.dataset.complete = "true";
    track.appendChild(fill);
    main.appendChild(track);
  }

  main.addEventListener("click", onOpen);
  li.appendChild(main);

  if (onDelete) {
    const d = make("button", "delete", "×");
    d.setAttribute("aria-label", "Delete " + name);
    d.addEventListener("click", onDelete);
    li.appendChild(d);
  } else {
    li.appendChild(make("span", "chev", "›"));
  }
  return li;
}

export function empty(node, message, actionLabel, onAction) {
  clear(node);
  node.appendChild(make("p", null, message));
  if (actionLabel) {
    const b = make("button", null, actionLabel);
    b.addEventListener("click", onAction);
    node.appendChild(b);
  }
}

// ---- picker --------------------------------------------------------------

let pickState = null;

/**
 * One searchable full-screen chooser, shared by every "pick a thing" flow.
 * options: [{ value, label, sub, group }]. onPick receives the value, or null
 * when the user clears the current choice.
 */
export function pick({ title, options, current: chosen, allowNone, noneLabel, back, onPick }) {
  pickState = { options, chosen, allowNone, noneLabel, back, onPick };
  el("picker-title").textContent = title;
  el("picker-search").value = "";
  el("picker-search").placeholder = "Search " + title.toLowerCase();
  renderPicker("");
  show("picker-view");
  el("picker-search").focus({ preventScroll: true });
}

function renderPicker(query) {
  const { options, chosen, allowNone, noneLabel, onPick } = pickState;
  const rows = clear(el("picker-rows"));
  const q = query.trim().toLowerCase();

  // Rank an exact name, then a prefix, then a word start, above a match buried
  // mid-string — otherwise "space marines" offers Chaos Space Marines first.
  const score = (o) => {
    const label = o.label.toLowerCase();
    if (label === q) return 0;
    if (label.startsWith(q)) return 1;
    if (new RegExp("\\b" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(label)) return 2;
    if (label.includes(q)) return 3;
    return 4;
  };
  const hits = q
    ? options
        .map((o, i) => ({ o, i, s: score(o) }))
        .filter((x) => x.s < 4 || (x.o.sub || "").toLowerCase().includes(q))
        .sort((a, b) => a.s - b.s || a.i - b.i)
        .map((x) => x.o)
    : options;

  if (allowNone && !q) {
    const li = make("li", "row");
    const b = make("button", "row-main");
    b.appendChild(make("div", "row-name", noneLabel || "None"));
    if (chosen == null) b.appendChild(make("div", "row-sub", "Current"));
    b.addEventListener("click", () => onPick(null));
    li.appendChild(b);
    rows.appendChild(li);
  }

  let group = null;
  for (const o of hits.slice(0, 400)) {
    if (!q && o.group && o.group !== group) {
      group = o.group;
      rows.appendChild(make("li", "group", group));
    }
    const li = make("li", "row");
    const b = make("button", "row-main");
    const head = make("div", "row-head");
    head.appendChild(make("div", "row-name", o.label));
    if (o.badge) head.appendChild(make("div", "row-badge", o.badge));
    b.appendChild(head);
    if (o.sub) b.appendChild(make("div", "row-sub", o.sub));
    if (o.value === chosen) b.appendChild(make("div", "row-sub", "Current"));
    b.addEventListener("click", () => onPick(o.value));
    li.appendChild(b);
    rows.appendChild(li);
  }

  el("picker-empty").hidden = hits.length > 0;
}

export function initPicker() {
  el("picker-search").addEventListener("input", (e) => renderPicker(e.target.value));
  el("picker-back").addEventListener("click", () => {
    if (pickState) show(pickState.back);
  });
}

// ---- misc ----------------------------------------------------------------

export const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

export function toast(node, message) {
  node.textContent = message;
}
