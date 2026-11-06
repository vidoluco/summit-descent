// The game flow without a browser: URL params, the fixed-step clock and the interpolation, what the phones get,
// the cloud's flight path, and whole races on the real Dolomiti world (bots to the valley floor, the cloud
// between stages keeping the order and the gap, a missing pad waited for, drinks counted per slot); when BOOST
// starts a race or leaves the results; a stage that fails to load; the gap shown while one drop has nothing to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadWorld, makeSampler } from '../src/world/load.js';
import { parseParams, botSlots } from '../src/game/params.js';
import { createClock, createInterp } from '../src/game/clock.js';
import { padFx, createHudFeed, FX_RULES } from '../src/game/fx.js';
import { flightPath, flightU, flightCamera, FLIGHT } from '../src/game/flight.js';
import { createRace, altitudeOf, CLOUD, FINALE } from '../src/game/race.js';
import { createLobbyGate, createResultsGate, GATE } from '../src/game/gate.js';
import { isSoftwareRenderer } from '../src/game/gpu.js';
import { createBot } from '../src/sim/bot.js';

const DT = 1 / 60;
const world = await loadWorld('dolomiti', { dir: 'data/worlds' });

test('URL params: defaults, debug hooks, clamping', () => {
  assert.deepEqual(parseParams(''), { bots: null, autostart: false, stage: 0, seed: 1, speed: 1, lang: null, world: 'dolomiti', pixelRatio: null, intro: true });
  assert.equal(parseParams('?intro=0').intro, false, 'no start shot');
  assert.equal(parseParams('?intro').intro, true);
  const p = parseParams('?bots=2&autostart&stage=3&seed=42&speed=8&lang=it');
  assert.equal(p.bots, 2); assert.equal(p.autostart, true); assert.equal(p.stage, 3); assert.equal(p.seed, 42); assert.equal(p.speed, 8); assert.equal(p.lang, 'it');
  assert.equal(parseParams('?bots').bots, 2, 'bare ?bots means two bots');
  assert.equal(parseParams('?bots=9').bots, 2);
  assert.equal(parseParams('?autostart=0').autostart, false);
  assert.equal(parseParams('?speed=1000').speed, 16);
  assert.equal(parseParams('?lang=fr').lang, null);
  assert.equal(parseParams('?world=../etc').world, 'dolomiti');
});

test('bots fill the slots no human drives', () => {
  assert.deepEqual(botSlots(2, [true, true]), [true, true]);
  assert.deepEqual(botSlots(1, [true, true]), [false, true]);
  assert.deepEqual(botSlots(null, [true, false]), [false, true], 'one phone: a bot rival');
  assert.deepEqual(botSlots(null, [false, true]), [true, false]);
  assert.deepEqual(botSlots(null, [true, true]), [false, false]);
  assert.deepEqual(botSlots(null, [false, false]), [true, true]);
});

test('fixed-step clock: steps and alpha follow real time, speed scales, a stall drops time', () => {
  const c = createClock({ dt: DT });
  let steps = 0;
  for (let i = 0; i < 60; i++) steps += c.advance(1 / 60);
  assert.equal(steps, 60);
  assert.ok(c.alpha >= 0 && c.alpha < 1);
  assert.equal(c.advance(DT * 0.5), 0);
  assert.ok(Math.abs(c.alpha - 0.5) < 1e-6);
  c.reset(); c.speed = 4;
  assert.equal(c.advance(1 / 60), 4);
  c.reset(); c.speed = 1;
  assert.equal(c.advance(5), 8, 'a long stall runs at most maxSteps');
  assert.equal(c.alpha, 0);
  // a 144 Hz display: 60 steps per second all the same
  c.reset(); steps = 0;
  for (let i = 0; i < 144; i++) steps += c.advance(1 / 144);
  assert.ok(Math.abs(steps - 60) <= 1, `${steps}`);
});

