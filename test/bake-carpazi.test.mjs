// Carpathian world (tools/bake/worlds/carpazi.json, docs/mountains/carpazi.md): Vârful Văiuga in the
// Făgăraș, its west face into the Bâlea cirque and Lacul Bâlea, over Cascada Bâlea, past Cabana Bâlea
// Cascadă and down Valea Bâlii towards Cârțișoara. Checks the baked world against published altitudes
// and places, the stage chain, the slope, the animals, the sim and the bake itself.
// test/bake-worlds.test.mjs runs the generic contract checks on this world too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/bake/config.mjs';
import { chooseStages } from '../tools/bake/course.mjs';
import { localFrame, geoDist, tileFile } from '../tools/bake/dem.mjs';
import { loadWorld, toGlobal, bilinear } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const ID = 'carpazi';
const baked = existsSync(`${DIR}/${ID}/world.json`);
const skip = baked ? false : 'carpazi not baked';

// Published values (docs/mountains/carpazi.md, "Sources"); positions from OpenStreetMap
const PUB = {
  summit: { alt: 2443, lat: 45.60372, lon: 24.62587 }, // Vârful Văiuga
  lake: { alt: 2034, lat: 45.60329, lon: 24.61723 }, // Lacul Bâlea
  outlet: { lat: 45.60481, lon: 24.61828 }, // the Bâlea leaves the lake (first node of OSM way 998015614)
  // the Văiuga stream from Căldarea Văiugii joins the Bâlea (OSM ways 284417796 and 284417538): the
  // summit's own fall line on the DEM runs north into that cirque and reaches the Bâlea here
  confluence: { lat: 45.61172, lon: 24.61479 },
  waterfall: { lat: 45.6264, lon: 24.61227 }, // Cascada Bâlea, 60 m
  chalet: { alt: 1234, lat: 45.63641, lon: 24.60663 }, // Cabana Bâlea Cascadă
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyLen = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);
const W = baked ? JSON.parse(readFileSync(`${DIR}/${ID}/world.json`, 'utf8')) : null;
const lonLatOf = (s, p) => {
  const f = localFrame(W.frame.lat, W.frame.lon), g = toGlobal(s, p);
  return f.toLonLat(g.x, g.z);
};
// closest course point of a stage to a lon/lat: [distance m, point index]
const nearest = (s, { lat, lon }) => s.course.reduce((best, p, i) => {
  const [x, y] = lonLatOf(s, p), d = geoDist(x, y, lon, lat);
  return d < best[0] ? [d, i] : best;
}, [Infinity, -1]);

test('carpazi: packed stage pick lays the windows from the summit, gap apart, above the floor', () => {
  const prof = Array.from({ length: 1001 }, (_, i) => 2000 - i); // 10 km at 10 m steps
  const p = chooseStages(prof, 10, 8000, { count: 4, length: 1900, gap: 300, pick: 'packed' });
  assert.deepEqual(p.map((s) => [s.u0, s.u1]), [[0, 1900], [2200, 4100], [4400, 6300]], 'the fourth window would end below the floor');
  const q = chooseStages(prof, 10, 9000, { count: 4, length: 1900, gap: 300, pick: 'packed' });
  assert.deepEqual(q.map((s) => s.u0), [0, 2200, 4400, 6600]);
  assert.ok(q.every((s) => s.drop === 190));
  // the default greedy pick is unchanged
  const g = chooseStages(prof, 10, 9000, { count: 4, length: 1900, gap: 300 });
  assert.equal(g.length, 4);
  assert.equal(loadConfig(ID).short.stages.pick, 'packed');
});

test('carpazi: summit and finish match the published altitudes and places', { skip }, () => {
  const cfg = loadConfig(ID);
  assert.equal(cfg.summit.elevation, PUB.summit.alt);
  assert.equal(cfg.descent.kind, 'osm-network');
  assert.ok(geoDist(W.frame.lon, W.frame.lat, PUB.summit.lon, PUB.summit.lat) < 100, 'the start is on Vârful Văiuga');
  assert.ok(Math.abs(W.source.summit.elevation - PUB.summit.alt) <= 30, `DEM summit ${W.source.summit.elevation} m vs ${PUB.summit.alt} m`);
  const top = W.stages[0].altitude[1];
  assert.ok(PUB.summit.alt - top >= 0 && PUB.summit.alt - top < 40, `summit bed ${top} m vs ${PUB.summit.alt} m`);
  // the finish: Valea Bâlii above Cârțișoara, just above the valley floor where the slope drops
  const last = W.stages.at(-1), fin = last.altitude[0];
  assert.ok(fin >= W.floor.altitude && fin - W.floor.altitude < 60, `finish ${fin} m vs floor ${W.floor.altitude} m`);
  assert.ok(W.floor.altitude > 600 && W.floor.altitude < 720, `valley floor ${W.floor.altitude} m`);
  assert.ok(Math.abs(W.floor.riverKm - 8.8) < 0.5, `valley floor at river km ${W.floor.riverKm}`);
  assert.ok(PUB.chalet.alt - fin > 450, 'the finish is well below Bâlea Cascadă');
  const idx = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).worlds.find((w) => w.id === ID);
  assert.equal(idx.summit.altitude, PUB.summit.alt);
  assert.equal(idx.summit.name, 'Vârful Văiuga');
  assert.deepEqual(idx.finish.names, { it: 'Valea Bâlii, verso Cârțișoara', en: 'Bâlea Valley, towards Cârțișoara' });
  assert.equal(idx.finish.altitude, fin);
  assert.ok(W.places.some((p) => p.name === 'Cârțișoara'), 'Cârțișoara in the places');
});

