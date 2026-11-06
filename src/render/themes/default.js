// The shared default look of the race renderer: every key the renderer reads, with the values of the first world
// (the Dolomiti of Monte Peralba, in the "Cartoon premium" style of docs/mockups/gemini-reference-cartoon.png).
// A world's theme file (themes/<id>.js) overrides only what differs there; themes/index.js documents the API.
// Colours are sRGB hex strings. Distances in metres, angles in degrees, altitudes are real (global) metres.

export const DEFAULT_THEME = {
  // Golden hour, morning alpenglow: a low warm sun from the east-north-east lights the pale Dolomite walls
  // pink-salmon while the valley sits in cool lavender shade.
  sun: {
    azimuth: 68, // deg clockwise from north (north is -z, east is +x)
    elevation: 24, // deg above the horizon
    color: '#ffdcb4',
    intensity: 2.7,
    wrap: [-0.32, 0.62], // soft light ramp: dot(n, sun) from shade to full light (cartoon terminator)
  },
  hemi: { sky: '#cdd2d6', ground: '#b8be78', intensity: 2.15 }, // a bright soft fill: the shade side of a meadow stays yellow-green, as in the reference
  shadow: {
    size: 2048, // px, one shadow map, re-centred on each view's drop
    extent: 150, // m half side of the shadow box around the drop
    bias: -0.0004,
    normalBias: 0.04,
    radius: 3, // PCF softness
    darkness: 0.55, // 0 none .. 1 black (applied as light intensity in shadow)
  },
  sky: {
    // elevation (deg) -> colour, lavender overhead, pink, warm peach at the horizon (the sky without a painting,
    // and the environment the glossy drops reflect)
    stops: [[-8, '#f6d3b9'], [0, '#f8d2b6'], [4, '#f5c6bd'], [9, '#f0bfc8'], [16, '#e3bbd5'], [26, '#d2b7dd'], [50, '#c4b3de']],
    glow: '#fde3c4', // soft halo low around the sun's azimuth
    glowStrength: 0.5,
    glowWidth: 0.35, // rad
  },
  // The painted backdrop (paint.js): one painting of the real view looking downhill along the course, on a
  // camera-centred cylinder at the horizon, and optionally one of the summit itself on the opposite azimuth.
  // The sky around them is each painting's own sky extended from its top rows, the ground below them its base
  // mist; the 3D terrain, trees and water turn into that mist and end at `cut` (where the painting shows land).
  backdrop: {
    file: null, // file name in assets/backdrops/ (null: no painting, the gradient sky and the 3D far terrain)
    summit: null, // the summit view, shown on the opposite azimuth (behind the start, looking back uphill)
    summitAt: null, // { row, elevation, width, baseHaze } of the summit painting where its composition differs from the view's
    summitOffset: 0, // deg the summit painting is turned from the exact opposite of the view (its real bearing)
    fallback: null, // backdrop keys used instead where `file` is missing from assets/backdrops (a stage's own painting not made yet)
    mist: null, // colour of the base mist under the painting and of the haze it lends the 3D ground (null: read from the painting's foot)
    azimuth: null, // deg clockwise from north of the painting's centre; null: each stage's downhill heading
    offset: 0, // deg added to that heading
    width: 60, // deg of azimuth the painting spans (undistorted at the horizon: its height follows from the aspect)
    row: 0.77, // image row (0 top, 1 bottom) of the massif's foot, where the painted valley begins
    elevation: 1.5, // deg above the horizon of that row, for a viewer at the painting's own altitude
    eye: null, distance: 8000, // m: the real altitude the view was painted from and the distance of its massif
    summitEye: null, summitDistance: null, // the same for the summit painting (null: as the view)
    edge: 10, // deg inside each side edge over which the painting fades into the gradient sky and, under its foot, its base mist
    carry: 0, // painting widths past each side edge over which its edge column's own sky (and under its ridge its base mist) carries on, fading into the gradient sky; 0: none
    skyFade: 0.35, // image heights above the painting over which its own sky fades into the gradient sky
    topFeather: 0.07, // image heights: a wall cut by the painting's top edge dissolves into the sky over its top rows
    baseHaze: [0.79, 0.9, 0.55], // image rows where the painting's own base turns into its mist (the second: its foot), and how much
    cut: [2600, 4000], // m: the 3D terrain, trees and water turn into the base mist between these horizontal distances, and end (where the painting shows land)
    below: 0.015, // tan of the band under the painting's foot where the far terrain turns into the base mist
    footMin: -24, footLift: 0.4, // deg: the painting sinks to the far edge of the 3D ground (+ footLift), never below footMin
    fogTint: 0.55, // the 3D haze colour is moved this far toward the painting's base mist
    sample: [396, 168], // px of the low resolution copy the sky extension and the base mist are read from
  },
  fog: {
    color: '#f2d0c6', // haze matches the horizon of the sky
    density: 0.00013, // 1/m, exponential with distance
    heightFalloff: 0.0006, // 1/m above fog.base, thinner haze up the mountains
    base: 900, // m, real altitude of the thickest haze (the valley floor)
    max: 0.82, // haze never fully hides the far massif
  },
  terrain: {
    // altitude and slope bands (real metres, degrees)
    meadowY: '#cdd35a', meadow: '#a3c957', meadowF: '#84b657', meadowD: '#7fa552', forest: '#557a44',
    scree: '#e8b28e', screeD: '#cc967a', // warm and saturated, so the shade on it reads lavender rather than grey
    rock: '#ecd8cf', rockB: '#dfc8c3', rockShade: '#a690b3', // pale pink-grey dolomite (the low warm sun adds the salmon)
    snow: '#fff8f2', snowShade: '#c6cdea',
    ice: '#dcecf4', iceD: '#a9c9dc', // glacier ice (bare, blue-white), only above iceAbove
    moraine: '#a49a92', moraineD: '#857b76', // grey rubble: lateral moraines and debris-covered ice
    bank: '#bf7a52', bankD: '#94604a', bankWet: '#7d5a4c', bed: '#7aa4b4',
    treeline: 1900, // m, the forest tint and trees stop around here
    alpine: 2150, // m, meadows turn to scree and rock above (alpine pasture up to here, as on the Peralba)
    bareAbove: null, // m, above this even the gentle ground is bare scree (null: some pasture stays on it, as below)
    rockSlope: [56, 66], // deg, ground turns to rock between these slopes (higher up it starts earlier)
    rockFrom: 1500, // m, no bare rock below this altitude on gentle slopes (forest soil and meadow cover it)
    snowAbove: 2250, // m, snow on gentle ground (patches from 250 m lower)
    snowSlope: 46, // deg, steeper than this the snow does not hold
    snowNoise: 260, // m the patch noise moves the snowline up and down (patches below it, bare spots above)
    iceAbove: null, // m, gentle ground above this is glacier ice (null: no glacier)
    iceSlope: null, // deg, steeper than this no bare glacier ice (null: snowSlope)
    ridges: null, // { reach m, depth m, shift deg, alt m }: rock out on the ribs and snow in the gullies (palette.js; null: by slope only)
    moraineBand: null, // [from, to] m: rubble on the gentle ground in this band (null: none)
    tints: [], // ground tints by altitude band: [{ alt: [from, to] m, color, amount, vary }] (palette.js)
    fields: null, // farmland below an altitude: { below, size: [along, across] m, angle, share, colors, edge, maxSlope } (palette.js; null: none)
    highGrass: null, // the short alpine grass above the treeline: { color, from, to (m, where it comes in), amount } (palette.js; null: the meadow colours all the way up)
    forestTint: 0.35, // how dark-green the ground under the forest gets on the backdrop
    bankWidth: [0.85, 1.2], // fraction of hw: the warm earth bank between these lateral distances
    bankHeight: 2.6, // m above the water, the bank fades into the meadow
    bankBand: { width: 2.4, wet: 0.55, line: 0.18, wetTone: 0.62, lineTone: 0.34, lift: 0.16 }, // m: the opaque earth band up the bank from the waterline (wet foot, lit earth, a dark line on top)
    smooth: { passes: 6, normalPasses: 2, from: [0.85, 1.3] }, // the ground beyond the bed (x hw from the stream) is blurred into rounded forms; shading from one more pass
    coverNoise: [38, 0.5], // rock, snow and ice patches (materials.js): m per noise cell, how far the noise moves their edges
    coverBlur: [0, 0], // passes of blur over the cover weights of the stage grid and the backdrop (terrain.js blurCover): smooth patch edges where the weights flip within a cell
    rockBand: null, // { alt: [from, to] real m, color, soft m, amount, slope?: [deg, deg] }: one stratum of the rock cover in another colour (in beds), bare of snow from these slopes when it forms a cliff band (null: none)
    rockStrata: null, // { spacing m, tone, wobble m }: thin dark bedding lines across the rock cover, as on layered limestone (materials.js; null: none)
    coverEdge: 0, // darkness of a thin inked line round the rock patches, the outline of an outcrop (materials.js; 0: none)
    facetSize: 12, // m, light low-poly hint: world-space triangle lattice size near the camera
    facetTilt: 0.06, // normal tilt per facet (a hint: the shading stays smooth)
    facetTone: 0.045, // +-albedo per facet
    noiseScale: [160, 55], // m, the two colour noise octaves
    // the painterly light wash of the reference: the ground to the left of the view glows warm in the low sun, the
    // right side sits in a cooler shade; strength, reach (m from the camera where it fades out), warm and cool tints
    wash: { strength: 0.55, reach: [140, 800], warm: [1.1, 1.0, 0.86], cool: [0.84, 0.9, 0.92] },
    massif: { from: 1750, gully: 80, gullyWidth: 180, crest: 80, keep: 200, terrace: 110, riser: 0.62, apron: 0.85, crease: 0.55 }, // Dolomite walls carved into the far high rock (m): gullies, crest notches, terraces of `terrace` m whose wall takes the last (1 - riser) of each step, a snow apron under them, crease lines on them; fading in from keep to 2 keep m off the stages
  },
  lod: {
    nearCourse: 110, // m from the course: stage grid at full 4 m inside, 8 m outside
    backdropUpsample: 2, // the 60 m backdrop is drawn at 30 m (bicubic, rounded forms)
    backdropNear: 3200, // m from the stage grids: the upsampled backdrop at full resolution inside, 2x coarser beyond
    edgeBlend: 64, // m at the stage grid border blended onto the backdrop surface
    skirt: 6, // m the stage border hangs down to hide hairline cracks
    buildBudget: 3, // ms per update() spent building the stages not on screen yet (each built once, then swapped in)
  },
  water: {
    depth: 0.3, // m, water level above the bed
    maxWidth: 1.1, // the sheet never reaches farther than this x hw from the centre
    rowStep: 2, // m between water rows along the stream
    columns: 14, // lateral vertices per row
    overlap: 1.0, // m the sheet extends past the waterline into the bank
    curl: 1.4, // m the outer edge of the sheet dips under the bank
    deep: '#3d94d4', base: '#55ade0', light: '#8ccfee', far: '#9fd3ea', foam: '#fbfdff',
    flow: 2.2, // m/s the surface patterns drift downstream (scaled by the slope)
    patch: [7, 2.4], // m, size of the soft lighter/darker patches (along, across)
    facet: [2.6, 1.5], // m, low-poly facets in stream space
    facetTone: 0.05, // a light low-poly hint, not a checkerboard
    foamEdge: [0.6, 2.0], // m, edge foam width range (clumps)
    foamBend: 1.4, // extra edge foam on the outside of bends
    rapidSlope: [0.3, 0.65], // bed slope where foam streaks start / the water turns white
    waterfallSlope: 1.3, // slope above which the sheet is a waterfall (white, vertical streaks)
    rockFoam: 0.6, // m of foam ring around a rock, plus a wake downstream
    bankRamp: 0.45, bankReach: 8, // past the sheet the ground stays under a ramp this steep (rise per m) for this many m: cut banks, not stairs
    endPool: 0.9, // x hw: the course's sheet runs this far past the finish and closes in a rounded end
    stones: null, // { size m, amount (in the shallows), clear (across the sheet), reach m }: a stony bed seen through clear water (null: none)
  },
  trees: {
    spacing: 5.5, // m between candidate trees on the stage grid
    farSpacing: 11, // m on the backdrop ring around the stage grid
    farRing: 900, // m of forest drawn on the backdrop around the stage grid
    clearing: [14, 26], // m of open meadow beyond the bank (min, max, noisy)
    wall: 40, // m wide dense framing wall of conifers past the clearing
    density: 0.55,
    cover: 0.15, // shifts the clump noise of the forest (terrain.js forestAt): higher closes the glades between clumps; or [[alt, cover], ...]
    maxSlope: 36,
    height: [11, 21], // m, for kinds that do not give their own
    width: 1.0, // horizontal scale / height (the unit tree's crown radius is about 0.28)
    // What grows here: each candidate spot below the treeline takes one kind, by share, among the kinds whose
    // altitude band holds it. shape: 'conifer' (tiered spruce, fir, larch, pine), 'round' (a broadleaf crown:
    // beech, montane rainforest), 'shrub' (low mounds: dwarf pine, juniper, rhododendron, heath, tea bushes) or
    // 'fern' (a tree fern: slender trunk, rosette of arching fronds).
    // alt: [from, to] real metres (soft edges); height: [min, max] m; width: crown width / height; lean: deg, up to
    // this far each tree leans its own way (gnarled forest; default 0).
    kinds: [
      { name: 'spruce', shape: 'conifer', share: 0.88, alt: [0, 2100], height: [11, 21], width: 1.0, colors: ['#3d6a47', '#355f41', '#2f573f', '#46744a', '#4f7b47', '#3a6644'] },
      { name: 'larch', shape: 'conifer', share: 0.12, alt: [1100, 2300], height: [10, 19], width: 0.9, colors: ['#7f9444', '#8f9e4a', '#73893f'] },
    ],
    // scrub above (and among) the trees, in patches: dwarf pine, juniper, rhododendron (none: kinds empty)
    shrubs: { kinds: [], line: 0, density: 0.5, spacing: 4.5, maxSlope: 40 }, // line: m, the scrub stops here
    trunk: '#5b3d2b',
    lod: [90, 380, 2600], // m from the camera: detailed tiers, medium, cheap; none beyond
    lodCap: [1500, 9000, 16000], // instances per band and view (all shapes together share these caps per shape)
    cone: 0.62, // cos of the horizontal half angle of trees kept in front of the camera
  },
  // field: the boulder fields of the open ground beside the course (rocks.js fieldRocks; null: none)
  rocks: { color: '#b3abb0', shade: '#8f8590', scale: 1.15, field: null },
  drop: {
    colors: ['#2f80e4', '#ee7fbe'], // P1 blue, P2 pink
    outline: ['#14336e', '#8a2f62'],
    height: 2.9, // teardrop height / sim radius (its widest radius is about the sim radius)
    gloss: 0.18, // roughness
    eye: '#121522', eyeWhite: '#ffffff', smile: null, // smile uses the outline colour
    squash: 0.012, // stretch per m/s of speed along the motion
    squashMax: 0.12, // the silhouette stays the plump HUD drop even at full speed
    lean: 0.3, // rad of lean per (rad/s of turn rate x speed / 30)
    leanMax: 0.22,
    bob: 0.05, // m of idle bobbing
    ice: '#d8f3ff', iceOpacity: 0.62, // frost tint while freezing, the ice cube when frozen
    float: 0.12, // in the water at most this share of the drop's height is under the surface (the face stays dry)
    floatUp: 0.3, // and at most this share under the water 4 m upstream (steep runs: the eyes stay in sight of the camera)
    sightAt: 0.25, sightMax: 0.5, // x height: the point under the smile its own camera always sees over the surface just run (up to sightMax of rise)
    evaporate: 1.2, // s of the evaporation fade
    snow: '#ffffff', // the snowflake before the melt
  },
  particles: {
    max: 1400,
    wake: 70, // particles per second per drop at 30 m/s
    splash: 34, // particles per splash event
    size: 0.07, // m
    color: '#ffffff',
    life: [0.45, 1.1], // s
    mist: 18, // particles per second at a waterfall foot
  },
  camera: {
    fov: 46, // deg vertical (narrow, as in the reference: the far massif reads big)
    near: 0.3, far: 32000,
    back: 12, // m behind the drop (low and a little far, as in the reference: the horizon near the middle of the view)
    up: 3.8, // m above the drop
    lookAhead: 34, // m ahead along the course: the heading looks there
    dropAt: 0.76, // the drop's centre sits at this fraction of the view height (from the top)
    dropHeight: 1.3, // x radius: the point of the drop that dropAt refers to
    follow: 5.5, // 1/s position smoothing
    aim: 7, // 1/s look smoothing
    clearance: 1.6, // m above the ground, never closer
    courseBlend: 0.75, // heading from the course tangent (1) or the velocity (0)
    steep: { slope: 0.45, back: 0.8, up: 0.5, dropAt: 0.84 }, // at this bed slope and steeper: back and up scaled by these (closer, lower), the drop lower in the view
    keepAhead: 0.85, // fraction of the half view height: the course lookAhead m on never sits lower under the centre (a drop in the air off a steep face does not tip the view into the sky); null: off
  },
  outline: {
    color: '#2e2630',
    strength: 0.85,
    width: 1.5, // px
    threshold: [0.06, 0.14], // relative depth curvature where the line fades in
    minGap: 0.6, // m, the depth step a line needs (no line on every slope break); never on the water
  },
  divider: { color: '#14121a', width: 6 }, // px between the two halves
  post: { fxaa: true }, // antialias the composite (outlines included) before the canvas
  exposure: 1.04,
  stages: {}, // { <stage id>: theme sections } for that stage only (themes/index.js)
};
