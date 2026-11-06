// The sim's animals as a racing drop meets them (src/sim/index.js updateAnimals, tuning animal): they graze on
// their own bank, head off a drop riding the bed edge at race speed and drink from it, leave a drop in the
// middle of the bed alone, and the eagle never comes down. The baked Dolomiti race checks the same thing end
// to end: a drop riding the edge meets 1-6 drinking animals, one holding the center line rarely one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createSim, createWorldAccess, TUNING } from '../src/sim/index.js';
import { vmaxFor } from '../src/sim/tuning.js';
import { createBot } from '../src/sim/bot.js';
import { loadWorld } from '../src/world/load.js';
import { syntheticWorld, run, courseSpot, DT } from './fixtures/sim-helpers.mjs';

const W = syntheticWorld();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// A race sim on the synthetic world with one animal of `kind` standing `past` m beyond the bed edge, on the
// right bank, `s` m down the course.
function bankSim({ s = 1500, past = 2, kind = 'chamois', flying = false, players = 1 } = {}) {
  const j = structuredClone(W.json);
  const hw = W.pointAt(0, s).hw;
  const spot = courseSpot(W, s, hw + past);
  j.spawns.animals = [{ kind, x: spot.x, y: W.heightAt(spot.x, spot.z), z: spot.z, ...(flying ? { flying: true } : {}) }];
  const sim = createSim(createWorldAccess(j, (x, z) => W.heightAt(x, z)), { players, seed: 3 });
  while (sim.state.phase === 'countdown') sim.step(DT, []);
  return { sim, s, hw };
}

// Pad input that holds the drop at `lateral` m from the centerline (positive right, or a function of the
// track), full stick forward. Toward the bank the stick stays under tuning bed.wallStick (0.5): the drop rides
// the edge inside the bed, it does not climb out onto the bank.
const holdLateral = (sim, slot, lateral) => () => {
  const tr = sim.track(slot), p = sim.state.players[slot];
  const vlat = p.vel.x * -tr.tangent.z + p.vel.z * tr.tangent.x;
  const x = clamp(0.4 * ((typeof lateral === 'function' ? lateral(tr) : lateral) - tr.lateral) - 0.15 * vlat, -1, 1);
  return { x: x * tr.lateral > 0 ? clamp(x, -0.45, 0.45) : x, y: 1 };
};

// Drop 0 placed `back` m upstream of s at `lateral`, moving at its top speed on that stretch.
function launch(sim, s, lateral, back = 60) {
  const st = courseSpot(W, s - back, lateral);
  const v = vmaxFor(TUNING, sim.state.players[0].mass, W.nearestCourse(st).grade);
  sim.place(0, st, { vel: { x: st.tangent.x * v, z: st.tangent.z * v } });
}

test('an animal grazes on its own bank and never wanders into the water', () => {
  const { sim, s } = bankSim({ s: 2400, past: 1 });
  sim.place(0, courseSpot(W, 200, 0)); // far away
  let closest = Infinity, moved = 0;
  const home = { ...sim.state.animals[0].pos };
  run(sim, 40, () => [{ y: -1 }], (sm) => {
    const a = sm.state.animals[0], near = W.nearestCourse(a.pos);
    closest = Math.min(closest, near.lateral - near.hw);
    moved = Math.max(moved, Math.hypot(a.pos.x - home.x, a.pos.z - home.z));
    return false;
  });
  assert.ok(moved > 2, `it wandered (${moved.toFixed(1)} m)`);
  assert.ok(closest > 0.5, `stays past the edge, closest ${closest.toFixed(2)} m`);
  assert.ok(Math.abs(W.nearestCourse(sim.state.animals[0].pos).s - s) < TUNING.animal.wanderRadius + 2);
});

test('a drop riding the bed edge at race speed is headed off and drunk at once', () => {
  const { sim, s, hw } = bankSim();
  launch(sim, s, hw - 1);
  const states = new Set();
  const ride = holdLateral(sim, 0, (tr) => tr.hw - 0.5);
  let caughtAt = null;
  const ev = run(sim, 6, () => [ride()], (sm) => {
    const a = sm.state.animals[0];
    if (a.state === 'drink' && caughtAt == null) caughtAt = sm.state.players[0].speed;
    states.add(a.state);
    return sm.track(0).s > s + 40;
  });
  assert.ok(states.has('approach') && states.has('drink'), [...states].join(','));
  assert.ok(caughtAt > 15, `caught at race speed (${caughtAt?.toFixed(1)} m/s)`);
  const sips = ev.filter((e) => e.kind === 'drink' && e.slot === 0);
  assert.ok(sips.length >= 1, 'the latch is felt at once: a drink event');
  assert.equal(sips[0].animalKind, 'chamois');
});

