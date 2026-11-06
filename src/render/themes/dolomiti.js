// Dolomiti, Monte Peralba (2694 m, Alpi Carniche) and the source of the Piave down Val Sesis and the Acquatona gorge
// to Sappada (data/worlds/dolomiti/world.json "look", docs/mountains/dolomiti-fauna.md, assets/backdrops/CREDITS.md).
// The Peralba (Hochweißstein, "high white stone") is pale grey Devonian reef limestone: a summit plateau of bare slabs,
// pale grey screes and late snow patches in the hollows of its south flank, tawny alpine grass among the outcrops
// down to Rifugio Calvi (2164 m). Below it the Val Sesis: green pasture and larch meadows round the Sorgenti del Piave
// (1830 m), mugo pine and hairy alpenrose on the screes, spruce forest with larch and some silver fir lower down
// (Natura 2000 IT3230006: 9410, 9420, 4060). The Piave is a clear spring stream over pale limestone gravel, faintly
// turquoise, and in the Acquatona gorge it runs between bare grey limestone walls under dark spruce.
// The default theme carries the shared Cartoon look; this file sets what is true of this place.
export default {
  sun: { relative: -112, elevation: 20 }, // from the left and a little behind the view, as in the painting
  backdrop: { file: 'dolomiti.jpg', summit: 'dolomiti-summit.jpg', summitAt: { row: 0.84, elevation: 1.0, baseHaze: [0.84, 0.92, 0.55] }, row: 0.77, elevation: 1.4, width: 58, eye: 1450, distance: 6000, summitEye: 2150, summitDistance: 2500 },
  terrain: {
    // the rich pasture of the Val Sesis (the painting's meadow), a little more olive on the high dry grass
    meadowD: '#86a650',
    // pale grey limestone scree and rock: the low sun turns it peach, the sky shade lavender, as in both paintings
    scree: '#e2d8d0', screeD: '#b9aca5',
    rock: '#e6dcd5', rockB: '#d6cbc6',
    // banks of pale limestone gravel with a dark wet foot, as the Piave has from its source to Sappada (no red earth here)
    bank: '#ddd2c4', bankD: '#bdb1a4', bankWet: '#857c74', bed: '#8fb2ae',
    bankBand: { width: 1.9 },
    treeline: 1900, // larch and spruce stop round the Sorgenti del Piave (1830 m), well below Rifugio Calvi (2164 m)
    alpine: 2380, // above: the grass thins into scree and slabs (the summit plateau and its screes)
    highGrass: { color: '#b3a85c', from: 1900, to: 2250, amount: 0.75 }, // tawny Sesleria and Carex firma turf among the outcrops, as on the summit painting
    rockSlope: [50, 62], // the limestone breaks out as bare walls on steep ground (the summit gully, the gorge)
    rockStrata: { spacing: 11, tone: 0.24, wobble: 3 }, // its bedding, the ledges on every wall of both paintings
    rockFrom: 1150, // down to the walls of the Acquatona gorge (about 1050 m)
    // June, as in the photo of the painting (yellow flowers, snow left in the gullies of the Creta Forata): the summit
    // snowfield of the first stage lies on the gentle ground above about 2250 m, the walls and steep screes are bare
    snowAbove: 2250, snowSlope: 36,
  },
  rocks: { color: '#d2cbc5', shade: '#a39ba0', scale: 1.15 }, // pale limestone boulders
  water: { deep: '#2f92c6', base: '#4cb0d8', light: '#8ed6ec', far: '#a2d8e8' }, // clear spring water, a hint of turquoise
  trees: {
    kinds: [
      { name: 'spruce', shape: 'conifer', share: 0.7, alt: [0, 1950], height: [12, 22], width: 1.0, colors: ['#3d6a47', '#355f41', '#2f573f', '#46744a', '#3a6644'] },
      { name: 'silver fir', shape: 'conifer', share: 0.12, alt: [0, 1450], height: [14, 24], width: 0.95, colors: ['#2f5842', '#355e46'] },
      // larch, light summer green: a fifth of the forest low down, the larch meadows of the upper Val Sesis
      { name: 'larch', shape: 'conifer', share: 0.18, alt: [1100, 2050], height: [10, 19], width: 0.9, colors: ['#7f9a48', '#8aa24c', '#74903f'] },
      { name: 'larch', shape: 'conifer', share: 0.35, alt: [1650, 2050], height: [9, 17], width: 0.9, colors: ['#7f9a48', '#8aa24c', '#74903f'] },
    ],
    shrubs: {
      kinds: [
        { name: 'mugo pine', shape: 'shrub', share: 0.75, alt: [1500, 2250], height: [1.2, 2.6], width: 2.2, colors: ['#3c6a3e', '#345f3a', '#43723f'] },
        { name: 'hairy alpenrose', shape: 'shrub', share: 0.25, alt: [1600, 2300], height: [0.5, 0.9], width: 2.4, colors: ['#5a7a44', '#6b8a46'] },
      ],
      line: 2300,
    },
  },
  // the summit painting where the Peralba really stands from each stage (bearings from each stage's start to the
  // summit at 46.6297 N 12.7166 E, against the exact opposite of its heading)
  stages: {
    // the race starts on the summit ridge, 260 m east of the top: the summit is the ground itself, nothing painted behind
    summit: { backdrop: { summit: null } },
    // the Peralba 1.8 km away at 339 deg (opposite of the heading: 7 deg), as on the summit painting from Val Sesis
    sesis: { backdrop: { summitOffset: -27, summitDistance: 2200 } },
    // 5.1 km up the valley at 351 deg (opposite: 20 deg)
    'sesis-2': { backdrop: { summitOffset: -29, summitDistance: 5000 } },
    // the Forra dell'Acquatona: the Peralba 8.1 km away at 37 deg (opposite: 123 deg), mostly behind the gorge walls;
    // dense spruce and fir right down to the gorge, on slopes too steep for pasture
    acquatona: {
      backdrop: { summitOffset: -86, summitDistance: 8000 },
      trees: { clearing: [6, 14], density: 0.65, maxSlope: 42, wall: 50 },
    },
  },
};
