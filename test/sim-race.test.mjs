// Whole-race behavior on the synthetic world: determinism, bots finishing with places, the
// shortcut, the 30 s grace for the second drop. Run with node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, stateHash, TUNING } from '../src/sim/index.js';
import { createBot } from '../src/sim/bot.js';
import { syntheticWorld, raceSim, run, courseSpot, DT } from './fixtures/sim-helpers.mjs';

const W = syntheticWorld();

function botRace({ seed = 3, shortcut = [false, true], seconds = 400, players = 2 } = {}) {
  const sim = createSim(W, { players, seed });
  const bots = Array.from({ length: players }, (_, i) => createBot(sim, i, { preferShortcut: shortcut[i] }));
  const events = [];
  const hashes = [];
  for (let k = 0; k < seconds / DT && sim.state.phase !== 'done'; k++) {
    sim.step(DT, bots.map((b) => b.input()));
    for (const e of sim.state.events) events.push({ ...e, t: sim.state.t });
    if (k % 600 === 0) hashes.push(sim.hash());
  }
  return { sim, events, hashes };
}

test('deterministic: same seed and inputs give the same state hash', () => {
  const a = botRace({ seed: 11, seconds: 60 }), b = botRace({ seed: 11, seconds: 60 });
  assert.deepEqual(a.hashes, b.hashes);
  assert.equal(stateHash(a.sim.state), stateHash(b.sim.state));
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  const c = botRace({ seed: 12, seconds: 60 });
  assert.notEqual(c.sim.hash(), a.sim.hash(), 'the seed drives animals and rain');
});

test('two bots finish the synthetic course in a plausible time with places', (t) => {
  const t0 = performance.now();
  const { sim, events } = botRace({ seed: 3, shortcut: [false, true] });
  const ms = performance.now() - t0;
  const [a, b] = sim.state.players;
  assert.equal(sim.state.phase, 'done');
  assert.equal(a.status, 'finished'); assert.equal(b.status, 'finished');
  assert.deepEqual([a.place, b.place].sort(), [1, 2]);
  const first = a.place === 1 ? a : b, second = a.place === 1 ? b : a;
  assert.ok(first.finishTime <= second.finishTime);
  for (const p of [a, b]) assert.ok(p.finishTime > 150 && p.finishTime < 300, `finish ${p.finishTime} s`);
  const fin = events.filter((e) => e.kind === 'finish');
  assert.deepEqual(fin.map((e) => e.place), [1, 2]);
  assert.ok(events.filter((e) => e.kind === 'checkpoint').length >= 2 * W.checkpoints.length - 2);
  assert.ok(events.some((e) => e.kind === 'pickup'));
  assert.ok(events.some((e) => e.kind === 'splash' && e.slot === 1), 'the shortcut bot jumped the waterfall');
  t.diagnostic(`slot 0 (course): ${a.finishTime.toFixed(1)} s place ${a.place}; slot 1 (shortcut): ${b.finishTime.toFixed(1)} s place ${b.place}; sim ${ms.toFixed(0)} ms`);
  console.log(`BOT RACE: slot0 course ${a.finishTime.toFixed(1)} s (place ${a.place}), slot1 shortcut ${b.finishTime.toFixed(1)} s (place ${b.place}), course ${W.sFinish.toFixed(0)} m, sim ${ms.toFixed(0)} ms`);
});

test('the shortcut is faster when taken cleanly', (t) => {
  const b = W.branches[0];
  const timeTo = (preferShortcut) => {
    const sim = raceSim({ seed: 2 });
    const st = courseSpot(W, b.sFrom - 200);
    sim.place(0, st, { vel: { x: st.tangent.x * 28, z: st.tangent.z * 28 } });
    const bot = createBot(sim, 0, { preferShortcut, pickups: false, boost: false });
    const t0 = sim.state.t;
    const seen = new Set();
    const ev = run(sim, 120, () => [bot.input()], (s) => { seen.add(s.state.players[0].status); seen.add('path' + s.track(0).pathId); return s.track(0).pathId === 0 && s.track(0).s > b.sTo + 50; });
    return { time: sim.state.t - t0, ev, seen };
  };
  const main = timeTo(false), cut = timeTo(true);
  assert.ok(!main.seen.has('path1') && cut.seen.has('path1'), 'each bot took the road it chose');
  assert.ok(cut.seen.has('airborne'), 'the waterfall throws the drop in the air');
  const splash = cut.ev.find((e) => e.kind === 'splash');
  assert.ok(splash && splash.air > 0.5, 'landing splash');
  assert.ok(!cut.ev.some((e) => e.kind === 'respawn'), 'taken cleanly');
  assert.ok(cut.time < main.time - 5, `shortcut ${cut.time.toFixed(1)} s vs course ${main.time.toFixed(1)} s`);
  t.diagnostic(`fork to rejoin: shortcut ${cut.time.toFixed(1)} s, course ${main.time.toFixed(1)} s`);
});

test('the second drop has 30 s after the first finishes', () => {
  const sim = createSim(W, { players: 2, seed: 5 });
  const bot = createBot(sim, 0);
  let firstAt = null;
  for (let k = 0; k < 400 / DT && sim.state.phase !== 'done'; k++) {
    sim.step(DT, [bot.input(), { connected: false }]);
    if (firstAt === null && sim.state.events.some((e) => e.kind === 'finish')) firstAt = sim.state.t;
  }
  assert.ok(firstAt !== null);
  assert.equal(sim.state.phase, 'done');
  assert.ok(Math.abs(sim.state.t - firstAt - TUNING.grace) < 2 * DT, `done ${sim.state.t - firstAt} s after the first`);
  const [a, b] = sim.state.players;
  assert.equal(a.place, 1); assert.equal(b.place, 2);
  assert.equal(b.dnf, true);
  assert.notEqual(b.status, 'finished');
});

