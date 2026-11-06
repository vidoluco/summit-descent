// Swiss Alps world (tools/bake/worlds/svizzera.json, docs/mountains/svizzera.md): the Matterhorn north
// face, the Matterhorngletscher, the Zmuttbach past Stafel and Zmutt, down to Zermatt. Checks the baked
// world against published altitudes and places, the stage chain, the slope, the sim and the bake itself.
// test/bake-worlds.test.mjs runs the generic contract checks on this world too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/bake/config.mjs';
import { localFrame, geoDist, tileFile } from '../tools/bake/dem.mjs';
import { loadGlaciers, glacierAt } from '../tools/bake/glaciers.mjs';
import { loadWorld, toGlobal } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const ID = 'svizzera';
const baked = existsSync(`${DIR}/${ID}/world.json`);
const skip = baked ? false : 'svizzera not baked';

// Published values (docs/mountains/svizzera.md, "Sources")
const PUB = {
  summit: { alt: 4478, lat: 45.9764, lon: 7.6586 }, // swisstopo 4477.5 m, Swiss summit
  glacierOutline: 2826, // Matterhorngletscher: lowest point of today's OSM outline on GLO-30
  glacierTongue: 2693, // Matterhorngletscher tongue, de.wikipedia (older inventory, 3632-2693 m)
  zmutt: { alt: 1936, lat: 46.0065, lon: 7.7171 }, // hamlet of Zmutt
  confluence: { alt: 1624, lat: 46.0112, lon: 7.7393 }, // Zmuttbach meets the Gornera: the Matter Vispa
  zermatt: { alt: 1608, lat: 46.0212, lon: 7.7493 },
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyLen = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);
const W = baked ? JSON.parse(readFileSync(`${DIR}/${ID}/world.json`, 'utf8')) : null;
const lonLatOf = (s, p) => {
  const f = localFrame(W.frame.lat, W.frame.lon), g = toGlobal(s, p);
  return f.toLonLat(g.x, g.z);
};

test('svizzera: summit and finish match the published altitudes and places', { skip }, () => {
  const cfg = loadConfig(ID);
  assert.equal(cfg.summit.elevation, PUB.summit.alt);
  assert.equal(cfg.descent.kind, 'osm-network');
  // the race starts on the DEM top of the Matterhorn; GLO-30 shaves the sharp summit by about 150 m
  assert.ok(geoDist(W.frame.lon, W.frame.lat, PUB.summit.lon, PUB.summit.lat) < 300, 'the start is on the Matterhorn summit');
  const top = W.stages[0].altitude[1];
  assert.ok(PUB.summit.alt - top >= 0 && PUB.summit.alt - top < 170, `summit bed ${top} m vs ${PUB.summit.alt} m`);
  assert.ok(top > 4300, 'the first stage starts above 4300 m');
  // the finish: the Zmuttbach at the edge of Zermatt, just above the Gornera confluence
  const last = W.stages.at(-1), [lon, lat] = lonLatOf(last, last.course.at(-1));
  const fin = last.altitude[0];
  assert.ok(Math.abs(fin - PUB.confluence.alt) <= 25, `finish ${fin} m vs confluence ${PUB.confluence.alt} m`);
  assert.ok(Math.abs(fin - PUB.zermatt.alt) <= 40, `finish ${fin} m vs Zermatt ${PUB.zermatt.alt} m`);
  assert.ok(geoDist(lon, lat, PUB.confluence.lon, PUB.confluence.lat) < 700, 'finish next to the confluence');
  assert.ok(geoDist(lon, lat, PUB.zermatt.lon, PUB.zermatt.lat) < 1800, 'finish in Zermatt');
  assert.ok(Math.abs(W.floor.altitude - PUB.confluence.alt) < 30, `valley floor ${W.floor.altitude} m: Zermatt`);
  const idx = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).worlds.find((w) => w.id === ID);
  assert.equal(idx.summit.altitude, PUB.summit.alt);
  assert.deepEqual(idx.finish.names, { en: 'Zermatt', it: 'Zermatt' });
  assert.equal(idx.finish.altitude, fin);
});

