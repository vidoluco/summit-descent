// K2 world (tools/bake/worlds/k2.json, docs/mountains/k2.md): the line from the summit over the
// Bottleneck and the Shoulder, down the south-east face beside the Abruzzi Spur, onto the
// Godwin-Austen Glacier towards Concordia. Checks the bake against published altitudes, the stage
// order, the steepness, the fall line on the face, the sim and determinism. Needs data/worlds/k2 (node tools/bake/index.mjs k2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWorld, toGlobal } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { localFrame, geoDist, tileFile } from '../tools/bake/dem.mjs';
import { loadConfig } from '../tools/bake/config.mjs';
import { CLOUD_SECONDS } from '../tools/bake/world-index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const DEM_DIR = `${ROOT}data/raw/dem`;
const have = existsSync(`${DIR}/k2/world.json`);
const opts = { skip: have ? false : 'k2 not baked: node tools/bake/index.mjs k2' };
const cfg = loadConfig('k2');
const haveDem = cfg.dem.tiles.every((t) => existsSync(`${DEM_DIR}/${tileFile(t)}`));
const demOpts = { skip: !have ? opts.skip : haveDem ? false : 'K2 DEM tile missing in data/raw/dem' };
const world = have ? await loadWorld('k2', { dir: DIR }) : null;
const W = world?.json;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const polyLen = (p) => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);
const realAlt = (s, i) => s.course[i].y + s.offset.y;

// Published values (sources in docs/mountains/k2.md)
const PUB = {
  summit: { alt: 8611, lat: 35.8825, lon: 76.5133 }, // official height; Wikipedia coordinates
  bottleneck: 8200, // the couloir between the Shoulder and the summit
  shoulder: 7900, // Camp 4 on the Shoulder, 7,900-7,950 m
  k2BaseCamp: { alt: [4963, 5150], lat: 35.8348, lon: 76.5093 }, // GPS 2014 4963 m, OSM 4965 m, guides 5,000-5,150 m
  broadPeakBaseCamp: { alt: [4823, 4850] }, // OSM 4823 m, guides 4,850 m
  concordia: { alt: [4600, 4691], lat: 35.7416, lon: 76.5119 }, // OSM 4600 m, Wikipedia 4,691 m
  // Abruzzi Spur camps 1-3, high-precision GPS of the 2014 Ev-K2-CNR / University of Trieste survey
  abruzziCamps: [[35.86607, 76.53632, 6060], [35.87008, 76.53256, 6654], [35.87539, 76.53052, 7330]],
};
// spec "Animali: specie vere", K2 row, plus the alpine chough recorded to 8,200 m; no pika (28/10/2026): it lives in
// talus and rock crevices, and every spawn the bake gave it was on the snow of the face or the glacier
const SPECIES = ['siberian-ibex', 'snow-leopard', 'himalayan-brown-bear', 'lammergeier', 'chough'];

test('k2: summit where the published K2 is, within what a 30 m DEM can show', opts, () => {
  assert.equal(cfg.summit.elevation, PUB.summit.alt);
  const s = W.source.summit;
  // GLO-30 shaves the sharp top: 8570 m against 8611 m, and puts the highest cell about 200 m south-west
  assert.ok(Math.abs(s.elevation - PUB.summit.alt) <= 60, `DEM summit ${s.elevation} m`);
  assert.ok(geoDist(s.lon, s.lat, PUB.summit.lon, PUB.summit.lat) < 300, 'summit position');
  assert.ok(Math.abs(W.stages[0].origin.alt - s.elevation) < 15, 'the race starts on the summit');
  const idx = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).worlds.find((w) => w.id === 'k2');
  assert.equal(idx.summit.altitude, PUB.summit.alt, 'the vote shows the official height');
});