test('carpazi: the line is Văiuga, Lacul Bâlea, Cascada Bâlea, Bâlea Cascadă, Valea Bâlii', { skip }, () => {
  const [s0, s1, s2, s3] = W.stages;
  assert.deepEqual(W.stages.map((s) => s.id), ['summit', 'cascada', 'balea-cascada', 'valea-balii']);
  assert.deepEqual(W.stages.map((s) => s.labels.it), ['Văiuga e Lacul Bâlea', 'Cascada Bâlea', 'Cabana Bâlea Cascadă', 'Valea Bâlii']);
  for (const s of W.stages) assert.ok(s.labels.it && s.labels.en && s.name === s.labels.it);
  assert.match(W.source.river, /Bâlea/);
  // stage 1 runs past Lacul Bâlea (2034 m) out of the cirque
  const [dl, il] = nearest(s0, PUB.lake);
  assert.ok(dl < 300, `stage 1 passes ${dl.toFixed(0)} m from Lacul Bâlea`);
  const yl = toGlobal(s0, s0.course[il]).y;
  assert.ok(Math.abs(yl - PUB.lake.alt) < 40, `bed at the lake ${yl.toFixed(0)} m vs ${PUB.lake.alt} m`);
  const [dout] = nearest(s0, PUB.outlet);
  assert.ok(dout < 60, `stage 1 passes ${dout.toFixed(0)} m from the lake outlet`);
  // water from the summit reaches the course again: the Văiuga stream confluence is on stage 1
  const [dc, ic] = nearest(s0, PUB.confluence);
  assert.ok(dc < 40 && ic > il, `stage 1 passes ${dc.toFixed(0)} m from the Văiuga confluence, below the lake`);
  assert.ok(s0.zones.some((z) => z.kind === 'ice'), 'late snow and ice on the cirque headwall (no glacier in the Făgăraș)');
  // stage 2 goes over the waterfall
  const [dw] = nearest(s1, PUB.waterfall);
  assert.ok(dw < 60, `stage 2 passes ${dw.toFixed(0)} m from Cascada Bâlea`);
  // stage 3 starts at Cabana Bâlea Cascadă (1234 m)
  const [lon2, lat2] = lonLatOf(s2, s2.course[0]);
  assert.ok(geoDist(lon2, lat2, PUB.chalet.lon, PUB.chalet.lat) < 250, 'stage 3 starts at Bâlea Cascadă');
  assert.ok(Math.abs(s2.origin.alt - PUB.chalet.alt) < 25, `stage 3 starts at ${s2.origin.alt} m`);
  // stage 4 is the beech valley, north of the chalet
  const [, lat3] = lonLatOf(s3, s3.course.at(-1));
  assert.ok(lat3 > PUB.chalet.lat + 0.015, 'stage 4 ends down the valley, towards Cârțișoara');
  assert.equal(s3.biome, 'beech');
});