test('live places follow distance down the course', () => {
  const sim = raceSim({ players: 2 });
  const ahead = courseSpot(W, 3000), behind = courseSpot(W, 2000);
  sim.place(0, behind); sim.place(1, ahead);
  sim.step(DT, []);
  assert.equal(sim.state.players[1].place, 1);
  assert.equal(sim.state.players[0].place, 2);
  assert.ok(sim.state.players[1].progress > sim.state.players[0].progress);
});

test('at a fork the stick chooses the road: no input stays on the course, holding toward the branch takes it', () => {
  const b = W.branches[0];
  const pass = (stick) => {
    const sim = raceSim({ seed: 2 });
    const st = courseSpot(W, b.sFrom - 60);
    sim.place(0, st, { vel: { x: st.tangent.x * 28, z: st.tangent.z * 28 } });
    const onBranch = W.pointAt(b.id, 60), onMain = W.pointAt(0, b.sFrom + 60);
    const side = Math.sign((onBranch.cx - onMain.cx) * -st.tangent.z + (onBranch.cz - onMain.cz) * st.tangent.x);
    const paths = new Set();
    run(sim, 8, () => [{ x: stick * side, y: 1 }], (s) => { paths.add(s.track(0).pathId); return s.track(0).sEq > b.sFrom + 200; });
    return paths;
  };
  assert.ok(!pass(0).has(b.id), 'no input follows the main course');
  assert.ok(pass(1).has(b.id), 'stick toward the branch takes it');
});

test('stages chain: no grace before the last stage, the gap and the clock carry over', () => {
  // Stage 1 (not final): slot 1 waits 40 s before moving, far beyond the 30 s grace. No rubber band here,
  // so the gap stays above the grace (the catch-up has its own test).
  const tuning = { catchup: { max: 0 } };
  const s1 = createSim(W, { players: 2, seed: 6, final: false, tuning });
  const bots = [createBot(s1, 0), createBot(s1, 1)];
  const ev1 = [];
  for (let k = 0; k < 500 / DT && s1.state.phase !== 'done'; k++) {
    s1.step(DT, [bots[0].input(), s1.state.t < TUNING.countdown + 40 ? { y: -1 } : bots[1].input()]);
    ev1.push(...s1.state.events);
  }
  assert.equal(s1.state.phase, 'done');
  const [a, b] = s1.state.players;
  assert.equal(a.status, 'finished'); assert.equal(b.status, 'finished');
  assert.ok(!b.dnf && s1.state.grace === null, 'no grace before the last stage');
  assert.ok(b.finishTime - a.finishTime > TUNING.grace, `gap ${b.finishTime - a.finishTime} s`);
  const fin = ev1.filter((e) => e.kind === 'finish');
  assert.deepEqual(fin.map((e) => [e.slot, e.place, e.final]), [[0, 1, false], [1, 2, false]]);

  // Stage 2 (final): the leader rains in at once, the other one `gap` s later; the clock resumes at
  // the leader's arrival, so finishTime keeps counting race time only.
  const c = s1.carry();
  assert.equal(c.stage, 1);
  const gap = b.finishTime - a.finishTime;
  assert.ok(Math.abs(c.players[1].delay - gap) < 1e-9 && c.players[0].delay === 0);
  const s2 = createSim(W, { players: 2, seed: 6, final: true, carry: c, tuning });
  assert.equal(s2.state.phase, 'race');
  assert.ok(s2.state.players.every((p) => p.status === 'evaporated' && p.lap === 1 && p.melt === 1));
  assert.ok(Math.abs(s2.state.players[0].mass - a.mass) < 1e-9, 'mass carries over');
  const bots2 = [createBot(s2, 0), createBot(s2, 1)];
  const rains = [];
  for (let k = 0; k < 500 / DT && s2.state.phase !== 'done'; k++) {
    s2.step(DT, bots2.map((x) => x.input()));
    for (const e of s2.state.events) if (e.kind === 'respawn') rains.push({ ...e, t: s2.state.t });
  }
  assert.deepEqual(rains.map((e) => [e.slot, e.reason]), [[0, 'rain'], [1, 'rain']]);
  assert.ok(Math.abs(rains[1].t - rains[0].t - gap) < 2 * DT, 'the second drop rains in after the gap');
  assert.ok(Math.abs(rains[0].t - TUNING.countdown - a.finishTime) < 2 * DT, 'race clock resumes at the leader arrival');
  assert.equal(s2.state.phase, 'done');
  const [a2, b2] = s2.state.players;
  assert.equal(a2.status, 'finished');
  assert.ok(a2.finishTime > a.finishTime + 100, `total race time ${a2.finishTime} s`);
  // The final stage does start the grace: the second drop finishes inside it or is marked DNF.
  assert.notEqual(s2.state.grace, null);
  if (b2.status === 'finished') assert.ok(b2.finishTime - a2.finishTime <= TUNING.grace + DT && !b2.dnf);
  else assert.equal(b2.dnf, true);
});
