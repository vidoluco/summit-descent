// World configs: one JSON file per world in tools/bake/worlds/<id>.json (documented in docs/world-format.md,
// "Bake config"). loadConfig(id) reads, validates and fills defaults; nothing else in the bake knows
// a world by name.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORLDS_DIR = fileURLToPath(new URL('./worlds/', import.meta.url));
// Worlds taken out of the game (27/10/2026: cervino, moldoveanu, rinjani, semeru duplicated a region). Their
// configs stay valid: moving one back to WORLDS_DIR bakes it again.
export const ARCHIVE_DIR = `${WORLDS_DIR}archive/`;
export const DESCENT_KINDS = ['osm-relation', 'osm-ways', 'osm-network', 'dem'];
// world.json "look" (docs/world-format.md, "look"): the words its lists may use
export const GROUND_TYPES = ['meadow', 'forest', 'scrub', 'scree', 'rock', 'moraine', 'glacier', 'snow', 'gravel-bed', 'volcanic-ash', 'farmland', 'tea-garden'];
export const WATER_TYPES = ['clear', 'glacial', 'tropical'];

// Defaults of the short mode, the Dolomiti values; a world config overrides any of them.
export const SHORT_DEFAULTS = {
  spine: { maxKm: 40, sigma: 35, pathSigma: 60 },
  floor: { window: 3000, slope: 0.0125, after: 1500 },
  stages: { count: 4, length: 1700, gap: 300, perGroup: 2 },
  pointStep: 10,
  extend: 200,
  corridor: 250,
  gridStep: 4,
  blur: 10,
  backdropStep: 60,
  backdropMargin: 6000,
  bedAcross: 28,
  iceAbove: 1900,
};

