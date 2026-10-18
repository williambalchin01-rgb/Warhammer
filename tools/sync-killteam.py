#!/usr/bin/env python3
"""Convert the BSData Kill Team (2024) catalogues into the JSON this app reads.

Source: https://github.com/BSData/wh40k-killteam (BattleScribe XML). Rules
content is (c) Games Workshop, reformatted here for personal reference.

    python3 tools/sync-killteam.py --src /path/to/wh40k-killteam

Writes data/kt/index.json, data/kt/rules.json (weapon rules and universal
equipment) and data/kt/<team>.json, one per kill team.

BattleScribe data is a graph: operatives link to shared weapons, profiles and
option groups by id, sometimes across files. Every element with an id from the
game system and every 2024 catalogue goes into one index so links resolve
wherever they point.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys, tempfile
import xml.etree.ElementTree as ET

SRC_REPO = "https://github.com/BSData/wh40k-killteam.git"
PREFIX = "2024 - "
SKIP = {"Non-player Operatives"}   # opponents' NPOs, not a team you build
STANDARD = {"Operative", "Weapons", "Equipment", "Abilities", "Unique Actions", "Psychic Power"}


def local(tag):
    return tag.split("}", 1)[-1]


def kids(el, name):
    """Direct children named `name`, ignoring the namespace."""
    return [c for c in el if local(c.tag) == name]


def section(el, name):
    """Children of the first direct child called `name` (e.g. <profiles>)."""
    for c in el:
        if local(c.tag) == name:
            return list(c)
    return []


def hidden(el):
    return el.get("hidden") == "true"


def clean(t):
    """Plain text: BSData uses *markdown* emphasis, which would show literally."""
    t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t or "")
    t = re.sub(r"\*([^*\n]+)\*", r"\1", t)
    return re.sub(r"[ \t]+\n", "\n", t.strip())


def text_of(el):
    return clean(el.text or "")


class Index:
    def __init__(self):
        self.by_id = {}

    def add_tree(self, root):
        for el in root.iter():
            i = el.get("id")
            if i and i not in self.by_id:
                self.by_id[i] = el

    def get(self, i):
        return self.by_id.get(i)


def chars(profile):
    out = {}
    for c in section(profile, "characteristics"):
        out[c.get("name")] = text_of(c)
    return out


def profiles(el, idx, type_name):
    """Profiles of a type on an entry: its own, plus any reached by infoLink."""
    found = []
    for p in section(el, "profiles"):
        if p.get("typeName") == type_name and not hidden(p):
            found.append(p)
    for link in section(el, "infoLinks"):
        if link.get("type") == "profile" and not hidden(link):
            p = idx.get(link.get("targetId"))
            if p is not None and p.get("typeName") == type_name:
                found.append(p)
    return found


def resolve(el, idx):
    """An entryLink stands for the entry it targets; anything else is itself."""
    if local(el.tag) == "entryLink":
        if hidden(el):
            return None
        return idx.get(el.get("targetId"))
    return None if hidden(el) else el


def child_entries(el, idx):
    """Selection entries directly under `el`, links resolved, groups excluded."""
    out = []
    for c in section(el, "selectionEntries") + section(el, "entryLinks"):
        r = resolve(c, idx)
        if r is not None and local(r.tag) == "selectionEntry":
            out.append(r)
    return out


def child_groups(el, idx):
    out = []
    for c in section(el, "selectionEntryGroups"):
        if not hidden(c):
            out.append(c)
    for c in section(el, "entryLinks"):
        r = resolve(c, idx)
        if r is not None and local(r.tag) == "selectionEntryGroup":
            out.append(r)
    return out


def weapon(p):
    c = chars(p)
    raw = p.get("name", "").strip()
    kind = "ranged" if raw.startswith("⌖") else "melee" if raw.startswith("⚔") else None
    name = re.sub(r"^[⌖⚔\s]+", "", raw)
    w = {"name": name, "atk": c.get("ATK", ""), "hit": c.get("HIT", ""), "dmg": c.get("DMG", ""), "wr": c.get("WR", "")}
    if kind:
        w["kind"] = kind
    return w


def weapons_under(el, idx, seen=None, depth=0):
    """Every weapon profile reachable from an entry, through entries and groups."""
    seen = set() if seen is None else seen
    out = []
    if depth > 8 or id(el) in seen:
        return out
    seen.add(id(el))
    for p in profiles(el, idx, "Weapons"):
        out.append(weapon(p))
    for e in child_entries(el, idx):
        out += weapons_under(e, idx, seen, depth + 1)
    for g in child_groups(el, idx):
        out += weapons_under(g, idx, seen, depth + 1)
    return out


def unique(ws):
    seen, out = set(), []
    for w in ws:
        key = (w["name"], w["atk"], w["hit"], w["dmg"], w["wr"])
        if key not in seen:
            seen.add(key)
            out.append(w)
    return out


def constraint(el, kind, scope=None):
    for c in section(el, "constraints"):
        if c.get("type") == kind and c.get("field") == "selections" and (scope is None or c.get("scope") == scope):
            try:
                return int(float(c.get("value")))
            except (TypeError, ValueError):
                return None
    return None


def named(ps):
    out = []
    for p in ps:
        c = chars(p)
        body = next(iter(c.values()), "") if c else ""
        out.append({"name": p.get("name", "").strip(), "text": body})
    return out


def operative(entry, idx, force_ids, link=None):
    stats_p = profiles(entry, idx, "Operative")
    if not stats_p:
        return None
    c = chars(stats_p[0])
    cats = [l.get("name") for l in section(entry, "categoryLinks") if not hidden(l)]

    # Fixed kit: weapons on the entry itself and on its direct sub-entries.
    fixed = []
    for p in profiles(entry, idx, "Weapons"):
        fixed.append(weapon(p))
    for e in child_entries(entry, idx):
        fixed += weapons_under(e, idx)

    options = []
    for g in child_groups(entry, idx):
        choices = []
        members = child_entries(g, idx)
        for sub in child_groups(g, idx):
            members += child_entries(sub, idx)
        for e in members:
            ws = unique(weapons_under(e, idx))
            choices.append({"name": e.get("name", "").strip(), "weapons": ws})
        if choices:
            options.append({
                "name": g.get("name", "").strip(),
                "min": constraint(g, "min"),
                "max": constraint(g, "max"),
                "choices": choices,
            })

    # A roster limit may sit on the link that brings the operative in, or on
    # the operative itself.
    max_count = None
    for holder in ([link] if link is not None else []) + [entry]:
        for fid in force_ids:
            m = constraint(holder, "max", fid)
            if m is not None:
                max_count = m
                break
        if max_count is not None:
            break

    op = {
        "name": entry.get("name", "").strip(),
        "apl": c.get("APL", ""), "move": c.get("Move", ""), "save": c.get("Save", ""), "wounds": c.get("Wounds", ""),
        "keywords": cats,
        "leader": "Leader" in cats,
        "weapons": unique(fixed),
        "options": options,
        "abilities": named(profiles(entry, idx, "Abilities")),
        "actions": named(profiles(entry, idx, "Unique Actions")),
    }
    psychic = named(profiles(entry, idx, "Psychic Power"))
    if psychic:
        op["psychic"] = psychic
    if max_count is not None:
        op["max"] = max_count
    return op


def equipment_in(el, idx):
    out, seen = [], set()
    for p in el.iter():
        if local(p.tag) == "profile" and p.get("typeName") == "Equipment" and not hidden(p):
            name = p.get("name", "").strip()
            if name not in seen:
                seen.add(name)
                out.append({"name": name, "text": next(iter(chars(p).values()), "")})
    return out


def team(cat, idx):
    forces = [f for f in section(cat, "forceEntries") if not hidden(f)]
    force_ids = [f.get("id") for f in forces]
    comp = {}
    if forces:
        f = forces[0]
        for link in section(f, "categoryLinks"):
            name = link.get("name")
            lo, hi = constraint(link, "min"), constraint(link, "max")
            if name in ("Operative", "Leader") and (lo is not None or hi is not None):
                comp[name.lower()] = {"min": lo, "max": hi}
        lo, hi = constraint(f, "min"), constraint(f, "max")
        if "operative" not in comp and (lo is not None or hi is not None):
            comp["operative"] = {"min": lo, "max": hi}

    # Operatives are either defined at the top level or shared and pulled in by
    # a top-level link. The same operative can be linked more than once.
    ops, seen = [], {}
    tops = [(e, None) for e in section(cat, "selectionEntries") if local(e.tag) == "selectionEntry"]
    for link in section(cat, "entryLinks"):
        target = resolve(link, idx)
        if target is not None and local(target.tag) == "selectionEntry":
            tops.append((target, link))
    reference = []
    for e, link in tops:
        if hidden(e):
            continue
        if e.get("type") == "model":
            op = operative(e, idx, force_ids, link)
            if not op:
                continue
            key = e.get("id") or op["name"]
            if key in seen:
                prev = seen[key]
                if op.get("max") is not None and (prev.get("max") is None or op["max"] > prev["max"]):
                    prev["max"] = op["max"]
                continue
            seen[key] = op
            ops.append(op)
        elif "Reference" in e.get("name", "") and e.get("name") != "Equipment Reference":
            reference += reference_in(e)

    rules = []
    for r in section(cat, "rules"):
        if hidden(r):
            continue
        d = kids(r, "description")
        rules.append({"name": r.get("name", "").strip(), "text": text_of(d[0]) if d else ""})

    equip = []
    for link in section(cat, "entryLinks"):
        equip += equipment_in(link, idx)

    name = cat.get("name", "").strip()
    comment = kids(cat, "comment")
    return {
        "name": name,
        "slug": slugify(name),
        "revision": cat.get("revision", ""),
        "rulesVersion": text_of(comment[0]) if comment else "",
        "composition": comp,
        "rules": rules,
        "operatives": ops,
        "reference": reference,
        "equipment": equip,
    }


def reference_in(el):
    """Team-specific reference profiles (orders, techniques, ploys and the like)."""
    out, seen = [], set()
    for p in el.iter():
        if local(p.tag) != "profile" or hidden(p) or p.get("typeName") in STANDARD:
            continue
        key = (p.get("typeName"), p.get("name"))
        if key in seen:
            continue
        seen.add(key)
        c = chars(p)
        out.append({"type": p.get("typeName", ""), "name": p.get("name", "").strip(),
                    "text": "\n".join(v for v in c.values() if v)})
    return out


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="existing checkout of wh40k-killteam; cloned if omitted")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data", "kt"))
    args = ap.parse_args()

    tmp = None
    src = args.src
    if not src:
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "kt")
        subprocess.run(["git", "clone", "--depth", "1", SRC_REPO, src], check=True)

    try:
        gst_path = os.path.join(src, PREFIX + "Kill Team.gst")
        gst = ET.parse(gst_path).getroot()
        cats = []
        for path in sorted(glob.glob(os.path.join(src, PREFIX + "*.cat"))):
            cats.append(ET.parse(path).getroot())

        idx = Index()
        idx.add_tree(gst)
        for c in cats:
            idx.add_tree(c)

        out_dir = os.path.abspath(args.out)
        os.makedirs(out_dir, exist_ok=True)
        for old in glob.glob(os.path.join(out_dir, "*.json")):
            os.remove(old)

        index, problems, total = [], [], 0
        for c in cats:
            if c.get("library") == "true" or c.get("name", "").strip() in SKIP:
                continue
            t = team(c, idx)
            if not t["operatives"]:
                problems.append(t["name"] + ": no operatives found")
                continue
            for op in t["operatives"]:
                if not (op["weapons"] or any(o["choices"] for o in op["options"])):
                    problems.append(t["name"] + " / " + op["name"] + ": no weapons")
            blob = json.dumps(t, separators=(",", ":"), ensure_ascii=False)
            with open(os.path.join(out_dir, t["slug"] + ".json"), "w", encoding="utf-8") as fh:
                fh.write(blob)
            total += len(blob.encode())
            index.append({
                "slug": t["slug"], "name": t["name"],
                "operatives": len(t["operatives"]), "rulesVersion": t["rulesVersion"],
            })
            refs = sorted({r["type"] for r in t["reference"]})
            print("%-28s %5.1f KB  %2d operatives  %-12s %s"
                  % (t["name"], len(blob.encode()) / 1024, len(t["operatives"]), t["rulesVersion"],
                     ("ref: " + ", ".join(refs)) if refs else ""))

        weapon_rules = []
        for r in gst.iter():
            if local(r.tag) == "rule" and not hidden(r) and r.get("name"):
                d = kids(r, "description")
                weapon_rules.append({"name": r.get("name").strip(), "text": text_of(d[0]) if d else ""})
        rules = {"weaponRules": weapon_rules, "equipment": equipment_in(gst, idx)}
        with open(os.path.join(out_dir, "rules.json"), "w", encoding="utf-8") as fh:
            json.dump(rules, fh, separators=(",", ":"), ensure_ascii=False)

        index.sort(key=lambda t: t["name"].lower())
        with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as fh:
            json.dump({"revision": gst.get("revision", ""), "teams": index}, fh, separators=(",", ":"), ensure_ascii=False)

        print("\n%d teams, %.0f KB, game system revision %s; %d weapon rules, %d universal equipment"
              % (len(index), total / 1024, gst.get("revision"), len(weapon_rules), len(rules["equipment"])))
        if problems:
            print("\nCheck these (%d):" % len(problems))
            for p in problems:
                print("  " + p)
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
