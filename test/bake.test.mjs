// Checks the baked Dolomiti world against the world data contract (spec "Contratto 2", short mode
// with 1:1 stages; docs/world-format.md). Needs the bake output: node tools/bake/index.mjs dolomiti
// The DEM checks also need data/raw/dem (skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorld, loadStage, bilinear, makeGround, toGlobal } from '../src/world/load.js';
import { bilinear as simBilinear } from '../src/sim/world-access.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { localFrame, geoDist } from '../tools/bake/dem.mjs';
import { loadConfig } from '../tools/bake/config.mjs';
import { riverFromPbf, oplToOverpass } from '../tools/bake/osm-geofabrik.mjs';
import { loadRiver } from '../tools/bake/river.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const cfg = loadConfig('dolomiti'); // tools/bake/worlds/dolomiti.json
const DIR = `${ROOT}data/worlds`;
const have = existsSync(`${DIR}/dolomiti/world.json`);
const world = have ? await loadWorld('dolomiti', { dir: DIR }) : null;
const W = world?.json;
const opts = { skip: have ? false : 'world not baked: node tools/bake/index.mjs dolomiti --mode short' };
const DEM_DIR = `${ROOT}data/raw/dem`;
const haveDem = existsSync(DEM_DIR) && readdirSync(DEM_DIR).some((f) => f.endsWith('.tif'));
const demOpts = { skip: !have ? opts.skip : haveDem ? false : 'no DEM tiles in data/raw/dem' };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyLen = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);
const stages = () => W.stages.map((json, k) => ({ json, height: world.stages[k].height, k, fine: (x, z) => bilinear(json.height, world.stages[k].height, x, z) }));
// the spec list for Monte Peralba without the ibex: the Carnic Alps have no documented colony on the Peralba
// (the Antelao, the other Dolomiti world, has one)
const SPECIES = ['marmot', 'chamois', 'eagle', 'chough', 'hare', 'cow'];

let demP = null;
const getDem = () => (demP ||= (async () => {
  const { loadDem } = await import('../tools/bake/dem.mjs');
  const tiles = new Set(W.stages.map((s) => `N${Math.floor(s.origin.lat)}_00_E${String(Math.floor(s.origin.lon)).padStart(3, '0')}`));
  return loadDem(DEM_DIR, { only: (f) => [...tiles].some((t) => f.includes(t)) });
})());

test('geoDist measures north-south distances in full (regression: it halved them)', () => {
  assert.ok(Math.abs(geoDist(12.5, 46, 12.5, 47) - 111170) < 300, `${geoDist(12.5, 46, 12.5, 47)}`);
  assert.ok(Math.abs(geoDist(12.5, 46.5, 12.5, 46.5 + 1 / 111.15) - 1000) < 5);
  const e = geoDist(12, 46.5, 13, 46.5);
  assert.ok(Math.abs(e - 76600) < 600, `${e}`);
  assert.ok(Math.abs(geoDist(12, 46, 12.01, 46.01) - Math.hypot(0.01 * 77300, 0.01 * 111150)) < 10);
});

test('contract shape: short mode is a list of stages, each a world of its own', opts, () => {
  for (const k of ['id', 'name', 'mode', 'stages', 'backdrop', 'length', 'pointStep', 'floor', 'frame', 'places', 'source']) assert.ok(k in W, `missing ${k}`);
  assert.equal(W.id, 'dolomiti');
  assert.equal(W.mode, 'short');
  assert.equal(W.backdrop.step, 60);
  assert.ok(!('course' in W) && !('height' in W), 'no whole-world course: the sim plays one stage at a time');
  assert.ok(W.stages.length >= 3 && W.stages.length <= 6);
  assert.equal(new Set(W.stages.map((s) => s.id)).size, W.stages.length, 'stage ids unique');
  assert.equal(new Set(W.stages.map((s) => s.name)).size, W.stages.length, 'stage names unique');
  for (const s of W.stages) {
    for (const k of ['id', 'name', 'labels', 'biome', 'palette', 'origin', 'offset', 'realKm', 'altitude', 'height', 'course', 'branches', 'checkpoints', 'zones', 'spawns', 'finish']) assert.ok(k in s, `${s.id}: missing ${k}`);
    assert.ok(!('seaLevel' in s), 'stage heights are local, no sea level');
    assert.ok(s.labels.it && s.labels.en && s.labels.it === s.name);
    for (const k of ['lat', 'lon', 'alt']) assert.ok(Number.isFinite(s.origin[k]));
    assert.equal(s.origin.alt, s.offset.y);
    assert.equal(s.height.step, 4);
    assert.equal(s.height.file, `stage-${W.stages.indexOf(s)}.bin`);
    assert.deepEqual(s.course[0], { x: 0, y: 0, z: 0, hw: s.course[0].hw }, 'local origin at the stage start');
    for (const k of ['start', 'water', 'animals', 'obstacles']) assert.ok(Array.isArray(s.spawns[k]), `${s.id} spawns.${k}`);
    assert.equal(s.spawns.start.length, 2);
    for (const p of s.course) for (const k of ['x', 'y', 'z', 'hw']) assert.ok(Number.isFinite(p[k]));
    assert.ok(Array.isArray(s.palette) && s.palette.length && s.biome);
  }
  for (const [k, st] of world.stages.entries()) assert.equal(st.height.length, W.stages[k].height.w * W.stages[k].height.h);
  assert.equal(world.backdrop.length, W.backdrop.w * W.backdrop.h);
});