test('k2: the line passes the Bottleneck and the Shoulder at their real heights', opts, () => {
  const s0 = W.stages[0];
  for (const [name, alt, tol] of [['Bottleneck', PUB.bottleneck, 150], ['Shoulder (Camp 4)', PUB.shoulder, 150]]) {
    const p = W.places.find((q) => q.name === name);
    assert.ok(p && p.stage === 0 && Number.isInteger(p.course), `${name} in the first stage`);
    assert.ok(Math.abs(realAlt(s0, p.course) - alt) <= tol, `${name}: bed at ${realAlt(s0, p.course).toFixed(0)} m, published ${alt} m`);
  }
});

test('k2: the race ends at the foot of the face, above K2 Base Camp, where the Godwin-Austen flattens', opts, () => {
  const last = W.stages.at(-1), finish = realAlt(last, last.finish);
  // the steep part ends where the face meets the Godwin-Austen; below, the glacier runs at 3-5 % to Concordia and
  // is not played (spec: only the steep part): the finish lies on the glacier just above K2 Base Camp
  assert.ok(finish > PUB.k2BaseCamp.alt[0] && finish < 5150, `finish at ${finish.toFixed(0)} m`);
  assert.ok(last.zones.some((z) => z.kind === 'ice' && z.glacier === 'Godwin Austen Glacier'), 'the last stage reaches the Godwin-Austen');
  // the valley floor is the first 3 km under 4 %, from K2 Base Camp down
  assert.ok(Math.abs(W.floor.altitude - PUB.k2BaseCamp.alt[0]) <= 40, `floor at ${W.floor.altitude} m`);
  const bc = W.places.find((p) => p.name === 'K2 Base Camp');
  assert.ok(bc && Math.abs(bc.riverKm - W.floor.riverKm) < 0.5, `floor at km ${W.floor.riverKm}, K2 Base Camp at km ${bc?.riverKm}`);
  // places in order down the line; K2 Base Camp and everything below it are past the finish (Concordia, 12 km
  // past the floor, is no longer listed)
  const order = ['K2', 'Bottleneck', 'Shoulder (Camp 4)', 'K2 Base Camp', 'Broad Peak Base Camp'].map((n) => W.places.find((p) => p.name === n));
  assert.ok(order.every(Boolean), 'named places');
  for (let i = 1; i < order.length; i++) assert.ok(order[i].riverKm > order[i - 1].riverKm, `${order[i].name} after ${order[i - 1].name}`);
  assert.ok(order[3].riverKm > last.realKm[1], 'K2 Base Camp is below the finish');
});

test('k2: three stages in order down the mountain, each continuous, joined by short cloud flights', opts, () => {
  assert.equal(W.stages.length, 3);
  assert.deepEqual(W.stages.map((s) => s.id), ['summit-shoulder', 'south-east-face', 'face-foot']);
  for (const s of W.stages) assert.ok(s.labels.it && s.labels.en && s.labels.it !== s.labels.en, s.id);
  for (const [k, s] of W.stages.entries()) {
    const c = s.course;
    for (let i = 1; i < c.length; i++) {
      const d = Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
      assert.ok(d > 9 && d < 11, `${s.id} ${i}: ${d.toFixed(1)} m between points`);
      assert.ok(c[i].y < c[i - 1].y, `${s.id} ${i} climbs`);
    }
    if (!k) continue;
    const a = W.stages[k - 1], end = toGlobal(a, a.course.at(-1)), start = toGlobal(s, s.course[0]);
    assert.ok(s.realKm[0] > a.realKm[1], `${s.id} after ${a.id}`);
    assert.ok(start.y < end.y, `${s.id} starts below where ${a.id} ends`);
    // the cloud carries the drop a short way down the same line
    assert.ok(dist(start, end) < 3000, `${a.id} -> ${s.id}: ${dist(start, end).toFixed(0)} m`);
  }
});

