// Antelao (3264 m), the "re delle Dolomiti" of Cadore, and the Val d'Oten down to Calalzo and the Lago di Centro
// Cadore (docs/mountains/antelao.md, assets/backdrops/CREDITS.md). The colours are read off real photos of the route
// on Wikimedia Commons (Val oten calalzo.JPG, Rifugio galassi.jpg, ValOten02.JPG, Antelao from chiggiato
// dolomites.JPG): pale grey-white dolomite walls and near-white screes (the light of the hour adds the pink), the two
// small Antelao glaciers above about 2400 m, dark mugo pine on the screes, dense dark spruce and larch woods with
// beech lower down (Cadore), and clear turquoise water over the white limestone gravel of the Val d'Oten and the
// Molinà: the banks are gravel, not earth.
// One season, late October, as the San Vito summit painting (an October photo) and the golden hour have it: the
// larches gold among the dark spruce, the beech woods of Calalzo copper, the hay meadows faded to green-ochre.
// Each painting is the real view from where it is used (CREDITS.md):
//   - antelao-marmarole.jpg, the summit stage: from the north face across the head of the Val d'Oten at the long
//     south wall of the Marmarole (Hans Braam's photo from about 2600 m under the summit).
//   - antelao-galassi.jpg, the Pile: from under Forcella Piccola east down the Val d'Oten (ValOten02.JPG).
//   - antelao.jpg, from Praciadelan to Calalzo: from above Calalzo south-east over the town and the Lago di Centro
//     Cadore to the Friulian Dolomites (CalalzoCadorePanorama.JPG). Nothing of the Antelao is ahead there.
//   - antelao-chiggiato.jpg, looking back up from the Pile to Calalzo: from Rifugio Chiggiato west-south-west up the
//     Val d'Oten, the north face of the Antelao with its one small glacier, Forcella Piccola, the Marmarole
//     (Val oten calalzo.JPG and Antelao from chiggiato dolomites.JPG, both taken there).
//   - antelao-summit.jpg, the Antelao as people photograph it (its south-west face over San Vito di Cadore): the
//     lobby card and the results only (assets/backdrops/<id>-summit.jpg), no stage looks at that side.
// The Antelao on antelao-chiggiato.jpg (its top at u 0.232 of 64 deg, 17 deg left of the centre, and at row 0.143)
// is turned to its real bearing from each stage and raised to its real height above the stage's start (from
// Calalzo it stands lower than from the Val d'Oten, 8 km off instead of 5); further down a stage it rises as the
// real one does (eyeShift from the start's altitude).
const ANTELAO = 3264, D2R = Math.PI / 180;
const LOOK_BACK = { summit: 'antelao-chiggiato.jpg', summitAt: { row: 0.66, width: 64, baseHaze: [0.62, 0.74, 0.55] } };
const PEAK = (0.66 - 0.143) * (64 * D2R) / (3168 / 1344); // tan of the Antelao's top above the painting's row
const lookBack = (summitOffset, summitDistance, alt) => ({
  ...LOOK_BACK, summitOffset, summitDistance, summitEye: alt,
  summitAt: { ...LOOK_BACK.summitAt, elevation: Math.atan((ANTELAO - alt) / summitDistance - PEAK) / D2R },
});
export default {
  sun: { relative: -112, elevation: 20 },
  // the skylight of the painting's lavender sky: the shaded screes and gravel take its mauve, not a neutral grey
  hemi: { sky: '#cdc6df' },
  // the view down to Calalzo: the far Friulian Dolomites (Spalti di Toro, Monfalconi, Cridola, 2500-2600 m, 8-12 km
  // from Calalzo, so 11-13 deg up from the valley floor) over the forested ridges beyond the lake; the town and the
  // lake under the foot of the range turn into its mist. That mist is the shaded olive of the wooded ridges beyond
  // the lake, not the painting's foot (copper beech and pink sky): the near ridge across the Molinà dissolves into
  // it and reads as one more wooded hill instead of a flat pink shape
  backdrop: { file: 'antelao.jpg', summit: 'antelao-summit.jpg', summitAt: { row: 0.62, elevation: 0.8, baseHaze: [0.62, 0.72, 0.55] }, row: 0.72, elevation: -1, width: 56, eye: 1250, distance: 10000, summitEye: 1900, summitDistance: 4000, baseHaze: [0.6, 0.7, 0.55], mist: '#6c6656' },
  terrain: {
    // the Cadore hay meadows at the end of October: green faded toward ochre (the painting of Calalzo), the forest
    // floor under the spruce dark (the painting's wooded slopes)
    meadowY: '#bdb468', meadow: '#9ea65c', meadowF: '#86995a', meadowD: '#788b52', forest: '#355536',
    forestTint: 0.8, // past the trees drawn round the course the far slopes read as forest by this tint alone
    // dolomite screes and gravel: near white, a touch warm (Rifugio galassi.jpg, the fans of Val oten calalzo.JPG)
    scree: '#e4ddd4', screeD: '#cbc2bb',
    // the walls: pale dolomite in two tones of broken slabs (the low sun turns them pink, the enrosadira), patches
    // smaller than the default so the faces read as ledges and slabs
    rock: '#ebe3dd', rockB: '#cdc4c0', coverNoise: [24, 0.6],
    // the Dolomia Principale is thick-bedded: its ledges cross every face of the Antelao (Antelao from chiggiato
    // dolomites.JPG, the north face over the Val d'Oten)
    rockStrata: { spacing: 12, tone: 0.28, wobble: 4 },
    snow: '#fdf9f4',
    ice: '#e2edf2', iceD: '#b4cbd8', // small cirque glaciers, partly under debris, not blue icefalls
    // the banks are the torrent's own gravel: pale limestone, wet grey at the waterline, a soft line on top
    bank: '#eee8de', bankD: '#e0d9ce', bankWet: '#aaa49d', bed: '#a6c3c4',
    bankBand: { width: 3.6, wet: 0.6, line: 0.16, wetTone: 0.82, lineTone: 0.6, lift: 0.16 },
    // the Ghiacciaio Inferiore reaches down to about 2410 m on the DEM (docs/mountains/antelao.md, "Glaciers")
    treeline: 1950, alpine: 2200, snowAbove: 2700, iceAbove: 2420,
    // summer: snow holds only on the ledges and the glacier basins (Antelao from chiggiato dolomites.JPG, the north
    // face from the Marmarole: grey rock, one white patch of the Ghiacciaio Inferiore, green ribs up to about 2300 m)
    snowSlope: 30,
    // nothing grows above about 2400 m on the Antelao: bare dolomite, screes and the glaciers (Natura 2000 IT3230081,
    // habitats 8210, 8120, 8340), so the gentle ground up there is scree, not the alpine pasture of the Peralba
    bareAbove: 2400,
    // the Dolomite ledges and gullies come right down to the course: the north face and the buttresses of the Val
    // d'Oten are carved from 40 m off the stage grids (default 200)
    massif: { keep: 40 },
    rockSlope: [44, 58], // the north face and the buttresses under Rifugio Galassi are bare slabs, not grass
  },
  // clear Dolomite water, turquoise over the white gravel (the glacier is small and far up the course)
  water: { deep: '#3a9ebf', base: '#5bb8d2', light: '#9ad8e4', far: '#a8dae4' },
  trees: {
    // the Val d'Oten is wooded down to its gravel bed: closed spruce and beech low, larch and spruce in groups between
    // meadows from about 1500 m to the treeline (Natura 2000 habitats 9410, 9420, 9130)
    density: 0.7, cover: [[1300, 0.6], [1700, 0.48], [1950, 0.2]], maxSlope: 50, clearing: [10, 22], // the walls are wooded up to their cliff bands, even at 45-50 deg
    kinds: [
      { name: 'spruce', shape: 'conifer', share: 0.62, alt: [0, 2050], height: [12, 24], width: 0.95, colors: ['#33593e', '#2f553c', '#3a6142', '#2b4f3a', '#36603f'] },
      // late October: the larch needles gold, the beech leaves copper (the paintings; the spruce stays dark green)
      { name: 'larch', shape: 'conifer', share: 0.24, alt: [1200, 2250], height: [10, 20], width: 0.85, colors: ['#c9902f', '#d8a63e', '#b97f2a'] },
      { name: 'beech', shape: 'round', share: 0.14, alt: [0, 1450], height: [12, 20], width: 0.8, colors: ['#b9763a', '#c88a42', '#a5683a'] },
    ],
    shrubs: {
      kinds: [
        { name: 'mugo pine', shape: 'shrub', share: 0.85, alt: [1350, 2300], height: [1.2, 2.6], width: 2.2, colors: ['#335c38', '#2d5434', '#3a643a'] },
        { name: 'hairy alpenrose', shape: 'shrub', share: 0.15, alt: [1600, 2300], height: [0.5, 0.9], width: 2.4, colors: ['#56763f', '#627f44'] },
        // Salix elaeagnos scrub on the gravel bars of the Oten and the Molinà (Natura 2000 habitat 3240), yellowing
        { name: 'grey willow', shape: 'shrub', share: 0.6, alt: [700, 1300], height: [1.6, 3.2], width: 1.6, colors: ['#939a64', '#9ea26a', '#878f5c'] },
      ],
      line: 2300, density: 0.42,
    },
  },
  // each stage's own paintings: the real view ahead, and behind the start the Antelao at its real bearing and distance
  // from the stage's start (46.4523 N 12.2606 E, the world frame's origin), against the exact opposite of the stage's
  // heading, less the 17 deg the Antelao stands left of the look-back painting's centre
  stages: {
    // the race starts just under the top: the summit is the ground itself, nothing painted behind it. Ahead, across
    // the head of the Val d'Oten, the Marmarole: their wall foot (about 1900 m, 4-5 km) 10 deg under the photo's eye
    // (2600 m), their crest (2900 m) 5 deg over it; from the summit both sink 7 deg more (eyeShift)
    antelao: { backdrop: { file: 'antelao-marmarole.jpg', summit: null, row: 0.62, elevation: -10, width: 76, eye: 2600, distance: 4500, baseHaze: [0.6, 0.72, 0.55], mist: null } },
    // down the Val d'Oten from under Forcella Piccola: the Oten gravel 5 km off and 10 deg under the photo's eye
    // (2050 m), the far Cadore ranges in the gap on the horizon. Behind, the summit 2.6 km away at 195 deg (opposite
    // of the heading: 251 deg), mostly hidden by the 3D north face
    pile: { backdrop: { file: 'antelao-galassi.jpg', row: 0.75, elevation: -10, width: 64, eye: 2050, distance: 6000, baseHaze: [0.72, 0.84, 0.55], mist: null, ...lookBack(-39, 2600, 1787) } },
    // 5.2 km at 236 deg (opposite: 296), up the Val d'Oten
    oten: { backdrop: lookBack(-43, 5200, 1236) },
    // 6.5 km at 253 deg (opposite: 304)
    molina: { backdrop: lookBack(-34, 6500, 1019) },
    // 8.0 km at 265 deg (opposite: 303), seen from Calalzo over the mouth of the Val d'Oten
    calalzo: { backdrop: lookBack(-21, 8000, 820) },
  },
};
