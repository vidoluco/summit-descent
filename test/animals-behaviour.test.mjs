// The animals' behaviour (src/render/animals/behaviour.js): its own copy of the sim rules (wander, come
// to a slow drop and drink, flee a fast one), mirroring the real sim's animals, reactions to splash and
// bump events, and the golden eagle that circles and never drinks. Pure, no three.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHerd, RULES } from '../src/render/animals/behaviour.js';
import { SPECIES } from '../src/render/animals/registry.js';
import { raceSim, run, syntheticWorld, DT } from './fixtures/sim-helpers.mjs';

const step = (herd, seconds, drops = [], events = () => [], sim = null) => {
  for (let t = 0; t < seconds; t += DT) herd.update(DT, typeof drops === 'function' ? drops(t) : drops, events(t), sim);
};
const drop = (x, z, speed = 0, slot = 0) => ({ slot, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: speed }, speed, radius: 0.55, status: 'rolling' });

test('a slow drop within the radius draws the animal in, it drinks with its head down and gulps', () => {
  const herd = createHerd({ seed: 2 });
  const [a] = herd.spawn([{ species: 'marmot', x: 0, z: 0, radius: 12 }]);
  const d = drop(8, 0, 1);
  const modes = new Set();
  for (let t = 0; t < 5; t += DT) { herd.update(DT, [d], []); modes.add(a.mode); }
  assert.ok(modes.has('approach'), [...modes].join(','));
  assert.equal(a.mode, 'drink');
  const dist = Math.hypot(a.x - d.pos.x, a.z - d.pos.z);
  assert.ok(dist < d.radius + RULES.reach && dist > 0.5, `drinks from ${dist.toFixed(2)} m`);
  assert.ok(a.head > 0.6, `head down ${a.head.toFixed(2)}`);
  assert.ok(a.sips >= 4, `${a.sips} sips`);
  assert.ok(Math.abs(Math.atan2(d.pos.x - a.x, d.pos.z - a.z) - a.heading) % (2 * Math.PI) < 0.3, 'faces the drop');
});

test('an animal leaves a drop alone outside its radius and goes back to wandering when it leaves', () => {
  const herd = createHerd({ seed: 3 });
  const [a] = herd.spawn([{ species: 'chamois', x: 0, z: 0, radius: 6 }]);
  step(herd, 3, [drop(12, 0, 1)]);
  assert.ok(a.mode === 'idle' || a.mode === 'wander', a.mode);
  assert.equal(a.target, -1);
  // in range: it drinks; the drop then moves off out of range: it gives up
  step(herd, 4, [drop(a.x + 3, a.z, 0.5)]);
  assert.equal(a.mode, 'drink');
  step(herd, 1, [drop(a.x + 40, a.z, 0.5)]);
  assert.ok(a.mode === 'idle' || a.mode === 'wander', a.mode);
});

test('a fast pass close by makes it flee away from the drop, then it comes home', () => {
  const herd = createHerd({ seed: 4 });
  const [a] = herd.spawn([{ species: 'hare', x: 0, z: 0 }]);
  step(herd, 0.5);
  const x0 = a.x;
  herd.update(DT, [drop(x0 + 3, a.z, 25)], []);
  assert.equal(a.mode, 'flee');
  step(herd, 1.5);
  assert.ok(a.x < x0 - 2, `ran away from the drop (${(x0 - a.x).toFixed(1)} m)`);
  assert.ok(a.gait > 0.5 && a.bob >= 0, 'running gait');
  step(herd, 12);
  assert.notEqual(a.mode, 'flee');
  assert.ok(Math.hypot(a.x - a.home.x, a.z - a.home.z) < RULES.wanderRadius + 2, 'back near home');
});

test('a splash close by puts animals on alert, looking at it; one right next to it flees', () => {
  const herd = createHerd({ seed: 5 });
  const [near, mid, far] = herd.spawn([{ species: 'marmot', x: 0, z: 0 }, { species: 'ibex', x: 10, z: 0 }, { species: 'cow', x: 60, z: 0 }]);
  step(herd, 0.2);
  herd.update(DT, [], [{ kind: 'splash', slot: 0, x: near.x + 2, y: 0, z: near.z }]);
  assert.equal(near.mode, 'flee');
  assert.ok(mid.alert > 0 && far.alert === 0);
  step(herd, 0.6);
  assert.ok(mid.head < -0.2, `head up ${mid.head.toFixed(2)}`);
  step(herd, 2);
  assert.equal(mid.alert, 0);
});

