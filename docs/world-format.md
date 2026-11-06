# World format

A baked world is `data/worlds/<id>/`, produced offline by `tools/bake/` from its config `tools/bake/worlds/<id>.json` (see "Bake config"). `data/worlds/index.json` lists the baked worlds for the vote (see "index.json"). It follows "Contratto 2: dati del mondo" of `docs/specs/2026-10-27-summit-descent-design.md`, short mode: **stages at real scale 1:1** (decision of 27/10/2026), each a contract-2 world of its own. Fields marked *addition* are extra and optional for readers.

## Files

| File | Content |
|---|---|
| `world.json` | metadata, the stages (course, branches, zones, spawns), backdrop, places |
| `stage-<k>.bin` | gameplay grid of stage `k`: Float32 little endian, row by row (`z` rows, `x` columns), `w*h` heights in metres, local frame |
| `backdrop.bin` | scenery grid of the whole route, same layout, coarse, global frame |
| `../index.json` | one per `data/worlds/`: every baked world with its display names, summit, finish and race time, in game order |

Dolomiti: `world.json` 0.05 MB, four stage grids of 0.4 to 0.8 MB (about 230 x 500 to 530 x 370 nodes at 4 m), `backdrop.bin` 0.42 MB (330 x 320 at 60 m).

## Coordinates

Metres, `y` up, `x` east, `z` south (north is `-z`). Plan and height are 1:1 with the real ground: no rescaling, no rotation.

| Frame | Origin | `y` |
|---|---|---|
| global (backdrop, `stage.offset`) | the summit, `world.frame` (lat, lon) | real altitude above the sea (`seaLevel` 0) |
| stage local (everything inside a stage) | the stage start, `course[0] = (0, 0, 0)` | metres above the start bed, so mostly negative |

`global = local + stage.offset` (a pure translation). `src/world/sample.js` has `toGlobal(stage, p)` and `toLocal(stage, p)`. Lon/lat: `localFrame(world.frame.lat, world.frame.lon)` of `tools/bake/dem.mjs` (equirectangular at the summit).

## Loading and sampling

| Function | Use |
|---|---|
| `loadWorld(id, opts)` | `{ json, backdrop, stages: [{ json, height }] }`. Browser: fetches `<opts.base or 'data/worlds'>/<id>/`; node: reads `<opts.dir or 'data/worlds'>/<id>/`. `opts.stages`: `false` loads no stage grid, or an array of indices |
| `loadStage(id, worldJson, k, opts)` | one stage `{ json, height }`, for loading the next stage during the cloud transition |
| `createSim(world.stages[k], { final, carry })` | the sim plays one stage (`src/sim/index.js`); passing the whole world throws |
| `bilinear(meta, data, x, z)` | one grid; `meta` is `stage.height` or `world.backdrop`. Same as `web-swing/tools/dem-lib.mjs` and `src/sim/world-access.js` (a test checks they agree) |
| `makeSampler(meta, data)` | `{ heightAt(x, z), inside(x, z) }` |
| `makeGround(world, k)` | ground of stage `k` in its local frame: the stage grid where it covers the point, the backdrop (shifted) elsewhere |

## world.json

| Field | Type | Meaning |
|---|---|---|
| `id`, `name`, `mode` | string | `dolomiti`, `Dolomiti, Monte Peralba`, `short` |
| `seaLevel` | number | 0, in the global frame |
| `stages` | array | the stages in river order, see below |
| `backdrop` | `{file, w, h, x0, z0, step}` | global grid, `step` 60 m, covers every stage grid +-6 km; inside a stage grid it equals that grid (+ offset) |
| `length`, `pointStep` | number | *addition*: total played length (m), course point spacing (m) |
| `floor` | `{riverKm, altitude, slope, window}` | *addition*: the valley floor where the bake stopped |
| `frame` | `{lat, lon}` | *addition*: origin of the global frame (the summit), full precision |
| `look` | object | *addition*: the real landscape for the renderer, see "look" |
| `places` | array | *addition*, see below |
| `source` | object | *addition*: data sources, licences, summit |

### stages