test('svizzera: the line is north face, Matterhorn Glacier, Zmuttbach, Zermatt', { skip }, () => {
  const [s0, s1, s2, s3] = W.stages;
  assert.deepEqual(W.stages.map((s) => s.id), ['north-face', 'matterhorngletscher', 'stafel', 'zmutt-zermatt']);
  for (const s of W.stages) assert.ok(s.labels.it && s.labels.en && s.name === s.labels.it);
  // down the north face: the first stage ends north of the summit, on the glacier
  const [, lat0] = lonLatOf(s0, s0.course.at(-1));
  assert.ok(lat0 > W.frame.lat + 0.008, 'north face, not the east or south face');
  assert.ok(s0.zones.some((z) => z.kind === 'ice'));
  // the second stage crosses the Matterhorngletscher snout and its ice is named after it
  assert.ok(s1.altitude[1] > PUB.glacierOutline && s1.altitude[0] < PUB.glacierTongue);
  assert.ok(s1.zones.some((z) => z.kind === 'ice' && z.glacier === 'Matterhorngletscher'));
  // Stafel lies on the third stage, Zmutt (1936 m) in the cloud between the third and the fourth
  const place = (n) => W.places.find((p) => p.name === n);
  assert.equal(place('Stafel')?.stage, 2);
  assert.ok(s2.altitude[0] > PUB.zmutt.alt && s3.altitude[1] < PUB.zmutt.alt, 'Zmutt between stages 3 and 4');
  assert.ok(place('Zmutt').riverKm > s2.realKm[1] && place('Zmutt').riverKm < s3.realKm[0]);
  assert.ok(place('Zermatt'), 'Zermatt in the places');
  // every species of the spec list (plus the alpine chough) shows up, and nothing else; the cows are the
  // Hérens of the Valais alps, and the bearded vulture soars
  const kinds = new Set(W.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)));
  assert.deepEqual([...kinds].sort(), ['chamois', 'chough', 'herens', 'ibex', 'lammergeier', 'marmot', 'ptarmigan']);
  for (const a of W.stages.flatMap((s) => s.spawns.animals)) assert.equal(!!a.flying, a.kind === 'lammergeier', a.kind);
  assert.match(W.source.river, /Zmuttbach/);
});

test('svizzera: the second stage is named and painted for its moraines, not as a glacier', { skip }, () => {
  // only its first ~110 m are on the Matterhorngletscher outline (lowest point 2826 m, OSM on GLO-30);
  // the rest is the meltwater stream through the glacier forefield down to the Zmuttbach
  const s1 = W.stages[1], ice = s1.zones.filter((z) => z.kind === 'ice');
  assert.equal(ice.length, 1);
  assert.ok(ice[0].from === 0 && ice[0].to < 0.2 * s1.course.length, `ice ${ice[0].from}-${ice[0].to}`);
  assert.equal(s1.biome, 'moraine');
  assert.deepEqual(s1.labels, { it: 'Fronte e morene del ghiacciaio del Cervino', en: 'Matterhorn Glacier snout and moraines' });
});

test('svizzera: no ground animal stands on glacier ice, no ibex above 3000 m', { skip }, () => {
  const gl = loadGlaciers(`${ROOT}data/raw/osm/${ID}/glaciers.json`);
  assert.ok(gl?.length, 'glacier outlines cached');
  const birds = new Set(Object.entries(loadConfig(ID).animals.kinds).filter(([, g]) => g.bird).map(([k]) => k));
  for (const s of W.stages) {
    for (const a of s.spawns.animals) {
      const g = toGlobal(s, a);
      if (a.kind === 'ibex') assert.ok(g.y <= 3000 + 30, `ibex at ${g.y.toFixed(0)} m`);
      if (birds.has(a.kind)) continue;
      const [lon, lat] = lonLatOf(s, a);
      assert.equal(glacierAt(gl, lon, lat), null, `${a.kind} on ${s.id} course ${a.course} stands on a glacier`);
    }
  }
});

// swissALTI3D spot heights (swisstopo height service, LV95) under course points of the 27/10 bake,
// [stage, course index, m]. GLO-30 is good on the glacier and in the Zmutt valley, too low around the
// summit and too high in the narrow Zmutt gorge (docs/mountains/svizzera.md, "Second review").
const ALTI = {
  'north-face': [[0, 4317.9], [20, 4221.8], [40, 3991.9], [60, 3847.6], [80, 3591.0], [100, 3375.5], [120, 3289.1], [140, 3224.1], [160, 3119.6], [170, 3045.2]],
  matterhorngletscher: [[0, 2886.8], [20, 2757.1], [40, 2571.6], [60, 2463.7], [80, 2376.7], [100, 2348.1], [120, 2333.4], [140, 2290.9], [160, 2239.9], [170, 2224.6]],
  stafel: [[0, 2178.7], [20, 2140.1], [40, 2112.3], [60, 2086.7], [80, 2067.2], [100, 2051.5], [120, 2033.7], [140, 2020.2], [160, 2004.8], [170, 1990.7]],
  'zmutt-zermatt': [[0, 1827.5], [20, 1790.5], [40, 1772.4], [60, 1749.8], [80, 1729.2], [100, 1709.5], [120, 1701.3], [140, 1653.9], [160, 1639.7], [170, 1630.4]],
};
// The Zmutt gorge (stage 4, first 1000 m): GLO-30 fills it, so the played bed ran 32-49 m above swissALTI3D until
// 28/10/2026; the gorge biome's slot cuts it 35 m down to within 15 m of the real floor, between rock walls.
test('svizzera: the bed against swissALTI3D, with the known GLO-30 errors bounded', { skip }, () => {
  // the tolerance per stretch: [stage, from index, to index, below, above] in metres
  const tol = [['north-face', 0, 0, 10, 10], ['north-face', 1, 70, 90, 10], ['north-face', 71, 109, 10, 50], ['north-face', 110, 170, 10, 10],
    ['matterhorngletscher', 0, 170, 10, 25], ['stafel', 0, 170, 10, 10], ['zmutt-zermatt', 0, 100, 5, 15], ['zmutt-zermatt', 101, 170, 5, 35]];
  for (const s of W.stages) {
    for (const [i, h] of ALTI[s.id]) {
      const d = s.course[i].y + s.offset.y - h, [, , , lo, hi] = tol.find(([id, a, b]) => id === s.id && i >= a && i <= b);
      assert.ok(d >= -lo && d <= hi, `${s.id} ${i}: bed ${(d + h).toFixed(1)} m, swissALTI3D ${h} m`);
    }
  }
  // the race starts 150 m west of the summit, on ground swissALTI3D puts at 4318 m (summit 4476 m)
  assert.ok(Math.abs(W.stages[0].altitude[1] - 4317.9) < 10);
  // the finish is on the real ground at the Gornera confluence (1623 m)
  assert.ok(Math.abs(W.stages.at(-1).altitude[0] - 1630.4) < 10);
});