test('6-8 km played in 1-2 km stages, points every ~10 m', opts, () => {
  let total = 0;
  for (const s of W.stages) {
    const L = polyLen(s.course);
    total += L;
    assert.ok(L >= 1000 && L <= 2000, `${s.id} ${L} m`);
    for (let i = 1; i < s.course.length; i++) {
      const d = dist(s.course[i - 1], s.course[i]);
      assert.ok(d > 8 && d < 12, `${s.id} step ${i}: ${d}`);
    }
  }
  assert.ok(total >= 6000 && total <= 8000, `total ${total} m`);
  assert.ok(Math.abs(W.length - total) < 50);
});

test('every stage descends strictly; stages follow the river down to the valley floor', opts, () => {
  for (const s of W.stages) {
    const c = s.course;
    for (let i = 1; i < c.length; i++) assert.ok(c[i].y < c[i - 1].y, `${s.id} point ${i}: ${c[i].y} >= ${c[i - 1].y}`);
    assert.equal(s.finish, c.length - 1);
    assert.ok(s.altitude[0] <= s.altitude[1]);
    assert.ok(Math.abs(s.altitude[1] - s.origin.alt) < 1 && Math.abs(s.altitude[0] - (s.origin.alt + c.at(-1).y)) < 1);
    assert.ok(s.altitude[0] >= W.floor.altitude - 5, `${s.id} below the valley floor`);
  }
  for (let i = 1; i < W.stages.length; i++) {
    const a = W.stages[i - 1], b = W.stages[i];
    assert.ok(b.realKm[0] > a.realKm[1], 'stages in river order, no overlap');
    assert.ok(b.origin.alt < a.origin.alt + a.course.at(-1).y + 1, 'each stage starts below where the previous ended');
  }
  assert.ok(W.stages.at(-1).realKm[1] <= W.floor.riverKm + 0.01, 'nothing played past the valley floor');
  // the first stage starts on the summit, the origin of the world frame
  const s0 = W.stages[0];
  assert.ok(Math.hypot(s0.offset.x, s0.offset.z) < 1);
  assert.ok(Math.abs(s0.origin.alt - W.source.summit.elevation) < 15, `summit bed ${s0.origin.alt}`);
  assert.ok(geoDist(s0.origin.lon, s0.origin.lat, W.source.summit.lon, W.source.summit.lat) < 30);
});

test('the bed flows: no long flat pools ending in cliffs (regression: a running minimum made them)', opts, () => {
  for (const s of W.stages) {
    const c = s.course, mean = -c.at(-1).y / polyLen(c);
    let run = 0, longest = 0, steep = 0;
    for (let i = 1; i < c.length; i++) {
      const sl = (c[i - 1].y - c[i].y) / dist(c[i - 1], c[i]);
      run = sl < 0.005 ? run + 1 : 0;
      longest = Math.max(longest, run);
      if (sl > Math.max(4 * mean, 0.5)) steep++;
    }
    assert.ok(longest * 10 <= 60, `${s.id}: flat run of ${longest * 10} m`);
    assert.ok(steep <= 3, `${s.id}: ${steep} cliff steps`);
  }
});