test('interpolation blends between the last two steps and never writes into the sim', () => {
  const ip = createInterp();
  const st = { players: [{ slot: 0, pos: { x: 0, y: 0, z: 0 }, status: 'rolling' }, { slot: 1, pos: { x: 5, y: 1, z: 5 }, status: 'rolling' }], pickups: [], animals: [], events: [] };
  ip.capture(st);
  st.players[0].pos = { x: 1, y: 0, z: 2 };
  st.players[1].pos = { x: 100, y: 1, z: 5 }; // a respawn: no blending
  const v = ip.view(st, 0.25);
  assert.deepEqual(v.players[0].pos, { x: 0.25, y: 0, z: 0.5 });
  assert.deepEqual(v.players[1].pos, { x: 100, y: 1, z: 5 });
  assert.notEqual(v.players[0].pos, st.players[0].pos);
  assert.deepEqual(st.players[0].pos, { x: 1, y: 0, z: 2 }, 'sim untouched');
  assert.equal(v.players[0].status, 'rolling');
  assert.equal(ip.view(st, 1).players[0].pos.x, 1);
});

test('phone fx: the events that buzz, finish with the place, drinks throttled', () => {
  const lastDrink = [-Infinity, -Infinity];
  const ev = [
    { kind: 'freeze', slot: 0 }, { kind: 'thaw', slot: 0 },
    { kind: 'drink', slot: 1 }, { kind: 'drink', slot: 1 },
    { kind: 'finish', slot: 0, final: false, place: 1 }, { kind: 'finish', slot: 1, final: true, place: 2 },
    { kind: 'bump', slot: 0, intensity: FX_RULES.bump - 1 }, { kind: 'bump', slot: 1, intensity: FX_RULES.bump + 1 },
    { kind: 'splash', slot: 0, intensity: 20 }, { kind: 'steal', slot: 0, from: 1 },
    { kind: 'respawn', slot: 1, reason: 'rain' }, { kind: 'respawn', slot: 1, reason: 'offcourse' },
    { kind: 'boost', slot: 0 }, { kind: 'pickup', slot: 0 },
  ];
  assert.deepEqual(padFx(ev, { t: 10, lastDrink }), [
    { slot: 0, kind: 'freeze' }, { slot: 0, kind: 'thaw' }, { slot: 1, kind: 'drink' },
    { slot: 0, kind: 'buzz' }, { slot: 1, kind: 'finish', place: 2 },
    { slot: 1, kind: 'buzz' }, { slot: 0, kind: 'buzz' }, { slot: 0, kind: 'buzz' }, { slot: 1, kind: 'buzz' }, { slot: 1, kind: 'buzz' },
  ]);
  assert.deepEqual(padFx([{ kind: 'drink', slot: 1 }], { t: 10.3, lastDrink }), [], 'too soon');
  assert.deepEqual(padFx([{ kind: 'drink', slot: 1 }], { t: 10.8, lastDrink }), [{ slot: 1, kind: 'drink' }]);
});

test('phone hud: sent on change and as a heartbeat', () => {
  const h = createHudFeed({ every: 1 });
  assert.deepEqual(h.next(0, { mass: 1.04, place: 2 }, 0), { t: 'hud', mass: 1, place: 2 });
  assert.equal(h.next(0, { mass: 1.02, place: 2 }, 0.1), null);
  assert.deepEqual(h.next(0, { mass: 1.02, place: 1 }, 0.2), { t: 'hud', mass: 1, place: 1 });
  assert.deepEqual(h.next(0, { mass: 1.3, place: 1 }, 0.3), { t: 'hud', mass: 1.3, place: 1 });
  assert.deepEqual(h.next(0, { mass: 1.3, place: 1 }, 1.4), { t: 'hud', mass: 1.3, place: 1 });
});