test('the golden eagle circles high above its spawn and never comes down to drink', () => {
  const herd = createHerd({ seed: 6, ground: () => 100 });
  const [e] = herd.spawn([{ kind: 'eagle', x: 50, z: 50, flying: true }]);
  let minY = Infinity, flaps = 0;
  for (let t = 0; t < 30; t += DT) {
    herd.update(DT, [drop(e.x, e.z, 0)], [{ kind: 'drink', animal: 0, slot: 0 }]);
    minY = Math.min(minY, e.y); if (Math.abs(e.flap) > 0.5) flaps++;
  }
  assert.equal(e.mode, 'soar');
  assert.ok(minY > 100 + 15, `stays above the ground (${minY.toFixed(1)})`);
  const r = Math.hypot(e.x - 50, e.z - 50);
  assert.ok(Math.abs(r - e.circle) < 0.5 && e.circle >= 30, `circles at ${r.toFixed(1)} m`);
  assert.ok(flaps > 0, 'flaps now and then');
  assert.ok(Math.abs(e.roll) > 0.1, 'banks into the turn');
});

test('mirroring the real sim: positions follow its animals and its drink events become gulps', () => {
  const sim = raceSim();
  const W = syntheticWorld();
  const herd = createHerd({ seed: 7 });
  herd.spawn(W.json.spawns.animals);
  assert.equal(herd.animals.length, sim.state.animals.length);
  const a = sim.state.animals[0];
  const near = W.nearestCourse(a.pos);
  sim.place(0, { x: a.pos.x - near.tangent.x * 6, z: a.pos.z - near.tangent.z * 6 });
  const modes = new Set();
  const ev = run(sim, 6, (k, s) => {
    herd.update(DT, s.state.players, s.state.events, s.state.animals);
    modes.add(herd.animals[0].mode);
    return [{ x: 0, y: -1 }];
  });
  assert.equal(sim.state.animals[0].state, 'drink');
  assert.equal(herd.animals[0].mode, 'drink');
  assert.ok(modes.has('approach'));
  const drinks = ev.filter((e) => e.kind === 'drink' && e.animal === 0).length;
  assert.ok(drinks >= 4 && herd.animals[0].sips === drinks, `${herd.animals[0].sips} gulps for ${drinks} sim sips`);
  const h = herd.animals[0], s0 = sim.state.animals[0];
  assert.ok(Math.hypot(h.x - s0.pos.x, h.z - s0.pos.z) < 0.3, 'drawn where the sim has it');
  assert.ok(Math.abs(h.y - s0.pos.y) < 0.05, "on the sim ground");
  // a boost scares it in the sim: the herd shows it fleeing
  run(sim, 0.3, (k, s) => { herd.update(DT, s.state.players, s.state.events, s.state.animals); return [{ x: 0, y: 1, boost: true }]; });
  assert.equal(herd.animals[0].mode, 'flee');
});

test('the moment an animal picks a drop it looks up at it and the "!" cue runs, then fades', () => {
  const sim = raceSim();
  const W = syntheticWorld();
  const herd = createHerd({ seed: 7 });
  herd.spawn(W.json.spawns.animals);
  const a = sim.state.animals[0], near = W.nearestCourse(a.pos);
  sim.place(0, { x: a.pos.x - near.tangent.x * 8, z: a.pos.z - near.tangent.z * 8 });
  let peak = 0, at = null, look = 0;
  run(sim, 4, (k, s) => {
    herd.update(DT, s.state.players, s.state.events, s.state.animals);
    const h = herd.animals[0];
    if (h.call > peak) { peak = h.call; at = s.state.t; }
    if (h.call > 0) look = Math.min(look, h.head);
    return [{ x: 0, y: -1 }];
  });
  assert.ok(peak > 0.95, `the cue pops (${peak.toFixed(2)})`);
  assert.equal(herd.animals[0].call, 0, 'and is gone a couple of seconds later');
  assert.ok(look < -0.2, `head up at the drop (${look.toFixed(2)})`);
  assert.ok(sim.state.t - at > RULES.callTime, 'it ran for its time');
});

test('the baked Alpine and Carpathian worlds only spawn species the renderer has, flying only the soaring birds', () => {
  for (const id of ['dolomiti', 'antelao', 'svizzera', 'carpazi']) {
    const world = JSON.parse(readFileSync(`data/worlds/${id}/world.json`, 'utf8'));
    const kinds = new Set(world.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)));
    for (const k of kinds) assert.ok(SPECIES[k], `${id}: no model for ${k}`);
    for (const [k, st] of world.stages.entries()) {
      const herd = createHerd({ seed: k });
      const list = herd.spawn(st.spawns.animals);
      assert.equal(list.length, st.spawns.animals.length);
      for (const a of list) assert.equal(a.flying, !!SPECIES[a.kind].flying, `${id} ${a.kind}`);
    }
  }
  // unknown kinds are skipped, not drawn as something else
  assert.equal(createHerd().spawn([{ kind: 'dragon', x: 0, z: 0 }]).length, 0);
});
