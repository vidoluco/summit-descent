// Antelao world (tools/bake/worlds/antelao.json, docs/mountains/antelao.md): the Antelao in Cadore, its north
// face onto the Ghiacciaio Inferiore, the meltwater under Rifugio Galassi into the Val d'Oten, over the Cascata
// delle Pile, past the Capanna degli Alpini and Praciadelan, then the Torrente Molinà down to Calalzo di Cadore
// and the Piave valley floor. Checks the baked world against published altitudes and places, the stage chain,
// the drainage, the animals, the sim and the bake itself; plus the two bake options it brought (stages.end
// "floor", weather). test/bake-worlds.test.mjs runs the generic contract checks on this world too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig } from '../tools/bake/config.mjs';
import { chooseStages } from '../tools/bake/course.mjs';
import { localFrame, geoDist, tileFile } from '../tools/bake/dem.mjs';
import { loadGlaciers, glacierAt } from '../tools/bake/glaciers.mjs';
import { loadWorld, toGlobal } from '../src/world/load.js';
import { createSim } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { en } from '../src/i18n/en.js';
import { it as itDict } from '../src/i18n/it.js';
import { themeFor } from '../src/render/themes/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = `${ROOT}data/worlds`;
const ID = 'antelao';
const baked = existsSync(`${DIR}/${ID}/world.json`);
const skip = baked ? false : 'antelao not baked';

