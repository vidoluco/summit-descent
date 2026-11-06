// K2 (8611 m), Karakoram, Pakistan side: the summit snowfield, the Bottleneck couloir under its serac and the
// Shoulder, the south-east face west of the Abruzzi Spur, and its foot on the upper Godwin-Austen Glacier
// (docs/mountains/k2.md). Every stage is on snow and ice and nothing grows on the course. The rock is the dark
// grey-brown gneiss and granite of the K2 massif, darkest across the Black Pyramid of the south-east ridge (about
// 6650-7350 m); the face below the Shoulder is 40-50 deg snow and ice couloirs between rock ribs; at its foot the
// glacier is white, crevassed, snow-covered ice, with the first grey medial moraine stripes toward K2 Base Camp.
// The stream is a meltwater channel cut in the snow and ice: clear deep blue supraglacial water (no rock flour on the
// ice yet; the milky water only leaves the Baltoro snout, 60 km away).
// The paintings sit at the real bearings of what they show (computed from the stage frames of world.json):
//   - k2.jpg (stages 1-2), Broad Peak and the Gasherbrums from Camp 3 on the south-east ridge at sunrise: Broad Peak
//     North at 154-155 deg, Broad Peak at 147-150, Gasherbrum IV at 145-147, Gasherbrum I-III at 135-138, 4-24 km;
//   - k2-glacier.jpg (stage 3), the Godwin-Austen from above with its medial moraines: Chogolisa at 170-172 deg and
//     Masherbrum at 220, 27-31 km (until it exists, k2.jpg as on the face);
//   - k2-summit.jpg (K2 from Concordia) is the lobby and results picture only: on every stage K2 itself is within
//     4 km, the real 3D ground, so no painted second K2 stands behind the start.
// Broad Peak and the Gasherbrums: their real bearings put the painting's centre at 143 deg, 40 deg wide (the photo
// spans about 32: a little wider, so it still fills a split view); its distant horizon is row 0.40, seen from 7700 m
const VIEW = { file: 'k2.jpg', azimuth: 143, width: 40, row: 0.4, elevation: -1.5, eye: 7700, distance: 9000, baseHaze: [0.86, 0.97, 0.5] };

