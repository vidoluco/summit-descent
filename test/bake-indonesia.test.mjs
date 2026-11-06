// Indonesia, Mount Kerinci (docs/mountains/indonesia.md): the baked world against published values
// and the short-mode rules. The generic contract checks of every world are in test/bake-worlds.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/bake/config.mjs';
import { localFrame, geoDist, tileFile } from '../tools/bake/dem.mjs';
import { loadWorld, toGlobal } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { CLOUD_SECONDS } from '../tools/bake/world-index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const ID = 'indonesia';
const baked = existsSync(`${DIR}/${ID}/world.json`);
const skip = baked ? false : 'data/worlds/indonesia not baked';
const W = baked ? JSON.parse(readFileSync(`${DIR}/${ID}/world.json`, 'utf8')) : null;
const cfg = loadConfig(ID);

// Published values (sources in docs/mountains/indonesia.md)
const KERINCI = { elevation: 3805, lat: -1.6967, lon: 101.2656 }; // Wikipedia, 1°41'48"S 101°15'56"E
const KERSIK_TUO = 1519; // valley floor village at the foot of the trail (gunungbagging.com)
const SHELTER_3 = { alt: 3306, lat: -1.70575, lon: 101.26718 }; // published 3291-3350 m; OSM node
const PINTU_RIMBA = 1800; // forest gate of the trail, about 1800 m (1809 m in one trip report)
// Taman Nasional Kerinci Seblat (OSM relation 8465254) ends where its boundary crosses the line, at about
// 1804 m in the forest-edge stage; below it are the farms of Bengkolan Dua (Kecamatan Gunung Tujuh)
const PARK_EDGE = 1800;
const FOREST_ONLY = ['malayan-tapir', 'sumatran-striped-rabbit', 'salvadoris-pheasant'];

// course point k of stage s as [lon, lat] and real altitude
const real = (s, p) => {
  const g = toGlobal(s, p), f = localFrame(W.frame.lat, W.frame.lon);
  return { ll: f.toLonLat(g.x, g.z), alt: g.y };
};
const len = (c) => c.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - c[i].x, q.z - c[i].z), 0);

test('Kerinci config: the real summit, a real OSM stream, only Sumatran species', () => {
  assert.equal(cfg.summit.elevation, KERINCI.elevation);
  assert.equal(cfg.country, 'ID');
  assert.equal(cfg.descent.kind, 'osm-network');
  assert.deepEqual(cfg.descent.prefer, ['Sungai Kering']);
  const kinds = Object.keys(cfg.animals.kinds);
  assert.ok(kinds.includes('sumatran-tiger') && kinds.includes('malayan-tapir'), kinds.join());
  // spec: no orangutans outside Sumatra and Borneo, and none in the Kerinci area either (Tapanuli and
  // Sumatran orangutans live north of Lake Toba); no species of Java or Lombok
  for (const k of ['orangutan', 'macaque', 'lutung', 'javan-hawk-eagle', 'rinjani-scops-owl', 'komodo']) assert.ok(!kinds.includes(k), k);
  // no siamang: its ceiling (1829 m) is the park edge on this line, montane forest above, farms below
  assert.ok(!kinds.includes('siamang'));
  // forest species stay inside the national park
  for (const k of FOREST_ONLY) assert.ok(cfg.animals.kinds[k].alt[0] >= PARK_EDGE, k);
});

test('summit: the DEM top is Gunung Kerinci, within 40 m of the published 3805 m', { skip }, () => {
  const s = W.source.summit;
  assert.ok(geoDist(s.lon, s.lat, KERINCI.lon, KERINCI.lat) < 400, 'summit far from the published coordinates');
  assert.ok(Math.abs(s.elevation - KERINCI.elevation) < 40, `DEM summit ${s.elevation} m`);
  assert.ok(Math.abs(W.stages[0].altitude[1] - KERINCI.elevation) < 60, `race starts at ${W.stages[0].altitude[1]} m`);
});

test('finish: the plateau floor below Bengkolan Dua, near the published 1519 m of Kersik Tuo', { skip }, () => {
  const fin = W.stages.at(-1).altitude[0];
  assert.ok(Math.abs(fin - KERSIK_TUO) < 60, `finish ${fin} m`);
  assert.ok(Math.abs(W.floor.altitude - KERSIK_TUO) < 80, `floor ${W.floor.altitude} m`);
  assert.ok(fin >= W.floor.altitude, 'nothing below the floor is played');
  // past the floor the stream is flat: the next 3 km lose less than 2.5 %
  assert.equal(W.floor.slope, 0.025);
});

test('stage 0 passes Shelter 3; Pintu Rimba lies in the altitude band of the forest stage', { skip }, () => {
  const s0 = W.stages[0];
  assert.ok(s0.altitude[0] < SHELTER_3.alt && s0.altitude[1] > SHELTER_3.alt);
  const near = Math.min(...s0.course.map((p) => { const [lon, lat] = real(s0, p).ll; return geoDist(lon, lat, SHELTER_3.lon, SHELTER_3.lat); }));
  assert.ok(near < 300, `Shelter 3 is ${near.toFixed(0)} m from the course`);
  const forest = W.stages.find((s) => s.id === 'kerinci-seblat');
  assert.ok(forest && forest.altitude[0] < PINTU_RIMBA && forest.altitude[1] > PINTU_RIMBA);
  // the forest-edge stage is where the line leaves the national park; the last stage is all farmland
  assert.ok(forest.altitude[0] < PARK_EDGE && forest.altitude[1] > PARK_EDGE);
  assert.ok(W.stages.at(-1).altitude[1] < PARK_EDGE);
});