export const listConfigs = () => readdirSync(WORLDS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
export const listArchived = () => (existsSync(ARCHIVE_DIR) ? readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort() : []);

const isLat = (v) => Number.isFinite(v) && v >= -90 && v <= 90;
const isLon = (v) => Number.isFinite(v) && v >= -180 && v <= 180;
const isBbox = (b) => Array.isArray(b) && b.length === 4 && isLat(b[0]) && isLon(b[1]) && isLat(b[2]) && isLon(b[3]) && b[0] < b[2] && b[1] < b[3];
const TILE = /^[NS]\d{2}_[EW]\d{3}$/;

// Throws with every problem found, so a new world is fixed in one round.
export function validateConfig(c, id = c?.id) {
  const errs = [];
  const need = (ok, msg) => { if (!ok) errs.push(msg); };
  need(c && typeof c === 'object', 'config is not an object');
  if (errs.length) throw new Error(`${id}: ${errs.join('; ')}`);
  need(c.id === id, `id "${c.id}" must match the file name "${id}"`);
  need(/^[a-z0-9-]+$/.test(c.id || ''), 'id: lower case letters, digits and dashes only');
  need(typeof c.name === 'string' && c.name, 'name (world.json name) missing');
  need(c.names?.en && c.names?.it, 'names.en and names.it required');
  need(/^[A-Z]{2}(-[A-Z]{2})?$/.test(c.country || ''), 'country: ISO 3166 alpha-2 code (e.g. "IT", "CH", "NP-CN")');
  need(c.summit && typeof c.summit.name === 'string', 'summit.name required');
  need(isLat(c.summit?.lat) && isLon(c.summit?.lon), 'summit.lat/lon required (degrees, negative for S and W)');
  need(c.summit?.names?.en && c.summit?.names?.it, 'summit.names.en and summit.names.it required');
  need(Array.isArray(c.dem?.tiles) && c.dem.tiles.length && c.dem.tiles.every((t) => TILE.test(t)), 'dem.tiles: list like ["N45_E007", "S09_E116", "N36_W118"]');
  const d = c.descent || {};
  need(DESCENT_KINDS.includes(d.kind), `descent.kind one of ${DESCENT_KINDS.join(', ')}`);
  if (d.kind === 'osm-relation') need(d.name || Number.isInteger(d.relation), 'descent: osm-relation needs name or relation id');
  if (d.kind === 'osm-ways') need(Array.isArray(d.ways) && d.ways.length && d.ways.every(Number.isInteger), 'descent.ways: OSM way ids in flow order');
  if (d.kind?.startsWith('osm')) need(isBbox(d.bbox), 'descent.bbox: [south, west, north, east]');
  if (d.kind === 'dem') need(Array.isArray(d.via) || Array.isArray(d.to) || Number.isFinite(d.maxKm), 'descent: dem needs via points, to, or maxKm');
  for (const p of [...(d.via || []), ...(d.summitVia || []), ...(d.to ? [d.to] : []), ...(d.start ? [d.start] : [])]) need(Array.isArray(p) && isLat(p[0]) && isLon(p[1]), `descent point ${JSON.stringify(p)}: [lat, lon]`);
  need(isBbox(c.osm?.bbox), 'osm.bbox: [south, west, north, east] for places and glaciers');
  need(c.osm?.featuresBbox === undefined || isBbox(c.osm.featuresBbox), 'osm.featuresBbox: [south, west, north, east] around the stages, for buildings, roads and lakes');
  need(c.biomes && Object.keys(c.biomes).length, 'biomes required');
  // the bed width: the real stream's short.width table, or else each biome's hw band
  const width = c.short?.width;
  if (width !== undefined) {
    const t = width?.km;
    need(Array.isArray(t) && t.length >= 2 && t.every((r) => Array.isArray(r) && r.length === 2 && Number.isFinite(r[0]) && r[1] >= 4 && r[1] <= 30) && t.every((r, i) => !i || r[0] > t[i - 1][0]),
      'short.width.km: [[river km, half width 4-30 m], ...], km increasing');
    need(width?.wiggle === undefined || (width.wiggle >= 0 && width.wiggle < 0.5), 'short.width.wiggle: a fraction under 0.5');
  }
  for (const [k, b] of Object.entries(c.biomes || {})) need(Array.isArray(b.palette) && (width !== undefined || (Array.isArray(b.hw) && b.hw.length === 2)) && Number.isFinite(b.bank) && Number.isFinite(b.bankW), `biome ${k}: palette, hw [min, max] (unless short.width), bank, bankW`);
  for (const lm of c.landmarks || []) {
    need(lm.id && c.biomes?.[lm.biome], `landmark ${lm.id}: id and a known biome`);
    need(Array.isArray(lm.km) || Array.isArray(lm.alt), `landmark ${lm.id}: km [from, to] or alt [low, high]`);
    need(Array.isArray(lm.names) && lm.names.length && lm.names.every((n) => n.length === 2), `landmark ${lm.id}: names [[it, en], ...]`);
  }
  for (const wf of c.waterfalls || []) need(typeof wf.name === 'string' && isLat(wf.lat) && isLon(wf.lon) && Array.isArray(wf.steps) && wf.steps.length && wf.steps.every((h) => h >= 3 && h <= 30), `waterfall ${wf.name}: name, lat, lon and steps [m, ...] of 3-30 m each`);
  for (const [k, b] of Object.entries(c.biomes || {})) if (b.slot !== undefined) need(b.slot.depth > 0 && b.slot.depth <= 60 && (b.slot.km === undefined || (Array.isArray(b.slot.km) && b.slot.km[0] < b.slot.km[1])) && (b.slot.ramp === undefined || b.slot.ramp >= 50), `biome ${k}: slot {depth 0-60 m, km?: [from, to], ramp?: m in}`);
  for (const [k, v] of Object.entries(c.branches || {})) need(['shortcut', 'safe'].includes(k) && Array.isArray(v) && v.every((id) => (c.landmarks || []).some((lm) => lm.id === id)), `branches.${k}: shortcut or safe, a list of landmark ids`);
  for (const [k, v] of Object.entries(c.weather || {})) need(['sun', 'rain'].includes(k) && (c.landmarks || []).some((lm) => lm.id === v), `weather.${k}: sun or rain, naming a landmark id`);
  if (c.defaultBiome) need(c.biomes?.[c.defaultBiome], `defaultBiome ${c.defaultBiome} not in biomes`);
  need(Number.isInteger(c.animals?.perStage) && c.animals?.kinds && Object.keys(c.animals.kinds).length, 'animals.perStage and animals.kinds required');
  for (const [k, a] of Object.entries(c.animals?.kinds || {})) need(Array.isArray(a.alt) && a.alt[0] < a.alt[1] && Array.isArray(a.off), `animal ${k}: alt [low, high] and off [min, max]`);
  if (c.look !== undefined) {
    const L = c.look, band = (a) => Array.isArray(a) && a.length === 2 && a.every(Number.isFinite) && a[0] < a[1];
    need(L.treeline === null || Number.isFinite(L.treeline), 'look.treeline: m, the upper limit of the forest (null: no trees on the course)');
    need(Array.isArray(L.treeSpecies) && L.treeSpecies.every((t) => /^[a-z-]+$/.test(t)), 'look.treeSpecies: ids like ["spruce", "larch"]');
    need(Array.isArray(L.ground) && L.ground.length && L.ground.every((g) => GROUND_TYPES.includes(g.type) && band(g.alt)), `look.ground: [{type, alt: [low, high]}], type one of ${GROUND_TYPES.join(', ')}`);
    need(WATER_TYPES.includes(L.waterType), `look.waterType one of ${WATER_TYPES.join(', ')}`);
    need(L.glacialAbove === undefined || Number.isFinite(L.glacialAbove), 'look.glacialAbove: m, the water is glacial milk above this altitude');
    need(Array.isArray(L.sources) && L.sources.length, 'look.sources: where the bands come from');
  }
  const S = c.short || {};
  if (S.stages) need(S.stages.length >= 1000 && S.stages.length <= 2000, 'short.stages.length: 1000-2000 m (spec: stages of 1-2 km)');
  if (S.stages?.end !== undefined) need(S.stages.end === 'floor' && S.stages.pick !== 'packed', 'short.stages.end: "floor" (the last stage ends where the valley floor starts), not with pick "packed"');
  if (S.stages?.pick !== undefined) need(['steepest', 'packed'].includes(S.stages.pick), 'short.stages.pick: "steepest" (default) or "packed"');
  if (S.floor) need(S.floor.slope > 0 && S.floor.slope < 1, 'short.floor.slope: a fraction, 0.0125 is 1.25 %');
  if (errs.length) throw new Error(`${id}: ${errs.join('; ')}`);
  return c;
}

// The config with the short-mode defaults filled in (nested objects merged one level deep).
export function withDefaults(raw) {
  const S = raw.short || {}, short = { ...SHORT_DEFAULTS };
  for (const [k, v] of Object.entries(S)) short[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...SHORT_DEFAULTS[k], ...v } : v;
  return { landmarks: [], placesFallback: [], ...raw, osm: { glaciers: true, ...raw.osm }, short };
}

export function loadConfig(id, { archived = false } = {}) {
  const file = `${archived ? ARCHIVE_DIR : WORLDS_DIR}${id}.json`;
  if (!existsSync(file)) throw new Error(`no world config ${file}; available: ${listConfigs().join(', ')}${listArchived().includes(id) ? ` (${id} is archived: move tools/bake/worlds/archive/${id}.json back to bake it)` : ''}`);
  return withDefaults(validateConfig(JSON.parse(readFileSync(file, 'utf8')), id));
}