export default {
  // a low sunrise sun (as in both paintings) on snow: warm peach where it strikes, lavender-blue in the shade, a
  // softer sky fill than on the green worlds so the snow keeps its shading
  sun: { relative: -108, elevation: 21, color: '#ffd0a4', intensity: 3.3 },
  fog: { color: '#e2cfd8', density: 0.00006, max: 0.68 }, // thin, clear air at 5000-8600 m
  hemi: { sky: '#b0bae4', ground: '#aaa6c0', intensity: 1.9 }, // the bounce off snow, not off grass
  exposure: 1.1,
  // the sky of k2.jpg carried on past its side edges (the default peach stood there as a flat salmon block): the
  // deep purple of its top row from 4 deg up, mauve over its ridges, its salmon horizon band; under the horizon
  // (it dips 3 deg from 7000-8600 m) no sky at all but the haze over the far ranges, as under the painting (mist),
  // where the camera on the face looks down past the painting's sides. Measured on the file: row 0.4 near -3.4 deg
  // from about 8000 m, 17 deg per image height. The glow, low toward the sunrise, the orange of its lit ridges.
  sky: {
    stops: [[-6, '#d4cde0'], [-3.5, '#b9a9bf'], [-2.2, '#cc8a70'], [-0.5, '#b37e78'], [1.5, '#8f6a7a'], [4, '#6f5a71'], [50, '#5e4f6e']],
    glow: '#e9a477', glowStrength: 0.4,
  },
  // carry 2: past its sides the painting's own sky and its mist go on for two painting widths (80 deg each way), so
  // the narrow view of Broad Peak and the Gasherbrums is not a framed picture on the flat gradient where the course
  // bends east or west of it;
  // footLift 0.4 (the default): on the face the painting sinks to the far edge of the 3D ground, so no flat band of
  // extended sky opens between the painted ranges and the real ridges (on the summit stage it does not, below);
  // mist: under the painting, where the 3D ground ends, a pale lavender haze over the far glaciers (the painting's
  // own foot gives a tan that reads as a desert plain)
  backdrop: { ...VIEW, summit: 'k2-summit.jpg', summitAt: { row: 0.72, elevation: 0.4, baseHaze: [0.72, 0.8, 0.55] }, summitEye: 4700, summitDistance: 12000, footLift: 0.4, carry: 2, mist: '#d4cde0' },
  terrain: {
    // the bare ground where no snow, ice or rock patch lies: old grey-blue glacier ice and firn, not soil or grass
    meadowY: '#c9d2dc', meadow: '#bcc7d3', meadowF: '#b1bdcb', meadowD: '#a6b2c2', forest: '#a6b2c2',
    scree: '#b4c0ce', screeD: '#a2afc2', // between the snow and the rock, the steep ground is bare blue-grey ice, not rubble
    rock: '#5f5e66', rockB: '#504f58', rockShade: '#4a4a66', // dark grey gneiss and granite, slate as in the paintings (the low sun adds the salmon)
    rockBand: { alt: [6650, 7350], color: '#47424a', soft: 60, slope: [40, 52] }, // the Black Pyramid: the dark cliff band of the south-east ridge, bare where the snow elsewhere holds
    snow: '#fbfaf8', snowShade: '#bcc6ea', ice: '#dde8f0', iceD: '#b4cadf', moraine: '#8e8886', moraineD: '#6e6a6a',
    bank: '#e9eef5', bankD: '#c5d0e6', bankWet: '#84a9cc', bed: '#6aa2cc', // a channel cut in snow and ice: lit snow, blue shade, wet blue ice
    treeline: 0, alpine: 4200, rockFrom: 4000, rockSlope: [72, 82], snowAbove: 5150, snowSlope: 52, iceAbove: 4700, moraineBand: [4700, 5080],
    coverNoise: [36, 0.4], // the steepness more than the noise draws the patches: rock on the ribs and steps, snow in the couloirs
    smooth: { passes: 14, normalPasses: 3, from: [0.85, 1.3] }, // the 30 m DEM's steps on the flat glacier rounded off
    massif: { from: 99999 }, // gneiss and granite, not dolomite
  },
  // clear supraglacial meltwater; the channel walls slope as cut in ice rather than in steps
  water: { deep: '#2a7fbe', base: '#43a0d8', light: '#8acdf0', far: '#a6d5ee', foam: '#f6fbff', bankRamp: 0.3, bankReach: 14 },
  rocks: { color: '#8c8688', shade: '#6a6670' }, // gneiss boulders riding on the ice
  trees: { kinds: [], shrubs: { kinds: [] } },
  camera: { keepAhead: 0.85 }, // the face is a 78-98 % slope: a drop in the air must not tip the view into the sky
  stages: {
    // from 8566-7168 m the 3D ground's far edge is the glacier 3 km below: sinking the painting's horizon row there
    // would drop Broad Peak to the bottom of the view, so it stays at its real height (Broad Peak 8051 m about level)
    'summit-shoulder': { backdrop: { summit: null, footLift: 90 } },
    'south-east-face': { backdrop: { summit: null } },
    // the foot of the face: the glacier turns south-west; Chogolisa (x 0.13 of the painting) and Masherbrum (x 0.82)
    // at their bearings put the centre at 197 deg, 72 wide; their summits (row 0.13) about 5 deg up, as from 5100 m.
    // The 3D walls of the Godwin-Austen dissolve into the painted ranges from 3 km (Masherbrum then stands at the end of
    // the glacier); the K2 face behind stays the solid 3D ground (no painting covers that way). carry 1.2: its blue sky
    // goes on 86 deg past each side, round to the face behind.
    'face-foot': {
      // the blue morning sky of k2-glacier.jpg (not the purple dawn of the face): pale peach-lavender on its ridges
      // (rows 0.2-0.25, 1-3 deg up), blue from row 0.1 (6 deg) up to its top row (9 deg); the same seven stops as
      // the world's sky, so the renderer swaps the colours in place
      sky: {
        stops: [[-8, '#ecd6cc'], [1, '#e8d2c8'], [3, '#cfc0c8'], [4.5, '#b4b8cc'], [6, '#9eb1cf'], [9, '#7ca5ce'], [50, '#6a96c6']],
        glow: '#f6d6bc', glowStrength: 0.3,
      },
      backdrop: {
        file: 'k2-glacier.jpg', azimuth: 197, width: 72, row: 0.13, elevation: 5, eye: 5100, distance: 30000, baseHaze: [0.36, 0.47, 0.6],
        summit: null, cut: [3000, 4500], carry: 1.2, mist: null, fallback: { ...VIEW, carry: 2 },
      },
    },
  },
};