test('1:1 in plan: stage geometry matches real distances', opts, () => {
  const f = localFrame(W.frame.lat, W.frame.lon);
  for (const s of W.stages) {
    const ll = s.course.map((p) => { const g = toGlobal(s, p); return f.toLonLat(g.x, g.z); });
    let real = 0;
    for (let i = 1; i < ll.length; i++) real += geoDist(...ll[i - 1], ...ll[i]);
    const L = polyLen(s.course);
    assert.ok(Math.abs(real - L) / L < 0.005, `${s.id}: game ${L} m vs real ${real} m`);
    const o = f.toLonLat(s.offset.x, s.offset.z);
    assert.ok(Math.abs(o[0] - s.origin.lon) < 1e-5 && Math.abs(o[1] - s.origin.lat) < 1e-5, `${s.id}: origin vs offset`);
  }
});

test('1:1 in height: the bed and the terrain are the real DEM', demOpts, async () => {
  const dem = await getDem(), f = localFrame(W.frame.lat, W.frame.lon);
  for (const s of stages()) {
    const real = (x, z) => { const g = toGlobal(s.json, { x, z }); return dem.elevation(...f.toLonLat(g.x, g.z)); };
    // the bed is the lowest real ground across it, deepened only where the surface model has bumps
    let above = 0, deepest = 0;
    for (const p of s.json.course) {
      const d = real(p.x, p.z) - (p.y + s.json.offset.y);
      if (d < -1.5) above++;
      deepest = Math.max(deepest, d);
    }
    assert.equal(above, 0, `${s.json.id}: bed above the real ground`);
    assert.ok(deepest < 60, `${s.json.id}: bed ${deepest} m under the real ground`);
    // away from the bed the grid is the real terrain (blurred by 10 m)
    const m = s.json.height, errs = [];
    for (let j = 0; j < m.h; j += 9) for (let i = 0; i < m.w; i += 9) {
      const x = m.x0 + i * m.step, z = m.z0 + j * m.step;
      const nearBed = [...s.json.course, ...s.json.branches.flatMap((b) => b.points)].some((p) => dist(p, { x, z }) < p.hw + 45);
      if (nearBed) continue;
      errs.push(Math.abs(s.fine(x, z) + s.json.offset.y - real(x, z)));
    }
    errs.sort((a, b) => a - b);
    assert.ok(errs.length > 200);
    assert.ok(errs[Math.floor(errs.length / 2)] < 1.5 && errs[Math.floor(errs.length * 0.99)] < 12, `${s.json.id}: median ${errs[Math.floor(errs.length / 2)]}, p99 ${errs[Math.floor(errs.length * 0.99)]}`);
  }
});

// Playtest finding (28/10/2026): the bed was 24-36 m wide from the summit down, 4 to 6 times the real Piave (a
// brook of a few metres in the Val Sesis, 6-10 m at Sappada). It now follows the stream: 4-30 m half widths,
// narrowest at the source and widening downstream, from short.width of the config.
test('half widths 4-30 m, as wide as the real Piave and widening downstream; bends no tighter than 1.5 half widths', opts, () => {
  const mean = (s) => s.course.reduce((a, p) => a + p.hw, 0) / s.course.length;
  for (let k = 1; k < W.stages.length; k++) assert.ok(mean(W.stages[k]) > mean(W.stages[k - 1]), `${W.stages[k].id} narrower than ${W.stages[k - 1].id}`);
  assert.ok(mean(W.stages[0]) < 5.5 && mean(W.stages[1]) < 6 && mean(W.stages.at(-1)) < 8, W.stages.map((s) => mean(s).toFixed(1)).join(' '));
  for (const s of W.stages) {
    const c = s.course;
    for (const p of c) assert.ok(p.hw >= 4 && p.hw <= 30, `hw ${p.hw}`);
    for (let i = 1; i < c.length - 1; i++) {
      const a = Math.atan2(c[i].z - c[i - 1].z, c[i].x - c[i - 1].x), b = Math.atan2(c[i + 1].z - c[i].z, c[i + 1].x - c[i].x);
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))), r = dist(c[i - 1], c[i + 1]) / 2 / Math.max(turn, 1e-9);
      assert.ok(r >= 1.5 * c[i].hw, `${s.id} point ${i}: radius ${r.toFixed(1)} m, hw ${c[i].hw}`);
    }
    // the course never comes back next to itself, so carving one bend does not cut another
    for (let i = 0; i < c.length; i++) for (let j = i + 30; j < c.length; j++) assert.ok(dist(c[i], c[j]) > c[i].hw + c[j].hw + 40, `${s.id} ${i} and ${j} too close`);
  }
});

