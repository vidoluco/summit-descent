// Everest (8849 m), Nepal side: the summit pyramid, the Western Cwm, the Khumbu Icefall and the Thukla moraine step
// into the Lobuche Khola (docs/mountains/everest.md). Above about 5300 m everything is snow and ice (seracs, blue
// crevasses) and dark grey rock; across the summit pyramid, between 8200 and 8600 m, the Yellow Band of yellowish-
// brown marble under the grey Qomolangma limestone of the summit. The lower Khumbu glacier and its lateral moraines are
// grey-brown rubble; at 4400-5000 m only tawny yak pasture turf with dark mats of dwarf juniper and rhododendron
// grows (the treeline of Sagarmatha is near 4000 m: no trees on the course).
// On the three ice stages the stream is a meltwater channel cut in the snow and ice (clear deep blue, as the
// supraglacial streams of the Khumbu: no rock flour yet); below the snout, at Thukla, it is the milky grey-turquoise
// glacial water of the Lobuche Khola between banks of grey glacial gravel (stages, below).
// The painting (everest.jpg: Pumori, Lingtren and Khumbutse over the Khumbu glacier) is the real view down the Cwm
// and the Icefall; on the summit pyramid there is no summit painting (the summit is the 3D ground itself), and at
// Thukla the view south to Pheriche, Taboche, Cholatse and Ama Dablam is the real terrain of the 3D far ground.
const ICE_BANKS = { // a channel cut in snow and ice: lit snow, blue shade, wet blue ice at the waterline
  terrain: { bank: '#e8eef6', bankD: '#c6d2ea', bankWet: '#86aed0', bed: '#6fa9d2' },
  water: { deep: '#2a76bc', base: '#459bd8', light: '#8acdf0', far: '#a6d5ee', foam: '#f6fbff' }, // clear meltwater
};

export default {
  sun: { relative: -108, elevation: 18 },
  fog: { color: '#e8d2d6', density: 0.00007, max: 0.7 }, // thin, clear high-altitude air
  hemi: { sky: '#bcc4dc', ground: '#b0a282' },
  backdrop: { file: 'everest.jpg', summit: 'everest-summit.jpg', summitAt: { row: 0.68, elevation: 0.4, baseHaze: [0.68, 0.78, 0.55] }, row: 0.6, elevation: -0.4, width: 62, eye: 4950, distance: 9000, summitEye: 5600, summitDistance: 9000, baseHaze: [0.55, 0.63, 0.8] }, // painted from the real photo points: near Lobuche (4950 m, Pumori 9 km away) and Kala Patthar (5600 m); the giant moraine boulders of the view's foreground stay in the mist
  terrain: {
    meadowY: '#cdab62', meadow: '#b89a5a', meadowF: '#a98c50', meadowD: '#9a8352', forest: '#5f6a46', // the rust-golden yak turf of October
    scree: '#a5a29c', screeD: '#8a8781', // grey moraine rubble and scree: gneiss and granite, not a warm earth
    rock: '#8e8c8c', rockB: '#7f7c7c', rockShade: '#625e7c', // dark grey schist and gneiss, grey limestone at the top
    rockBand: { alt: [8200, 8600], color: '#cdb486', soft: 45, amount: 0.85, slope: [36, 46] }, // the Yellow Band: beds of marble weathering yellowish brown between phyllite, a cliff band bare of snow
    snow: '#fbfaf7', snowShade: '#bfc8ea', ice: '#d6ebf5', iceD: '#b2d0e4', moraine: '#9b9892', moraineD: '#7b7873',
    bank: '#a19e97', bankD: '#86837d', bankWet: '#64625d', bed: '#8a9ea4', // grey glacial gravel and silt
    rockSlope: [44, 58], // outcrops on the steep moraine and valley sides, not only on cliffs
    treeline: 0, alpine: 4950, rockFrom: 4000, snowAbove: 5600, snowSlope: 50, iceAbove: 5300, moraineBand: [4650, 5400],
    snowNoise: 90, // the snowline follows the ground's form (ribs, gullies) more than the noise: no round bare spots
    iceSlope: 24, // bare ice only on the gentle glacier surfaces (Khumbu, Cwm): the steep faces are snow and rock
    ridges: { reach: 75, depth: 12, shift: 14, alt: 300 }, // the rock out on the ribs, the snow fluted down the gullies and in tongues below the snowline (SW face, Nuptse)
    coverNoise: [24, 0.16], // the ground's form draws the patches, the noise only roughens their edges
    coverBlur: [3, 6], // the weights spread over a few cells: patch edges run smoothly across the 30 m cells, not in steps
    smooth: { passes: 6, normalPasses: 4, from: [0.85, 1.3] }, // slope from a softer copy: the 30 m DEM cells do not show as steps in the cover
    massif: { from: 99999 },
  },
  water: { deep: '#5f99aa', base: '#7fb2bc', light: '#acd1d4', far: '#bccfd2', foam: '#f4f8f8' }, // milky grey-turquoise glacial water
  trees: {
    kinds: [],
    shrubs: {
      kinds: [
        // low, wide mats a few metres across (Juniperus indica, J. squamata), dark blue-green on the golden turf
        { name: 'dwarf juniper', shape: 'shrub', share: 0.55, alt: [3800, 4900], height: [0.6, 1.2], width: 3.6, colors: ['#465a38', '#3e5236', '#52613c'] },
        { name: 'dwarf rhododendron', shape: 'shrub', share: 0.45, alt: [3900, 5000], height: [0.5, 0.9], width: 3.2, colors: ['#6a5a34', '#76603a', '#5e5a36'] }, // R. anthopogon, leaves bronzed in October
      ],
      line: 5000, density: 0.7, spacing: 3.6, maxSlope: 36,
    },
    spacing: 4.5, // candidates for the scrub: clumps close enough to read as mats
  },
  // grey gneiss and granite boulders; on the turf and old moraines of Dughla and Thukla (4400-4950 m) fields of them,
  // the stone walls of the yak pastures built from the same blocks
  rocks: {
    color: '#a5a29d', shade: '#7d7a76',
    field: { alt: [4380, 4960], spacing: 5, share: 0.6, size: 60, r: [0.5, 3.2], clear: 1.3, near: 160, maxSlope: 40, max: 1600 },
  },
  stages: {
    'summit-pyramid': { ...ICE_BANKS, backdrop: { file: null } }, // above everything: the real ranges below, no painting
    // the paintings turned to the real bearings of Pumori (view) and of Everest itself (summit) from mid-stage
    'western-cwm': { ...ICE_BANKS, backdrop: { offset: 24, summitOffset: -55, cut: [4500, 6500] } }, // Nuptse and the west shoulder stay solid 3D walls, Pumori framed in the mouth of the Cwm
    icefall: { ...ICE_BANKS, backdrop: { offset: -12, summitOffset: -26, cut: [1800, 3000], baseHaze: [0.55, 0.63, 0.5] } }, // the painting from nearer: no 3D glacier ghosting through it
    // below the snout the Khumbu Khola is a boulder-bed torrent: white water over the stones, gravel banks that slope
    // down to it (not cut steps)
    thukla: {
      backdrop: { file: null },
      water: { rapidSlope: [0.12, 0.38], foamEdge: [0.9, 2.6], rockFoam: 0.9, bankRamp: 0.3, bankReach: 12 },
    },
  },
};
