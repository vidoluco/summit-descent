# Dolomites: Monte Peralba and the source of the Piave (`dolomiti`)

The drop starts on the summit ridge of Monte Peralba (Hochweißstein, 2694 m, Carnic Alps, above Sappada), 260 m east of the top. It runs down the south flank into the Alta Val Sesis past the Sorgenti del Piave (1830 m), down the Bassa Val Sesis to Cima Sappada, and through the Forra dell'Acquatona below Sappada (about 1030 m). Everything is at real scale. The course follows the OSM Piave for 90 % or more of every stage below the summit path (`test/world-fidelity.test.mjs`). This note covers the look: what each stage shows and why. The bake is in `tools/bake/worlds/dolomiti.json`, the fauna in `dolomiti-fauna.md`.

| | |
|---|---|
| Theme | `src/render/themes/dolomiti.js` (over `themes/default.js`) |
| Tests | `test/render-dolomiti.test.mjs` (4 tests), plus `render-themes` and `world-fidelity` |
| Renders | `docs/screens/world-dolomiti-s0.png` to `-s3.png`, `world-dolomiti-hero.png`, `world-dolomiti-summit-view.png` |
| Paintings | `assets/backdrops/dolomiti.jpg` (Creta Forata from the meadows of Val Sesis), `dolomiti-summit.jpg` (the Peralba with Rifugio Calvi from Val Sesis); sources in `assets/backdrops/CREDITS.md` |

## Stages

| Stage | Real altitude | What is there | What the game shows |
|---|---|---|---|
| 0 Vetta e nevaio del Peralba | 2678 to 1757 m | Summit plateau of bare, pale grey Devonian reef limestone; snowfields in June on the gentle ground and in the hollows; scree and a rocky gully on the normal route; tawny short turf among the outcrops down to Rifugio Calvi (2164 m); larch and spruce from about 1900 m | Snow on gentle ground above about 2250 m (patches lower), pale limestone rock with bedding lines on the walls and steep ground, pale grey scree, tawny alpine turf from 1900 m, mugo pine and alpenrose from 2300 m down, the first larches and spruces under 1900-2050 m. No summit painting: the race starts on the summit itself |
| 1 Alta Val Sesis | 1714 to 1519 m | Green pasture round the Sorgenti del Piave, larch meadows, spruce, mugo pine on the screes; the Peralba 1.8 km behind | Lush pasture, larch (light green) and spruce, mugo pine clumps, limestone gravel banks. Looking back, the Peralba painting at its real bearing (339 deg) |
| 2 Bassa Val Sesis | 1408 to 1255 m | Spruce forest with larch and some silver fir on steep valley sides, pastures, limestone outcrops; the Peralba 5 km up the valley | Spruce, larch, silver fir, pasture by the stream, occasional pale rock outcrops. Looking back, the Peralba at 351 deg (`world-dolomiti-summit-view.png`) |
| 3 Forra dell'Acquatona | 1133 to 1026 m | A deep gorge in grey limestone, about 50 m deep, under dense spruce | Dense spruce and fir down to the stream on the steep sides, bare limestone where the sides are steepest. The DEM cannot resolve the gorge itself (it is narrower than a cell) |

## Every visible element and its source

| Element | Choice | Source |
|---|---|---|
| Peralba rock | Pale grey limestone (`rock`, `rockB`), salmon only from the low sun | Wikimedia Commons "Peralba Sesis.JPG" (source of the summit painting); the name Hochweißstein, "high white stone" |
| Bedding lines | `rockStrata` every 11 m on rock cover | Bedded limestone walls in both source photos |
| Scree | Pale grey (`scree`), no orange | "Creta Forata.jpg" (scree cones under the walls), "Peralba Sesis.JPG" |
| Snow | Gentle ground above 2250 m, steep ground bare | June, as in "Creta Forata.jpg" (yellow-flowered meadows, snow left in the gullies); the baked look's snow band; the stage is the "nevaio" |
| Alpine turf | Tawny olive above the treeline (`highGrass`, 1900-2250 m) | "Peralba Sesis.JPG" (olive-ochre turf among the outcrops round Rifugio Calvi) |
| Pasture | Green meadow, Val Sesis | "Creta Forata.jpg"; Rifugio Sorgenti del Piave in summer pasture |
| Trees | Spruce to 1950 m (70 %), larch to 2050 m (more above 1650 m), silver fir to 1450 m; no broadleaf | Natura 2000 IT3230006: 9410 spruce forest, 9420 larch forest; larches by the meadow in "Creta Forata.jpg" |
| Treeline | 1900 m | Parking at 1815 m among larches, Rifugio Calvi (2164 m) above the trees (volpidelvajolet.it, Rifugio Calvi) |
| Scrub | Mugo pine to 2250 m, hairy alpenrose to 2300 m | Natura 2000 IT3230006: 4060 alpine and boreal heaths; mugo pine as the usual scrub of the limestone screes (the 4070 code was not checked: the site form did not load on 28/10) |
| Banks | Pale limestone gravel, dark wet foot, no red earth | The Piave runs over limestone gravel from its source to Sappada |
| Water | Clear, a hint of turquoise, never glacial milk | Spring water (the Peralba has no glacier); `look.waterType: clear` |
| Boulders | Pale limestone | As the rock |
| Gorge | Bare rock on steep ground down to 950 m, dense forest close to the water | "Orrido acquatona gorge sappada.jpg" (Commons); montagna.tv on the Acquatona ferrata |
| Summit painting | None on stage 0; turned to the Peralba's real bearing on stages 1-3 (offsets -27, -29, -86 deg) | Bearings from each stage start to 46.6297 N, 12.7166 E, pinned by a test |
| Animals | Marmot, mountain hare, alpine chough, chamois, golden eagle, Bruna alpina cow in their bands; no ibex | `dolomiti-fauna.md` |

## Known gaps

- The 3D Peralba seen from the Alta Val Sesis is the smoothed DEM: within 2 km it stays 3D and reads as a smooth pale cone, not the craggy face of the painting.
- The gully walls of the summit stage are big flat scree slopes in shade.
- Stage 3 shows forested slopes, not the 50 m limestone walls of the gorge itself.
- Three chamois spawn in the gorge (1058-1075 m, bake); chamois do use steep forest that low, but in summer they are usually higher.
