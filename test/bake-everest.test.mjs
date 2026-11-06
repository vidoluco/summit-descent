// Everest, Nepal side (docs/mountains/everest.md): the baked world against the published altitudes of
// the real line, stage order and continuity, steepness, two sim bots on every stage, and a
// deterministic rebake. test/bake-worlds.test.mjs keeps the contract checks common to every world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../tools/bake/config.mjs';
import { tileFile, localFrame } from '../tools/bake/dem.mjs';
import { loadWorld, toGlobal } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { CLOUD_SECONDS } from '../tools/bake/world-index.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const ID = 'everest';
const baked = existsSync(`${DIR}/${ID}/world.json`);
const skip = baked ? false : 'everest not baked';
const W = baked ? JSON.parse(readFileSync(`${DIR}/${ID}/world.json`, 'utf8')) : null;
const cfg = loadConfig(ID);
const place = (name) => W.places.find((p) => p.name === name);
const polyLen = (c) => c.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - c[i].x, q.z - c[i].z), 0);

// Published altitudes (sources in docs/mountains/everest.md)
const PUBLISHED = {
  summit: 8848.86, // China-Nepal survey 2020
  westernCwm: [6000, 6800],
  khumbuIcefall: 5486,
  thukla: 4620, // Thukla / Dughla
  pheriche: 4250, // HRA aid post (Wikipedia gives 4,371 m; the 30 m DEM reads the bed at about 4,250 m)
};

test('everest config: official summit, the descent through Thukla, the floor past the glacier', () => {
  assert.ok(Math.abs(cfg.summit.elevation - PUBLISHED.summit) < 1);
  assert.equal(cfg.descent.kind, 'dem');
  // the line leaves the glacier at its snout and runs down to Thukla, not over the lateral moraine
  assert.ok(cfg.descent.via.some(([lat, lon]) => Math.abs(lat - 27.9237) < 0.003 && Math.abs(lon - 86.8055) < 0.003), 'a via point at Thukla');
  // the debris-covered Khumbu Glacier is almost flat between Gorak Shep and Lobuche: the floor is
  // searched only below its snout
  assert.ok(cfg.short.floor.after >= 20000);
  assert.ok(cfg.short.stages.length >= 1000 && cfg.short.stages.length <= 2000);
});

test('everest: summit and finish altitudes match the published values', { skip }, () => {
  // the 30 m DEM shaves the summit pyramid by about 110 m
  assert.ok(W.source.summit.elevation > PUBLISHED.summit - 150 && W.source.summit.elevation < PUBLISHED.summit, `DEM summit ${W.source.summit.elevation}`);
  assert.ok(W.stages[0].origin.alt > 8700, 'the race starts on the summit pyramid');
  const finish = W.stages.at(-1).altitude[0];
  assert.ok(finish < PUBLISHED.thukla && finish > PUBLISHED.pheriche, `finish ${finish} m between Thukla and Pheriche`);
  assert.ok(Math.abs(W.floor.altitude - PUBLISHED.pheriche) < 100, `valley floor ${W.floor.altitude} m, Pheriche ${PUBLISHED.pheriche} m`);
  // the floor lies on the Pheriche flats: below Thukla, above Pheriche village
  assert.ok(W.floor.riverKm > place('Thukla').riverKm && W.floor.riverKm < place('Pheriche').riverKm);
  const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).worlds.find((w) => w.id === ID);
  assert.equal(index.summit.altitude, 8849);
  assert.equal(index.finish.altitude, finish);
  assert.deepEqual(index.finish.names, cfg.finish.names);
});

test('everest: the stages are the real stretches, at their published altitudes', { skip }, () => {
  assert.deepEqual(W.stages.map((s) => s.id), ['summit-pyramid', 'western-cwm', 'icefall', 'thukla']);
  const [top, cwm, icefall, thukla] = W.stages;
  assert.ok(top.altitude[1] > 8700);
  assert.ok(cwm.altitude[0] > PUBLISHED.westernCwm[0] && cwm.altitude[0] < PUBLISHED.westernCwm[1], `the second stage lands in the Western Cwm: ${cwm.altitude[0]} m`);
  assert.ok(icefall.altitude[0] < PUBLISHED.khumbuIcefall && icefall.altitude[1] > PUBLISHED.khumbuIcefall, `the Icefall stage spans ${PUBLISHED.khumbuIcefall} m`);
  assert.equal(place('Khumbu Icefall').stage, 2);
  assert.equal(place('Thukla').stage, 3);
  assert.ok(place('Thukla').distance < 300, 'the last stage passes Thukla');
  for (const n of ['Gorak Shep', 'Lobuche', 'Pheriche']) assert.ok(place(n).distance < 700, `${n} next to the line`);
  // ice on the glacier stages, named after the Khumbu Glacier; none below its snout
  for (const s of [top, cwm, icefall]) assert.ok(s.zones.some((z) => z.kind === 'ice' && z.from === 0 && z.to === s.finish), `${s.id} ice`);
  for (const s of [cwm, icefall]) assert.ok(s.zones.some((z) => z.glacier === 'Khumbu Glacier'), `${s.id} glacier name`);
  assert.ok(!thukla.zones.some((z) => z.kind === 'ice'));
});

// Ranges recorded in Sagarmatha NP itself (sources in docs/mountains/everest.md), not the species'
// whole Himalayan range. The course runs above 4,400 m, so the top of each band is what matters.
const LOCAL_FAUNA = {
  chough: [3500, 8200], // alpine chough, follows climbers to 8,200 m on Everest
  yak: [3000, 5400], // herded to Gorak Shep and Base Camp
  'snow-leopard': [3000, 5100], // Ale et al. 2007
  'himalayan-tahr': [3685, 4380], // Shrestha 2007
  danphe: [3250, 4021], // Paudel et al. 2023, pine forest only
  'red-panda': [3000, 3700], // lower forests
};

