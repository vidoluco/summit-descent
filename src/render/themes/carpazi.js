// Carpathians, Făgăraș: Vârful Văiuga (2443 m) and Lacul Bâlea down the Bâlea waterfall and Valea Bâlii
// (docs/mountains/carpazi.md). Every band below is read off the real valley (sources in docs/mountains/carpazi.md,
// "Look"): short green alpine grass (Festuca, Nardus, Carex curvula) up to the ridge, with pale grey crystalline
// schist (mica schist and gneiss, no dolomite terraces) in outcrops and boulder fields and late snow only in patches;
// dwarf mountain pine (jneapăn, Pinus mugo) in dark carpets with juniper and Rhododendron myrtifolium from about
// 2300 m down to the spruce treeline (about 1750 m); closed spruce forest below, then the mixed beech, silver fir and
// spruce forest of Valea Bâlii from about 1400 m, beech the most common under about 1100 m. The Bâlea runs clear
// over grey schist stones (no glacier in the Făgăraș): clear grey-green water with its stony bed showing, grey stony
// banks, not earth. The source photos (File:Valea Balea.jpg, File:Lake Bâlea and Cabana Bâlea.jpg) show the cirque
// green but strewn with grey: outcrop bands on every steeper slope, boulder fields on the floor and under the walls.
// The paintings: carpazi.jpg is the Bâlea valley from about 2050 m with the high cirque walls on both sides, right
// for the cirque and the hanging valley (stages 1-2). From Cabana Bâlea Cascadă down (stages 3-4, 1236-696 m) the
// real view downhill is the forested lower Valea Bâlii opening onto the Făgăraș depression, with no alpine wall in
// it: those stages take carpazi-valley.jpg, a painting of that view, and until it exists no painting (the gradient
// sky over the real 3D ridges, forested to their tops), never the cirque walls.
const VALLEY = { file: 'carpazi-valley.jpg', summit: null, row: 0.62, elevation: -1, width: 70, offset: 0, eye: 1000, distance: 9000, baseHaze: [0.62, 0.74, 0.55], fallback: { file: null } };

export default {
  sun: { relative: -110, elevation: 19 },
  fog: { color: '#eccfc8' },
  // the course swings from west to due north inside a stage: a wide painting, a little right of each heading, keeps
  // those views on the painted valley instead of its mirrored edge (a peak that is not there)
  backdrop: { file: 'carpazi.jpg', summit: 'carpazi-summit.jpg', summitAt: { row: 0.62, elevation: 0.5, baseHaze: [0.62, 0.74, 0.55] }, row: 0.55, elevation: -0.8, width: 80, offset: 10, eye: 2050, distance: 9000, summitEye: 2050, summitDistance: 2500, baseHaze: [0.56, 0.66, 0.55] },
  terrain: {
    meadowY: '#b6cb58', meadow: '#8fbd52', meadowF: '#77ad4c', meadowD: '#5f9147', forest: '#3d673b',
    scree: '#aba79e', screeD: '#8e8b84', // grey schist debris under the cirque walls
    // grey mica schist in two tones, pale lichen grey where it is lit and a darker grey in the broad blotches between,
    // each outcrop inked round its edge as in the paintings (not flat grey polygons)
    rock: '#aeb0a6', rockB: '#999c92', rockShade: '#5d6074', coverEdge: 0.5,
    bank: '#9d9182', bankD: '#7c7266', bankWet: '#5e5a54', bed: '#8b9490', // the bed and banks are grey schist stones
    treeline: 1750, alpine: 2380, rockFrom: 900, rockSlope: [48, 62], snowAbove: 2420, snowSlope: 38,
    // the cirque, from the spruce line to the ridge: the schist comes out of every steeper slope, in bands and broken
    // outcrops from about 35 deg (below the treeline only the walls of the gorges and the waterfall step, rockSlope)
    rockBand: { alt: [1720, 2470], slope: [34, 46], amount: 0 },
    coverNoise: [16, 0.65], // small broken outcrops and boulder fields, not big slabs
    forestTint: 0.6, // under the closed spruce and beech canopy the ground is dark
    massif: { from: 99999 }, // crystalline schist, not dolomite
  },
  // clear mountain water, darker and greener than the glacial milk of the Alps and the Himalaya (the lake and the
  // stream in the photos are a deep grey-green), its stony bed showing in the shallows and faintly across the sheet
  water: { deep: '#2f6f72', base: '#4a8f8a', light: '#7fbdb2', far: '#93c1b9', stones: { size: 0.5, amount: 0.45, clear: 0.1, reach: 2.6 } },
  // the boulders strewn over the cirque floor and heaped under its walls, from the spruce line to the ridge (the
  // photos: every few metres a stone, in places a whole field of blocks)
  rocks: {
    color: '#b5b4ac', shade: '#85847e',
    field: { alt: [1690, 2440], spacing: 6, share: 0.6, size: 80, r: [0.3, 2.4], clear: 1.8, near: 130, maxSlope: 40, max: 1100 },
  },
  trees: {
    density: 0.8, cover: 0.55, maxSlope: 52, clearing: [4, 12], // the steep valley sides are forested down to the river
    kinds: [
      { name: 'spruce', shape: 'conifer', share: 0.9, alt: [1300, 1800], height: [14, 26], width: 0.8, colors: ['#2f5a3c', '#2b5338', '#36623f', '#3b6742'] },
      { name: 'spruce (mixed forest)', shape: 'conifer', share: 0.32, alt: [700, 1350], height: [16, 28], width: 0.8, colors: ['#2f5a3c', '#2b5338', '#36623f'] },
      { name: 'silver fir', shape: 'conifer', share: 0.14, alt: [700, 1450], height: [16, 28], width: 0.95, colors: ['#2d5440', '#335b44'] },
      { name: 'beech', shape: 'round', share: 0.54, alt: [0, 1450], height: [16, 26], width: 0.8, colors: ['#5e8c43', '#689746', '#557f3f', '#73a04a'] },
    ],
    shrubs: {
      kinds: [
        { name: 'dwarf pine', shape: 'shrub', share: 0.62, alt: [1600, 2250], height: [1.0, 2.4], width: 2.2, colors: ['#2f5a37', '#36603b', '#2b5233'] },
        { name: 'juniper', shape: 'shrub', share: 0.22, alt: [1650, 2300], height: [0.4, 0.9], width: 2.6, colors: ['#577048', '#4c6844'] },
        { name: 'rhododendron', shape: 'shrub', share: 0.16, alt: [1700, 2350], height: [0.3, 0.6], width: 2.6, colors: ['#6a7d46', '#627a44'] },
      ],
      line: 2300, density: 0.85,
    },
  },
  stages: {
    'balea-cascada': { backdrop: { ...VALLEY } },
    'valea-balii': { backdrop: { ...VALLEY } },
  },
};