// Playtest finding (28/10/2026): Cascada Bâlea, the stage's title, was a plain 55-66 % ramp (the 30 m DEM smooths
// the fall). The config's waterfall makes it the real 60 m stepped fall at the OSM point, a rock step across the
// valley that the renderer draws as falling water (slope over theme water.waterfallSlope, 1.3).
test('carpazi: Cascada Bâlea is a 60 m fall in steps at its real place, a rock step across the valley', { skip }, async () => {
  const world = await loadWorld(ID, { dir: DIR }), s = world.json.stages[1], c = s.course;
  const z = s.zones.find((q) => q.kind === 'waterfall' && q.name === 'Cascada Bâlea');
  assert.ok(z, `no waterfall zone on ${s.id}: ${JSON.stringify(s.zones)}`);
  assert.ok(Math.abs(z.steps.reduce((a, st) => a + st.drop, 0) - 60) < 1, 'the published 60 m');
  const [d, i] = nearest(s, PUB.waterfall);
  assert.ok(d < 60 && i >= z.from && i <= z.to, `the fall is ${d.toFixed(0)} m from the OSM point`);
  const fine = (x, zz) => bilinear(s.height, world.stages[1].height, x, zz);
  for (const st of z.steps) {
    const a = c[st.at], b = c[st.at + 1];
    assert.ok((a.y - b.y) / dist(a, b) > 1.3, `step at ${st.at}: ${((a.y - b.y) / dist(a, b)).toFixed(2)}`);
    // the ground beside the stream steps down too: a cliff band, not a chute cut in the slope
    const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz), nx = -tz / L, nz = tx / L;
    for (const off of [-30, 30]) {
      const up = fine(a.x + nx * off - (tx / L) * 6, a.z + nz * off - (tz / L) * 6), down = fine(b.x + nx * off + (tx / L) * 6, b.z + nz * off + (tz / L) * 6);
      assert.ok(up - down > 0.6 * st.drop, `step at ${st.at}, ${off} m aside: ground falls ${(up - down).toFixed(1)} m`);
    }
  }
  // a fall the sim flies off: the drops are airborne over it
  const sim = createSim(world.stages[1], { players: 2, seed: 5 }), bots = [createBot(sim, 0), createBot(sim, 1)];
  let air = 0;
  for (let n = 0; n < 120 * 60 && sim.state.phase !== 'done'; n++) {
    sim.step(1 / 60, bots.map((b) => b.input()));
    const p = sim.state.players[0], tr = sim.track(0);
    if (p.status === 'airborne' && tr.index >= z.from - 2 && tr.index <= z.to + 6) air++;
  }
  assert.equal(sim.state.phase, 'done');
  assert.ok(air / 60 > 1, `${(air / 60).toFixed(1)} s in the air at the fall`);
});

test('carpazi: the animals are the Făgăraș species, inside their altitude bands', { skip }, () => {
  const cfg = loadConfig(ID), kinds = cfg.animals.kinds;
  const seen = new Set();
  for (const s of W.stages) {
    for (const a of s.spawns.animals) {
      seen.add(a.kind);
      const g = toGlobal(s, a), band = kinds[a.kind].alt;
      // the band is checked on the real bed altitude of the course point; the animal stands on the bank
      assert.ok(g.y > band[0] - 120 && g.y < band[1] + 120, `${a.kind} at ${g.y.toFixed(0)} m, band ${band}`);
      if (a.kind === 'eagle') assert.equal(a.flying, true);
    }
  }
  assert.deepEqual([...seen].sort(), ['brown-bear', 'carpathian-chamois', 'eagle', 'lynx', 'red-deer', 'sheep', 'sheepdog', 'wolf']);
  // the stâna: sheep come with their dog on the summit stage
  const top = W.stages[0].spawns.animals.map((a) => a.kind);
  assert.ok(top.includes('sheep') && top.includes('sheepdog') && top.includes('carpathian-chamois'));
});

test('carpazi: stages are in order down the mountain and continuous inside', { skip }, () => {
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
    assert.ok(s.realKm[0] - a.realKm[1] >= 0.3 - 0.02, `${s.id}: gap ${s.realKm[0] - a.realKm[1]} km`);
    assert.ok(s.origin.alt < a.altitude[0], `${s.id} starts below where ${a.id} ends`);
  }
});

test('carpazi: every stage is steep, nothing flat is played', { skip }, () => {
  for (const s of W.stages) {
    const slope = (s.altitude[1] - s.altitude[0]) / s.length;
    assert.ok(slope >= 0.11, `${s.id}: mean slope ${(slope * 100).toFixed(1)} %`);
    assert.ok(s.altitude[0] >= W.floor.altitude, `${s.id} below the valley floor`);
    assert.ok(s.length >= 1000 && s.length <= 2000);
    const c = s.course;
    for (let i = 6; i < c.length; i++) assert.ok(c[i - 6].y - c[i].y > 60 * 0.005, `${s.id}: flat at ${i}`);
  }
  const drop = W.stages[0].altitude[1] - W.stages.at(-1).altitude[0];
  assert.ok(drop > 1600, `drop ${drop} m`);
});

test('carpazi: two sim bots finish every stage, chained, in 3-5 minutes', { skip, timeout: 120000 }, async (t) => {
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
  assert.ok(race >= 180 && race <= 300, `race ${race.toFixed(0)} s (spec: 3-5 min; 199 s when baked)`);
  for (const s of per) assert.ok(s > 20 && s < 90, `stage time ${s} s`);
});

const haveTiles = () => loadConfig(ID).dem.tiles.every((t) => existsSync(`${ROOT}data/raw/dem/${tileFile(t)}`));
test('carpazi: the bake is deterministic and matches data/worlds', { skip: !baked ? skip : haveTiles() ? false : 'DEM tiles missing', timeout: 300000 }, () => {
  const outs = [0, 1].map(() => mkdtempSync(`${tmpdir()}/summit-descent-carpazi-`));
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
      assert.ok(a.equals(readFileSync(`${DIR}/${ID}/${f}`)), `${f} differs from data/worlds: rebake carpazi`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