test('everest: only the species of the park, at the altitudes recorded there', { skip }, () => {
  assert.deepEqual(Object.keys(cfg.animals.kinds).sort(), Object.keys(LOCAL_FAUNA).sort());
  for (const [kind, [, hi]] of Object.entries(LOCAL_FAUNA)) {
    const top = cfg.animals.kinds[kind].alt[1];
    assert.ok(top <= hi + 100, `${kind}: band up to ${top} m, recorded up to ${hi} m`);
  }
  for (const s of W.stages) for (const a of s.spawns.animals) {
    const alt = s.offset.y + a.y, [lo, hi] = LOCAL_FAUNA[a.kind];
    assert.ok(alt >= lo - 100 && alt <= hi + 100, `${s.id}: ${a.kind} at ${alt.toFixed(0)} m, recorded ${lo}-${hi} m`);
  }
  // the whole course is above the treeline and above the tahr's recorded range
  const kinds = new Set(W.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)));
  for (const k of ['danphe', 'red-panda', 'himalayan-tahr']) assert.ok(!kinds.has(k), `${k} spawns above its range`);
});

test('everest: stages ordered down the mountain, each continuous, each steep', { skip }, () => {
  const f = localFrame(W.frame.lat, W.frame.lon);
  for (const [k, s] of W.stages.entries()) {
    const c = s.course, L = polyLen(c);
    assert.ok(Math.abs(L - cfg.short.stages.length) < 25, `${s.id}: ${L} m`);
    for (let i = 1; i < c.length; i++) {
      const d = Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
      assert.ok(d > 5 && d < 15, `${s.id}: gap of ${d.toFixed(1)} m at ${i}`);
      assert.ok(c[i].y < c[i - 1].y, `${s.id}: climbs at ${i}`);
    }
    const drop = s.altitude[1] - s.altitude[0], slope = drop / L;
    assert.ok(slope > 0.15, `${s.id}: mean slope ${(slope * 100).toFixed(1)} %`);
    assert.ok(slope > 3 * W.floor.slope, `${s.id} steeper than the valley floor`);
    // the stage origin is where the world frame says it is
    const [lon, lat] = f.toLonLat(s.offset.x, s.offset.z);
    assert.ok(Math.abs(lat - s.origin.lat) < 1e-5 && Math.abs(lon - s.origin.lon) < 1e-5);
    if (k) {
      const a = W.stages[k - 1], end = toGlobal(a, a.course.at(-1));
      assert.ok(s.realKm[0] > a.realKm[1], `${s.id} after ${a.id}`);
      assert.ok(s.origin.alt < end.y, `${s.id} starts below the end of ${a.id}`);
      // the cloud carries the drop down the real line: the next start is downstream, not beside it
      const gap = Math.hypot(s.offset.x - end.x, s.offset.z - end.z);
      assert.ok(gap > 200 && gap < 14000, `${a.id} -> ${s.id}: ${gap.toFixed(0)} m`);
    }
  }
  assert.ok(W.stages.at(-1).realKm[1] <= W.floor.riverKm);
});

test('everest: two sim bots finish every stage, the race lasts 3-5 minutes', { skip, timeout: 120000 }, async () => {
  const world = await loadWorld(ID, { dir: DIR });
  let carry = null, sim = null;
  for (let k = 0; k < world.stages.length; k++) {
    sim = createSim(world.stages[k], { players: 2, seed: 3, final: k === world.stages.length - 1, carry });
    const bots = [createBot(sim, 0), createBot(sim, 1, { preferShortcut: true })];
    for (let n = 0; n < 240 * 60 && sim.state.phase !== 'done'; n++) sim.step(1 / 60, bots.map((b) => b.input()));
    assert.equal(sim.state.phase, 'done', `${W.stages[k].id}: the bots did not finish`);
    assert.deepEqual(sim.state.players.map((p) => p.status), ['finished', 'finished'], W.stages[k].id);
    carry = sim.carry();
  }
  const t = sim.state.players.map((p) => p.finishTime);
  const total = t.reduce((a, b) => a + b, 0) / t.length + CLOUD_SECONDS * (world.stages.length - 1);
  assert.ok(total >= 180 && total <= 300, `race ${total.toFixed(0)} s`);
});

const haveTiles = cfg.dem.tiles.every((t) => existsSync(`${ROOT}data/raw/dem/${tileFile(t)}`));
test('everest: the bake is deterministic and data/worlds/everest is up to date', { skip: skip || (haveTiles ? false : 'DEM tiles missing'), timeout: 300000 }, () => {
  const outs = [mkdtempSync(`${tmpdir()}/summit-descent-everest-a-`), mkdtempSync(`${tmpdir()}/summit-descent-everest-b-`)];
  try {
    for (const out of outs) {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', ID, '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const files = readdirSync(`${outs[0]}/${ID}`).sort();
    assert.deepEqual(files, readdirSync(`${outs[1]}/${ID}`).sort());
    assert.deepEqual(files, readdirSync(`${DIR}/${ID}`).sort());
    for (const f of files) {
      assert.ok(readFileSync(`${outs[0]}/${ID}/${f}`).equals(readFileSync(`${outs[1]}/${ID}/${f}`)), `${f}: two bakes differ`);
      assert.ok(readFileSync(`${outs[0]}/${ID}/${f}`).equals(readFileSync(`${DIR}/${ID}/${f}`)), `${f} differs: rebake ${ID}`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