test('cloud flight: from the stage end to the next start, always above the real terrain', () => {
  const bd = makeSampler(world.json.backdrop, world.backdrop);
  const ground = (x, z) => bd.heightAt(x, z);
  const st = world.json.stages;
  for (let k = 0; k + 1 < st.length; k++) {
    const a = st[k], b = st[k + 1];
    const end = a.course[a.finish], sp = b.spawns.start[0];
    const from = { x: end.x + a.offset.x, y: end.y + a.offset.y, z: end.z + a.offset.z };
    const to = { x: sp.x + b.offset.x, y: sp.y + b.offset.y, z: sp.z + b.offset.z };
    const path = flightPath(from, to, ground);
    const p0 = path.at(0), p1 = path.at(1);
    assert.ok(Math.hypot(p0.x - from.x, p0.z - from.z) < 1e-6 && Math.abs(p0.y - (from.y + FLIGHT.rise)) < 1e-6, `stage ${k}: starts over the finish`);
    assert.ok(Math.hypot(p1.x - to.x, p1.z - to.z) < 1e-6 && Math.abs(p1.y - (to.y + FLIGHT.hover)) < 1e-6, `stage ${k}: hovers over the next start`);
    let lowest = Infinity;
    for (let i = 40; i <= 160; i++) { // the middle of the flight; near its ends the cloud is down by its stage
      const p = path.at(i / 200);
      lowest = Math.min(lowest, p.y - ground(p.x, p.z));
      const cam = flightCamera(p, path.dir);
      assert.ok(cam.y > p.y, 'camera above its cloud');
    }
    assert.ok(lowest > 30, `stage ${k}->${k + 1}: lowest clearance ${lowest.toFixed(0)} m over ${path.length.toFixed(0)} m`);
    assert.ok(path.top > Math.max(from.y, to.y), 'it climbs');
  }
  // the trailing cloud lags in the middle and arrives with the others
  assert.equal(flightU(0, 3.6, 10), 0);
  assert.ok(flightU(1.8, 3.6, 10) < flightU(1.8, 3.6, 0));
  assert.equal(flightU(3.6, 3.6, 10), 1);
});

// Runs a race to its end: bots, or human inputs from inputs(race, t).
function run(race, { inputs = () => [], max = 900, onStep } = {}) {
  const seen = { phases: [], events: {}, stages: [] };
  let t = 0;
  while (race.phase !== 'done' && t < max) {
    race.step(DT, inputs(race, t));
    t += DT;
    if (seen.phases.at(-1) !== race.phase) seen.phases.push(race.phase);
    if (seen.stages.at(-1) !== race.stage) seen.stages.push(race.stage);
    for (const e of race.events) seen.events[e.kind] = (seen.events[e.kind] || 0) + 1;
    onStep?.(race, t);
  }
  return { ...seen, t };
}

test('a bot race plays every stage to the valley floor, with the cloud in between', () => {
  const race = createRace(world, { bots: [true, true], seed: 1 });
  assert.equal(race.phase, 'countdown');
  const swaps = [];
  const r = run(race, {
    onStep(rc) {
      for (const e of rc.events) if (e.kind === 'stage') swaps.push({ stage: e.stage, players: rc.state.players.map((p) => p.status), t: rc.cloud.t });
    },
  });
  assert.equal(race.phase, 'done');
  assert.deepEqual(r.stages, [0, 1, 2, 3]);
  assert.deepEqual(r.phases.slice(0, 4), ['countdown', 'race', 'cloud', 'race']);
  assert.equal(r.events.cloud, 3);
  assert.equal(r.events.stage, 3);
  assert.equal(r.events.go, 1, 'one start signal: the later stages rain in from the cloud');
  assert.equal(r.events.over, 1);
  // the next stage comes in at the top of the flight, both drops still in the cloud
  for (const s of swaps) {
    assert.deepEqual(s.players, ['evaporated', 'evaporated']);
    assert.ok(Math.abs(s.t - CLOUD.duration * CLOUD.swapAt) < 2 * DT);
  }
  const res = race.results();
  assert.deepEqual(res.map((p) => p.place).sort(), [1, 2]);
  assert.ok(res.every((p) => p.finished && p.bot && Number.isFinite(p.time)));
  const total = Math.max(...res.map((p) => p.time));
  assert.ok(total > 150 && total < 330, `short mode lasts 3 to 5 minutes, got ${total.toFixed(0)} s`);
  // at the valley floor
  const last = race.stageJson();
  for (const p of race.state.players) assert.ok(altitudeOf(last, p) < last.altitude[0] + 5);
});

test('the cloud keeps the order and the gap of the stage end, up to CLOUD.gapMax s', () => {
  const race = createRace(world, { bots: [true, true], seed: 3 });
  let gap = null, rain = {};
  run(race, {
    max: 400,
    onStep(rc) {
      for (const e of rc.events) {
        if (e.kind === 'finish' && rc.stage === 0) gap = gap === null ? { first: e.slot, t: e.time } : { ...gap, dt: e.time - gap.t };
        if (e.kind === 'respawn' && e.reason === 'rain' && rc.stage === 1) rain[e.slot] = rc.state.t;
      }
      if (rc.stage === 1 && Object.keys(rain).length === 2) rc.state.phase = 'done'; // enough
    },
  });
  assert.ok(gap && gap.dt > 0, 'both finished stage 1');
  const first = gap.first, second = 1 - first;
  assert.ok(rain[first] < rain[second], 'the leader rains in first');
  const kept = Math.min(gap.dt, CLOUD.gapMax);
  assert.ok(Math.abs(rain[second] - rain[first] - kept) < 0.1, `gap ${gap.dt.toFixed(2)} s, rained ${(rain[second] - rain[first]).toFixed(2)} s apart`);
});

