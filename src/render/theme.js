// The look of the race renderer: the shared default (themes/default.js, the Dolomiti of Monte Peralba in the
// "Cartoon premium" style of docs/mockups/gemini-reference-cartoon.png), deep merged with the theme file of a world
// (themes/<id>.js, see themes/index.js) and its world.json "look". createRenderer(canvas, { theme }) merges overrides
// on top (see mergeTheme). Colours are sRGB hex strings. Distances in metres, angles in degrees, altitudes real.
import { DEFAULT_THEME } from './themes/default.js';

export const THEME = DEFAULT_THEME;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Deep merge: objects merge key by key, arrays and scalars replace.
export function mergeTheme(base, over) {
  if (!over) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(base[k]) ? mergeTheme(base[k], v) : v;
  return out;
}

// Unit vector toward the sun in the world frame (x east, y up, z south).
export function sunDirection(sun) {
  const az = (sun.azimuth * Math.PI) / 180, el = (sun.elevation * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}
