# Painting

An offline-first tracker for a Warhammer 40,000 collection: what you own, how
far through painting it you are, how you paint it, what it costs in points,
which lists you can actually field, and how your games went.

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

**Kill teams.** A kill team is a roster and the models in it at once. Pick a
team, add operatives, choose their weapon options, and each one gets its
datacard: stats, weapon profiles, abilities, unique actions, and what each
weapon rule means. Every operative has its own painting stage, the team wears
paint schemes as a whole, and the roster warns (never blocks) on a missing
leader, the wrong number of operatives or too many of one type. Data comes
from [BSData/wh40k-killteam](https://github.com/BSData/wh40k-killteam), which
covers operatives, weapons, faction rules and equipment but mostly not ploys.

**Paint schemes.** A scheme is a reusable recipe ("Ultramarines armour"):
ordered steps, each with a stage (base, shade, layer, highlight…), a paint, the
area it goes on and a note, plus a reference photo of a finished model. Link a
scheme to every unit that wears it and the recipe is one tap from the unit
you're painting, which is what keeps an army consistent when it's painted over
months. The **paint rack** holds the paints you own in any brand; a paint you
don't own yet lands on the **shopping list**, along with which schemes need it.

**Battle log.** Date, result, score, opponent, mission, and, the useful part,
what worked and what didn't. Each list shows its record.

**Ask Claude.** From any list or kill team, pick a question (game plan, list review,
matchup, learn from my games, or your own) and the app builds a prompt from the
list, detachment, points, painted state, spare units and recent games. It's
copied and Claude opens. Kill Team prompts carry the full datacards and faction
rules, so the advice works from the actual rules; you paste it into a new chat. Nothing is sent from the
app, so there's no API key and no extra cost. The prompt asks Claude to say
when it isn't sure of a current rule rather than guess.

**Backup.** The main data sits in one `localStorage` key and photos in
IndexedDB, and browsers evict
storage from apps that go unused. The Data screen exports everything, photos
included, as JSON and restores from a paste, and the army list shows when you last took a
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

## Kill Team data

`data/kt/` holds one JSON file per kill team plus `index.json` and `rules.json`
(weapon rules and universal equipment), generated from the BattleScribe
catalogues:

```sh
python3 tools/sync-killteam.py     # clones the source and regenerates data/kt/
```

The same daily workflow refreshes it alongside the points.

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

Tests run in a real browser through Playwright and live in `tests/`:

```sh
npm test    # points arithmetic, end-to-end app flows, service worker updates
```

The test server serves modified files from memory when a test needs them, so
a test run never edits the working tree.

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
| `js/kt.js` | Kill Team data loading, weapons, composition checks |
| `js/photos.js` | Scheme photos in IndexedDB, downscaled on the way in |
| `js/views-*.js` | Collection, lists, paints, games, Ask Claude, backup |
| `tests/` | Browser and unit tests (`npm test`) |
| `sw.js` | Service worker: network-first shell, cached data |
| `tools/sync-mfm.py` | Regenerates `data/` from the Munitorum Field Manual |
| `tools/sync-killteam.py` | Regenerates `data/kt/` from the BSData Kill Team catalogues |
| `tools/icon-source.jpg` | Source art for the app icons |
| `tools/render-icons.mjs` | Rasterises the icon source to the three PNG sizes |

Stored data is versioned (`schema`), and older backups are migrated forward on
restore, so exports taken from earlier versions stay usable.

## Disclaimer

Unofficial and unaffiliated with Games Workshop. Warhammer 40,000 and the
Munitorum Field Manual are © Games Workshop; points values are reproduced here
for personal reference.