test('k2: every stage is steep enough to race, with no flat pools and no tight bends', opts, () => {
  const mins = { 'summit-shoulder': 0.5, 'south-east-face': 0.5, 'face-foot': 0.1 };
  for (const s of W.stages) {
    const c = s.course, L = polyLen(c), mean = -c.at(-1).y / L;
    assert.ok(L >= 1000 && L <= 2000, `${s.id}: ${L} m`);
    assert.ok(mean >= mins[s.id], `${s.id}: mean slope ${(mean * 100).toFixed(1)} %`);
    let run = 0, longest = 0;
    for (let i = 1; i < c.length; i++) {
      run = (c[i - 1].y - c[i].y) / dist(c[i - 1], c[i]) < 0.005 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    assert.ok(longest * 10 <= 60, `${s.id}: flat run of ${longest * 10} m`);
    for (const p of c) assert.ok(p.hw >= 4 && p.hw <= 30, `${s.id}: hw ${p.hw}`);
    for (let i = 1; i < c.length - 1; i++) {
      const a = Math.atan2(c[i].z - c[i - 1].z, c[i].x - c[i - 1].x), b = Math.atan2(c[i + 1].z - c[i].z, c[i + 1].x - c[i].x);
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))), r = dist(c[i - 1], c[i + 1]) / 2 / Math.max(turn, 1e-9);
      assert.ok(r >= 1.5 * c[i].hw, `${s.id} point ${i}: radius ${r.toFixed(1)} m`);
    }
  }
  assert.ok(W.stages.at(-1).altitude[0] > W.floor.altitude, 'nothing below the valley floor is played');
});

test('k2: the bed is the real ground of the DEM', demOpts, async () => {
  const { loadDem } = await import('../tools/bake/dem.mjs');
  const dem = await loadDem(DEM_DIR, { files: cfg.dem.tiles.map((t) => tileFile(t)) }), f = localFrame(W.frame.lat, W.frame.lon);
  for (const s of W.stages) {
    let above = 0;
    for (const p of s.course) {
      const g = toGlobal(s, p);
      if (dem.elevation(...f.toLonLat(g.x, g.z)) - g.y < -1.5) above++;
    }
    assert.equal(above, 0, `${s.id}: bed above the real ground`);
  }
});

test('k2: below the Shoulder the course takes the real fall line of the face, not the Abruzzi Spur', demOpts, async () => {
  const { loadDem } = await import('../tools/bake/dem.mjs');
  const dem = await loadDem(DEM_DIR, { files: cfg.dem.tiles.map((t) => tileFile(t)) }), f = localFrame(W.frame.lat, W.frame.lon);
  // steepest descent on the DEM (3x3 mean at 30 m, 16 directions, 20 m steps) from the Shoulder: where meltwater runs
  const E = (x, z) => { let s = 0; for (const dx of [-30, 0, 30]) for (const dz of [-30, 0, 30]) s += dem.elevation(...f.toLonLat(x + dx, z + dz)); return s / 9; };
  const sh = W.places.find((p) => p.name === 'Shoulder (Camp 4)');
  let [x, z] = f.toXZ(sh.lon, sh.lat), h = E(x, z);
  const trace = [[x, z]];
  for (let n = 0; n < 400; n++) {
    let b = null;
    for (let a = 0; a < 16; a++) {
      const t = (a * Math.PI) / 8, nx = x + 20 * Math.cos(t), nz = z + 20 * Math.sin(t), nh = E(nx, nz);
      if (nh < h && (!b || nh < b.h)) b = { x: nx, z: nz, h: nh };
    }
    if (!b) break;
    ({ x, z, h } = b);
    trace.push([x, z]);
  }
  assert.ok(h < 5300, `the fall line from the Shoulder reaches the glacier (${h.toFixed(0)} m)`);
  const off = (g) => Math.min(...trace.map(([tx, tz]) => Math.hypot(g.x - tx, g.z - tz)));
  const face = W.stages.find((s) => s.id === 'south-east-face');
  const worst = Math.max(...face.course.map((p) => off(toGlobal(face, p))));
  assert.ok(worst <= 150, `south-east-face: ${worst.toFixed(0)} m off the DEM fall line`);
  // the climbers' ridge stays to the side: camps 1-3 of the Abruzzi Spur are not on the course
  for (const [lat, lon, alt] of PUB.abruzziCamps) {
    const [cx, cz] = f.toXZ(lon, lat);
    const d = Math.min(...W.stages.flatMap((s) => s.course.map((p) => { const g = toGlobal(s, p); return Math.hypot(g.x - cx, g.z - cz); })));
    assert.ok(d >= 400, `Abruzzi camp at ${alt} m is ${d.toFixed(0)} m from the course`);
  }
});