test('all indices are valid and local to their stage', opts, () => {
  const kinds = new Set();
  let cps = 0;
  for (const s of W.stages) {
    const n = s.course.length, ok = (i) => Number.isInteger(i) && i >= 0 && i < n;
    assert.ok(ok(s.finish));
    assert.ok(s.checkpoints.length >= 2 && s.checkpoints[0] === 0);
    cps += s.checkpoints.length;
    for (let i = 0; i < s.checkpoints.length; i++) {
      assert.ok(ok(s.checkpoints[i]));
      if (i) {
        assert.ok(s.checkpoints[i] > s.checkpoints[i - 1]);
        const gap = polyLen(s.course.slice(s.checkpoints[i - 1], s.checkpoints[i] + 1));
        assert.ok(gap > 300 && gap < 900, `${s.id} checkpoint gap ${gap}`);
      }
      for (const b of s.branches) assert.ok(!(s.checkpoints[i] > b.from && s.checkpoints[i] < b.to), 'checkpoint inside a branch');
    }
    for (const z of s.zones) {
      assert.ok(['ice', 'sun', 'rain', 'waterfall'].includes(z.kind));
      assert.ok(ok(z.from) && ok(z.to) && z.from < z.to);
      if (z.kind === 'waterfall') assert.ok(s.branches[z.branch]?.kind === 'shortcut' || (z.branch == null && z.name));
      kinds.add(z.kind);
    }
    for (const b of s.branches) assert.ok(ok(b.from) && ok(b.to) && b.from < b.to);
    for (const k of ['water', 'animals', 'obstacles']) for (const o of s.spawns[k]) {
      if ('course' in o) assert.ok(ok(o.course));
      if ('branch' in o) assert.ok(s.branches[o.branch]);
    }
  }
  assert.ok(cps >= 8);
  assert.deepEqual([...kinds].sort(), ['ice', 'rain', 'sun', 'waterfall']);
  assert.equal(W.stages[0].zones.find((z) => z.kind === 'ice')?.from, 0, 'the snowfield is at the top');
});

test('branches leave and rejoin the course, a shortcut with a waterfall and a safe arm', opts, () => {
  const all = W.stages.flatMap((s) => s.branches.map((b) => ({ s, b })));
  assert.deepEqual(all.map(({ b }) => b.kind).sort(), ['safe', 'shortcut']);
  for (const { s, b } of all) {
    const p = b.points, main = polyLen(s.course.slice(b.from, b.to + 1)), own = polyLen(p);
    assert.ok(dist(p[0], s.course[b.from]) < 1 && Math.abs(p[0].y - s.course[b.from].y) < 0.05, 'leaves at from');
    assert.ok(dist(p.at(-1), s.course[b.to]) < 1 && Math.abs(p.at(-1).y - s.course[b.to].y) < 0.05, 'rejoins at to');
    for (let i = 1; i < p.length; i++) assert.ok(p[i].y <= p[i - 1].y + 1e-9, `branch climbs at ${i}`);
    for (let i = 1; i < p.length; i++) assert.ok(dist(p[i - 1], p[i]) < 13);
    if (b.kind === 'shortcut') {
      assert.ok(own < main - 30, `shortcut ${own} vs ${main}`);
      assert.ok(b.waterfall && b.waterfall.drop >= 8 && b.waterfall.drop <= 30.5, `waterfall ${b.waterfall?.drop}`);
      assert.ok(Math.abs(p[b.waterfall.at].y - p[b.waterfall.at + 1].y - b.waterfall.drop) < 0.05);
    } else assert.ok(own > main, `safe arm ${own} vs ${main}`);
    const mid = p[Math.floor(p.length / 2)];
    const dmin = Math.min(...s.course.map((q) => dist(q, mid)));
    assert.ok(dmin > 25, `branch middle only ${dmin} m from the course`);
  }
});