test('stages are in river order, continuous, and each one is steep', { skip }, () => {
  assert.equal(W.stages.length, 4);
  assert.deepEqual(W.stages.map((s) => s.id), ['summit', 'upper-kering', 'kerinci-seblat', 'bengkolan-dua']);
  for (const [k, s] of W.stages.entries()) {
    const L = len(s.course), drop = s.altitude[1] - s.altitude[0];
    assert.ok(Math.abs(L - 1900) < 5, `${s.id}: ${L} m`);
    assert.ok(drop / L >= 0.05, `${s.id}: mean slope ${(drop / L * 100).toFixed(1)} %`);
    if (!k) { assert.ok(drop / L > 0.35, 'the summit stage is the steepest'); continue; }
    const a = W.stages[k - 1];
    const gap = s.realKm[0] - a.realKm[1];
    assert.ok(gap > 0 && gap < 0.3, `${a.id} -> ${s.id}: ${gap} km of cloud`);
    const step = a.altitude[0] - s.altitude[1];
    assert.ok(step > 0 && step < 150, `${a.id} -> ${s.id}: ${step} m lower`);
    assert.ok(drop / L < (a.altitude[1] - a.altitude[0]) / len(a.course) + 1e-9, 'the slope eases down the mountain');
  }
  assert.equal(W.length, 7600);
  assert.ok(W.stages.at(-1).realKm[1] <= W.floor.riverKm);
});

test('animals: only the configured species, each inside its real altitude band', { skip }, () => {
  const seen = new Set();
  for (const s of W.stages) for (const a of s.spawns.animals) {
    const band = cfg.animals.kinds[a.kind]?.alt;
    assert.ok(band, a.kind);
    const alt = a.y + s.offset.y;
    assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${a.kind} at ${alt} m`);
    seen.add(a.kind);
  }
  // every configured species shows up somewhere on the descent
  assert.deepEqual([...seen].sort(), Object.keys(cfg.animals.kinds).sort());
  // forest animals stay inside the national park; the fields get only the tiger and the flying hornbill
  for (const s of W.stages) for (const a of s.spawns.animals) {
    if (FOREST_ONLY.includes(a.kind)) assert.ok(a.y + s.offset.y >= PARK_EDGE, `${a.kind} at ${(a.y + s.offset.y).toFixed(0)} m, outside the park`);
  }
  const fields = W.stages.find((s) => s.id === 'bengkolan-dua');
  for (const a of fields.spawns.animals) assert.ok(['sumatran-tiger', 'wreathed-hornbill'].includes(a.kind), `${a.kind} in the fields`);
  // the spec names the tiger and the tapir for Kerinci: both must be on the course
  assert.ok(seen.has('sumatran-tiger') && seen.has('malayan-tapir'));
});

test('two sim bots finish every stage; the race lasts 3 to 5 minutes', { skip, timeout: 120000 }, async () => {
  const world = await loadWorld(ID, { dir: DIR });
  let carry = null, sim = null;
  for (let k = 0; k < world.stages.length; k++) {
    sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === world.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++) sim.step(1 / 60, bots.map((b) => b.input()));
    assert.equal(sim.state.phase, 'done', `stage ${k} not finished`);
    for (const p of sim.state.players) assert.equal(p.status, 'finished', `stage ${k}`);
    carry = sim.carry();
  }
  const t = sim.state.players.map((p) => p.finishTime);
  const total = t.reduce((a, b) => a + b, 0) / t.length + CLOUD_SECONDS * (world.stages.length - 1);
  assert.ok(total >= 180 && total <= 300, `${total.toFixed(0)} s`);
});

const haveTile = cfg.dem.tiles.every((t) => existsSync(`${ROOT}data/raw/dem/${tileFile(t)}`));
const haveOsm = existsSync(`${ROOT}data/raw/osm/${ID}/river.json`);
test('the bake is deterministic and the committed world is up to date', { skip: baked && haveTile && haveOsm ? false : 'DEM tile or OSM cache missing', timeout: 300000 }, () => {
  const outs = [mkdtempSync(`${tmpdir()}/summit-descent-kerinci-a-`), mkdtempSync(`${tmpdir()}/summit-descent-kerinci-b-`)];
  try {
    for (const out of outs) {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', ID, '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const files = readdirSync(`${outs[0]}/${ID}`).sort();
    assert.deepEqual(files, readdirSync(`${outs[1]}/${ID}`).sort());
    assert.deepEqual(files, readdirSync(`${DIR}/${ID}`).sort());
    for (const f of files) {
      const a = readFileSync(`${outs[0]}/${ID}/${f}`);
      assert.ok(a.equals(readFileSync(`${outs[1]}/${ID}/${f}`)), `${f}: two bakes differ`);
      assert.ok(a.equals(readFileSync(`${DIR}/${ID}/${f}`)), `${f}: rebake ${ID}`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