test('k2: ice on every stage, only K2 species, each in its real altitude band', opts, () => {
  for (const s of W.stages) {
    assert.ok(s.zones.some((z) => z.kind === 'ice'), `${s.id}: no ice`);
    for (const a of s.spawns.animals) {
      assert.ok(SPECIES.includes(a.kind), `${s.id}: ${a.kind} does not live on K2`);
      const band = cfg.animals.kinds[a.kind].alt, alt = a.y + s.offset.y;
      assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${a.kind} at ${alt.toFixed(0)} m`);
      if (!cfg.animals.kinds[a.kind].bird) assert.ok(alt <= 5650, `${a.kind} at ${alt.toFixed(0)} m: no mammal lives on the upper face`);
    }
  }
  // the played part is above 5000 m, over the top of the ibex and snow leopard bands: no large mammal is spawned
  assert.ok(!W.stages.flatMap((s) => s.spawns.animals).some((a) => a.kind === 'snow-leopard' || a.kind === 'siberian-ibex'), 'no large mammal above 5000 m');
  // every stage is snow and ice: only the birds, no walker standing on the glacier
  assert.ok(W.stages.flatMap((s) => s.spawns.animals).every((a) => cfg.animals.kinds[a.kind].bird), 'only birds on the ice');
});

// K2 is the one world under 3 minutes: at 1:1 only 5 km of the line are steep (summit to the foot of the face);
// the rest is the Godwin-Austen at 3-5 %, which the spec does not play (decision of 27/10/2026). About 2.2 minutes
// (138 s) since the landing fix of 28/10/2026 ended the false flights over the face (157 s before).
test('k2: two sim bots finish every stage, and the short race lasts about 2.2-5 minutes', { ...opts, timeout: 120000 }, () => {
  let carry = null, sim = null, steps = 0;
  for (let k = 0; k < W.stages.length; k++) {
    sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === W.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++, steps++) sim.step(1 / 60, bots.map((b) => b.input()));
    assert.equal(sim.state.phase, 'done', `${W.stages[k].id} not finished`);
    for (const p of sim.state.players) assert.equal(p.status, 'finished', `${W.stages[k].id}: a bot did not finish`);
    carry = sim.carry();
  }
  const race = Math.max(...sim.state.players.map((p) => p.finishTime)) + CLOUD_SECONDS * (W.stages.length - 1);
  assert.ok(race >= 130 && race <= 300, `race ${race.toFixed(0)} s`);
  test.diagnostic?.(`k2 race: ${race.toFixed(0)} s with the cloud, ${(steps / 60).toFixed(0)} s simulated`);
});

test('k2: the bake is deterministic and the committed world is up to date', { skip: demOpts.skip, timeout: 300000 }, () => {
  const outs = [0, 1].map(() => mkdtempSync(`${tmpdir()}/summit-descent-k2-`));
  try {
    for (const out of outs) {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', 'k2', '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const files = readdirSync(`${outs[0]}/k2`).sort();
    assert.deepEqual(files, readdirSync(`${outs[1]}/k2`).sort());
    assert.deepEqual(files, readdirSync(`${DIR}/k2`).sort());
    for (const f of files) {
      const a = readFileSync(`${outs[0]}/k2/${f}`);
      assert.ok(a.equals(readFileSync(`${outs[1]}/k2/${f}`)), `${f}: two bakes differ`);
      assert.ok(a.equals(readFileSync(`${DIR}/k2/${f}`)), `${f}: committed world is stale, rebake k2`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
