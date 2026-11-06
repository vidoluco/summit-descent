// Per-world look, data driven. The renderer's theme for a world is, deep merged in this order (mergeTheme: objects
// merge key by key, arrays and scalars replace):
//   1. themes/default.js        every key the renderer reads, with the Dolomiti values (the shared default);
//   2. themes/<id>.js           what differs in that world, selected by world.json "id" (THEMES below);
//   3. world.json "look"        its sections that are theme sections (same shape as a theme file; the bake writes
//                               only backdrop, with the theme's own file names, next to facts the merge skips);
//   4. createRenderer({ theme }) the caller's overrides (debug page, tests).
//
// A theme file exports one plain object (no code) with any of these sections, each documented in default.js:
//   sun, hemi, shadow, sky, fog        light and haze: golden hour everywhere, tinted per place; sun.relative
//                                      (deg from the stage's downhill heading) puts the key light where the
//                                      painting has it, else sun.azimuth is absolute
//   backdrop                           the painting (assets/backdrops/<file>), the summit painting (summitAt: its
//                                      own row, elevation, width, baseHaze), how they sit on the horizon (row,
//                                      elevation, width; footMin/footLift: how far the painting the view faces
//                                      sinks to the far edge of the 3D ground), their side continuation, and the
//                                      distances (cut) where the 3D terrain dissolves into them (blur while it does)
//   terrain                            ground colours and the altitude bands that pick them: meadow below the
//                                      treeline, scree above `alpine`, rock on steep ground above `rockFrom`,
//                                      snow above `snowAbove`, glacier ice above `iceAbove`, moraine rubble in
//                                      `moraineBand`, earth banks; `massif` carves Dolomite walls (off where the
//                                      rock is not dolomite); rock, snow and ice are drawn as crisp patches
//                                      (coverNoise); rockBand tints one real stratum of the rock (Everest's
//                                      Yellow Band), rockStrata draws the bedding of layered limestone;
//                                      highGrass the short alpine turf above the treeline; tints colours whole
//                                      altitude bands (bare ash, the ground between scrub), fields draws farmland
//                                      plots below an altitude
//   trees                              `kinds` (conifer / round / shrub / fern shapes, share, altitude band, height,
//                                      colours), the treeline comes from terrain.treeline; `shrubs` the scrub
//                                      above it up to shrubs.line; cover (a number or a curve by altitude) closes
//                                      or opens the canopy
//   water                              stream colours (glacial milk where the water comes off a glacier), foam; bankRamp
//                                      and bankReach shape the ground beside the stream into sloping cut banks
//   rocks, outline, camera, drop ...   rarely changed per world
//   stages                             { <stage id>: theme sections } merged over the rest for that stage only, where
//                                      one course crosses more than one landscape: its banks, bed and water (snow and
//                                      ice banks with clear meltwater on a glacier, earth and milky water below the
//                                      snout), trees, and its paintings (backdrop: file null shows none there, the
//                                      real 3D far terrain; summit null none behind the start; summitOffset turns
//                                      the summit painting to its real bearing). The ground colours of the
//                                      stage grid must stay those of the world's far terrain it blends into.
// Altitudes are real metres above sea level, so the bands come straight from the research in docs/mountains/.
import { DEFAULT_THEME } from './default.js';
import { mergeTheme } from '../theme.js';
import dolomiti from './dolomiti.js';
import antelao from './antelao.js';
import svizzera from './svizzera.js';
import carpazi from './carpazi.js';
import everest from './everest.js';
import k2 from './k2.js';
import indonesia from './indonesia.js';

export { DEFAULT_THEME };
export const THEMES = { dolomiti, antelao, svizzera, carpazi, everest, k2, indonesia };

// The theme of a world: world is a loadWorld() result, its world.json or just an id. Unknown ids get the default.
export function themeFor(world, over) {
  const json = typeof world === 'string' ? { id: world } : world?.json || world || {};
  let t = mergeTheme(DEFAULT_THEME, THEMES[json.id]);
  // only the theme sections of the baked look: its facts (treeline, treeSpecies, ground, waterType, fauna, sources;
  // docs/world-format.md, "look") are for reading, not render settings
  if (json.look && typeof json.look === 'object') t = mergeTheme(t, Object.fromEntries(Object.entries(json.look).filter(([k]) => k in DEFAULT_THEME)));
  return mergeTheme(t, over);
}

// The painting files of a theme: { view, summit } names in assets/backdrops/ (null when the theme has none).
export function backdropFiles(theme) {
  const B = theme.backdrop || {};
  return { view: B.file || null, summit: B.summit || null };
}