// Published values (docs/mountains/antelao.md, "Sources"); positions from OpenStreetMap
const PUB = {
  summit: { alt: 3264, lat: 46.4519, lon: 12.2618 }, // Antelao, OSM node 2641912271
  galassi: { alt: 2018, lat: 46.4707, lon: 12.2619 }, // Rifugio Pietro Galassi, OSM relation 19526395
  pile: { lat: 46.4799, lon: 12.2859 }, // Cascata delle Pile, OSM node 1383481858
  alpini: { alt: 1395, lat: 46.4806, lon: 12.2899 }, // Rifugio Capanna degli Alpini, OSM way 383877715
  praciadelan: { alt: 1044, lat: 46.4722, lon: 12.3383 }, // OSM node 1383482726
  rizzios: { lat: 46.4556, lon: 12.3768 }, // hamlet of Calalzo, OSM node 1427176367
  calalzo: { lat: 46.4467, lon: 12.3804 }, // Calalzo di Cadore, OSM node 64778113
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

test('antelao: stages.end "floor" puts the last window on the valley floor, the others greedy above it', () => {
  // steep at the top, gentle at the bottom: the greedy pick alone stays high up
  const prof = Array.from({ length: 1301 }, (_, i) => 3000 - (i < 500 ? 3 * i : 1500 + 0.5 * (i - 500)));
  const greedy = chooseStages(prof, 10, 12000, { count: 3, length: 1700, gap: 300, perGroup: Infinity });
  assert.ok(greedy.at(-1).u1 < 8000, 'without the option the last stage ends high up');
  const p = chooseStages(prof, 10, 12000, { count: 3, length: 1700, gap: 300, end: 'floor' });
  assert.deepEqual(p.map((s) => [s.u0, s.u1]), [[0, 1700], [2000, 3700], [10300, 12000]]);
  assert.equal(p.at(-1).drop, 85);
  // a floor too close to the summit for two windows: only the summit window
  assert.deepEqual(chooseStages(prof, 10, 1800, { count: 3, length: 1700, gap: 300, end: 'floor' }).map((s) => s.u0), [0]);
  const cfg = loadConfig(ID);
  assert.equal(cfg.short.stages.end, 'floor');
  assert.throws(() => validateConfig({ ...cfg, short: { ...cfg.short, stages: { ...cfg.short.stages, end: 'lake' } } }, ID), /short.stages.end/);
  assert.throws(() => validateConfig({ ...cfg, weather: { sun: 'nowhere' } }, ID), /weather.sun/);
});

test('antelao: summit and finish match the published altitudes and places', { skip }, () => {
  const cfg = loadConfig(ID);
  assert.equal(cfg.summit.elevation, PUB.summit.alt);
  assert.equal(cfg.descent.kind, 'osm-network');
  assert.ok(geoDist(W.frame.lon, W.frame.lat, PUB.summit.lon, PUB.summit.lat) < 120, 'the start is on the Antelao summit');
  // GLO-30 is a 30 m surface model: it shaves the sharp summit pyramid by about 130 m (docs, "The DEM")
  assert.ok(PUB.summit.alt - W.source.summit.elevation > 0 && PUB.summit.alt - W.source.summit.elevation < 150, `DEM summit ${W.source.summit.elevation} m`);
  const last = W.stages.at(-1), fin = last.altitude[0];
  // the carved bed may sit a metre under the floor profile (the generic check allows 5 m)
  assert.ok(Math.abs(fin - W.floor.altitude) < 5, `the race ends on the valley floor: ${fin} m vs ${W.floor.altitude} m`);
  assert.ok(W.floor.altitude > 700 && W.floor.altitude < 760, `valley floor ${W.floor.altitude} m (Calalzo, above Lago di Centro Cadore)`);
  const [lon, lat] = lonLatOf(last, last.course.at(-1));
  assert.ok(geoDist(lon, lat, PUB.calalzo.lon, PUB.calalzo.lat) < 800, 'the finish is at Calalzo di Cadore');
  const idx = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')).worlds.find((w) => w.id === ID);
  assert.equal(idx.summit.altitude, PUB.summit.alt);
  assert.equal(idx.summit.name, 'Antelao');
  assert.equal(idx.country, 'IT');
  assert.deepEqual(idx.finish.names, { it: 'Torrente Molinà a Calalzo', en: 'Molinà torrent at Calalzo' });
  assert.equal(idx.finish.altitude, fin);
  assert.ok(idx.estimatedSeconds >= 180 && idx.estimatedSeconds <= 300, `${idx.estimatedSeconds} s`);
  for (const name of ['Rizzios', 'Calalzo di Cadore']) assert.ok(W.places.some((p) => p.name === name), `${name} in the places`);
  // the lobby and results screens name the world in both languages
  assert.ok(en['world.antelao'] && itDict['world.antelao'] && en['world.antelao.sub'] && itDict['world.antelao.sub']);
});

test('antelao: the line is the north face, Val d\'Oten, Cascata delle Pile, Praciadelan, the Molinà to Calalzo', { skip }, () => {
  const [s0, s1, s2, s3, s4] = W.stages;
  assert.deepEqual(W.stages.map((s) => s.id), ['antelao', 'pile', 'oten', 'molina', 'calalzo']);
  for (const s of W.stages) assert.ok(s.labels.it && s.labels.en && s.name === s.labels.it);
  assert.match(W.source.river, /Torrente Oten/);
  assert.match(W.source.river, /Torrente Molinà/);
  // stage 1: from the summit down the north face onto the Ghiacciaio Inferiore, an ice zone named after it
  assert.ok(s0.altitude[1] > 3100, `stage 1 starts at ${s0.altitude[1]} m`);
  const ice = s0.zones.find((z) => z.kind === 'ice');
  assert.equal(ice?.glacier, "Ghiacciaio Inferiore dell'Antelao");
  const [, lat0] = lonLatOf(s0, s0.course.at(-1));
  assert.ok(lat0 > PUB.summit.lat + 0.008, 'stage 1 goes north, towards the Val d\'Oten');
  // stage 2: below Rifugio Galassi, over the Cascata delle Pile, to above the Capanna degli Alpini
  const [, lat1] = lonLatOf(s1, s1.course[0]);
  assert.ok(lat1 > PUB.galassi.lat && s1.origin.alt < PUB.galassi.alt, 'stage 2 starts below Rifugio Galassi');
  const [dp] = nearest(s1, PUB.pile);
  assert.ok(dp < 60, `stage 2 passes ${dp.toFixed(0)} m from the Cascata delle Pile`);
  const [da, ia] = nearest(s1, PUB.alpini);
  assert.ok(da < 200 && ia === s1.course.length - 1, `stage 2 ends ${da.toFixed(0)} m above the Capanna degli Alpini`);
  assert.ok(Math.abs(s1.altitude[0] - PUB.alpini.alt) < 20, `stage 2 ends at ${s1.altitude[0]} m`);
  // stage 3: the gravel bed of the Val d'Oten, running east, ending near Praciadelan
  const [lonA] = lonLatOf(s2, s2.course[0]), [lonB] = lonLatOf(s2, s2.course.at(-1));
  assert.ok(lonB - lonA > 0.015, 'stage 3 runs east down the Val d\'Oten');
  const [dpr] = nearest(s2, PUB.praciadelan);
  assert.ok(dpr < 600, `stage 3 ends ${dpr.toFixed(0)} m from Praciadelan`);
  assert.ok(s2.branches.some((b) => b.kind === 'safe'), 'a second gravel channel: the braided bed of the photos');
  // stage 4 and 5: the Torrente Molinà below Praciadelan, then past Rizzios to Calalzo
  assert.ok(s3.origin.alt < PUB.praciadelan.alt, 'stage 4 starts below Praciadelan');
  const [dr] = nearest(s4, PUB.rizzios);
  assert.ok(dr < 350, `stage 5 passes ${dr.toFixed(0)} m from Rizzios`);
  assert.deepEqual(W.stages.map((s) => s.biome), ['alpine', 'gorge', 'montane', 'forest', 'valley']);
  // the sun shines on the open valley at Calalzo, not in the Pile gorge (config "weather")
  assert.ok(s4.zones.some((z) => z.kind === 'sun') && !s1.zones.some((z) => z.kind === 'sun'));
  assert.ok(s2.zones.some((z) => z.kind === 'rain'));
});

test('antelao: the water of the north face drains to the Val d\'Oten, the course stays out of the Boite basin', { skip }, () => {
  // every played point is east of the Antelao's west ridge line (the Boite, San Vito side, is west of
  // 12.255 at the latitudes of the face) and the whole course stays north or east of the summit
  for (const s of W.stages) for (const p of s.course) {
    const [lon, lat] = lonLatOf(s, p);
    assert.ok(lon > 12.255 && lat > 46.445, `${s.id}: ${lat.toFixed(4)} ${lon.toFixed(4)} off the Oten-Molinà basin`);
  }
  // the summit stage crosses the Ghiacciaio Inferiore, not the Superiore (which drains to Val Antelao)
  const g = loadGlaciers(`${ROOT}data/raw/osm/${ID}/glaciers.json`);
  if (!g) return;
  const on = new Set(W.stages[0].course.map((p) => glacierAt(g, ...lonLatOf(W.stages[0], p))?.name).filter(Boolean));
  assert.deepEqual([...on], ["Ghiacciaio Inferiore dell'Antelao"]);
});

test('antelao: the painted glacier and the sim ice zone both end at the toe of the Ghiacciaio Inferiore', { skip }, () => {
  // the DEM inside the OSM outline goes down to about 2410 m (docs/mountains/antelao.md, "Glaciers"): the render
  // theme paints ice above its iceAbove, the sim's ice zone ends where the course leaves the outline
  const s0 = W.stages[0], ice = s0.zones.find((z) => z.kind === 'ice'), theme = themeFor(ID);
  const toe = toGlobal(s0, s0.course[ice.to]).y;
  assert.ok(toe > 2350 && toe < 2480, `the ice zone ends at ${toe.toFixed(0)} m`);
  assert.ok(Math.abs(theme.terrain.iceAbove - toe) < 60, `theme ice above ${theme.terrain.iceAbove} m, sim ice to ${toe.toFixed(0)} m`);
  assert.ok(theme.terrain.iceAbove < theme.terrain.snowAbove);
  // the research doc the theme, the config and this test cite
  assert.ok(existsSync(`${ROOT}docs/mountains/${ID}.md`), 'docs/mountains/antelao.md');
});

test('antelao: the animals are the Cadore species, inside their altitude bands', { skip }, () => {
  const kinds = loadConfig(ID).animals.kinds, seen = new Set();
  for (const s of W.stages) {
    for (const a of s.spawns.animals) {
      seen.add(a.kind);
      const g = toGlobal(s, a), band = kinds[a.kind].alt;
      assert.ok(g.y > band[0] - 120 && g.y < band[1] + 120, `${a.kind} at ${g.y.toFixed(0)} m, band ${band}`);
      if (a.kind === 'eagle') assert.equal(a.flying, true);
    }
  }
  // Natura 2000 IT3230081 and the CAI sheet of the group (docs, "Fauna"): no cows (no pasture on the course)
  assert.deepEqual([...seen].sort(), ['chamois', 'chough', 'eagle', 'hare', 'ibex', 'marmot', 'red-deer']);
  assert.ok(W.stages[0].spawns.animals.some((a) => a.kind === 'ibex'), 'the Cadore ibex colony on the summit stage');
  for (const s of W.stages.slice(2)) assert.ok(!s.spawns.animals.some((a) => ['ibex', 'marmot', 'chough'].includes(a.kind)), `${s.id}: no high-mountain species in the valley woods`);
});

test('antelao: stages are in order down the mountain and continuous inside', { skip }, () => {
  for (const [k, s] of W.stages.entries()) {
    const c = s.course;
    for (let i = 1; i < c.length; i++) {
      assert.ok(c[i].y < c[i - 1].y, `${s.id} ${i} climbs`);
      const d = dist(c[i], c[i - 1]);
      assert.ok(d > 8 && d < 12, `${s.id} ${i}: ${d} m between points`);
    }
    assert.ok(Math.abs(polyLen(c) - s.length) / s.length < 0.01);
    assert.ok(s.altitude[0] >= W.floor.altitude - 5, `${s.id} below the valley floor`);
    if (!k) continue;
    const a = W.stages[k - 1];
    assert.ok(s.realKm[0] - a.realKm[1] >= 0.3 - 0.02, `${s.id}: gap ${s.realKm[0] - a.realKm[1]} km`);
    assert.ok(s.origin.alt < a.altitude[0], `${s.id} starts below where ${a.id} ends`);
  }
  const drop = W.stages[0].altitude[1] - W.stages.at(-1).altitude[0];
  assert.ok(drop > 2300, `drop ${drop} m`);
});

test('antelao: two sim bots finish every stage, chained, in 3-5 minutes', { skip, timeout: 120000 }, async (t) => {
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
  assert.ok(race >= 180 && race <= 300, `race ${race.toFixed(0)} s (spec: 3-5 min)`);
  for (const s of per) assert.ok(s > 20 && s < 90, `stage time ${s} s`);
});

const haveTiles = () => loadConfig(ID).dem.tiles.every((t) => existsSync(`${ROOT}data/raw/dem/${tileFile(t)}`));
test('antelao: the bake is deterministic and matches data/worlds', { skip: !baked ? skip : haveTiles() ? false : 'DEM tiles missing', timeout: 300000 }, () => {
  const outs = [0, 1].map(() => mkdtempSync(`${tmpdir()}/summit-descent-antelao-`));
  try {
    for (const out of outs) {
      const r = spawnSync(process.execPath, ['tools/bake/index.mjs', ID, '--out', out, '--offline', '--no-index'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr || r.stdout);
    }
    const files = readdirSync(`${outs[0]}/${ID}`).sort();
    assert.deepEqual(files, ['backdrop.bin', 'stage-0.bin', 'stage-1.bin', 'stage-2.bin', 'stage-3.bin', 'stage-4.bin', 'world.json']);
    assert.deepEqual(readdirSync(`${outs[1]}/${ID}`).sort(), files);
    for (const f of files) {
      const a = readFileSync(`${outs[0]}/${ID}/${f}`);
      assert.ok(a.equals(readFileSync(`${outs[1]}/${ID}/${f}`)), `${f}: two bakes differ`);
      assert.ok(a.equals(readFileSync(`${DIR}/${ID}/${f}`)), `${f} differs from data/worlds: rebake antelao`);
    }
  } finally {
    for (const out of outs) rmSync(out, { recursive: true, force: true });
  }
});