test('svizzera: stages are in order down the mountain and continuous inside', { skip }, () => {
  for (const [k, s] of W.stages.entries()) {
    const c = s.course;
    for (let i = 1; i < c.length; i++) {
      assert.ok(c[i].y < c[i - 1].y, `${s.id} ${i} climbs`);
      const d = dist(c[i], c[i - 1]);
      assert.ok(d > 8 && d < 12, `${s.id} ${i}: ${d} m between points`);
    }
    assert.ok(Math.abs(polyLen(c) - s.length) / s.length < 0.01);
    if (!k) continue;
    const a = W.stages[k - 1];
    assert.ok(s.realKm[0] - a.realKm[1] >= 0.3 - 1e-9, `${s.id}: gap ${s.realKm[0] - a.realKm[1]} km`);
    assert.ok(s.origin.alt < a.altitude[0], `${s.id} starts below where ${a.id} ends`);
  }
});

test('svizzera: every stage is steep, nothing flat is played', { skip }, () => {
  for (const s of W.stages) {
    const slope = (s.altitude[1] - s.altitude[0]) / s.length;
    assert.ok(slope >= 0.08, `${s.id}: mean slope ${(slope * 100).toFixed(1)} %`);
    assert.ok(s.altitude[0] >= W.floor.altitude, `${s.id} below the valley floor`);
    // no flat run over 60 m (the Zmutt reservoir is not played)
    const c = s.course;
    for (let i = 6; i < c.length; i++) assert.ok(c[i - 6].y - c[i].y > 60 * 0.005, `${s.id}: flat at ${i}`);
  }
  const drop = W.stages[0].altitude[1] - W.stages.at(-1).altitude[0];
  assert.ok(drop > 2500, `drop ${drop} m`);
});

test('svizzera: two sim bots finish every stage, chained, in 3-5 minutes', { skip, timeout: 120000 }, async (t) => {
  const world = await loadWorld(ID, { dir: DIR });
  let carry = null, sim = null;
  const per = [];
  for (let k = 0; k < world.stages.length; k++) {
    sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === world.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    const t0 = sim.state.t;
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++) sim.step(1 / 60, bots.map((b) => b.input()));
    assert.equal(sim.state.phase, 'done', `stage ${k} not finished`);
    for (const p of sim.state.players) assert.equal(p.status, 'finished', `stage ${k}`);
    per.push(sim.state.t - t0);
    carry = sim.carry();
  }
  const times = sim.state.players.map((p) => p.finishTime);
  const race = times.reduce((a, b) => a + b, 0) / times.length + 3.5 * (W.stages.length - 1);
  t.diagnostic(`stages ${per.map((s) => s.toFixed(0)).join(' + ')} s, race with clouds ${race.toFixed(0)} s`);
  assert.ok(race >= 165 && race <= 300, `race ${race.toFixed(0)} s (spec: 3-5 min; 185 s when baked)`);
  for (const s of per) assert.ok(s > 20 && s < 90, `stage time ${s} s`);
});

const haveTiles = () => loadConfig(ID).dem.tiles.every((t) => existsSync(`${ROOT}data/raw/dem/${tileFile(t)}`));
test('svizzera: the bake is deterministic and matches data/worlds', { skip: !baked ? skip : haveTiles() ? false : 'DEM tiles missing', timeout: 300000 }, () => {
  const outs = [0, 1].map(() => mkdtempSync(`${tmpdir()}/summit-descent-svizzera-`));
  try {
    for (const out of outs) {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', ID, '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const files = readdirSync(`${outs[0]}/${ID}`).sort();
    assert.deepEqual(files, ['backdrop.bin', 'stage-0.bin', 'stage-1.bin', 'stage-2.bin', 'stage-3.bin', 'world.json']);
    assert.deepEqual(readdirSync(`${outs[1]}/${ID}`).sort(), files);
    for (const f of files) {
      const a = readFileSync(`${outs[0]}/${ID}/${f}`);
      assert.ok(a.equals(readFileSync(`${outs[1]}/${ID}/${f}`)), `${f}: two bakes differ`);
      assert.ok(a.equals(readFileSync(`${DIR}/${ID}/${f}`)), `${f} differs from data/worlds: rebake svizzera`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