Each stage has every field of a contract-2 world, in its local frame, plus a few of its own.

| Field | Meaning |
|---|---|
| `id` | `summit`, `sesis`, `sesis-2`, `acquatona` (landmark id, numbered when a landmark has two stages) |
| `name`, `labels` | real name in Italian; `labels.{it,en}` *addition* for the i18n layer |
| `biome`, `palette` | `alpine`, `subalpine`, `montane`, `gorge`; suggested palette keys (`snow`, `scree`, `larch`, `limestone`, ...) |
| `origin` | `{lat, lon, alt}`: real position and bed altitude of `course[0]` |
| `offset` | `{x, y, z}`: `course[0]` in the global frame (`y = origin.alt`) |
| `realKm` | *addition*: window on the real river, km from the OSM source (negative on the summit path) |
| `altitude` | *addition*: real bed altitude `[min, max]` |
| `length`, `pointStep` | *addition*: course length (m), point spacing (m) |
| `heading` | *addition*: mean downhill direction of the stage, degrees clockwise from north (north is `-z`, east `+x`), 0.1 deg: the chord from `course[0]` to the finish, which is the mean of the course directions (points are evenly spaced). The renderer centres the painted backdrop on it (`src/render/paint.js`, `stageHeading`) |
| `height` | `{file, w, h, x0, z0, step, min, max}`: stage grid, `step` 4 m, course and branches +-250 m |
| `course` | `[{x, y, z, hw}]`: bed centre line every 10 m, `y` the bed, `hw` the bed half width |
| `branches` | `[{from, to, kind, points, waterfall?}]`, indices into this stage's course |
| `checkpoints` | `[index]`, every ~600 m, first is 0, never strictly inside a branch |
| `zones` | `[{kind, from, to, branch?, glacier?, icefall?}]`; `glacier` (*addition*) names the OSM glacier an `ice` zone lies on, `icefall: true` when OSM tags it so |
| `spawns` | `{start, water, animals, obstacles}`, all `y` sampled on the stage grid |
| `finish` | last course point; the drop evaporates there and the cloud carries it to the next stage |

Guarantees (checked by `test/bake.test.mjs`):

| Rule | Value |
|---|---|
| length | 6-8 km in all, 1-2 km per stage |
| descent | `course[i].y < course[i-1].y` in every stage; each stage starts below where the previous ended |
| real scale | course length equals the real distance (0.5 %); away from the bed the grid is the real DEM (median under 1.5 m, blurred 10 m) |
| real bed | the bed is the lowest real ground across it, at most 1.5 m above it, carved deeper only through bumps of the surface model |
| flow | no flat run (under 0.5 %) longer than 60 m, no cliff steps beyond 4x the stage mean slope |
| valley floor | every stage lies above `floor`; nothing past it is played |
| bed in the grid | grid sampled at `course[i]` equals `course[i].y` (0.3 m, 0.6 m on slopes over 10 %); branches 0.5 m |
| channel | grid at +-0.95 `hw` is not below the bed (outside the forks) |
| bends | radius at least 1.5 `hw`; the course never comes back next to itself |
| bed `hw` | 12 to 30 m |
| branches | first point on `course[from]`, last on `course[to]`, `y` never climbs |
| determinism | two bakes give the same bytes, and the committed world matches a fresh bake |
| playable | two bots finish every stage in the real sim, chained with `carry` |

### branches

| Field | Meaning |
|---|---|
| `kind` | `shortcut`: shorter, narrow (`hw` 9), with a waterfall; `safe`: longer, wide (`hw` 22), around the outside, while the main arm next to it has rocks |
| `points` | `[{x, y, z, hw}]` every ~10 m, endpoints included |
| `waterfall` | *addition*, shortcut only: `{at, drop}`, the fall (8-30 m) is between `points[at]` and `points[at+1]` |

The shortcut goes in the first stage that has a bend with room for it (gorges first); the safe arm where the real ground needs the least cutting. Dolomiti: shortcut in Bassa Val Sesis (27 m waterfall), safe arm in Alta Val Sesis. The Acquatona gorge is too straight for a shortcut at this smoothing.

### zones

