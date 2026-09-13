#!/usr/bin/env python3
"""Convert the BSData Munitorum Field Manual dataset into the JSON this app reads.

Source: https://github.com/BSData/wh40k-11e-mfm (MIT). Points values are
(c) Games Workshop, reformatted here for personal reference.

    python3 tools/sync-mfm.py --src /path/to/wh40k-11e-mfm

Writes data/factions.json (index) and data/<slug>.json (one per faction).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile

try:
    import yaml
except ImportError:
    sys.exit("PyYAML is required: pip install pyyaml")

SRC_REPO = "https://github.com/BSData/wh40k-11e-mfm.git"
RANGE_RE = re.compile(r"^([\[(])\s*(\d+)\s*,\s*(\d*)\s*([\])])$")


def parse_range(text):
    """'[1,2]' -> (1, 2); '[3,)' -> (3, None). Used for requisition thresholds."""
    m = RANGE_RE.match((text or "").strip())
    if not m:
        return (1, None)
    open_b, lo, hi, close_b = m.groups()
    lo = int(lo) + (1 if open_b == "(" else 0)
    if hi == "":
        return (lo, None)
    hi = int(hi) - (1 if close_b == ")" else 0)
    return (lo, hi)


def unit_json(u):
    pricing = []
    for p in u.get("pricing") or []:
        lo, hi = parse_range(p.get("range"))
        costs = sorted(
            ({"m": int(c["models"]), "p": int(c["points"])} for c in p.get("costs") or []),
            key=lambda c: c["m"],
        )
        if costs:
            pricing.append({"from": lo, "to": hi, "costs": costs})
    if not pricing:
        return None
    out = {"name": u["name"], "pricing": pricing}
    if u.get("groupTitle"):
        out["group"] = u["groupTitle"]
    # Kept for future leader-attachment work; cheap and avoids a re-sync later.
    for key, short in (("leaderTo", "leads"), ("supportTo", "supports")):
        if u.get(key):
            out[short] = list(u[key])
    return out


def faction_json(doc):
    units = [x for x in (unit_json(u) for u in doc.get("units") or []) if x]
    units.sort(key=lambda u: u["name"].lower())
    dets = []
    for d in doc.get("detachments") or []:
        dets.append({
            "name": d["name"],
            "dp": d.get("dp"),
            "enhancements": [
                {"name": e["name"], "points": int(e["points"])}
                for e in d.get("enhancements") or []
            ],
        })
    dets.sort(key=lambda d: d["name"].lower())
    return {
        "name": doc["name"],
        "slug": doc["slug"],
        "version": str(doc.get("version", "")),
        "units": units,
        "detachments": dets,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="existing checkout of wh40k-11e-mfm; cloned if omitted")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    args = ap.parse_args()

    tmp = None
    src = args.src
    if not src:
        tmp = tempfile.mkdtemp()
        src = os.path.join(tmp, "mfm")
        subprocess.run(["git", "clone", "--depth", "1", SRC_REPO, src], check=True)

    try:
        data_dir = os.path.join(src, "data")
        meta = yaml.safe_load(open(os.path.join(data_dir, "meta.yaml"), encoding="utf-8"))
        out_dir = os.path.abspath(args.out)
        os.makedirs(out_dir, exist_ok=True)

        index, total = [], 0
        for slug in meta["factions"]:
            doc = yaml.safe_load(open(os.path.join(data_dir, slug + ".yaml"), encoding="utf-8"))
            fac = faction_json(doc)
            path = os.path.join(out_dir, slug + ".json")
            blob = json.dumps(fac, separators=(",", ":"), ensure_ascii=False)
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(blob)
            total += len(blob.encode())
            index.append({"slug": slug, "name": fac["name"], "units": len(fac["units"])})
            print("%-24s %5.1f KB  %3d units  %2d detachments"
                  % (slug, len(blob.encode()) / 1024, len(fac["units"]), len(fac["detachments"])))

        index.sort(key=lambda f: f["name"].lower())
        with open(os.path.join(out_dir, "factions.json"), "w", encoding="utf-8") as fh:
            json.dump({
                "version": str(meta.get("version", "")),
                "lastUpdated": str(meta.get("lastUpdated", "")),
                "factions": index,
            }, fh, separators=(",", ":"), ensure_ascii=False)
        print("\n%d factions, %.0f KB total, MFM v%s (%s)"
              % (len(index), total / 1024, meta.get("version"), meta.get("lastUpdated")))
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
