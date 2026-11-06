// Config-driven bake (docs/world-format.md, "Bake config" and "index.json"): the configs, the DEM tile
// helpers, the descent lines, the glacier ice, and every baked world in data/worlds/ against the
// contract. test/bake.test.mjs keeps the detailed Dolomiti checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, listConfigs, listArchived, validateConfig, withDefaults, GROUND_TYPES, WATER_TYPES } from '../tools/bake/config.mjs';
import { WORLD_ORDER } from '../tools/bake/world-index.mjs';
import { tileOf, tilesForBox, tileFile, tileUrl, fillVoids, localFrame, geoDist } from '../tools/bake/dem.mjs';
import { networkRiver, loadWays } from '../tools/bake/river.mjs';
import { joinRings, glacierAt, loadGlaciers } from '../tools/bake/glaciers.mjs';
import { queries } from '../tools/bake/osm.mjs';
import { loadWorld, toGlobal, bilinear } from '../src/world/load.js';
import { THEME } from '../src/render/theme.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const DEM = `${ROOT}data/raw/dem`;
const tmp = (p) => mkdtempSync(`${tmpdir()}/summit-descent-${p}-`);
const baked = existsSync(DIR) ? readdirSync(DIR).filter((d) => existsSync(`${DIR}/${d}/world.json`)).sort() : [];
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyLen = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);

// sha1 of data/worlds/dolomiti/* as baked before the bake became config driven (27/10/2026); world.json
// since the animals moved onto the banks (same day: they stood 22-50 m from the bed and never drank), the soaring
// birds got their flying flag and each stage its heading, and the world its look; every file since the stream
// got the real Piave width and the Acquatona its slot gorge (28/10/2026)
const DOLOMITI_SHA1 = {
  'backdrop.bin': '0f7024fd30530b5d645e79041ebb3c160d3de7ee',
  'stage-0.bin': '74534455abf6266bcc1dfb1b3ba5acff6fb1758d',
  'stage-1.bin': 'da9c5ea5940a099051157b5ca0304b095694d811',
  'stage-2.bin': '7fd3868f8490a7aafa89a616b04541827811d7b5',
  'stage-3.bin': 'cd57807cba8dff41a5aaae3a0614e0276bdedbe4',
  'world.json': '4f9c2507f65524759928851719aac12e3afb6ac7',
};

test('every world config validates; the Dolomiti one keeps its bake values', () => {
  const ids = listConfigs();
  assert.ok(ids.includes('dolomiti') && ids.length >= 2, ids.join());
  for (const id of ids) {
    const c = loadConfig(id);
    assert.equal(c.id, id);
    for (const sp of Object.keys(c.animals.kinds)) assert.match(sp, /^[a-z-]+$/);
  }
  const d = loadConfig('dolomiti');
  assert.deepEqual(d.summit, { name: 'Monte Peralba', names: { en: 'Monte Peralba', it: 'Monte Peralba' }, elevation: 2694, lat: 46.6297, lon: 12.7166, searchRadius: 900 });
  assert.deepEqual(d.short.floor, { window: 3000, slope: 0.0125, after: 1500 });
  assert.deepEqual(d.short.stages, { count: 4, length: 1700, gap: 300, perGroup: 2 });
  assert.equal(d.descent.kind, 'osm-relation');
  assert.equal(d.osm.glaciers, false);
});