| kind | Where |
|---|---|
| `ice` | the part of a stage whose real bed is above `iceAbove` (Dolomiti 1900 m: the summit snowfield), and, on worlds with `osm.glaciers`, every run of 5+ course points inside an OSM glacier outline (glaciers, icefalls) |
| `waterfall` | the shortcut range; `branch` is the branch index |
| `sun` | the highest stage without other zones (open alpine valley) |
| `rain` | the middle 80 % of the next one |

### spawns

| Field | Meaning |
|---|---|
| `start` | two positions side by side at course point 2, 8 m apart |
| `water` | pickups on the bed every ~90 m, plus some on the branches (before the waterfall lip). *addition*: `course` or `branch` index |
| `animals` | `{kind, x, y, z, course, flying?}` on the banks: a walker stands 1-6 m past the bed edge (its species' `off`), where a drop riding the edge goes by within the sim's sense radius and the chase camera sees it; each stage starts on the other bank so both banks get as many. Only species of the spec list for Monte Peralba, each within its real altitude band: `ibex`, `marmot`, `hare` (mountain hare), `chough` (alpine chough), `chamois`, `eagle` (golden eagle, `flying: true`, at most one per stage), `cow` (pasture below 1800 m on gentle ground). Bands in `tools/bake/worlds/dolomiti.json`; other worlds list their own species (`animals.kinds` of their config) |
| `obstacles` | `{kind: 'rock', x, y, z, r, course}` inside the bed: gorge and shortcut stages, and the main arm beside the safe branch |

### look (addition)

The real landscape of the mountain, for the renderer and for checking it against reality. Baked from `look` of the bake config (bands, sources) and its `animals` (fauna). Altitudes are real metres. It is facts, not render tuning: `themeFor` (`src/render/themes/index.js`) merges only the look's sections that are theme sections, and the only one the bake writes is `backdrop`, with the theme's own file names (`test/world-fidelity.test.mjs` checks that the look agrees with the theme: paintings, treeline, glacier, moraine and snow bands).

| Field | Meaning |
|---|---|
| `treeline` | m, upper limit of the closed forest; `null` when no tree grows on the course (Everest, K2) |
| `treeSpecies` | what grows on the course, trees and scrub: `spruce`, `larch`, `beech`, `silver-fir`, `arolla-pine`, `mugo-pine`, `grey-alder`, `willow`, `alpenrose`, `juniper`, `rhododendron`, `montane-rainforest`, `mossy-forest`, `podocarp`, `ericaceous-heath` |
| `ground` | `[{type, alt: [low, high]}]`: ground cover by altitude band, bands may overlap (slope decides). Types: `meadow`, `forest`, `scrub`, `scree`, `rock`, `moraine`, `glacier`, `snow`, `gravel-bed`, `volcanic-ash`, `farmland`, `tea-garden` |
| `waterType` | `clear` (spring and torrent water), `glacial` (milky grey-turquoise meltwater), `tropical` (brown-green over volcanic sand) |
| `glacialAbove` | optional, m: above it the water is glacial milk even where `waterType` is `clear` (Antelao: the Ghiacciaio Inferiore, 2420 m) |
| `fauna` | `[{id, alt: [low, high]}]`: every species of the mountain with its real band (`animals.kinds` of the config), spawned on the course or not |
| `backdrop` | `{file, summit}`: the paintings in `assets/backdrops/` (`<id>.jpg` the view downhill, `<id>-summit.jpg` the summit, loaded only when present) |
| `sources` | where the bands come from (park data forms, land cover, papers), also cited in `docs/mountains/<id>.md` |

| World | Treeline | Trees and scrub | Ground, top to bottom | Water |
|---|---|---|---|---|
| `dolomiti` | 1900 m | spruce, larch, mugo pine, alpenrose | snow patches from 2250, rock, scree, scrub to 2250, pasture to 2150, spruce and larch forest | clear |
| `antelao` | 1950 m | spruce, larch, beech, mugo pine, grey alder, willow | snow from 2700, glacier 2420-2900, rock, scree, scrub, the gravel bed of the Val d'Oten, forest | clear, glacial above 2420 m |
| `svizzera` | 2300 m | larch, arolla pine, spruce, juniper, alpenrose | snow from 3000, glacier 2850-4000, rock, moraine 2180-2900, scrub, pasture, larch and arolla forest | glacial |
| `carpazi` | 1750 m | spruce, silver fir, beech, mugo pine, juniper, rhododendron | rock and scree from 1900, alpine grass, dwarf pine scrub 1550-2200, spruce then beech forest | clear |
| `everest` | none (3800-4000 m, below the course) | dwarf juniper, rhododendron | snow from 5600, glacier 5300-8000, rock, moraine 4300-5400, scrub, yak pasture turf | glacial |
| `k2` | none | none | snow from 5400, glacier 4700-8000, rock, moraine 4700-5300 | glacial |
| `indonesia` | 3150 m | montane rainforest, mossy forest, podocarp, ericaceous heath | volcanic ash above 3200, heath 2800-3450, forest 1800-3150, farmland below the park edge (the Kayu Aro tea gardens lie west of the line, so no `tea-garden`) | tropical |

### places (addition)

`{name, lat, lon, riverKm, stage, course, distance, kind}`: real places along the Piave from OSM (Overpass), sorted by `riverKm`, down to 10 km past the floor. `stage` and `course` locate the place in a played stage, `null` when it falls between stages. `distance` is metres from the river.

## Worlds

Seven worlds (decision of 27/10/2026): one per region of the spec (pezzo 2: Swiss Alps, Carpathians, Everest, K2, Indonesia), two in the Dolomiti. `data/worlds/index.json` is the live list. The duplicates `cervino` (Matterhorn east face), `moldoveanu` (Făgăraș), `rinjani` and `semeru` (Indonesia) were archived on 27/10/2026: their configs are in `tools/bake/worlds/archive/` (still validated by `test/bake-worlds.test.mjs`; move one back to `tools/bake/worlds/` to bake it again), their OSM caches stay in `data/raw/osm/`.

| World | Summit (official / DEM) | Descent line | Stages, real bed | Finish | Race |
|---|---|---|---|---|---|
| `dolomiti` Dolomites, Monte Peralba | Monte Peralba 2694 / 2685 m | OSM relation (Piave) | Peralba summit and snowfield 2678-1757 m; Upper Val Sesis 1714-1519 m; Lower Val Sesis 1408-1255 m; Acquatona Gorge 1133-1026 m | 1026 m, floor 926 m | 206 s |
| `antelao` Dolomites, Antelao | Antelao 3264 / 3134 m | OSM network (Torrente Oten, Torrente Molinà) | Antelao north face and Lower Glacier 3126-2197 m; Val d'Oten and the Pile Waterfall; Val d'Oten gravel bed towards Praciadelan; Molinà torrent below Praciadelan; Molinà torrent at Calalzo | 730 m, floor 731 m | 268 s |
| `svizzera` Swiss Alps, Matterhorn by Zmutt | Matterhorn 4478 / 4330 m | OSM network (Zmuttbach) | Matterhorn north face; Matterhorn Glacier snout and moraines; Zmuttbach at Stafel; Zmutt down to Zermatt | 1637 m, floor 1632 m | 195 s |
| `carpazi` Carpathians, Bâlea | Vârful Văiuga 2443 / 2432 m | OSM network (Bâlea, Cârțișoara) | Văiuga and Lake Bâlea 2417-1692 m; Bâlea Waterfall 1653-1280 m; Bâlea Cascadă chalet (it: Cabana Bâlea Cascadă) 1236-957 m; Bâlea Valley 917-696 m | 696 m, floor 666 m | 214 s |
| `everest` Everest, Nepal side | Mount Everest 8849 / 8737 m | DEM (glacier line through via points) | Summit pyramid 8729-7015 m; Western Cwm 6747-6317 m; Khumbu Icefall 6018-5366 m; Lobuche Khola at Thukla 4788-4425 m | 4425 m below Thukla, floor 4321 m (Pheriche flats) | 204 s |
| `k2` K2, south-east face and Godwin-Austen | K2 8611 / 8570 m | DEM (glacier line through via points) | Summit, Bottleneck and Shoulder 8566-7168 m; South-east face below the Shoulder 7052-5285 m; Foot of the south-east face 5230-5038 m | 5038 m on the Godwin-Austen at the foot of the face, floor 4962 m (K2 Base Camp) | 138 s |
| `indonesia` Indonesia, Mount Kerinci | Mount Kerinci 3805 / 3774 m | OSM network (Sungai Kering, Batang Sangir) | Kerinci summit and Shelter 3 3762-2789 m; Upper Sungai Kering mossy forest 2679-2024 m; Kerinci Seblat forest edge 1985-1625 m; Bengkolan Dua fields 1614-1475 m | 1475 m, floor 1464 m (Gunung Tujuh plateau) | 203 s |

Fidelity checks (`test/world-fidelity.test.mjs`): the official summit heights, names spelled right (accents, the Romanian comma below), every stage below the summit path within 60 m of the OSM waterway for 90 % of its points, races of 3-5 minutes (K2 about 2.2, 138 s, below), and the baked `look` agreeing with the render theme. `test/bake-worlds.test.mjs` adds the stage headings and a last stage of at least 5 % (no plain played).

Notes per world:

| World | Note |
|---|---|
| `antelao` | the second Dolomiti world: the north face of the Antelao (3264 m, DEM 3134 m) onto the Ghiacciaio Inferiore, its meltwater under Rifugio Galassi into the Val d'Oten, over the Cascata delle Pile to the Capanna degli Alpini, the braided gravel bed to Praciadelan, then the Torrente Molinà past Rizzios to Calalzo di Cadore (floor 731 m, above Lago di Centro Cadore on the Piave). Five stages, the last on the floor (`stages.end: "floor"`), sun at Calalzo and rain in the Val d'Oten (`weather`). Details in `docs/mountains/antelao.md` |
| `carpazi` | the Carpathian world for the vote: the west face of Vârful Văiuga into the glacial cirque of Lacul Bâlea (2034 m), the source of the Bâlea, then Cascada Bâlea, Cabana Bâlea Cascadă (1234 m, stage 3 starts there) and Valea Bâlii towards Cârțișoara. Văiuga is the highest peak whose water reaches the Bâlea (Buteanu and Capra drain to the Arpășel and the Capra). Stages are `packed` from the summit, so all four are 11 % or steeper. Details in `docs/mountains/carpazi.md` |
| `everest` | glacier line from the DEM through via points on the real thalweg (the fall line of the south-west face, never on a ridge, then the Western Cwm, Camp 1, top of the Icefall, Base Camp, the Khumbu Glacier snout, Thukla, the Khumbu Khola to Pheriche); the floor search starts below the snout (`floor.after`) because the debris-covered glacier past Gorak Shep is almost flat; the race ends below Thukla and the floor is the Pheriche flats (4321 m); ice zones carry the OSM glacier names. Details in `docs/mountains/everest.md` |
| `indonesia` | the Indonesian world for the vote. Kerinci (Sumatra) beat Rinjani and Semeru: it is the steepest (30 % mean slope down to the floor) and the only one whose race reaches a real valley floor, the plateau of Kayu Aro and Gunung Tujuh (Kersik Tuo 1519 m). OSM maps the Sungai Kering from 400 m under the summit. Animals are Kerinci Seblat species only (Sumatran tiger, Malayan tapir, Sumatran striped rabbit, Salvadori's pheasant, wreathed hornbill); the forest species spawn only above the national park edge (1804 m on the line, inside stage 3). Details in `docs/mountains/indonesia.md` |
| `k2` | glacier line from the DEM through via points: summit, Bottleneck, the Shoulder, then the DEM steepest-descent line down the couloir of the south-east face west of the Abruzzi Spur (never on the ridge; the test holds the face stage within 150 m of it), onto the Godwin-Austen Glacier (the line goes on past K2 Base Camp and Broad Peak Base Camp to Concordia for the backdrop); `floor.after` skips the nearly level Shoulder; the floor is the first 3 km under 4 %, which start at K2 Base Camp (4962 m on the DEM, 4963 m by GPS), so the race is the steep part only: three stages of 1800 m, 100 m apart, the last from the foot of the face onto the glacier (until 27/10/2026 a fourth stage ran 1.7 km of the Godwin-Austen at 5 % towards Concordia, a glacier plain). That makes K2 the one race under 3 minutes (138 s; 157 s until the landing relaunch fix of 28/10/2026 removed the false flights over the face): at 1:1 only about 5 km of its line are steep; ice zones carry the OSM glacier names (Godwin Austen Glacier); places from the config list (OSM returns only Concordia). Details in `docs/mountains/k2.md` |

Animals follow the spec table; additions: `chough` (alpine chough, recorded to 8,000 m on Everest and K2) so the highest stages are not empty. Species and bands are a first draft to verify on park and IUCN sources before each mountain ships (spec "Animali: specie vere"); the renderer still has models only for the Dolomiti species.

## How the short mode is baked

The steps below use the Dolomiti numbers; every world runs the same steps with its own config.

1. The river is the OSM relation 2219648 (`main_stream` ways in order, 231 km). A least-cost downhill path joins the DEM peak near Monte Peralba to the OSM source. Together they are the spine, smoothed (sigma 35 m, 60 m on the summit path) and kept 1:1.
2. The bed profile along the spine is the lowest real ground across a 28 m strip, made non-increasing (for the floor and the stage choice). The valley floor is the first place where the mean slope over 3 km falls below 1.25 % (Dolomiti: river km 21.2, 926 m, before Santo Stefano di Cadore; the Sappada plateau stays above 1.5 %).
3. Stages: the first starts on the summit; the others are the 1.7 km windows with the most drop above the floor, at most two per named landmark, at least 300 m apart.
4. The stage bed is the same lowest ground, strictly descending, at most 1 m above the real ground, with its slope held between 0.35x and 1.8x the local mean (over +-300 m): bumps of the surface model (trees, bridges) become gentle trenches instead of flat pools, and steps become ramps.
5. Each stage grid is the real DEM at 4 m, blurred by 10 m (the 30 m DEM shows facets), then carved: flat bottom, U sides, banks that blend into the terrain. The bed is carved 200 m past both ends.

| Stage | Real window | Real bed |
|---|---|---|
| Vetta e nevaio del Peralba | summit path + first 1.2 km of river | 2678 to 1757 m |
| Alta Val Sesis | km 1.6-3.4 | 1714 to 1519 m |
| Bassa Val Sesis | km 5.6-7.5 | 1408 to 1255 m |
| Forra dell'Acquatona | km 14.0-15.7 | 1133 to 1026 m |

## Commands

| Command | What it does |
|---|---|
| `node tools/bake/index.mjs <id> [--out dir] [--offline] [--no-index]` | bakes one world from `tools/bake/worlds/<id>.json` in 2-6 s once the data is on disk; downloads missing DEM tiles into `data/raw/dem/` and missing OSM answers into `data/raw/osm/<id>/` (`--offline`: only what is on disk), then refreshes `<out>/index.json` |
| `node tools/bake/bake-all.mjs [id ...] [--jobs 3] [--offline]` | bakes several worlds in parallel (one process each, every config without ids), then writes the index once |
| `node tools/bake/osm-fetch.mjs <id> [--force]` | only the OSM part: warms or (`--force`) refreshes `data/raw/osm/<id>/` |
| `node tools/bake/world-index.mjs [--out dir]` | rebuilds `index.json` from the baked folders |
| `node --test test/bake.test.mjs test/bake-worlds.test.mjs` | Dolomiti in detail, then every world, the config and the data helpers (fresh bakes included, about 30 s) |

Worlds bake independently: each process writes only `data/worlds/<id>/` and `data/raw/osm/<id>/`; shared DEM tiles and every output file land through a private part file and a rename, and `index.json` is rewritten until the folder list is stable, so parallel bakes do not clobber each other. The Overpass answers are cached, so a rebake needs no network. Without `places.json` the bake uses the approximate place list in the world config (`placesFallback`); without `glaciers.json` ice comes from `iceAbove` only.

## Bake config

`tools/bake/worlds/<id>.json`, one per world, read by `tools/bake/config.mjs` (validated: a broken config lists every problem at once). `short` fields left out take the Dolomiti values.

| Field | Meaning |
|---|---|
| `id` | folder name, equal to the file name (`a-z`, digits, dashes) |
| `name` | `world.json` name (Italian, kept for the contract) |
| `names` | `{en, it}` display names for the vote |
| `country` | ISO 3166 alpha-2 (`IT`, `CH`, `RO`, `NP`, `PK`, `ID`) |
| `summit` | `{name, names: {en, it}, elevation?, lat, lon, searchRadius}`: the race starts at the highest DEM point within `searchRadius` m; `elevation` is the official height, shown in the index (the 30 m DEM shaves sharp peaks) |
| `dem.tiles` | Copernicus tiles by south-west corner, `N45_E007`, `S09_E116`, `N36_W119`: downloaded when missing (GLO-30, GLO-90 when GLO-30 has no tile, open sea at 0 when neither has one). The list must cover the backdrop (route +-`backdropMargin`); the bake names the missing tile otherwise |
| `descent` | the watercourse, see below |
| `osm.bbox` | `[south, west, north, east]` for places and glaciers |
| `osm.places` | place names to fetch (Dolomiti); without it every `placeKinds` place in the box (`city`, `town`, `village`, `hamlet`, `suburb` by default) |
| `osm.placeMaxDistance` | m from the line beyond which a place is dropped (another valley) |
| `osm.extraNodes`, `osm.geofabrik` | extra Overpass node selectors; Geofabrik extract for the osmium fallback of an `osm-relation` |
| `osm.glaciers` | `true` (default): fetch `natural=glacier` outlines and mark the course on them as `ice` |
| `short.spine` | `{maxKm, sigma, pathSigma}`: line read this far; plan smoothing in m (river, summit path) |
| `short.floor` | `{window, slope, after}`: the valley floor is the first place past `after` m where the mean bed slope over `window` m falls below `slope` (0.0125 is 1.25 %). With no such place within `maxKm` the race stops where the line ends (volcano flanks) |
| `short.stages` | `{count, length, gap, perGroup, pick}`: stages of `length` m (1000-2000), at least `gap` m apart, at most `perGroup` per landmark. `pick`: `"steepest"` (default, the windows with the most drop, picked greedily) or `"packed"` (one window after the other from the summit, `gap` m apart, as many as fit above the floor; for a short steep valley where the greedy pick leaves only the flat bottom for the last stage, as on the Bâlea). `end: "floor"` (not with `packed`): the last window ends where the valley floor starts and the others are picked greedily above it, for a valley whose steepest stretches are all high up (Antelao: the race still ends at Calalzo, not in the Molinà ravine above it) |
| `short.iceAbove` | real bed altitude above which the bed is ice (snowfield); 99999 for none |
| `short.*` | `pointStep` 10, `extend` 200, `corridor` 250, `gridStep` 4, `blur` 10, `backdropStep` 60, `backdropMargin` 6000, `bedAcross` 28 |
| `landmarks` | `[{id, km: [from, to] | alt: [low, high], biome, names: [[it, en], ...]}]`: named stretches by river km or by real bed altitude; a stage takes the one it overlaps most, the names in order when two stages share it |
| `defaultBiome` | biome of a stage no landmark covers |
| `biomes` | `{key: {palette, hw: [min, max], bank, bankW}}` |
| `animals` | `{perStage, kinds: {species: {alt: [low, high], off: [min, max], bird?, flying?, max?, maxSlope?}}}`: only real species of the mountain, each in its real altitude band (spec "Animali: specie vere"). `flying`: the spawn soars above its spot and never drinks (default: the species' own `flying` in `src/render/animals/`, the golden eagle and the bearded vulture). `off`: meters past the bed edge (Dolomiti: small animals 1-3.5, chamois and ibex 2-5, cows 2.5-6; the other worlds 1.5-4.5, 2.5-6 and 3-7 until their animals get models; soaring raptors 12-30); `maxSlope`: steepest bank over the 12 m beyond the spot (a pasture; a grazer takes the other bank when only that one is gentle); the animals draw from their own random stream, so retuning them never moves the rocks and water drops |
| `placesFallback` | `[{name, lat, lon}]` used when Overpass gives no places |
| `requireShortcut` | `false` lets a world bake without a shortcut branch (a straight descent line has no bend for one) |
| `weather` | `{sun?, rain?}`: landmark ids of the stages that get the sun and the rain zone. By default the highest stage without zones gets the sun and the next the rain; name them where that stage is a shaded gorge (Antelao: the sun on the open valley at Calalzo, not in the Pile gorge) |

`descent.kind`:

| kind | Fields | Use |
|---|---|---|
| `osm-relation` | `name` or `relation`, `bbox`, `maxGap?` | a waterway relation, main stream in relation order (Dolomiti: the Piave) |
| `osm-ways` | `ways: [id, ...]`, `bbox`, `maxGap?` | hand-picked ways in flow order, named or not; gaps up to `maxGap` m (50) bridged |
| `osm-network` | `bbox`, `start: [lat, lon]`, `prefer: [name, ...]`, `jump?` | every river/stream way of the box, walked downstream from the node nearest `start`: at a fork the preferred name, then river over stream, then the longer way, so braided and unnamed channels collapse to one line; a way drawn upstream is followed only where the DEM descends; a dead end (stream under a glacier, into a lake) jumps to the nearest lower node within `jump` m (400) |
| `dem` | `via: [[lat, lon], ...]`, `to?`, or neither (`maxKm`) | from the elevation data: least-cost downhill paths through the via points (a glacier centreline: Western Cwm, icefall, glacier tongue), or a steepest-descent flow line from the summit when OSM has nothing |
| all | `summitVia?: [[lat, lon], ...]` | points the summit path must pass before the line starts |

The summit path (least cost downhill on a 15 m grid) always joins the DEM summit to the first point of the line; for `dem` the line starts on the summit and the summit path is empty.

DEM quirks handled: voids (no-data, NaN, below -1000 m) are filled from the GLO-90 twin when it is on disk, then from the neighbours ring by ring, and recorded in `source.voids`; a tile GLO-30 does not publish falls back to GLO-90 and `source.elevation` says so; lat/lon to metres is the local ellipsoid scale at the summit (equator to 50 degrees, both hemispheres, negative longitudes); heights are Float32 metres, 8000 m included.

## index.json

`data/worlds/index.json`: `{version: 1, worlds: [...]}`, one entry per baked folder, in game order: `WORLD_ORDER` of `tools/bake/world-index.mjs` (`dolomiti`, `antelao`, `svizzera`, `carpazi`, `everest`, `k2`, `indonesia`), any other baked world after them by id.

| Field | Meaning |
|---|---|
| `id`, `names`, `country`, `mode` | folder, `{en, it}` display name, ISO country, `short` |
| `summit` | `{name, names, altitude, demAltitude, lat, lon}`: `altitude` official (config) or DEM, `demAltitude` the DEM summit where the race starts |
| `finish` | `{names: {en, it}, altitude}`: the last stage and the real bed altitude where the race ends |
| `floor`, `stages`, `stageNames`, `length`, `drop` | valley floor altitude, stage count, `labels` of each stage, played metres, summit-to-finish drop |
| `estimatedSeconds` | short race: two bots racing every stage in the real sim (`estimate` says which) plus 3.5 s of cloud per transition; 30 m/s on the played length when the bots cannot finish |
| `raceSeconds`, `hash`, `simHash` | bot race clock; hash of `world.json` and of the sim's code (`src/sim/*.js`): the estimate is reused while neither changes, so a change in the physics or the bots races every world again on the next `node tools/bake/world-index.mjs` |

## Credits

| Data | Source and licence |
|---|---|
| Rivers, streams, glacier outlines and places | (c) OpenStreetMap contributors, ODbL |
| Elevation | Copernicus DEM GLO-30 (GLO-90 where GLO-30 has no tile), (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA. Each `world.json` carries its own credit lines in `source` |