test('grid sampled at course points equals the bed height', opts, () => {
  for (const s of stages()) {
    // 0.3 m on a gentle bed; on the steep 1:1 slopes a slope break inside a 4 m cell allows 0.6 m
    const c = s.json.course;
    c.forEach((p, i) => {
      const q = c[Math.min(i + 1, c.length - 1)], o = c[Math.max(i - 1, 0)], slope = (o.y - q.y) / dist(o, q);
      assert.ok(Math.abs(s.fine(p.x, p.z) - p.y) < (slope < 0.1 ? 0.3 : 0.6), `${s.json.id} point ${i}: ${s.fine(p.x, p.z)} vs ${p.y}, slope ${slope}`);
    });
    for (const b of s.json.branches) b.points.forEach((p, i) => {
      if (b.waterfall && Math.abs(i - b.waterfall.at) <= 1) return;
      assert.ok(Math.abs(s.fine(p.x, p.z) - p.y) < 0.5, `${s.json.id} branch ${b.kind} point ${i}: ${s.fine(p.x, p.z)} vs ${p.y}`);
    });
  }
});

test('sampling is the same in the bake, the loader and the sim', opts, () => {
  for (const s of stages()) {
    const m = s.json.height;
    for (let n = 0; n < 500; n++) {
      const x = m.x0 - 20 + ((n * 7919) % 1000) / 1000 * ((m.w - 1) * m.step + 40), z = m.z0 - 20 + ((n * 104729) % 997) / 997 * ((m.h - 1) * m.step + 40);
      assert.equal(simBilinear(m, s.height, x, z), s.fine(x, z));
    }
  }
});

test('the bed is a channel: banks are not lower than the bed', opts, () => {
  for (const s of stages()) {
    const c = s.json.course, skip = (i) => s.json.branches.some((b) => i >= b.from - 3 && i <= b.to + 3);
    let bad = 0;
    for (let i = 1; i < c.length - 1; i++) {
      if (skip(i)) continue;
      const tx = c[i + 1].x - c[i - 1].x, tz = c[i + 1].z - c[i - 1].z, L = Math.hypot(tx, tz), nx = -tz / L, nz = tx / L;
      for (const sg of [-1, 1]) if (s.fine(c[i].x + nx * sg * c[i].hw * 0.95, c[i].z + nz * sg * c[i].hw * 0.95) < c[i].y - 0.05) bad++;
    }
    assert.equal(bad, 0, s.json.id);
  }
});

// Playtest finding (28/10/2026): the Forra dell'Acquatona, a 50 m limestone slot, was an open grassy valley. The
// 30 m DEM cannot see a gorge narrower than a cell; the gorge biome's slot cuts the bed 25 m under it, between walls.
test('the Acquatona is a slot gorge: walls of 15 m or more within 8 m of the bed edge, one channel', opts, () => {
  const s = stages().find((q) => q.json.id === 'acquatona'), c = s.json.course;
  let walled = 0, n = 0;
  for (let i = 5; i < c.length - 5; i++, n++) {
    const tx = c[i + 1].x - c[i - 1].x, tz = c[i + 1].z - c[i - 1].z, L = Math.hypot(tx, tz), o = c[i].hw + 8;
    if ([-1, 1].every((sg) => s.fine(c[i].x - (tz / L) * o * sg, c[i].z + (tx / L) * o * sg) - c[i].y >= 15)) walled++;
  }
  assert.ok(walled / n > 0.8, `walls on ${((100 * walled) / n).toFixed(0)} % of the gorge`);
  assert.equal(s.json.branches.length, 0, 'no arm through the gorge walls');
  assert.ok(s.json.altitude[1] < 1133 - 15, 'the bed is cut under the DEM rim');
});