test('a missing pad is waited for, a present but slow drop gets CLOUD.wait seconds', () => {
  // slot 1 is a human whose pad dropped: the stage does not end without it
  const away = createRace(world, { bots: [true, false], seed: 2 });
  run(away, { inputs: () => [null, { x: 0, y: 0, boost: false, connected: false }], max: 160 });
  assert.equal(away.stage, 0);
  assert.equal(away.phase, 'race');
  assert.equal(away.state.players[0].status, 'finished');
  assert.notEqual(away.state.players[1].status, 'finished');
  // slot 1 is there but brakes all the time: after CLOUD.wait s the cloud takes it on
  const slow = createRace(world, { bots: [true, false], seed: 2 });
  let finishedAt = null, cloudAt = null;
  run(slow, {
    inputs: () => [null, { x: 0, y: -1, boost: false, connected: true }],
    max: 260,
    onStep(rc, t) {
      if (finishedAt === null && rc.state.players[0].status === 'finished') finishedAt = t;
      if (cloudAt === null && rc.phase === 'cloud') cloudAt = t;
      if (rc.stage === 1) rc.state.phase = 'done';
    },
  });
  assert.ok(cloudAt !== null, 'the stage ended');
  assert.ok(Math.abs(cloudAt - finishedAt - CLOUD.wait) < 0.1, `${(cloudAt - finishedAt).toFixed(1)} s`);
});

test('drinks are counted per slot and species for the results', () => {
  // slot 1 is put next to an animal and stays still: it comes to drink
  for (const kind of ['marmot', 'chough']) {
    const race = createRace(world, { bots: [true, false], seed: 1 });
    let placed = false;
    run(race, {
      max: 20,
      inputs: () => [null, { x: 0, y: -1, boost: false, connected: true }],
      onStep(rc) {
        if (placed || rc.state.phase !== 'race') return;
        const a = rc.state.animals.find((x) => x.kind === kind);
        rc.sim.place(1, { x: a.pos.x + 4, z: a.pos.z });
        placed = true;
      },
    });
    const d = race.drank(1);
    assert.ok(d[kind] >= 1, `the ${kind} drank from slot 1: ${JSON.stringify(d)}`);
    assert.deepEqual(Object.keys(d), [kind]);
    assert.deepEqual(race.drank(0), {});
    assert.deepEqual(race.results()[1].drank, d);
  }
});

