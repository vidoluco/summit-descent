// Swiss Alps, the Matterhorn (4478 m) down its north face onto the Matterhorngletscher, the glacier forefield, Stafel
// and Zmutt to Zermatt (docs/mountains/svizzera.md, "The look, element by element"). Late October, as in the
// paintings (assets/backdrops/svizzera.jpg and svizzera-summit.jpg) and their source photos (CREDITS.md there:
// File:Zmutttal (22386927726).jpg, File:ZmuttValley.jpg): dark grey-violet gneiss of the Dent Blanche nappe on the
// face, not dolomite (no carved terraces), fresh snow on its ledges, bare blue-grey ice of the glaciers above about
// 2850 m, grey moraine rubble of the forefields down to the Zmuttbach, and above about 2500 m (2800 m on the sunny
// side) only rock, scree and ice: the photos have no grass up there. Below, dry straw-gold Valais pasture broken by
// grey scree runs; open larch woods gone gold with Swiss stone pine (arolla) among them, scattered round Stafel and
// closing in only down towards Zmutt, spruce only below about 1850 m; the Zmuttbach is opaque milky grey glacial water.
export default {
  sun: { relative: -105, elevation: 19, intensity: 3.0, wrap: [-0.6, 1.0] }, // a broad ramp: even a lit slope keeps a soft gradient
  // the shade takes the violet of the paintings' shaded valley side; the bounce off straw grass and grey rubble
  hemi: { sky: '#c8c4da', ground: '#b5a98c', intensity: 1.7 },
  fog: { color: '#eccfc4', density: 0.00008 }, // dry, clear autumn air of the inner Valais
  backdrop: { file: 'svizzera.jpg', summit: 'svizzera-summit.jpg', summitAt: { row: 0.58, elevation: 0.6, baseHaze: [0.58, 0.68, 0.55] }, row: 0.48, elevation: -1.2, width: 64, eye: 2700, distance: 12000, summitEye: 2600, summitDistance: 6000, baseHaze: [0.52, 0.64, 0.55], cut: [3500, 6000] }, // the gorge walls stay 3D: only the far range is painted
  terrain: {
    // dry late-season Valais pasture: straw on the sunny slopes (the Zmutttal photo), olive where it is still green,
    // never the orange of a desert
    meadowY: '#c9a962', meadow: '#b09c66', meadowF: '#959660', meadowD: '#8c8460', forest: '#5c6a3e',
    // grey gneiss and greenstone rubble with the paintings' violet (the warm low sun turns a neutral grey to tan),
    // not the warm Dolomite scree
    scree: '#9a96a0', screeD: '#7d7a86',
    rock: '#7b7488', rockB: '#615d72', rockShade: '#625f78', // dark gneiss of the face and the cliff bands
    snow: '#fbf8f4', ice: '#d6e4ee', iceD: '#9fb8cc', moraine: '#958e9a', moraineD: '#77717f', // debris grey, as in svizzera-summit.jpg
    bank: '#8f8a8a', bankD: '#736e70', bankWet: '#5e5a5c', bed: '#93a8a6', // grey glacial silt and gravel, not red earth
    treeline: 2300, alpine: 2450, rockFrom: 1800, snowAbove: 3000, iceAbove: 2850, moraineBand: [2180, 2900],
    // the steep ground is bare gneiss: the cliffs of the Zmutt gorge, outcrops on the steep steps of the pasture, the
    // whole north face from about 20 deg up high; snow holds on the ledges and the gentler ice fields, not on the 75 %
    // face itself (late October: fresh snow plastered on the ledges, dark rock between)
    rockSlope: [42, 56], snowSlope: 38,
    // the Valais sunny side: south-facing pasture reaches about 2750 m (Höhbalmen, 2665 m), north-facing slopes turn
    // to rubble and keep their snow lower (the slopes round Stafel stay grass and open wood up to about 2400 m, as in
    // File:ZmuttValley.jpg); the forefields lie on the shaded valley side and floor
    sunnySide: { azimuth: 180, lift: 150, rubble: 0.85 },
    bareAbove: 2600, // nothing grows above (2750 m on the sunny side, 2450 m facing north): bare rubble, rock and ice
    // grey scree runs down the pasture in patches (the Zmutttal photo: golden grass broken by grey bands), and in the
    // Zmutt gorge darker olive grass and moss between the larches
    tints: [{ alt: [1900, 2700], color: '#8f8b96', amount: 0.55, vary: 1 }, { alt: [1400, 2000], color: '#7f7d58', amount: 0.45, vary: 1 }],
    coverNoise: [55, 0.85], // rock outcrops in ragged bands, not round blots
    smooth: { passes: 3, normalPasses: 2, from: [0.85, 1.3] }, // the face keeps its ribs and steps (less rounding)
    massif: { from: 99999 }, // gneiss and ophiolite, not dolomite
  },
  // glacial milk: opaque grey-turquoise (the lakes of the summit photo, about #b9d3cc to #9fbfbb), soft facets, the
  // flow drawn in long foam streaks even where the Zmuttbach runs gentle
  water: { deep: '#8aa6a6', base: '#a3bcb8', light: '#bccfca', far: '#c2d1cd', foam: '#f2f5f3', facetTone: 0.045, rapidSlope: [0.1, 0.6] },
  trees: {
    // open larch and stone pine woods (lichter Lärchen-Arvenwald): the highest closed forest of the Alps reaches 2300 m
    // on the sunny slopes above Zermatt (terrain.treeline), but round Stafel (2150 m) there are only scattered trees
    // and groups on the open forefield (File:ZmuttValley.jpg), and the woods close in only down towards Zmutt
    density: 0.42, cover: [[1750, 0.05], [1950, -0.05], [2100, -0.22]], clearing: [16, 30], wall: 20, // no closed framing wall
    maxSlope: 44, // larches hold on the steep sides of the Zmutt gorge
    kinds: [
      { name: 'larch', shape: 'open-larch', share: 0.55, alt: [1500, 2250], height: [9, 21], width: 0.95, colors: ['#d6a64a', '#cf9c40', '#c98f3a', '#d2a246', '#c4973f'] },
      { name: 'arolla pine', shape: 'stone-pine', share: 0.35, alt: [1700, 2250], height: [7, 15], width: 0.95, colors: ['#2f4e3e', '#34553f', '#2b483b', '#3a5a42'] },
      { name: 'spruce', shape: 'conifer', share: 0.3, alt: [0, 1850], height: [12, 22], width: 0.9, colors: ['#33593e', '#2f553c', '#3c6544'] },
    ],
    shrubs: {
      kinds: [
        { name: 'juniper', shape: 'shrub', share: 0.6, alt: [1700, 2600], height: [0.5, 1.0], width: 2.6, colors: ['#5a7348', '#4f6a44'] },
        { name: 'alpenrose', shape: 'shrub', share: 0.4, alt: [1800, 2500], height: [0.5, 0.9], width: 2.4, colors: ['#4f6a40', '#5b6e42'] },
      ],
      line: 2600, density: 0.35,
    },
  },
  rocks: { color: '#9a95a0', shade: '#76717f' }, // gneiss boulders
  camera: { keepAhead: 0.85 }, // the north face is a 75 % slope: a drop off a step must not tip the view into the sky
  // The painting is the Zmutt valley looking down to Zermatt, true for the two valley stages only. From the face and
  // the forefield the way down looks north-north-east, over the real 3D Ober Gabelhorn, Wellenkuppe and Mettelhorn
  // (within the 10 km of baked terrain), so no painting there. The summit painting (the north face seen from the
  // Höhbalmen side) turns to the real bearing of the Matterhorn from each valley stage: 216 deg from Stafel, 239 deg
  // from Zmutt (its peak sits 13 deg left of the painting's centre).
  stages: {
    'north-face': { backdrop: { file: null } },
    matterhorngletscher: { backdrop: { file: null } },
    // the face is 3.3 to 4 km from Stafel and stands 30 deg high there: a wider summit painting, and the 3D
    // Matterhorn (GLO-30 is up to 275 m too low at its top) dissolves into it from 1.8 km
    // round Stafel only scattered larches and stone pines on the open forefield, at about half the density of the woods
    stafel: { backdrop: { summitOffset: -30, cut: [1800, 3000], summitDistance: 3600, summitAt: { width: 96 } }, trees: { density: 0.2, wall: 10 } },
    // in the Zmutt gorge the real 3D valley sides stay solid in front of the painting's own near slope; the
    // Matterhorn, 5.6 km away, has turned into its painting by 5.8 km
    'zmutt-zermatt': { backdrop: { summitOffset: 4, cut: [3500, 5800], summitDistance: 5600, summitAt: { width: 80 } } },
  },
};
