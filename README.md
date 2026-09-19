# Painting

An offline-first tracker for a Warhammer 40,000 collection: what you own, how
far through painting it you are, what it costs in points, and which lists you
can actually field.

Installed to the home screen it runs as a standalone app and works with no
connection. There is no account, no server and no sync — everything lives in
the browser on the device.

## What it does

**Collection.** Armies hold units, units hold individual models, and each model
moves through six stages: Not started → Assembled → Primed → Base colours →
Details → Based. Tap a model to advance it, or advance a whole stage group at
once.

**Points.** Give an army a faction and link a unit to its datasheet, and points
follow automatically — per unit, per army, and across the collection. The
arithmetic handles the awkward parts:

- a unit between two listed sizes pays the cost of the next size up;
- datasheets that charge more for repeat selections ("Your 3rd+ Units Cost")
  are costed in list order;
- units with no datasheet are counted as unlinked rather than silently
  contributing nothing.

**Lists.** A list is a selection over the collection with a battle size and a
detachment, so it can only contain models you actually own. Enhancements come
from the chosen detachment. Alongside the points total it shows how much of the
list is fully based and which units are still to paint — a painting queue driven
by what you intend to play.

**Backup.** Everything sits in one `localStorage` key, and browsers evict
storage from apps that go unused. The Data screen exports the collection as
JSON and restores from a paste, and the army list shows when you last took a
backup. Take one.

## Points data

`data/` holds one JSON file per faction, generated from
[BSData/wh40k-11e-mfm](https://github.com/BSData/wh40k-11e-mfm), which scrapes
the official Munitorum Field Manual. Faction files are fetched on demand and
cached, so the app does not download all 30 on install.

Refresh it with:

```sh
pip install pyyaml
python3 tools/sync-mfm.py          # clones the source and regenerates data/
```

`.github/workflows/sync-points.yml` does this daily and opens a pull request
when the values change, so points updates need only a review and a merge.

## Development

Static files, no build step. Serve the directory over HTTP — ES modules and the
service worker will not run from `file://`:

```sh
python3 -m http.server 8777
```

Icons are generated from `tools/icon-source.jpg`; run `node
tools/render-icons.mjs` to rewrite the three PNGs. The renderer crops the
artwork out of the source mock-up and re-lays it on a full-bleed square,
because iOS and Android apply their own corner mask and baked-in rounding
shows as a dark halo. iOS never updates the icon of an already-installed
home-screen app, so testing an icon change means removing it from the home
screen and re-adding it.
`node tools/render-icons.mjs` to rewrite the three PNGs.

**Bump `CACHE` in `sw.js` whenever you change the shell.** `index.html` and the
modules are served network-first so an update lands on the next launch, but the
cache name is what clears the old copies out.

## Layout

| Path | |
| --- | --- |
| `index.html` | Markup and styles for every screen |
| `js/store.js` | State, persistence, schema migration, backup |
| `js/mfm.js` | Points data loading and the costing arithmetic |
| `js/ui.js` | DOM helpers, view switching, the shared picker |
| `js/views-*.js` | Collection, lists, and backup screens |
| `sw.js` | Service worker: network-first shell, cached data |
| `tools/sync-mfm.py` | Regenerates `data/` from the Munitorum Field Manual |
| `tools/icon-source.jpg` | Source art for the app icons |
| `tools/render-icons.mjs` | Rasterises the icon source to the three PNG sizes |

Stored data is versioned (`schema`), and older backups are migrated forward on
restore, so exports taken from earlier versions stay usable.

## Disclaimer

Unofficial and unaffiliated with Games Workshop. Warhammer 40,000 and the
Munitorum Field Manual are © Games Workshop; points values are reproduced here
for personal reference.