test('grids: the corridor and the backdrop cover the course, and agree inside the stages', opts, () => {
  const b = W.backdrop, bx1 = b.x0 + (b.w - 1) * b.step, bz1 = b.z0 + (b.h - 1) * b.step;
  for (const s of stages()) {
    const g = s.json.height, x1 = g.x0 + (g.w - 1) * g.step, z1 = g.z0 + (g.h - 1) * g.step;
    for (const p of [...s.json.course, ...s.json.branches.flatMap((q) => q.points)]) {
      assert.ok(p.x - g.x0 >= 240 && x1 - p.x >= 240 && p.z - g.z0 >= 240 && z1 - p.z >= 240, 'corridor margin');
      const q = toGlobal(s.json, p);
      assert.ok(q.x - b.x0 >= 5900 && bx1 - q.x >= 5900 && q.z - b.z0 >= 5900 && bz1 - q.z >= 5900, 'backdrop margin');
    }
    // backdrop nodes inside a stage grid are that grid, in global heights
    let worst = 0, n = 0;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
      const x = b.x0 + i * b.step - s.json.offset.x, z = b.z0 + j * b.step - s.json.offset.z;
      if (x < g.x0 || z < g.z0 || x > x1 || z > z1) continue;
      if (W.stages.slice(0, s.k).some((o) => { const h = o.height, lx = x + s.json.offset.x - o.offset.x, lz = z + s.json.offset.z - o.offset.z; return lx >= h.x0 && lz >= h.z0 && lx <= h.x0 + (h.w - 1) * h.step && lz <= h.z0 + (h.h - 1) * h.step; })) continue;
      worst = Math.max(worst, Math.abs(world.backdrop[j * b.w + i] - (s.fine(x, z) + s.json.offset.y)));
      n++;
    }
    assert.ok(n > 20 && worst < 0.01, `${s.json.id}: backdrop vs stage ${worst} over ${n}`);
    // ground: fine inside, the shifted backdrop outside, no step at the seam
    const ground = makeGround(world, s.k);
    for (const p of s.json.course) assert.equal(ground(p.x, p.z), s.fine(p.x, p.z));
    const edge = { x: x1 - 1, z: (g.z0 + z1) / 2 }, out = { x: x1 + 1, z: edge.z };
    assert.ok(Math.abs(ground(edge.x, edge.z) - ground(out.x, out.z)) < 25, 'seam');
  }
});

test('backdrop outside the stages is the real DEM', demOpts, async () => {
  const dem = await getDem(), f = localFrame(W.frame.lat, W.frame.lon), b = W.backdrop;
  let n = 0;
  for (let j = 0; j < b.h; j += 23) for (let i = 0; i < b.w; i += 23) {
    const x = b.x0 + i * b.step, z = b.z0 + j * b.step, [lon, lat] = f.toLonLat(x, z);
    if (lat < 46 || lat > 47 || lon < 12 || lon > 13) continue;
    if (W.stages.some((s) => { const h = s.height, lx = x - s.offset.x, lz = z - s.offset.z; return lx >= h.x0 && lz >= h.z0 && lx <= h.x0 + (h.w - 1) * h.step && lz <= h.z0 + (h.h - 1) * h.step; })) continue;
    assert.ok(Math.abs(world.backdrop[j * b.w + i] - dem.elevation(lon, lat)) < 0.01);
    n++;
  }
  assert.ok(n > 50);
});

