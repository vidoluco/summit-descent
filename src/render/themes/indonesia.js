// Indonesia, Mount Kerinci (3805 m), Sumatra: the active volcano's ash cone, the scrub and the mossy upper montane
// forest along the Sungai Kering, the Kerinci Seblat forest edge and the vegetable fields of Bengkolan Dua
// (docs/mountains/indonesia.md). The bands are those of Ohsawa et al. 1985 (J. Trop. Ecol. 1: 193-216), measured on
// this mountain: forest from 1750 m (where the natural forest starts above the farms) to the forest limit at
// 2950 m, ericaceous scrub from there to the upper limit of vegetation at 3250 m, bare grey-brown ash, scoria and
// dark andesite above (no snow, no ice). Below the park edge (1804 m on the line) the fields of potatoes, cabbages
// and chillies, with copses of Kerinci cinnamon (Cinnamomum burmannii, the "Korintje" cassia) and trees along the
// stream; the Kayu Aro tea estate lies west of the line, so no tea rows are drawn. The stream runs clear over dark
// volcanic sand and grey andesite boulders, a little tea-green, never glacial.
// The view painting (Lake Kerinci from Bukit Kayangan) is turned so the lake sits at its real bearing from the line,
// about 158 deg (the lake's middle at -2.15, 101.45 against the summit at -1.70, 101.27): 8 deg right of the
// stages' downhill heading of about 143 deg, where the painting's centre would put it.
export default {
  sun: { relative: -105, elevation: 17 },
  fog: { color: '#eed2c2', density: 0.00017, heightFalloff: 0.0004, base: 1500, max: 0.86 },
  hemi: { sky: '#bccbd8', ground: '#8fae62' },
  backdrop: { file: 'indonesia.jpg', summit: 'indonesia-summit.jpg', summitAt: { row: 0.64, elevation: 0.6, baseHaze: [0.64, 0.74, 0.55] }, row: 0.46, elevation: -6.8, width: 62, offset: 8, eye: 3000, distance: 40000, summitEye: 1500, summitDistance: 9000, baseHaze: [0.27, 0.46, 0.93], mist: '#b7b2aa' },
  terrain: {
    meadowY: '#93ba4a', meadow: '#7bb246', meadowF: '#62a243', meadowD: '#4a8a3e', forest: '#3b5b30', // wet tropical greens, the dark forest floor
    scree: '#8f8082', screeD: '#706668', // grey-brown ash and scoria of the cone (warm in the low sun)
    rock: '#6f6460', rockB: '#5f5653', rockShade: '#585070', // dark andesite lava
    bank: '#966447', bankD: '#74503d', bankWet: '#553e33', bed: '#66786a', // dark brown andosol, dark volcanic sand under the water
    treeline: 2950, alpine: 3250, rockFrom: 2900, snowAbove: 99999, rockSlope: [48, 60],
    massif: { from: 99999 },
    forestTint: 1,
    // the park's forest floor (moss, ferns, gingers and leaf litter, dark under the closed canopy: no lawn even in the
    // open strip along the stream); the scrub zone between the forest limit and the vegetation line: grey ash and
    // scoria between the bushes (the summit photos: dark-olive cantigi clumps on bare ash, no turf); above about
    // 3200 m bare ash on gentle ground too (ESA WorldCover: 79 % bare in the upper half of stage 1), grey-brown with
    // reddish-brown scoria in broad patches (the cone of indonesia-summit.jpg and its source photo)
    tints: [
      { alt: [1800, 2950], color: '#445e33', amount: 0.95, vary: 0.3 },
      { alt: [2950, 3200], color: '#7a736b', amount: 0.9, vary: 0.3 },
      { alt: [3200, 4000], color: '#8b7f84', amount: 1, vary: 0.1 },
      { alt: [3200, 4000], color: '#8a6a5e', amount: 0.55, vary: 1 },
    ],
    // the radial gullies of the cone: dark andesite out on the ribs between them, ash down the gullies
    ridges: { reach: 60, depth: 8, shift: 14 },
    // the vegetable plots below the park edge: potatoes and chillies (dark rows), cabbages (blue-green), leeks and
    // young crops (light), fresh tilled earth; a few plots lie fallow under grass
    fields: { below: 1790, size: [34, 15], angle: 32, share: 0.85, edge: 1.6, colors: ['#4f7d33', '#6b9a3a', '#93b98a', '#b4cc6a', '#86644a', '#c8c86a'] },
  },
  water: { deep: '#3d7a6e', base: '#5e9a86', light: '#98c4a6', far: '#a6c8b2' },
  rocks: { color: '#8e8986', shade: '#6a6664' }, // grey andesite boulders in the bed
  stages: {
    // the summit gully is cut in scoria and ash: grey-black banks over dark volcanic sand, not the brown andosol below
    summit: { terrain: { bank: '#5d5653', bankD: '#4c4644', bankWet: '#3a3533', bed: '#5d6862' } },
  },
  trees: {
    maxSlope: 52, clearing: [2.5, 7], wall: 30, density: 0.7, spacing: 7.5, farRing: 450, farSpacing: 14, // the forest stands on the steep gully sides too
    // a closed canopy in the park, only copses and strips along the stream in the fields below its edge
    cover: [[1740, -0.6], [1820, 0.6], [2850, 0.55], [2950, 0.3]],
    kinds: [
      // lower and middle montane forest, up to about 2400 m: oaks and chestnuts (Lithocarpus, Castanopsis, Quercus),
      // laurels and Schima, a layered canopy of broad crowns closing over the dense understory (no bare poles at the
      // forest wall), with solitary giants above it
      { name: 'lower montane forest', shape: 'round', share: 0.5, alt: [1750, 2450], height: [13, 26], width: 1.3, lean: 6, colors: ['#2f5e34', '#3a6a38', '#2a5530', '#46723c', '#355f36'] },
      // upper montane mossy forest to the forest limit: low and gnarled, leaning, the crowns broken into clusters and
      // grey-olive with the moss that hangs from every branch (Ohsawa 1985: 2300-2950 m)
      { name: 'upper montane mossy forest', shape: 'stone-pine', share: 0.8, alt: [2300, 2950], height: [6, 12], width: 1.5, lean: 14, colors: ['#5c6c44', '#66744a', '#53643f', '#6f7a4e'] },
      // the dense understory under the canopy: saplings, rattans, gingers, ground ferns
      { name: 'understory', shape: 'shrub', share: 0.5, alt: [1750, 2900], height: [3, 6.5], width: 1.7, colors: ['#355f30', '#2f5a2e', '#406a36', '#4a6f38'] },
      // tree ferns (Cyathea), the signature of the place: 5-8 m, frequent in the gaps and along the stream
      { name: 'tree fern', shape: 'fern', share: 0.4, alt: [1750, 2650], height: [5, 8], width: 1.15, colors: ['#5f9a3e', '#6ea544', '#558f3a'] },
      // below the forest: Kerinci cinnamon gardens and riparian trees among the fields
      { name: 'cinnamon garden', shape: 'round', share: 1, alt: [1300, 1790], height: [7, 13], width: 0.75, colors: ['#4f8a3c', '#5d9540', '#6e9a45', '#457e38'] },
    ],
    shrubs: {
      // the scrub zone: cantigi (Vaccinium varingiifolium), Rhododendron, Gaultheria, Leptospermum in sparse clumps on
      // the ash, dark olive, some yellow-green, the young leaves reddish
      kinds: [
        { name: 'ericaceous scrub', shape: 'shrub', share: 1, alt: [2850, 3300], height: [0.8, 2.4], width: 2.0, colors: ['#56603a', '#5f683c', '#4c5636', '#7d8a44', '#7a5e40'] },
      ],
      line: 3250, density: 0.32,
    },
  },
};