test('a drop holding the middle of the bed rides past untouched', () => {
  const { sim, s } = bankSim({ past: 1.5 });
  launch(sim, s, 0);
  const states = new Set();
  const ride = holdLateral(sim, 0, 0);
  const ev = run(sim, 6, () => [ride()], (sm) => { states.add(sm.state.animals[0].state); return sm.track(0).s > s + 40; });
  assert.ok(sim.track(0).s > s + 40, 'it rode on past');
  assert.deepEqual([...states], ['wander']);
  assert.ok(!ev.some((e) => e.kind === 'drink'));
});

test('a drop braking in the middle of the bed is visited: the animal wades out to it and drinks', () => {
  const { sim, s, hw } = bankSim({ past: 4 });
  launch(sim, s, 0, 50);
  const ride = holdLateral(sim, 0, 0);
  let deepest = Infinity, called = null;
  const ev = run(sim, 8, () => [{ ...ride(), y: -1 }], (sm) => {
    const a = sm.state.animals[0];
    if (a.state !== 'wander' && called == null) called = Math.hypot(a.pos.x - sm.state.players[0].pos.x, a.pos.z - sm.state.players[0].pos.z);
    deepest = Math.min(deepest, Math.abs(W.nearestCourse(a.pos).lateral));
    return sm.state.events.some((e) => e.kind === 'drink');
  });
  assert.ok(called > TUNING.animal.sense, `called from ${called?.toFixed(1)} m, beyond the race-speed radius ${TUNING.animal.sense} m`);
  assert.ok(ev.some((e) => e.kind === 'drink' && e.slot === 0), 'it drank from the braking drop');
  assert.ok(deepest < hw - TUNING.animal.wade, `it waded out to ${deepest.toFixed(1)} m from the center line (bed half width ${hw.toFixed(1)})`);
});

test('a moment under the stop speed (a hairpin) is not a stop: the middle of the bed stays safe', () => {
  const { sim, s } = bankSim({ past: 4 });
  launch(sim, s, 0, 50);
  const ride = holdLateral(sim, 0, 0);
  // two short taps of the brake, each shorter than callAfter
  const tap = Math.round((TUNING.animal.callAfter * 0.6) / DT);
  const ev = run(sim, 6, (k) => [{ ...ride(), y: k % 60 < tap ? -1 : 1 }], (sm) => sm.track(0).s > s + 40);
  assert.ok(!ev.some((e) => e.kind === 'drink'), 'nobody drank');
  assert.deepEqual([...new Set(sim.state.animals.map((a) => a.state))], ['wander']);
});

test('the eagle never comes down to drink, even from a drop sitting still beside it', () => {
  const { sim, s, hw } = bankSim({ kind: 'eagle', flying: true });
  sim.place(0, courseSpot(W, s, hw - 1));
  const ev = run(sim, 5, () => [{ y: -1 }]);
  assert.equal(sim.state.animals[0].state, 'wander');
  assert.ok(!ev.some((e) => e.kind === 'drink'));
});