test('the game has seven worlds in a fixed order; the archived duplicates stay valid configs', () => {
  assert.deepEqual(WORLD_ORDER, ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia']);
  assert.deepEqual(listConfigs(), [...WORLD_ORDER].sort());
  assert.deepEqual(listArchived(), ['cervino', 'moldoveanu', 'rinjani', 'semeru']);
  for (const id of listArchived()) {
    assert.equal(loadConfig(id, { archived: true }).id, id);
    assert.ok(!existsSync(`${DIR}/${id}`), `${id} is archived but still baked in data/worlds`);
    assert.throws(() => loadConfig(id), /archived/);
  }
});

test('config validation names every problem at once', () => {
  const bad = { id: 'x', name: 'X', names: { en: 'X' }, country: 'Italy', summit: { name: 'P', lat: 95, lon: 0 }, dem: { tiles: ['N45E011'] }, descent: { kind: 'river' }, osm: {}, biomes: {}, animals: {} };
  const err = (() => { try { validateConfig(bad, 'x'); } catch (e) { return e.message; } })();
  for (const k of ['names.en and names.it', 'country', 'summit.lat/lon', 'dem.tiles', 'descent.kind', 'osm.bbox', 'biomes', 'animals']) assert.ok(err.includes(k), `${k} in ${err}`);
  assert.throws(() => validateConfig({ ...loadConfig('dolomiti'), id: 'other' }, 'dolomiti'), /must match the file name/);
  assert.equal(withDefaults({ id: 'y', short: { floor: { slope: 0.03 } } }).short.floor.window, 3000, 'nested defaults merged');
});

test('DEM tile names: both hemispheres, negative longitudes, tiles across several degrees', () => {
  assert.equal(tileOf(46.63, 12.72), 'N46_E012');
  assert.equal(tileOf(-8.41, 116.46), 'S09_E116');
  assert.equal(tileOf(-0.5, -78.4), 'S01_W079');
  assert.equal(tileOf(0, 0), 'N00_E000');
  assert.equal(tileOf(36.58, -118.29), 'N36_W119');
  assert.equal(tileOf(-13.16, -72.54), 'S14_W073');
  assert.deepEqual(tilesForBox([45.9, 6.9, 46.1, 7.1]), ['N45_E006', 'N45_E007', 'N46_E006', 'N46_E007']);
  assert.deepEqual(tilesForBox([-0.2, -0.3, 0.1, 0.2]), ['S01_W001', 'S01_E000', 'N00_W001', 'N00_E000']);
  assert.equal(tileFile('S09_E116'), 'Copernicus_DSM_COG_10_S09_00_E116_00_DEM.tif');
  assert.equal(tileFile('N27_E086', 90), 'Copernicus_DSM_COG_30_N27_00_E086_00_DEM.tif');
  assert.equal(tileUrl('N45_W001', 90), 'https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N45_00_W001_00_DEM/Copernicus_DSM_COG_30_N45_00_W001_00_DEM.tif');
});

test('metres per degree hold from the equator to the Karakoram, east and west', () => {
  // WGS84: meridian and prime vertical radii of curvature
  const a = 6378137, e2 = 6.69437999014e-3, rad = Math.PI / 180;
  const ref = (lat) => {
    const s2 = Math.sin(lat * rad) ** 2;
    return [(a * (1 - e2)) / (1 - e2 * s2) ** 1.5 * rad, (a / Math.sqrt(1 - e2 * s2)) * Math.cos(lat * rad) * rad];
  };
  for (const lat of [0, -8.4, 27.99, 35.9, 46.6]) {
    const [mLat, mLon] = ref(lat + 0.5).map((v, i) => (i ? ref(lat)[1] : v)), f = localFrame(lat, 0);
    assert.ok(Math.abs(-f.toXZ(0, lat + 1)[1] - mLat) < 30, `lat ${lat}: ${-f.toXZ(0, lat + 1)[1]}`);
    assert.ok(Math.abs(f.toXZ(1, lat)[0] - mLon) < 60, `lon at ${lat}: ${f.toXZ(1, lat)[0]}`);
  }
  const w = localFrame(-13.16, -72.54), [x, z] = w.toXZ(-72.55, -13.17), back = w.toLonLat(x, z);
  assert.ok(x < 0 && z > 0, 'west is -x, south is +z on negative longitudes too');
  assert.ok(Math.abs(back[0] + 72.55) < 1e-12 && Math.abs(back[1] + 13.17) < 1e-12);
  assert.ok(Math.abs(geoDist(-0.1, 0, 0.1, 0) - 0.2 * 111320) < 50, 'across the prime meridian');
});

test('DEM voids are filled from the GLO-90 twin, then from the neighbours, at 8000 m too', () => {
  const w = 6, h = 5, data = new Float32Array(w * h).fill(8000);
  data[7] = -32767; data[8] = NaN; data[20] = -32767; data[21] = -32767;
  const t = { w, h, data, lon0: 76, lat0: 36, rx: 1 / 3600, ry: 1 / 3600, off: 0 };
  assert.equal(fillVoids({ ...t, data: data.slice() }, -32767, null), 4);
  const a = data.slice();
  fillVoids({ ...t, data: a }, -32767, null);
  assert.ok(a.every((v) => v === 8000), 'neighbour fill');
  const b = data.slice();
  fillVoids({ ...t, data: b }, -32767, (lon) => (lon > 76 + 2.5 / 3600 ? 8100 : null));
  assert.equal(b[21], 8100, 'GLO-90 value where it covers');
  assert.equal(b[7], 8000, 'neighbours where GLO-90 has nothing');
  const all = new Float32Array(4).fill(-32767);
  fillVoids({ ...t, w: 2, h: 2, data: all }, -32767, null);
  assert.deepEqual([...all], [0, 0, 0, 0], 'a tile with no valid cell is sea level');
});

// A tiny network: a stream drawn in flow order, a braid around nodes 3-5, one way drawn upstream,
// a dead end under a glacier with the stream resuming 200 m further down, and a tributary.
function network(dir) {
  const node = (id, lat, lon) => ({ id, lat, lon });
  const n = [node(1, 46.0, 7.0), node(2, 45.999, 7.0), node(3, 45.998, 7.0), node(4, 45.997, 7.0005), node(5, 45.996, 7.0), node(14, 45.997, 6.9995),
    node(6, 45.995, 7.0), node(7, 45.993, 7.0), node(8, 45.992, 7.0), node(9, 45.991, 7.0), node(20, 45.996, 7.003), node(21, 45.995, 7.0)];
  const at = (ids) => ids.map((i) => n.find((q) => q.id === i));
  const way = (id, ids, tags) => ({ type: 'way', id, nodes: ids, geometry: at(ids).map(({ lat, lon }) => ({ lat, lon })), tags });
  const j = { elements: [
    way(100, [1, 2, 3], { waterway: 'stream', name: 'Rio Alto' }),
    way(101, [3, 4, 5], { waterway: 'stream', name: 'Rio Alto' }),
    way(102, [3, 14, 5], { waterway: 'stream' }),
    way(103, [6, 5], { waterway: 'stream', name: 'Rio Alto' }), // drawn upstream
    way(104, [7, 8, 9], { waterway: 'river', name: 'Fiume' }),
    way(105, [20, 21], { waterway: 'stream', name: 'Affluente' }),
  ] };
  writeFileSync(`${dir}/net.json`, JSON.stringify(j));
  return `${dir}/net.json`;
}

test('osm-network: downstream walk through braids, a reversed way and a gap under the ice', () => {
  const dir = tmp('net');
  try {
    const file = network(dir), elev = (lon, lat) => (lat - 45.99) * 100000; // 100 m per 0.001 deg, falling south
    const r = networkRiver(file, elev, { lon: 7.0, lat: 46.0 }, { prefer: ['Rio Alto', 'Fiume'] });
    const lats = r.pts.map((p) => +p[1].toFixed(3));
    assert.deepEqual(lats, [46.0, 45.999, 45.998, 45.997, 45.996, 45.995, 45.993, 45.992, 45.991]);
    assert.equal(r.pts[3][0], 7.0005, 'the named braid arm, not the unnamed one');
    assert.equal(r.jumps, 1, 'the 220 m gap is bridged');
    assert.ok(r.label.includes('Rio Alto') && r.label.includes('Fiume'));
    assert.ok(Math.abs(r.length - r.s.at(-1)) < 1e-9 && r.s.every((v, i) => !i || v > r.s[i - 1]));
    const short = networkRiver(file, elev, { lon: 7.0, lat: 46.0 }, { jump: 100 });
    assert.equal(+short.pts.at(-1)[1].toFixed(3), 45.995, 'no jump past the limit');
    const w = loadWays(file, [100, 101], {});
    assert.equal(w.pts.length, 5);
    assert.throws(() => loadWays(file, [100, 104]), /gap of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('glaciers: rings are joined from open multipolygon members, holes are not ice', () => {
  const sq = (x0, y0, d) => [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]];
  const outer = sq(7, 46, 0.1), hole = sq(7.04, 46.04, 0.02);
  const rings = joinRings([outer.slice(0, 3), outer.slice(2).reverse(), hole]);
  assert.equal(rings.length, 2);
  const dir = tmp('glacier');
  try {
    const g = (pts) => pts.map(([lon, lat]) => ({ lon, lat }));
    writeFileSync(`${dir}/glaciers.json`, JSON.stringify({ elements: [
      { type: 'relation', id: 1, tags: { natural: 'glacier', name: 'Vedretta' }, members: [{ type: 'way', role: 'outer', geometry: g(outer.slice(0, 3)) }, { type: 'way', role: 'outer', geometry: g(outer.slice(2)) }, { type: 'way', role: 'inner', geometry: g(hole) }] },
      { type: 'way', id: 2, tags: { natural: 'glacier', 'glacier:type': 'icefall' }, geometry: g(sq(8, 46, 0.01)) },
    ] }));
    const gl = loadGlaciers(`${dir}/glaciers.json`);
    assert.equal(glacierAt(gl, 7.01, 46.01)?.name, 'Vedretta');
    assert.equal(glacierAt(gl, 7.05, 46.05), null, 'inside the hole');
    assert.equal(glacierAt(gl, 7.2, 46.01), null);
    assert.equal(glacierAt(gl, 8.005, 46.005)?.icefall, true);
    assert.equal(loadGlaciers(`${dir}/missing.json`), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Overpass queries come from the config', () => {
  const q = queries(loadConfig('dolomiti'));
  assert.deepEqual(Object.keys(q).sort(), ['places.json', 'river.json']);
  assert.match(q['river.json'], /relation\["waterway"="river"\]\["name"="Piave"\]\(45\.4,11\.7,46\.75,12\.95\)/);
  assert.match(q['places.json'], /Santo Stefano di Cadore\|/);
  for (const id of listConfigs()) {
    const c = loadConfig(id), qq = queries(c);
    assert.equal('glaciers.json' in qq, !!c.osm.glaciers, id);
    assert.equal('river.json' in qq, c.descent.kind !== 'dem', id);
  }
});

test('the Dolomiti world is byte identical to the bake before the config refactor', { skip: baked.includes('dolomiti') ? false : 'dolomiti not baked' }, () => {
  for (const [f, sha] of Object.entries(DOLOMITI_SHA1)) assert.equal(createHash('sha1').update(readFileSync(`${DIR}/dolomiti/${f}`)).digest('hex'), sha, f);
});

const index = existsSync(`${DIR}/index.json`) ? JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')) : null;
test('index.json lists every baked world with what the vote shows', { skip: index ? false : 'no data/worlds/index.json' }, () => {
  assert.equal(index.version, 1);
  assert.deepEqual(index.worlds.map((w) => w.id), WORLD_ORDER.filter((id) => baked.includes(id)), 'the order of WORLD_ORDER');
  assert.deepEqual([...index.worlds.map((w) => w.id)].sort(), baked);
  for (const w of index.worlds) {
    const W = JSON.parse(readFileSync(`${DIR}/${w.id}/world.json`, 'utf8'));
    assert.ok(w.names.en && w.names.it && /^[A-Z]{2}/.test(w.country), w.id);
    assert.ok(w.summit.names.en && w.summit.names.it && Number.isFinite(w.summit.altitude), w.id);
    assert.ok(w.finish.names.en && w.finish.names.it && w.finish.altitude < w.summit.altitude, w.id);
    assert.equal(w.stages, W.stages.length);
    assert.equal(w.finish.altitude, W.stages.at(-1).altitude[0]);
    assert.equal(w.summit.demAltitude, W.source.summit.elevation);
    assert.ok(Number.isInteger(w.estimatedSeconds) && w.estimatedSeconds >= 120 && w.estimatedSeconds <= 330, `${w.id}: ${w.estimatedSeconds} s (spec: 3-5 min)`);
    assert.equal(w.hash, createHash('sha256').update(readFileSync(`${DIR}/${w.id}/world.json`, 'utf8')).digest('hex').slice(0, 16), `${w.id}: index out of date`);
  }
});

for (const id of baked) {
  const cfgOk = listConfigs().includes(id);
  test(`${id}: contract, 1:1, descent to the valley floor`, { skip: cfgOk ? false : 'no config' }, async () => {
    const cfg = loadConfig(id), world = await loadWorld(id, { dir: DIR }), W = world.json;
    assert.equal(W.id, id);
    assert.equal(W.mode, 'short');
    assert.ok(W.stages.length >= 2 && W.stages.length <= 6);
    assert.equal(new Set(W.stages.map((s) => s.id)).size, W.stages.length);
    assert.equal(new Set(W.stages.map((s) => s.name)).size, W.stages.length);
    const f = localFrame(W.frame.lat, W.frame.lon);
    let total = 0;
    for (const [k, s] of W.stages.entries()) {
      const c = s.course, L = polyLen(c);
      total += L;
      assert.ok(L >= 1000 && L <= 2000, `${s.id}: ${L} m`);
      assert.deepEqual(c[0], { x: 0, y: 0, z: 0, hw: c[0].hw });
      for (let i = 1; i < c.length; i++) assert.ok(c[i].y < c[i - 1].y, `${s.id} ${i} climbs`);
      // the bed is as wide as the real stream (short.width) or the biome's band, never under 4 m for two drops
      for (const p of c) assert.ok(p.hw >= 4 && p.hw <= 30, `${s.id}: hw ${p.hw}`);
      // Playtest finding (28/10/2026): bank ribbons across the river. The bars were the arms' bands at the forks
      // (test/render-geometry.test.mjs); this guards the bends: the earth band the renderer drapes past the waterline
      // (at most water.maxWidth hw out, then terrain.bankBand wide) never reaches the wetted bed (0.6 hw, where the
      // carved bed rises above the water) of another stretch of the same stage
      const band = THEME.terrain.bankBand.width + THEME.terrain.bankBand.line;
      for (let i = 1; i < c.length - 1; i++) for (const sg of [-1, 1]) {
        const tx = c[i + 1].x - c[i - 1].x, tz = c[i + 1].z - c[i - 1].z, L = Math.hypot(tx, tz), o = THEME.water.maxWidth * c[i].hw + band;
        const q = { x: c[i].x - (tz / L) * o * sg, z: c[i].z + (tx / L) * o * sg };
        for (let j = 0; j < c.length; j++) assert.ok(dist(q, c[j]) >= 0.6 * c[j].hw, `${s.id} ${i}: the bank band reaches the water at ${j}`);
      }
      if (cfg.short.width && k) assert.ok(c.reduce((a, p) => a + p.hw, 0) > W.stages[k - 1].course.reduce((a, p) => a + p.hw, 0) * (c.length / W.stages[k - 1].course.length), `${s.id}: the stream narrows downstream`);
      assert.ok(s.altitude[0] >= W.floor.altitude - 5, `${s.id} below the floor`);
      assert.equal(world.stages[k].height.length, s.height.w * s.height.h);
      assert.equal(statSync(`${DIR}/${id}/${s.height.file}`).size, s.height.w * s.height.h * 4);
      // 1:1 in plan
      const ll = c.map((p) => { const g = toGlobal(s, p); return f.toLonLat(g.x, g.z); });
      let real = 0;
      for (let i = 1; i < ll.length; i++) real += geoDist(...ll[i - 1], ...ll[i]);
      assert.ok(Math.abs(real - L) / L < 0.005, `${s.id}: ${L} vs ${real}`);
      // the bed is in the grid
      const fine = (x, z) => bilinear(s.height, world.stages[k].height, x, z);
      // (a waterfall step falls between two course points: the grid there is the cliff)
      const steps = s.zones.flatMap((z) => z.steps || []);
      c.forEach((p, i) => { if (!steps.some((st) => i === st.at || i === st.at + 1)) assert.ok(Math.abs(fine(p.x, p.z) - p.y) < 1, `${s.id} ${i}: grid ${fine(p.x, p.z)} vs bed ${p.y}`); });
      const n = c.length, ok = (i) => Number.isInteger(i) && i >= 0 && i < n;
      assert.equal(s.finish, n - 1);
      assert.equal(s.checkpoints[0], 0);
      for (const z of s.zones) assert.ok(['ice', 'sun', 'rain', 'waterfall'].includes(z.kind) && ok(z.from) && ok(z.to) && z.from < z.to, `${s.id} zone`);
      // a waterfall is a shortcut's fall or a real one on the course, named, with its steps inside the zone
      for (const z of s.zones.filter((q) => q.kind === 'waterfall')) {
        if (z.branch != null) { assert.equal(s.branches[z.branch]?.kind, 'shortcut'); continue; }
        assert.ok(z.name && z.steps.length && z.steps.every((st) => st.at > z.from && st.at < z.to && Math.abs(c[st.at].y - c[st.at + 1].y - st.drop) < 2.5 && st.drop >= 3), `${s.id}: waterfall ${JSON.stringify(z)}`);
      }
      for (const b of s.branches) assert.ok(ok(b.from) && ok(b.to) && b.from < b.to && b.points.every((p, i) => !i || p.y <= b.points[i - 1].y + 1e-9));
      for (const p of [...s.spawns.start, ...s.spawns.water, ...s.spawns.animals, ...s.spawns.obstacles]) assert.ok(Math.abs(fine(p.x, p.z) - p.y) < 0.05, `${s.id}: spawn off the ground`);
      for (const a of s.spawns.animals) {
        const band = cfg.animals.kinds[a.kind]?.alt;
        assert.ok(band, `${id}: ${a.kind} is not an animal of this mountain`);
        const alt = a.y + s.offset.y;
        assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${a.kind} at ${alt} m`);
      }
      // the downhill heading the painted backdrop is centred on: the chord of the course, clockwise from north
      const chord = ((Math.atan2(c.at(-1).x, -c.at(-1).z) * 180) / Math.PI + 360) % 360;
      assert.ok(s.heading >= 0 && s.heading < 360 && Math.abs(((s.heading - chord + 540) % 360) - 180) <= 0.06, `${s.id}: heading ${s.heading} vs ${chord}`);
      if (k) {
        const a = W.stages[k - 1];
        assert.ok(s.realKm[0] > a.realKm[1] && s.origin.alt < a.origin.alt + a.course.at(-1).y + 1, 'stages in order down the mountain');
      }
    }
    assert.ok(total >= 4000 && total <= 10000, `total ${total}`);
    // no plain is played: the last stage still falls at least 5 % on average (the floor rule cuts at 1.25-4 %)
    const last = W.stages.at(-1);
    assert.ok(-last.course.at(-1).y / last.length >= 0.05, `${id}: last stage ${((-last.course.at(-1).y / last.length) * 100).toFixed(1)} %`);
    // look: the real landscape for the renderer, from the config's look and animals
    const L = W.look;
    assert.ok(L, `${id}: no look`);
    assert.ok(L.treeline === null || (L.treeline > 0 && L.treeline < 4500), `${id}: treeline ${L.treeline}`);
    assert.equal(L.treeline === null, L.treeSpecies.every((t) => ['juniper', 'rhododendron', 'alpenrose'].includes(t)), `${id}: trees without a treeline`);
    assert.ok(L.ground.every((g) => GROUND_TYPES.includes(g.type) && g.alt[0] < g.alt[1]) && WATER_TYPES.includes(L.waterType));
    const top = W.stages[0].altitude[1], bottom = last.altitude[0];
    for (const a of [top, bottom]) assert.ok(L.ground.some((g) => a >= g.alt[0] - 50 && a <= g.alt[1] + 50), `${id}: no ground band at ${a} m`);
    assert.deepEqual(L.fauna.map((f) => f.id), Object.keys(cfg.animals.kinds));
    for (const sp of new Set(W.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)))) assert.ok(L.fauna.some((f) => f.id === sp), `${id}: ${sp} spawned but not in look.fauna`);
    assert.deepEqual(L.backdrop, { file: `${id}.jpg`, summit: `${id}-summit.jpg` });
    assert.ok(L.sources.length);
    assert.ok(W.stages.at(-1).realKm[1] <= W.floor.riverKm + 0.01);
    assert.ok(Math.hypot(W.stages[0].offset.x, W.stages[0].offset.z) < 1, 'the race starts on the summit');
    assert.ok(Math.abs(W.stages[0].origin.alt - W.source.summit.elevation) < 15);
    assert.equal(world.backdrop.length, W.backdrop.w * W.backdrop.h);
    assert.ok(W.source.tiles.length === cfg.dem.tiles.length || W.source.sea, 'one file per configured tile');
    assert.ok(W.source.elevation.startsWith('Copernicus DEM GLO-30'));
    // high mountains: ice where the glaciers are, the renderer gets the glacier name
    if (cfg.osm.glaciers && W.source.glaciers) assert.ok(W.stages.some((s) => s.zones.some((z) => z.kind === 'ice')), `${id}: no ice on a glaciated mountain`);
  });
}

const haveTiles = (id) => loadConfig(id).dem.tiles.every((t) => existsSync(`${DEM}/${tileFile(t)}`) || existsSync(`${DEM}/${tileFile(t, 90)}`));
for (const id of baked.filter((d) => d !== 'dolomiti' && listConfigs().includes(d))) {
  test(`${id}: the bake is deterministic and the baked world is up to date`, { skip: haveTiles(id) ? false : 'DEM tiles missing', timeout: 300000 }, () => {
    const out = tmp(`bake-${id}`);
    try {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', id, '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
      const files = readdirSync(`${out}/${id}`).sort();
      assert.deepEqual(files, readdirSync(`${DIR}/${id}`).sort());
      for (const f of files) assert.ok(readFileSync(`${out}/${id}/${f}`).equals(readFileSync(`${DIR}/${id}/${f}`)), `${f} differs: rebake ${id}`);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
}
