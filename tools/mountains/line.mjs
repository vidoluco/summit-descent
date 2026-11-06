// The whole descent line of a world as the bake reads it, for the mountain docs (docs/mountains/).
// Usage: node tools/mountains/line.mjs <id> [--step 15] > line.json
// Prints JSON: the spine every 20 m (river km, global x/z, real bed altitude), the DEM every `step` m
// over the route +-1.5 km (for a hillshade), the valley floor and the places. Offline: only what is on disk.
import { loadConfig } from '../bake/config.mjs';
import { ensureTiles, loadDem, localFrame } from '../bake/dem.mjs';
import { loadRiver, loadWays, networkRiver } from '../bake/river.mjs';
import { findSummit, buildSpine, crossMinProfile, findFloor, demRiver } from '../bake/course.mjs';
import { osmDir } from '../bake/osm.mjs';

const args = process.argv.slice(2);
const id = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--step');
const step = Number(args.includes('--step') ? args[args.indexOf('--step') + 1] : 15);
if (!id) throw new Error('usage: node tools/mountains/line.mjs <id>');
const cfg = loadConfig(id), S = cfg.short, D = cfg.descent, OSM = osmDir(id);
const info = await ensureTiles(cfg.dem.tiles, 'data/raw/dem', { offline: true });
const dem = await loadDem('data/raw/dem', { files: info.filter((t) => t.file).map((t) => t.file), sea: info.filter((t) => !t.file).map((t) => t.tile) });
const summit = findSummit(dem, cfg.summit);
const river = D.kind === 'osm-relation' ? loadRiver(`${OSM}/river.json`, { name: D.name, relation: D.relation, maxGap: D.maxGap })
  : D.kind === 'osm-ways' ? loadWays(`${OSM}/river.json`, D.ways, { maxGap: D.maxGap })
  : D.kind === 'osm-network' ? networkRiver(`${OSM}/river.json`, dem.elevation, D.start ? { lat: D.start[0], lon: D.start[1] } : summit, { prefer: D.prefer, maxKm: S.spine.maxKm + 5, jump: D.jump })
  : demRiver(dem, summit, { via: D.via, to: D.to, maxKm: S.spine.maxKm + 5 });
const frame = localFrame(summit.lat, summit.lon);
const elev = (x, z) => dem.elevation(...frame.toLonLat(x, z));
const spine = buildSpine(dem, river, summit, frame, S.spine, D.summitVia);
const prof = crossMinProfile(spine, elev, 0, spine.length, S.pointStep, S.bedAcross);
for (let i = 1; i < prof.length; i++) prof[i] = Math.min(prof[i], prof[i - 1]);
const floorU = findFloor(prof, S.pointStep, S.floor);
const line = [];
for (let u = 0; u <= spine.length; u += 20) {
  const p = spine.at(u);
  line.push({ u, rk: Math.round(spine.rk[Math.round(u)]), x: Math.round(p.x), z: Math.round(p.z), alt: Math.round(prof[Math.min(prof.length - 1, Math.round(u / S.pointStep))] * 10) / 10, ground: Math.round(elev(p.x, p.z)) });
}
const xs = line.map((p) => p.x), zs = line.map((p) => p.z), m = 1500;
const x0 = Math.floor((Math.min(...xs) - m) / step) * step, z0 = Math.floor((Math.min(...zs) - m) / step) * step;
const w = Math.ceil((Math.max(...xs) + m - x0) / step) + 1, h = Math.ceil((Math.max(...zs) + m - z0) / step) + 1;
const grid = new Array(w * h);
for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) grid[j * w + i] = Math.round(elev(x0 + i * step, z0 + j * step));
process.stdout.write(JSON.stringify({ id, summit: { lat: summit.lat, lon: summit.lon, h: summit.h }, pathLen: spine.pathLen, floor: { u: floorU, rk: spine.rk[Math.round(floorU)], alt: prof[Math.round(floorU / S.pointStep)] }, line, grid: { x0, z0, w, h, step, data: grid } }));