test('starting on a later stage plays from there to the valley floor; unloaded stages load on the way', async () => {
  const lazy = await loadWorld('dolomiti', { dir: 'data/worlds', stages: [2] });
  const loads = [];
  const { loadStage } = await import('../src/world/load.js');
  const race = createRace(lazy, { bots: [true, true], seed: 5, startStage: 2, loadStage: (k) => { loads.push(k); return loadStage('dolomiti', lazy.json, k, { dir: 'data/worlds' }); } });
  let t = 0;
  while (race.phase !== 'done' && t < 400) {
    race.step(DT, []);
    t += DT;
    if (race.phase === 'cloud' && !race.cloud.swapped && race.cloud.t >= 0) await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(race.phase, 'done');
  assert.equal(race.first, 2);
  assert.deepEqual(loads, [3]);
  assert.ok(race.results().every((p) => p.finished));
  assert.equal(race.results()[0].stageTimes[0], undefined);
});

// Frames of BOOST readings for the gates: [[dt, humans, boosts], ...] or a duration with one reading held.
function frames(gate, list) {
  let out = null;
  for (const [secs, ...args] of list) for (let t = 0; t < secs - 1e-9; t += DT) { out = gate.step(DT, ...args); if (out.start || out.action) return out; }
  return out;
}

test('lobby gate: one curious tap does not start a race against a bot; both phones ready, or one held BOOST, does', () => {
  const g = createLobbyGate();
  const one = [true, false], two = [true, true];
  // phone 1 taps BOOST once: ready, nothing starts, however long nobody does anything
  let r = frames(g, [[0.1, one, [true, false]], [10, one, [false, false]]]);
  assert.equal(r.start, false);
  assert.deepEqual(r.ready, [true, false]);
  assert.equal(r.solo, 0);
  // the second phone joins: it has to press too
  r = frames(g, [[2, two, [false, false]]]);
  assert.equal(r.start, false);
  assert.deepEqual(r.ready, [true, false]);
  assert.equal(r.solo, -1);
  r = frames(g, [[0.1, two, [false, true]]]);
  assert.equal(r.start, true, 'both phones ready');
  // a solo player holding BOOST races the bot after GATE.hold s, not before
  g.reset();
  r = frames(g, [[GATE.hold - 0.2, one, [true, false]]]);
  assert.equal(r.start, false);
  assert.ok(r.hold > 0.8 && r.hold < 1);
  r = frames(g, [[0.3, one, [true, false]]]);
  assert.equal(r.start, true);
  // with two phones, holding BOOST alone does not start against a bot
  g.reset();
  assert.equal(frames(g, [[5, two, [true, false]]]).start, false);
  // a phone that leaves forgets it was ready
  g.reset();
  frames(g, [[0.1, two, [true, true]]]);
  g.reset();
  frames(g, [[0.1, two, [true, false]], [0.1, one, [false, false]], [0.1, two, [false, false]]]);
  assert.deepEqual(g.ready, [true, false]);
});

test('results gate: BOOST locked out for GATE.lock s, then a tap rematches and a hold goes back to the lobby', () => {
  const g = createResultsGate();
  // the losing player still mashing BOOST as the results appear: nothing happens
  let r = null;
  for (let t = 0; t < GATE.lock - 0.1; t += 0.2) r = frames(g, [[0.1, [true, false]], [0.1, [false, false]]]);
  assert.equal(r.action, null);
  assert.ok(r.lock > 0.9 && r.lock < 1);
  // a press that began inside the lockout and is still down when it ends does not count, even on release
  r = frames(g, [[0.4, [true, false]], [0.1, [false, false]]]);
  assert.equal(r.action, null);
  assert.equal(r.lock, 1);
  assert.equal(g.open, true);
  // a tap after the lockout: rematch
  assert.equal(frames(g, [[0.1, [false, true]], [0.1, [false, false]]]).action, 'rematch');
  // a hold: back to the lobby, once
  g.reset();
  r = frames(g, [[GATE.lock, [false, false]], [GATE.hold + 0.5, [true, false]]]);
  assert.equal(r.action, 'lobby');
  assert.equal(frames(g, [[0.2, [true, false]], [0.1, [false, false]]]).action, null, 'the same press does not rematch on release');
});

// The playtest (28/10): pink tapped BOOST once on the results and the race restarted under blue, still reading them.
test('results gate: with two phones the rematch waits for both taps; one phone, or a hold, needs only its own', () => {
  const two = [true, true], one = [true, false];
  const g = createResultsGate();
  let r = frames(g, [[GATE.lock, [false, false], two], [0.1, [false, true], two], [0.1, [false, false], two]]);
  assert.equal(r.action, null, 'one tap of two phones does not rematch');
  assert.deepEqual(r.ready, [false, true]);
  r = frames(g, [[1, [false, false], two]]);
  assert.equal(r.action, null, 'it keeps waiting for the other phone');
  assert.deepEqual(g.ready, [false, true]);
  assert.equal(frames(g, [[0.1, [true, false], two], [0.1, [false, false], two]]).action, 'rematch', 'the second tap does');
  // a phone that leaves the results: the one left decides alone
  g.reset();
  r = frames(g, [[GATE.lock, [false, false], two], [0.1, [true, false], two], [0.1, [false, false], two]]);
  assert.equal(r.action, null);
  assert.equal(frames(g, [[0.1, [false, false], one]]).action, 'rematch');
  // one phone racing a bot: its tap is enough
  g.reset();
  assert.equal(frames(g, [[GATE.lock, [false, false], one], [0.1, [true, false], one], [0.1, [false, false], one]]).action, 'rematch');
  // a hold on either phone still goes back to the lobby at once
  g.reset();
  assert.equal(frames(g, [[GATE.lock, [false, false], two], [GATE.hold + 0.2, [false, true], two]]).action, 'lobby');
});

test('software WebGL is recognised, the Mac GPU is not', () => {
  assert.ok(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'));
  assert.ok(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)'));
  assert.ok(!isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)'));
  assert.ok(!isSoftwareRenderer(''));
});

// Stage 2 in memory, stage 3 fetched by loadStage(k) when the race gets there.
function lastTwo(loadStage) {
  const n = world.json.stages.length;
  const w = { json: world.json, stages: [], backdrop: world.backdrop };
  w.stages[n - 2] = world.stages[n - 2];
  return { n, race: createRace(w, { loadStage, bots: [true, true], seed: 1, startStage: n - 2 }) };
}

test('a stage that fails to load is fetched again with a backoff and the race goes on; one that never loads is reported', async () => {
  const { loadStage: realLoad } = await import('../src/world/load.js');
  const full = await Promise.all(world.json.stages.map((_, k) => world.stages[k] || realLoad('dolomiti', world.json, k, { dir: 'data/worlds' })));
  for (const [k, st] of full.entries()) world.stages[k] = st;
  const tick = () => new Promise((r) => setImmediate(r));
  // a LAN blip: the first two fetches fail, the third works
  let calls = 0;
  const blip = lastTwo((k) => (++calls <= 2 ? Promise.reject(new Error('blip')) : Promise.resolve(full[k])));
  let held = 0, maxStalled = null;
  for (let i = 0; i < 60 * 120 && blip.race.stage !== blip.n - 1; i++) {
    blip.race.step(DT, []);
    if (blip.race.phase === 'cloud' && !blip.race.cloud.swapped && blip.race.cloud.t >= blip.race.cloud.duration * CLOUD.swapAt - 1e-9) held += DT;
    maxStalled ||= blip.race.stalled;
    if (i % 30 === 0) await tick();
  }
  assert.equal(blip.race.stage, blip.n - 1, 'the last stage came in');
  assert.equal(calls, 3);
  assert.ok(held < 6, `held ${held.toFixed(1)} s at the top of the flight`);
  assert.equal(blip.race.stalled, null);
  assert.equal(blip.race.error, null);
  // a stage that never loads: the cloud holds, the fetches back off, race.stalled says so
  let fails = 0;
  const dead = lastTwo(() => { fails++; return Promise.reject(new Error('gone')); });
  let stalledAt = null, t = 0;
  for (let i = 0; i < 60 * 200; i++) {
    dead.race.step(DT, []);
    t += DT;
    if (stalledAt === null && dead.race.stalled) stalledAt = t;
    if (i % 30 === 0) await tick();
  }
  assert.equal(dead.race.phase, 'cloud');
  assert.equal(dead.race.stage, dead.n - 2);
  const st = dead.race.stalled;
  assert.ok(st && st.stage === dead.n - 1 && st.failures >= CLOUD.failAfter && st.error.message === 'gone', JSON.stringify(st));
  assert.ok(stalledAt !== null);
  const holding = 200 - (stalledAt - CLOUD.retry * 3); // about the seconds spent at the top of the flight
  assert.ok(fails > CLOUD.failAfter && fails < holding / CLOUD.retryMax + 6, `${fails} fetches: backed off, not one per frame`);
});

test('the gap is there while it is dead time: the leader waiting at the stage end, the cloud, the trailer raining in', () => {
  const race = createRace(world, { bots: [true, true], seed: 1 });
  const seen = { wait: [], cloud: [], rain: [] };
  let over = false; // stage 2 underway with both drops: enough
  run(race, {
    max: 200,
    onStep(rc) {
      if (over) return;
      const g = rc.gap();
      const st = rc.state;
      if (rc.stage === 0 && rc.phase === 'race' && st.players.some((p) => p.status === 'finished')) seen.wait.push(g);
      else if (rc.phase === 'cloud') seen.cloud.push(g);
      else if (rc.stage === 1 && st.players.some((p) => p.status === 'evaporated')) seen.rain.push(g);
      else if (rc.phase === 'race' && rc.stage === 1) { assert.equal(g, null, 'both racing: no gap'); over = true; }
      else if (rc.phase === 'race' && rc.stage === 0) assert.equal(g, null);
    },
  });
  const wait = seen.wait.filter(Boolean);
  assert.ok(wait.length > 60, 'shown while the leader waits for the trailer');
  assert.ok(wait.at(-1).s > wait[0].s, 'it grows while the trailer is still on its way');
  const { leader } = wait[0];
  assert.ok(seen.cloud.every((g) => g && g.leader === leader && Math.abs(g.s - Math.min(wait.at(-1).s, CLOUD.gapMax)) < 0.1), 'the cloud keeps it, up to CLOUD.gapMax s');
  assert.ok(seen.rain.length > 30 && seen.rain.filter(Boolean).every((g) => g.leader === leader));
  assert.ok(seen.wait.length * DT <= CLOUD.wait + 0.1, `the leader waits at most CLOUD.wait s: ${(seen.wait.length * DT).toFixed(1)} s`);
});

test('the carried gap is capped at CLOUD.gapMax s and can be scaled', () => {
  const gaps = (cloud) => {
    const race = createRace(world, { bots: [true, true], seed: 1, cloud });
    let d = null;
    run(race, { max: 300, onStep(rc) { if (rc.phase === 'cloud' && !d) d = rc.cloud.delays.slice(); if (d) rc.state.phase = 'done'; } });
    return Math.abs(d[0] - d[1]);
  };
  const exact = gaps({ gapMax: Infinity });
  assert.ok(exact > 2, `${exact}`);
  assert.ok(Math.abs(gaps() - Math.min(exact, CLOUD.gapMax)) < 1e-9, 'capped by default');
  assert.ok(Math.abs(gaps({ gapScale: 0.5, gapMax: 6 }) - Math.min(exact * 0.5, 6)) < 1e-9);
});

// The playtest on the Carpazi (28/10): the slower drop was taken by the cloud 15 s after the leader on every stage,
// rained in 15 s late on the next one, and missed the valley floor by 3 m when the grace ran out.
test('a drop the cloud takes before its line rains in at most CLOUD.gapMax s late, with its stage time', () => {
  const race = createRace(world, { bots: [true, false], seed: 2 });
  let rain = {}, cutAt = null;
  run(race, {
    inputs: (rc) => [null, rc.stage === 0 ? { x: 0, y: -1, boost: false, connected: true } : { x: 0, y: 0, boost: false, connected: true }],
    max: 300,
    onStep(rc) {
      if (rc.phase === 'cloud' && cutAt === null) cutAt = rc.cloud.delays.slice();
      for (const e of rc.events) if (e.kind === 'respawn' && e.reason === 'rain' && rc.stage === 1) rain[e.slot] = rc.state.t;
      if (rc.stage === 1 && Object.keys(rain).length === 2) rc.state.phase = 'done';
    },
  });
  assert.ok(cutAt, 'the cloud took the braking drop');
  assert.ok(Math.abs(cutAt[1] - cutAt[0] - CLOUD.gapMax) < 1e-9, `carried ${(cutAt[1] - cutAt[0]).toFixed(2)} s`);
  assert.ok(Math.abs(rain[1] - rain[0] - CLOUD.gapMax) < 0.1, `rained ${(rain[1] - rain[0]).toFixed(2)} s after the leader`);
  const [lead, trail] = race.results().map((p) => p.stageTimes);
  assert.ok(Math.abs(trail[0] - lead[0] - CLOUD.wait) < 0.05, `stage time of the drop taken by the cloud, as ridden: ${trail[0]} after ${lead[0]}`);
});

// The playtest results (28/10): with the gap cut, both drops showed the very same split on every later stage.
test('the stage times are ridden: each split is the time on that stage, rain-in to line, whatever the cloud cut', () => {
  const race = createRace(world, { bots: [true, false], seed: 5 });
  // slot 1 brakes on the first two stages (the cloud cuts its gap), then drives like a bot to the valley floor
  let pilot = null;
  const drive = (rc) => {
    if (rc.stage < 2) return { x: 0, y: -0.6, boost: false, connected: true };
    if (pilot?.sim !== rc.sim) pilot = { sim: rc.sim, bot: createBot(rc.sim, 1, { seed: 9 }) };
    return { ...pilot.bot.input(), connected: true };
  };
  run(race, { inputs: (rc) => [null, drive(rc)], max: 900 });
  const res = race.results();
  assert.ok(res.every((p) => p.finished), JSON.stringify(res));
  const [lead, trail] = res.map((p) => p.stageTimes);
  for (const p of res) {
    assert.equal(p.stageTimes.length, world.json.stages.length, `slot ${p.slot} has a time for every stage`);
    for (let k = 1; k < p.stageTimes.length; k++) assert.ok(p.stageTimes[k] > p.stageTimes[k - 1], `slot ${p.slot}: stage ${k} ends after stage ${k - 1}`);
  }
  assert.ok(Math.abs(lead.at(-1) - res[0].time) < 1e-6, 'the leader rode its whole race time');
  const split = (t, k) => t[k] - (k ? t[k - 1] : 0);
  assert.ok(split(trail, 0) - split(lead, 0) > CLOUD.gapMax + 1, 'the braking stage shows the real gap, not the cut one');
  assert.ok(Math.abs(split(trail, 1) - split(lead, 1)) > 0.05, 'the next split is its own, not a copy of the leader');
  // what the cloud gave back: the trailer's ridden time is its race time plus the seconds over CLOUD.gapMax
  assert.ok(trail.at(-1) > res[1].time + 1, `${trail.at(-1)} ridden, ${res[1].time} race time`);
});

// A human drop kept braking on the last stage until the grace is nearly over, then let go `left` m from the line.
function finale(left) {
  const last = world.json.stages.length - 1;
  const race = createRace(world, { bots: [true, false], seed: 4, startStage: last });
  let dropped = false, graceEnd = null;
  run(race, {
    inputs: () => [null, { x: 0, y: dropped ? 0 : -1, boost: false, connected: true }],
    max: 400,
    onStep(rc) {
      const st = rc.state;
      if (!dropped && st.grace !== null && st.grace < 0.5) {
        const W = rc.sim.world, q = W.pointAt(0, W.sFinish - left);
        rc.sim.place(1, { x: q.cx, z: q.cz }, { vel: { x: q.tangent.x * 6, z: q.tangent.z * 6 } });
        dropped = true;
      }
      if (dropped && graceEnd === null && rc.phase === 'done') graceEnd = st.t;
    },
  });
  return race.results()[1];
}

test('the valley floor: a drop rolling within FINALE.near m of the line when the grace ends gets to finish', () => {
  const near = finale(FINALE.near / 3);
  assert.ok(near.finished && Number.isFinite(near.time) && near.place === 2, JSON.stringify(near));
  const far = finale(FINALE.near * 4);
  assert.equal(far.finished, false, 'far from the line the grace still ends the race');
  assert.equal(far.place, null);
});

// Integration fix in src/render: past the last course point the bake's carved trench is still below the water
// level of that point, and it was painted as wet bed with no water over it (a grey slab under every stage-end cloud).
test('the stage end: the ground past the last course point is not painted as wet bed', async () => {
  const { THEME } = await import('../src/render/theme.js');
  const { createPalette } = await import('../src/render/palette.js');
  const { stagePaths, createPathIndex } = await import('../src/render/path.js');
  const palette = createPalette(THEME);
  const st = world.stages[0] || (world.stages[0] = await (await import('../src/world/load.js')).loadStage('dolomiti', world.json, 0, { dir: 'data/worlds' }));
  const paths = stagePaths(st.json), index = createPathIndex(paths), hit = {};
  const c = st.json.course, a = c[c.length - 2], b = c[c.length - 1];
  const l = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / l, uz = (b.z - a.z) / l;
  assert.ok(index.nearest(b.x - ux * 5, b.z - uz * 5, hit) && hit.past === 0, 'along the stream: not past the end');
  assert.ok(index.nearest(b.x + ux * 12, b.z + uz * 12, hit) && Math.abs(hit.past - 12) < 2.5, `12 m past the end: ${hit.past}`);
  assert.ok(index.nearest(c[0].x - (c[1].x - c[0].x) * 0.8, c[0].z - (c[1].z - c[0].z) * 0.8, hit) && hit.past > 0, 'before the start');
  const bed = palette.colors.bed, under = [0, 0, 0], past = [0, 0, 0];
  const ground = (out, stream) => palette.ground(out, { alt: 1500, slope: 2, x: 0, z: 0, forest: 0, stream });
  ground(under, { r: 0.2, above: -0.5, side: 1, past: 0 });
  ground(past, { r: 0.2, above: -0.5, side: 1, past: 12 });
  const dist = (p) => Math.hypot(p[0] - bed[0], p[1] - bed[1], p[2] - bed[2]);
  assert.ok(dist(under) < 1e-6, 'under the water: the bed colour');
  assert.ok(dist(past) > 0.05, 'past the end: the bank and meadow colours');
});
