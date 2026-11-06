// Every species the game can draw, merged from the species files, the readability scale of each, and
// which species live in each world. Pure (no three.js), so the behaviour, the tests and the tools read it
// in Node too. How a species file plugs in is written at the top of index.js.
import * as ALPS from './species.js';
import * as CARPATHIANS from './species-carpazi.js';
import * as ASIA from './species-asia.js';

export const SPECIES = {};
export const SCALE = {};
export const WORLDS = {};
export const VARIANTS = {};

const FILES = [ALPS, CARPATHIANS, ASIA];
// A file that exports its tables: SPECIES (id -> spec), SCALE (id -> factor), WORLDS (world -> ids), and
// optionally VARIANTS (world -> {kind: species drawn instead}).
for (const file of FILES) {
  for (const [id, spec] of Object.entries(file.SPECIES || {})) {
    if (SPECIES[id]) throw new Error(`animals: species ${id} defined twice`);
    SPECIES[id] = spec;
  }
  Object.assign(SCALE, file.SCALE || {});
  for (const [world, ids] of Object.entries(file.WORLDS || {})) {
    if (WORLDS[world]) throw new Error(`animals: world ${world} listed twice`);
    WORLDS[world] = ids;
  }
  for (const [world, map] of Object.entries(file.VARIANTS || {})) VARIANTS[world] = { ...VARIANTS[world], ...map };
}

// The species drawn for a spawn kind on a world: its seasonal variant (VARIANTS), or the kind itself.
export const drawnAs = (world, kind) => VARIANTS[world]?.[kind] ?? kind;

// The species to load for a world: its list, or every species for an unknown world (a fixture, the lineup).
export function speciesOf(world) {
  const ids = WORLDS[world];
  return ids ? [...ids] : Object.keys(SPECIES);
}