// The baked race, the finding of the review: animals stood 22-50 m from the bed and nobody was ever drunk.
// Up to 6 since playtest r1: the rules read the horizontal speed (on the 60-70 % faces of stage 0 a drop at its
// cap used to count as fast and was never drunk there), and the rebaked beds are the real 8-14 m of the young
// Piave, so a drop riding a bank passes within reach of most animals on it. The middle stays safe.
const DIR = new URL('../data/worlds', import.meta.url).pathname;
const baked = existsSync(`${DIR}/dolomiti/world.json`);
test('Dolomiti race: riding the bank edge meets 1-6 drinking animals, the center line rarely one', { skip: baked ? false : 'world not baked', timeout: 300000 }, async () => {
  const world = await loadWorld('dolomiti', { dir: DIR });
  // slot 0 is the drop under test, slot 1 a normal bot in its own lane; a player boosts away after 0.4 s of
  // being drunk
  function race(seed, lateral) {
    let carry = null, held = 0, last = false;
    const met = new Set();
    for (let k = 0; k < world.stages.length; k++) {
      const sim = createSim(world.stages[k], { players: 2, seed: seed + k, final: k === world.stages.length - 1, carry });
      const ride = holdLateral(sim, 0, lateral), bot = createBot(sim, 1, { lane: 0.3, seed: seed * 10 });
      for (let n = 0; n < 60 * 240 && !sim.state.players.every((p) => p.status === 'finished' || p.status === 'dnf'); n++) {
        const p = sim.state.players[0];
        held = sim.state.animals.some((a) => a.target === 0 && a.state === 'drink') ? held + DT : 0;
        const boost = held > 0.4 && p.boostCooldown <= 0 && !last;
        last = boost;
        sim.step(DT, [{ ...ride(), boost }, bot.input()]);
        for (const e of sim.state.events) if (e.kind === 'drink' && e.slot === 0) met.add(`${k}:${e.animal}`);
      }
      carry = sim.carry();
    }
    return met.size;
  }
  const seeds = [1, 2, 3, 4, 5, 6];
  const edge = seeds.flatMap((seed) => [race(seed, (tr) => tr.hw - 0.5), race(seed, (tr) => -(tr.hw - 0.5))]);
  const center = seeds.map((seed) => race(seed, 0));
  const median = edge.slice().sort((a, b) => a - b)[edge.length >> 1];
  assert.ok(median >= 1 && median <= 6, `riding the edge: median ${median} drinking animals per race (${edge.join(', ')}, right and left bank by seed)`);
  assert.ok(edge.filter((n) => n === 0).length <= 3, `riding the edge mostly meets one: ${edge.join(', ')}`);
  // at 50-60 m/s a hairpin on the snowfield throws even a drop steering for the center out to 0.7-0.8 of the
  // half width for a moment, and in the 8-10 m young Piave that is the animal's half of the bed: well under
  // one meeting a race, a small fraction of riding the edge
  const centered = center.reduce((a, b) => a + b, 0), edged = edge.reduce((a, b) => a + b, 0) / 2;
  assert.ok(centered <= seeds.length * 0.75 && centered * 4 <= edged, `the center line is rarely drunk: ${center.join(', ')} (the edge ${edge.join(', ')})`);
});

// Playtest round 1: on Carpazi, Everest, K2 and Kerinci nobody was drunk in a whole race, even by a player
// braking by a yak or a tiger. A player holding the middle of the bed who brakes when a ground animal is ahead
// is visited on most stages of every world.
const WORLDS = ['dolomiti', 'antelao', 'svizzera', 'carpazi', 'everest', 'k2', 'indonesia'].filter((id) => existsSync(`${DIR}/${id}/world.json`));
test('every world: braking by an animal in the middle of the bed gets it to come and drink', { skip: WORLDS.length ? false : 'no world baked', timeout: 300000 }, async (t) => {
  const report = [];
  for (const id of WORLDS) {
    const world = await loadWorld(id, { dir: DIR });
    let carry = null, stages = 0;
    for (let k = 0; k < world.stages.length; k++) {
      const sim = createSim(world.stages[k], { players: 1, seed: 5 + k, final: k === world.stages.length - 1, carry });
      const ground = world.stages[k].json.spawns.animals.map((a, i) => (a.flying ? -1 : i)).filter((i) => i >= 0);
      const ride = holdLateral(sim, 0, 0);
      let braking = 0, drank = false;
      for (let n = 0; n < 60 * 240 && sim.state.players[0].status !== 'finished'; n++) {
        const p = sim.state.players[0], v = Math.hypot(p.vel.x, p.vel.z) || 1;
        // a person sees the animal 50 m ahead and brakes for up to 4 s, longer while it drinks
        const ahead = ground.some((i) => {
          const a = sim.state.animals[i], dx = a.pos.x - p.pos.x, dz = a.pos.z - p.pos.z, along = (dx * p.vel.x + dz * p.vel.z) / v;
          return along > -8 && along < 45 && Math.hypot(dx, dz) < 50;
        });
        const drinking = sim.state.animals.some((a) => a.target === 0 && a.state === 'drink');
        braking = drinking || ahead ? braking + DT : 0;
        sim.step(DT, [{ ...ride(), y: ahead && braking < 4 ? -1 : 1 }]);
        if (sim.state.events.some((e) => e.kind === 'drink')) drank = true;
      }
      if (drank) stages++;
      carry = sim.carry();
    }
    report.push(`${id} ${stages}/${world.stages.length}`);
    assert.ok(stages >= 1, `${id}: no animal came to a braking drop (${report.join(', ')})`);
  }
  t.diagnostic(`stages with a drink: ${report.join(', ')}`);
  const total = report.reduce((a, r) => a + +r.split(' ')[1].split('/')[0], 0);
  assert.ok(total >= WORLDS.length * 1.5, `braking by animals pays on most stages: ${report.join(', ')}`);
});