test('spawns: starts side by side, pickups on the bed, real species at their altitude, rocks in the bed', opts, () => {
  let water = 0;
  const kinds = new Set();
  for (const s of stages()) {
    const sp = s.json.spawns, c = s.json.course;
    const [a, b] = sp.start;
    assert.ok(dist(a, b) > 4 && dist(a, b) < 12);
    for (const p of [...sp.start, ...sp.water, ...sp.animals, ...sp.obstacles]) assert.ok(Math.abs(s.fine(p.x, p.z) - p.y) < 0.05, 'spawn on the ground');
    for (const w of sp.water.filter((w) => 'course' in w)) assert.ok(dist(w, c[w.course]) < c[w.course].hw);
    water += sp.water.length;
    for (const an of sp.animals) {
      assert.ok(SPECIES.includes(an.kind), `${an.kind} does not live on Monte Peralba`);
      const band = cfg.animals.kinds[an.kind].alt, alt = an.y + s.json.offset.y;
      assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${an.kind} at ${alt} m`);
      assert.ok(dist(an, c[an.course]) > c[an.course].hw, 'animals on the bank, not in the water');
      kinds.add(an.kind);
    }
    assert.ok(sp.animals.length >= 3, `${s.json.id}: ${sp.animals.length} animals`);
    for (const o of sp.obstacles) assert.ok(o.kind === 'rock' && o.r > 0 && dist(o, c[o.course]) < c[o.course].hw);
  }
  assert.ok(water >= 50);
  for (const k of ['marmot', 'chamois', 'eagle']) assert.ok(kinds.has(k), k);
  assert.ok(W.stages[0].spawns.animals.some((a) => a.kind === 'marmot'));
  assert.ok(W.stages.some((s) => s.spawns.obstacles.length >= 8));
});

// Review finding (27/10/2026): the animals stood 22-50 m from the centerline, out of the sim's sense radius
// and a few pixels tall on screen, so nobody was ever drunk; the marmot lived on one stage and no cow grazed.
test('animals: walkers on the bank of every stage, by the water, on both banks; marmots and cows along the way', opts, () => {
  const stagesOf = (kind) => W.stages.filter((s) => s.spawns.animals.some((a) => a.kind === kind)).length;
  const sides = { left: 0, right: 0 };
  for (const s of stages()) {
    const c = s.json.course;
    const walkers = s.json.spawns.animals.filter((a) => !a.flying);
    assert.ok(walkers.length >= 2, `${s.json.id}: ${walkers.length} walkers`);
    for (const a of walkers) {
      const p = c[a.course], past = dist(a, p) - p.hw, off = cfg.animals.kinds[a.kind].off;
      assert.ok(past >= off[0] - 0.5 && past <= off[1] + 0.5 && past <= 8.5, `${s.json.id} ${a.kind}: ${past.toFixed(1)} m past the bed edge`);
      const q = c[Math.min(a.course + 1, c.length - 1)], o = c[Math.max(a.course - 1, 0)];
      sides[(a.x - p.x) * (q.z - o.z) - (a.z - p.z) * (q.x - o.x) < 0 ? 'right' : 'left']++;
    }
  }
  assert.ok(Math.abs(sides.left - sides.right) <= 2, `banks ${JSON.stringify(sides)}`);
  assert.ok(stagesOf('marmot') >= 2, `marmots on ${stagesOf('marmot')} stages`);
  assert.ok(stagesOf('cow') >= 1, 'cows at the lower pastures');
});

test('places along the real river are in order, with a stage index where they are played', opts, () => {
  assert.equal(W.places[0].name, 'Monte Peralba');
  assert.equal(W.places[0].stage, 0);
  assert.equal(W.places[0].course, 0);
  const names = W.places.map((p) => p.name);
  for (const n of ['Sappada', 'Santo Stefano di Cadore']) assert.ok(names.includes(n), n);
  for (let i = 1; i < W.places.length; i++) assert.ok(W.places[i].riverKm >= W.places[i - 1].riverKm);
  for (const p of W.places) {
    if (p.stage === null) assert.equal(p.course, null);
    else assert.ok(Number.isInteger(p.course) && p.course >= 0 && p.course < W.stages[p.stage].course.length);
  }
  // Santo Stefano di Cadore is about 23 km down the Piave from its source
  const ss = W.places.find((p) => p.name === 'Santo Stefano di Cadore');
  assert.ok(ss.riverKm > 20 && ss.riverKm < 27, `${ss.riverKm}`);
});

test('every stage plays in the sim: two bots reach the finish, chained by the cloud', opts, () => {
  let carry = null, steps = 0, ms = 0;
  for (let k = 0; k < W.stages.length; k++) {
    const sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === W.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++) {
      const inputs = bots.map((b) => b.input()), t = performance.now();
      sim.step(1 / 60, inputs);
      ms += performance.now() - t;
      steps++;
    }
    assert.equal(sim.state.phase, 'done', `${W.stages[k].id} not finished`);
    for (const p of sim.state.players) assert.equal(p.status, 'finished');
    carry = sim.carry();
  }
  assert.ok(ms / steps < 0.5, `${(ms / steps).toFixed(3)} ms per step`);
  test.diagnostic?.(`race over all stages: ${(steps / 60).toFixed(0)} s, ${(ms / steps).toFixed(3)} ms per step`);
});

test('files are small; the loader loads stages lazily and over HTTP', opts, async () => {
  let total = statSync(`${DIR}/dolomiti/world.json`).size + statSync(`${DIR}/dolomiti/${W.backdrop.file}`).size;
  for (const s of W.stages) {
    const size = statSync(`${DIR}/dolomiti/${s.height.file}`).size;
    assert.equal(size, s.height.w * s.height.h * 4);
    total += size;
  }
  assert.ok(total < 40e6, `${total} bytes`);
  const bins = readdirSync(`${DIR}/dolomiti`).filter((f) => f.endsWith('.bin')).sort();
  assert.deepEqual(bins, [W.backdrop.file, ...W.stages.map((s) => s.height.file)].sort(), 'no stale grids');
  const lazy = await loadWorld('dolomiti', { dir: DIR, stages: false });
  assert.ok(lazy.stages.every((s) => s === null));
  const one = await loadStage('dolomiti', lazy.json, 1, { dir: DIR });
  assert.equal(one.json.id, W.stages[1].id);
  assert.equal(one.height[1234], world.stages[1].height[1234]);

  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const srv = createServer(async (req, res) => {
    try {
      res.end(await readFile(`${DIR}/${decodeURIComponent(req.url.replace(/^\/worlds\//, ''))}`));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const w = await loadWorld('dolomiti', { base: `http://127.0.0.1:${srv.address().port}/worlds` });
    assert.deepEqual(w.json, W);
    for (const [k, st] of w.stages.entries()) {
      assert.equal(st.height.length, world.stages[k].height.length);
      for (let i = 0; i < st.height.length; i += 997) assert.equal(st.height[i], world.stages[k].height[i]);
    }
    assert.equal(w.backdrop[123], world.backdrop[123]);
  } finally {
    srv.close();
  }
});

test('the bake is deterministic and the baked world is up to date', { ...demOpts, timeout: 300000 }, () => {
  const out = mkdtempSync(`${tmpdir()}/summit-descent-bake-`);
  try {
    const r = spawnSync(process.execPath, ['tools/bake/index.mjs', 'dolomiti', '--mode', 'short', '--out', out], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(`${out}/dolomiti`).sort();
    assert.deepEqual(files, readdirSync(`${DIR}/dolomiti`).sort());
    for (const f of files) assert.ok(readFileSync(`${out}/dolomiti/${f}`).equals(readFileSync(`${DIR}/dolomiti/${f}`)), `${f} differs: rebake`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

const haveOsmium = spawnSync('osmium', ['--version']).status === 0;
test('Overpass down: the Geofabrik extract through osmium gives the river in the Overpass shape', { skip: haveOsmium ? false : 'osmium not installed' }, () => {
  const dir = mkdtempSync(`${tmpdir()}/summit-descent-osm-`);
  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  <node id="1" version="1" lat="46.60" lon="12.70"/><node id="2" version="1" lat="46.59" lon="12.70"/>
  <node id="3" version="1" lat="46.58" lon="12.69"/><node id="4" version="1" lat="46.57" lon="12.69"/>
  <node id="9" version="1" lat="46.61" lon="12.71"><tag k="natural" v="spring"/></node>
  <way id="10" version="1"><nd ref="1"/><nd ref="2"/><tag k="waterway" v="river"/></way>
  <way id="11" version="1"><nd ref="4"/><nd ref="3"/><nd ref="2"/><tag k="waterway" v="river"/></way>
  <way id="12" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="track"/></way>
  <relation id="2219648" version="1"><member type="node" ref="9" role="source"/><member type="way" ref="10" role="main_stream"/>
    <member type="way" ref="11" role="main_stream"/><tag k="type" v="waterway"/><tag k="waterway" v="river"/>
    <tag k="name" v="Piave"/><tag k="name:it" v="Fiume Piave, il sacro"/></relation>
  <relation id="5" version="1"><member type="way" ref="12" role=""/><tag k="name" v="Piave"/><tag k="route" v="hiking"/></relation>
</osm>`;
    writeFileSync(`${dir}/in.osm`, xml);
    assert.equal(spawnSync('osmium', ['cat', `${dir}/in.osm`, '-o', `${dir}/in.osm.pbf`]).status, 0);
    const j = riverFromPbf(`${dir}/in.osm.pbf`, `${dir}/work`);
    const rel = j.elements.filter((e) => e.type === 'relation');
    assert.equal(rel.length, 1, 'only the river relation');
    assert.equal(rel[0].tags['name:it'], 'Fiume Piave, il sacro', 'OPL escapes decoded');
    assert.deepEqual(rel[0].members.map((m) => [m.type, m.ref, m.role]), [['node', 9, 'source'], ['way', 10, 'main_stream'], ['way', 11, 'main_stream']]);
    writeFileSync(`${dir}/piave.json`, JSON.stringify(j));
    const r = loadRiver(`${dir}/piave.json`);
    assert.equal(r.pts.length, 4);
    assert.deepEqual(r.pts.at(-1), [12.69, 46.57], 'the reversed way is turned downstream');
    assert.ok(Math.abs(r.length - geoDist(12.7, 46.6, 12.7, 46.59) - geoDist(12.7, 46.59, 12.69, 46.58) - geoDist(12.69, 46.58, 12.69, 46.57)) < 1e-6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => oplToOverpass('w1 v1 Nn1,n2'), /without location/);
});
