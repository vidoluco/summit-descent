// Sim mechanics on the synthetic world: descent, steering, mass, evaporation, ice, animals,
// collisions, boost, off-course, countdown. Run with node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, collideDrops, TUNING } from '../src/sim/index.js';
import { vmaxFor } from '../src/sim/tuning.js';
import { bilinear, createWorldAccess } from '../src/sim/world-access.js';
import { syntheticWorld, raceSim, run, courseSpot, momentum, DT } from './fixtures/sim-helpers.mjs';

const W = syntheticWorld();
const sAt = (index) => W.course.s[index];
const zone = (kind) => W.zones.find((z) => z.kind === kind);
const lateralOf = (sim, slot) => sim.track(slot).lateral;

test('bilinear sampling matches the web-swing formula, clamped at the edges', () => {
  const meta = { w: 3, h: 2, x0: 10, z0: 20, step: 4 };
  const data = new Float32Array([0, 4, 8, 2, 6, 10]);
  assert.equal(bilinear(meta, data, 10, 20), 0);
  assert.equal(bilinear(meta, data, 12, 20), 2);
  assert.equal(bilinear(meta, data, 12, 22), 3);
  assert.equal(bilinear(meta, data, 18, 24), 10);
  assert.equal(bilinear(meta, data, -100, -100), 0);
  assert.equal(bilinear(meta, data, 100, 100), 10);
  const w = createWorldAccess({ height: meta, course: [{ x: 10, y: 0, z: 20 }, { x: 18, y: 0, z: 20 }] }, data);
  assert.equal(w.heightAt(16, 22), bilinear(meta, data, 16, 22));
});

test('synthetic world follows the world.json contract', () => {
  const j = W.json;
  for (const k of ['id', 'name', 'mode', 'height', 'seaLevel', 'course', 'branches', 'checkpoints', 'zones', 'spawns', 'finish', 'backdrop']) assert.ok(k in j, k);
  const n = j.course.length;
  for (let i = 1; i < n; i++) assert.ok(j.course[i].y <= j.course[i - 1].y, `course descends at ${i}`);
  assert.ok(j.course[j.finish].y <= j.seaLevel && j.course[j.finish - 1].y > j.seaLevel);
  for (const c of j.checkpoints) assert.ok(c > 0 && c < n);
  for (const b of j.branches) assert.ok(b.from < b.to && b.to < n && b.points.length > 2);
  assert.deepEqual(j.zones.map((z) => z.kind).sort(), ['ice', 'rain', 'sun']);
  assert.equal(j.spawns.animals.length, 3);
  assert.ok(W.sFinish > 6000 && W.sFinish < 8000, `course ${W.sFinish} m`);
  let err = 0;
  for (const p of j.course) err = Math.max(err, Math.abs(W.heightAt(p.x, p.z) - p.y));
  assert.ok(err < 0.5, `bed carved under the course points (max error ${err})`);
});

test('nearestCourse reports index, t, distance and a downstream tangent', () => {
  const sp = courseSpot(W, 1234, 5);
  const r = W.nearestCourse(sp, sp.index);
  assert.ok(Math.abs(r.dist - 5) < 0.3 && Math.abs(r.lateral - 5) < 0.3);
  assert.ok(Math.abs(r.s - 1234) < 1);
  assert.ok(r.t >= 0 && r.t <= 1 && r.index === sp.index);
  const ahead = W.pointAt(0, 1254);
  const dot = r.tangent.x * (ahead.cx - sp.x) + r.tangent.z * (ahead.cz - sp.z);
  assert.ok(dot > 0, 'tangent points downstream');
  assert.ok(Math.abs(Math.hypot(r.tangent.x, r.tangent.z) - 1) < 1e-9);
  const g = W.nearestCourse(sp);
  assert.equal(g.index, r.index, 'global search agrees with the hinted one');
});

test('countdown: 3 s of snowflake melting, nobody moves, then the race starts', () => {
  const sim = createSim(W, { players: 2, seed: 1 });
  const start = sim.state.players.map((p) => ({ ...p.pos }));
  let steps = 0;
  while (sim.state.phase === 'countdown') {
    sim.step(DT, [{ x: 1, y: 1, boost: true }, { x: -1, y: 1, boost: false }]);
    steps++;
  }
  assert.ok(Math.abs(steps * DT - TUNING.countdown) < 2 * DT, `countdown lasted ${steps} steps`);
  sim.state.players.forEach((p, i) => {
    assert.equal(p.melt, 1);
    assert.ok(Math.hypot(p.pos.x - start[i].x, p.pos.z - start[i].z) < 1e-9);
  });
  const mid = createSim(W, { players: 1 });
  run(mid, 1.5);
  assert.ok(Math.abs(mid.state.players[0].melt - 0.5) < 0.02);
});

test('drop descends and gains speed downhill with no input', () => {
  const sim = raceSim();
  const p = sim.state.players[0];
  const y0 = p.pos.y;
  run(sim, 3);
  const v3 = p.speed;
  run(sim, 5);
  assert.ok(p.pos.y < y0 - 30, `dropped ${y0 - p.pos.y} m`);
  assert.ok(v3 > 12, `speed after 3 s ${v3}`);
  assert.ok(p.speed > 22 && p.speed < 45, `speed after 8 s ${p.speed}`);
  assert.ok(p.progress > 0.02 && p.dist > 120);
  assert.equal(p.status, 'rolling');
});

test('in bed is fast, off bed is slow', () => {
  const s = 4700;
  const inBed = raceSim(), offBed = raceSim();
  const a = courseSpot(W, s, 0), b = courseSpot(W, s, a.hw + 25);
  inBed.place(0, a, { vel: { x: a.tangent.x * 25, z: a.tangent.z * 25 } });
  offBed.place(0, b, { vel: { x: a.tangent.x * 25, z: a.tangent.z * 25 } });
  run(inBed, 1.5); run(offBed, 1.5);
  assert.ok(inBed.state.players[0].speed > 24, `in bed ${inBed.state.players[0].speed}`);
  assert.ok(offBed.state.players[0].speed < 12, `off bed ${offBed.state.players[0].speed}`);
});

test('steering is relative to the course tangent, not to the world', () => {
  const spots = [courseSpot(W, 1500), courseSpot(W, 3360), courseSpot(W, 4200 + 600)];
  const dirs = spots.map((s) => s.tangent);
  assert.ok(dirs[0].x * dirs[1].x + dirs[0].z * dirs[1].z < 0.6, 'the test spots face different world directions');
  for (const sp of spots) {
    for (const side of [1, -1]) {
      const sim = raceSim();
      sim.place(0, sp, { vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
      run(sim, 1, () => [{ x: side, y: 0 }]);
      const lat = lateralOf(sim, 0);
      assert.ok(lat * side > 2.5, `stick ${side} at s=${sp.index * 10}: lateral ${lat}`);
    }
    const fwd = raceSim(), back = raceSim();
    for (const s of [fwd, back]) s.place(0, sp, { vel: { x: sp.tangent.x * 15, z: sp.tangent.z * 15 } });
    run(fwd, 1, () => [{ x: 0, y: 1 }]);
    run(back, 1, () => [{ x: 0, y: -1 }]);
    assert.ok(fwd.state.players[0].speed > back.state.players[0].speed + 8, 'forward pushes, back brakes');
  }
});

test('mass sets radius by cube root and raises top speed', () => {
  const light = raceSim(), heavy = raceSim();
  const sp = courseSpot(W, 4700);
  light.place(0, sp, { mass: 1, vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
  heavy.place(0, sp, { mass: 3.5, vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
  run(light, 8, () => [{ x: 0, y: 1 }]); run(heavy, 8, () => [{ x: 0, y: 1 }]);
  const pl = light.state.players[0], ph = heavy.state.players[0];
  assert.ok(Math.abs(ph.radius / pl.radius - Math.cbrt(ph.mass / pl.mass)) < 1e-9);
  // vmaxPerMass: mass 3.5 is +2.5 m/s over mass 1, a help but not a runaway leader.
  assert.ok(ph.speed > pl.speed + 1.5 && ph.speed < pl.speed + 4, `heavy ${ph.speed} vs light ${pl.speed}`);
  assert.ok(pl.speed > 22 && ph.speed < 45, 'top speeds stay in the 22-45 m/s band');
});

test('picking up a water drop increases mass, and it comes back later', () => {
  const sim = raceSim();
  const pk = sim.state.pickups.find((k) => k.kind === 'water');
  const near = W.nearestCourse(pk.pos);
  sim.place(0, { x: pk.pos.x - near.tangent.x * 0.5, z: pk.pos.z - near.tangent.z * 0.5 }, { vel: { x: near.tangent.x * 5, z: near.tangent.z * 5 } });
  const m0 = sim.state.players[0].mass;
  const ev = run(sim, 0.2);
  const got = ev.find((e) => e.kind === 'pickup');
  assert.ok(got && got.pickup === pk.id && got.type === 'water');
  assert.ok(sim.state.players[0].mass > m0 + TUNING.pickup.water * 0.95);
  assert.equal(pk.active, false);
  run(sim, TUNING.pickup.waterRespawn + 0.5, () => [{ x: 0, y: 0 }]);
  assert.equal(sim.state.pickups.find((k) => k.id === pk.id).active, true);
});

test('mass is capped at 4', () => {
  const sim = raceSim();
  const pk = sim.state.pickups.find((k) => k.kind === 'water');
  sim.place(0, pk.pos, { mass: 3.9 });
  run(sim, 0.1);
  assert.ok(sim.state.players[0].mass <= TUNING.mass.max + 1e-9);
});

test('rain zones drop collectable rain', () => {
  const sim = raceSim();
  const rz = zone('rain');
  const sp = courseSpot(W, (rz.sFrom + rz.sTo) / 2);
  sim.place(0, sp);
  run(sim, 4, () => [{ x: 0, y: -1 }]);
  const rain = sim.state.pickups.filter((k) => k.kind === 'rain');
  assert.ok(rain.length >= 4, `${rain.length} rain drops`);
  for (const r of rain) {
    const n = W.nearestCourse(r.pos);
    assert.ok(n.s >= rz.sFrom - 1 && n.s <= rz.sTo + 1 && n.dist <= n.hw);
  }
  const target = rain[0];
  sim.place(0, target.pos);
  const ev = run(sim, 0.1);
  assert.ok(ev.some((e) => e.kind === 'pickup' && e.type === 'rain'));
});

test('evaporation is continuous, faster in the sun, and respawns at the last checkpoint or respawn mark with mass 1', () => {
  const sun = zone('sun');
  const shade = raceSim(), hot = raceSim();
  const a = courseSpot(W, sun.sFrom - 300), b = courseSpot(W, (sun.sFrom + sun.sTo) / 2);
  shade.place(0, a, { mass: 1 }); hot.place(0, b, { mass: 1 });
  run(shade, 2, () => [{ y: -1 }]); run(hot, 2, () => [{ y: -1 }]);
  const lossShade = 1 - shade.state.players[0].mass, lossSun = 1 - hot.state.players[0].mass;
  assert.ok(lossShade > 0 && lossSun > lossShade * 4, `shade ${lossShade} sun ${lossSun}`);

  const sim = raceSim();
  sim.place(0, b, { mass: 0.3 });
  const ev = run(sim, 10, () => [{ y: -1 }], (s, e) => e.some((x) => x.kind === 'respawn'));
  const p = sim.state.players[0];
  const evap = ev.find((e) => e.kind === 'evaporate');
  const resp = ev.find((e) => e.kind === 'respawn');
  assert.ok(evap && resp, 'evaporated then respawned');
  assert.ok(Math.abs(resp.t - evap.t - TUNING.respawn.delay) < 2 * DT, 'loses the respawn delay');
  assert.equal(resp.reason, 'evaporate');
  assert.equal(p.status, 'rolling');
  assert.ok(Math.abs(p.mass - 1) < 0.01);
  const cpIndex = W.checkpoints[p.checkpoint];
  const sB = W.nearestCourse(b).s;
  assert.ok(p.checkpoint >= 0 && W.course.s[cpIndex] < sB);
  // Back at the last checkpoint, or at the last respawn mark (every TUNING.respawn.every m) if that is further down.
  const sBack = Math.max(W.course.s[cpIndex], Math.floor(sB / TUNING.respawn.every) * TUNING.respawn.every);
  assert.ok(sBack <= sB && sB - sBack < Math.max(TUNING.respawn.every, sB - W.course.s[cpIndex]) + 1);
  const at = W.nearestCourse(p.pos);
  assert.ok(Math.abs(at.s - sBack) < 10 && at.dist < 10, `respawned at s=${at.s.toFixed(0)}, expected ${sBack}`);
});

test('ice: a slow drop freezes into a cube, steering stops working, boost mashing breaks it', () => {
  const ice = zone('ice');
  const sp = courseSpot(W, (ice.sFrom + ice.sTo) / 2 - 100);
  const sim = raceSim();
  sim.place(0, sp);
  // Nothing freezes in the first T.ice.startGrace s after the start signal.
  run(sim, TUNING.ice.startGrace - 0.1, () => [{ x: 0, y: -1 }]);
  assert.equal(sim.state.players[0].freeze, 0, 'no freeze right after the start');
  const ev = run(sim, 4, () => [{ x: 0, y: -1 }], (s) => s.state.players[0].status === 'frozen');
  const p = sim.state.players[0];
  assert.equal(p.status, 'frozen');
  assert.ok(ev.some((e) => e.kind === 'freeze'));
  assert.equal(p.freeze, 1);

  const lat0 = lateralOf(sim, 0);
  run(sim, 1, () => [{ x: 1, y: 0 }]);
  assert.ok(Math.abs(lateralOf(sim, 0) - lat0) < 1, 'no steering as a cube');
  assert.equal(p.status, 'frozen');

  let thaw = null;
  run(sim, 3, (k) => [{ boost: k % 6 < 3 }], (s, e) => (thaw = e.find((x) => x.kind === 'thaw')));
  assert.ok(thaw, 'boost presses break the cube');
  assert.equal(p.status, 'rolling');
  assert.equal(p.freeze, 0);

  // A fast drop crosses the whole ice zone without freezing.
  const fast = raceSim();
  const st = courseSpot(W, ice.sFrom - 20);
  fast.place(0, st, { vel: { x: st.tangent.x * 30, z: st.tangent.z * 30 } });
  const fev = run(fast, 20, () => [{ y: 1 }], (s) => s.track(0).sEq > ice.sTo + 20);
  assert.ok(!fev.some((e) => e.kind === 'freeze'));
  assert.ok(fast.track(0).sEq > ice.sTo);
});

test('ice cube needs the configured number of presses', () => {
  const ice = zone('ice');
  const sim = raceSim({ tuning: { ice: { slow: 50, startGrace: 0 } } });
  sim.place(0, courseSpot(W, (ice.sFrom + ice.sTo) / 2));
  run(sim, 0.2, () => [{ y: -1 }]);
  assert.equal(sim.state.players[0].status, 'frozen');
  let presses = 0;
  for (let k = 0; k < 200 && sim.state.players[0].status === 'frozen'; k++) {
    const down = k % 4 < 2;
    if (down && k % 4 === 0) presses++;
    sim.step(DT, [{ boost: down }]);
  }
  assert.equal(presses, TUNING.ice.presses);
});

test('animals approach and drink a slow drop, a boost interrupts them', () => {
  const sim = raceSim();
  const a = sim.state.animals[0];
  const near = W.nearestCourse(a.pos);
  sim.place(0, { x: a.pos.x - near.tangent.x * 6, z: a.pos.z - near.tangent.z * 6 });
  const m0 = sim.state.players[0].mass;
  const states = new Set();
  const ev = run(sim, 6, (k, s) => { states.add(s.state.animals[0].state); return [{ x: 0, y: -1 }]; });
  const drinks = ev.filter((e) => e.kind === 'drink' && e.slot === 0);
  assert.ok(states.has('approach'), 'it came closer');
  assert.ok(drinks.length >= 4, `${drinks.length} sips`);
  assert.equal(sim.state.animals[0].state, 'drink');
  assert.ok(sim.state.players[0].mass < m0 - drinks.length * TUNING.animal.sip * 0.9);
  assert.ok(sim.state.players[0].speed < 3, 'the drinker holds the drop');

  const ev2 = run(sim, 0.1, () => [{ x: 0, y: 1, boost: true }]);
  assert.ok(ev2.some((e) => e.kind === 'boost'));
  assert.ok(ev2.some((e) => e.kind === 'scare' && e.animal === 0));
  assert.equal(sim.state.animals[0].state, 'startled');
  const ev3 = run(sim, 3, () => [{ x: 0, y: -1 }]);
  assert.ok(!ev3.some((e) => e.kind === 'drink'), 'no more sips once scared');
});

// Drop 0 shot past animal i at twice its top speed on that stretch (tuning animal.fastFrac: a boost, a drop
// out of a chute), starting 10 m upstream in the animal's line.
function fastPass(sim, i) {
  const a = sim.state.animals[i];
  const near = W.nearestCourse(a.pos);
  const st = courseSpot(W, near.s - 10, near.lateral);
  const v = 2 * vmaxFor(TUNING, sim.state.players[0].mass, W.nearestCourse(st).grade);
  sim.place(0, st, { vel: { x: st.tangent.x * v, z: st.tangent.z * v } });
  return { a, near };
}

test('a fast pass does not get drunk and scares the animal', () => {
  const sim = raceSim();
  const { near } = fastPass(sim, 2);
  const ev = run(sim, 8, () => [{ y: 1 }], (s) => s.track(0).s > near.s + 60);
  assert.ok(!ev.some((e) => e.kind === 'drink'));
  assert.ok(ev.some((e) => e.kind === 'scare' && e.animal === 2), 'scared by the fast pass');
});

test('animals wander near home when nobody is around', () => {
  const sim = raceSim({ seed: 9 });
  const homes = sim.state.animals.map((a) => ({ ...a.pos }));
  run(sim, 20, () => [{ y: -1 }]);
  sim.state.animals.forEach((a, i) => {
    const d = Math.hypot(a.pos.x - homes[i].x, a.pos.z - homes[i].z);
    assert.ok(d > 0.5 && d < TUNING.animal.wanderRadius + 2, `${a.kind} moved ${d} m`);
    assert.equal(a.state, 'wander');
  });
});

test('collision impulse conserves momentum exactly and the heavier drop wins', () => {
  const a = { pos: { x: 0, z: 0 }, vel: { x: 30, z: 0 }, mass: 3, radius: 0.8 };
  const b = { pos: { x: 1.2, z: 0.3 }, vel: { x: 10, z: 1 }, mass: 1, radius: 0.55 };
  const p0 = momentum([a, b]);
  const va = { ...a.vel }, vb = { ...b.vel };
  collideDrops(a, b, 0.5);
  const p1 = momentum([a, b]);
  assert.ok(Math.abs(p1.x - p0.x) < 1e-9 && Math.abs(p1.z - p0.z) < 1e-9);
  const dA = Math.hypot(a.vel.x - va.x, a.vel.z - va.z), dB = Math.hypot(b.vel.x - vb.x, b.vel.z - vb.z);
  assert.ok(Math.abs(dB / dA - 3) < 1e-9, 'velocity change scales with the inverse of mass');
});

test('drop-drop collision in the sim: momentum about conserved, heavier drop wins', () => {
  const sim = raceSim({ players: 2 });
  const s = 4700;
  const back = courseSpot(W, s), front = courseSpot(W, s + 1.6);
  sim.place(0, back, { mass: 3, vel: { x: back.tangent.x * 30, z: back.tangent.z * 30 } });
  sim.place(1, front, { mass: 1, vel: { x: front.tangent.x * 10, z: front.tangent.z * 10 } });
  let before = null, bump = null;
  for (let k = 0; k < 30 && !bump; k++) {
    const ps = sim.state.players;
    before = { P: momentum(ps), va: { ...ps[0].vel }, vb: { ...ps[1].vel } };
    sim.step(DT, []);
    bump = sim.state.events.find((e) => e.kind === 'bump' && e.other >= 0);
  }
  assert.ok(bump, 'they collided');
  const [A, B] = sim.state.players;
  const P = momentum([A, B]);
  const rel = Math.hypot(P.x - before.P.x, P.z - before.P.z) / Math.hypot(before.P.x, before.P.z);
  assert.ok(rel < 0.02, `momentum drift ${rel}`);
  const dA = Math.hypot(A.vel.x - before.va.x, A.vel.z - before.va.z), dB = Math.hypot(B.vel.x - before.vb.x, B.vel.z - before.vb.z);
  assert.ok(dB > 2 * dA, `light drop pushed (${dB}) more than the heavy one (${dA})`);
  assert.ok(B.speed > A.speed - 1, 'the heavy drop shoves the light one ahead');
});

test('boost: forward kick, costs mass, 2 s cooldown', () => {
  const sim = raceSim();
  const sp = courseSpot(W, 4700);
  sim.place(0, sp, { vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
  const v0 = sim.state.players[0].speed, m0 = sim.state.players[0].mass;
  const ev = run(sim, 1.5, (k) => [{ boost: k % 10 < 5 }]);
  const boosts = ev.filter((e) => e.kind === 'boost');
  assert.equal(boosts.length, 1, 'repeated presses inside the cooldown do nothing');
  assert.ok(sim.state.players[0].boostCooldown > 0);
  assert.ok(m0 - sim.state.players[0].mass > TUNING.boost.cost * 0.95);
  const kicked = raceSim();
  kicked.place(0, sp, { vel: { x: sp.tangent.x * 20, z: sp.tangent.z * 20 } });
  run(kicked, 0.05, () => [{ boost: true }]);
  assert.ok(kicked.state.players[0].speed > v0 + TUNING.boost.impulse * 0.8);
  const ev2 = run(sim, 2.2, (k) => [{ boost: k % 10 < 5 }]);
  assert.equal(ev2.filter((e) => e.kind === 'boost').length, 1, 'available again after the cooldown');
});

test('boosting into the other drop steals mass', () => {
  const sim = raceSim({ players: 2 });
  const s = 4700;
  const back = courseSpot(W, s), front = courseSpot(W, s + 3);
  sim.place(0, back, { mass: 1.5, vel: { x: back.tangent.x * 20, z: back.tangent.z * 20 } });
  sim.place(1, front, { mass: 1.5, vel: { x: front.tangent.x * 20, z: front.tangent.z * 20 } });
  const before = sim.state.players.map((p) => p.mass);
  const ev = run(sim, 1, () => [{ boost: true }, {}], (s, e) => e.some((x) => x.kind === 'steal'));
  const steal = ev.find((e) => e.kind === 'steal');
  assert.ok(steal, 'stole on impact');
  assert.equal(steal.slot, 0); assert.equal(steal.from, 1);
  const [A, B] = sim.state.players;
  assert.ok(Math.abs(before[1] - B.mass - steal.amount) < 0.01, 'victim lost the stolen mass');
  assert.ok(Math.abs(A.mass - (before[0] - TUNING.boost.cost + steal.amount)) < 0.01, 'thief gained it');
  assert.ok(steal.amount > 0.2);
  const again = run(sim, 0.5, () => [{ boost: true }, {}]);
  assert.ok(!again.some((e) => e.kind === 'steal'), 'one steal per boost');
});

test('off course for 3 s respawns at the last checkpoint', () => {
  const sim = raceSim();
  const sp = courseSpot(W, sAt(W.checkpoints[0]) + 300);
  const far = courseSpot(W, sAt(W.checkpoints[0]) + 300, sp.hw + 90);
  sim.place(0, far);
  assert.ok(sim.track(0).dist > sim.track(0).hw + TUNING.respawn.offCourseMargin);
  const ev = run(sim, 5, () => [{}], (s, e) => e.some((x) => x.kind === 'respawn'));
  const r = ev.find((e) => e.kind === 'respawn');
  assert.ok(r && r.reason === 'offcourse');
  assert.ok(Math.abs(r.t - sim.state.t) < 1e-9 && r.t > TUNING.respawn.offCourseTime - 0.1 + TUNING.countdown);
  const p = sim.state.players[0];
  assert.equal(p.checkpoint, 0);
  const cp = W.course.pts[W.checkpoints[0]];
  assert.ok(Math.hypot(p.pos.x - cp.x, p.pos.z - cp.z) < 10);
  assert.ok(sim.track(0).dist < 5);
});

test('a disconnected pad lets the drop slow down and stop', () => {
  const sim = raceSim();
  const sp = courseSpot(W, 2000);
  sim.place(0, sp, { vel: { x: sp.tangent.x * 25, z: sp.tangent.z * 25 } });
  run(sim, 3, () => [{ connected: false }]);
  const p = sim.state.players[0];
  assert.equal(p.connected, false);
  assert.ok(p.speed < 1.5, `speed ${p.speed}`);
  run(sim, 2, () => [{ y: 1 }]);
  assert.ok(p.speed > 10, 'resumes on reconnect');
});

test('state shape follows the contract', () => {
  const sim = createSim(W, { mode: 'race', players: 2, seed: 4 });
  const s = sim.state;
  for (const k of ['t', 'phase', 'players', 'pickups', 'animals', 'events']) assert.ok(k in s, k);
  for (const p of s.players) for (const k of ['pos', 'vel', 'mass', 'radius', 'status', 'progress', 'lap', 'checkpoint', 'place', 'freeze', 'boostCooldown']) assert.ok(k in p, k);
  assert.throws(() => createSim(W, { mode: 'coop' }));
  sim.step(DT, []);
  assert.ok(Array.isArray(s.events));
  assert.doesNotThrow(() => createSim({ json: W.json, height: (x, z) => W.heightAt(x, z) }, { players: 1 }));
});

// Regressions found in review.

test('every event names a slot, scares included', () => {
  const sim = raceSim();
  const { a, near } = fastPass(sim, 2);
  const ev = run(sim, 8, () => [{ y: 1 }], (s) => s.track(0).s > near.s + 60);
  const scare = ev.find((e) => e.kind === 'scare');
  assert.ok(scare, 'scared');
  assert.equal(scare.slot, 0);
  assert.equal(scare.animalKind, a.kind);
  for (const e of ev) assert.ok(Number.isInteger(e.slot), `${e.kind} has a slot`);
});

test('animals do not drink during the countdown', () => {
  const j = structuredClone(W.json);
  // the first drop starts by the bed edge with a marmot on the bank beside it (animals wade in only a few meters)
  const near = W.nearestCourse(j.spawns.start[0]), side = Math.sign(near.lateral || 1);
  const edge = courseSpot(W, near.s, side * (near.hw - 1.5)), bank = courseSpot(W, near.s, side * (near.hw + 1));
  j.spawns.start[0] = { x: edge.x, y: W.heightAt(edge.x, edge.z), z: edge.z };
  j.spawns.animals = [{ kind: 'marmot', x: bank.x, y: W.heightAt(bank.x, bank.z), z: bank.z }];
  const sim = createSim(createWorldAccess(j, (x, z) => W.heightAt(x, z)), { players: 2, seed: 1 });
  const ev = [];
  while (sim.state.phase === 'countdown') { sim.step(DT, []); ev.push(...sim.state.events); }
  assert.ok(!ev.some((e) => e.kind === 'drink'));
  sim.state.players.forEach((p) => assert.equal(p.mass, TUNING.mass.start));
  assert.equal(sim.state.animals[0].target, -1);
  // Once the race is on, a drop that stays put is fair game.
  const later = run(sim, 4, () => [{ y: -1 }, { y: -1 }]);
  assert.ok(later.some((e) => e.kind === 'drink'));
});

test('a drop whose pad disconnected is not drunk away', () => {
  const sim = raceSim();
  const a = sim.state.animals[0];
  sim.place(0, { x: a.pos.x + 3, z: a.pos.z });
  const ev = run(sim, 20, () => [{ connected: false }]);
  assert.ok(!ev.some((e) => e.kind === 'drink' || e.kind === 'evaporate'));
  assert.equal(sim.state.players[0].status, 'rolling');
  assert.notEqual(sim.state.animals[0].target, 0);
});

test('world access takes height.bin as fetched and rejects a whole stages world', () => {
  const j = W.json;
  const n = j.height.w * j.height.h;
  const buf = new ArrayBuffer(n * 4), dv = new DataView(buf);
  for (let i = 0; i < n; i++) dv.setFloat32(i * 4, (i % 97) * 0.5, true);
  const fromBuf = createWorldAccess(j, buf), fromArr = createWorldAccess(j, new Float32Array(buf));
  const fromNodeBuf = createWorldAccess(j, Buffer.from(buf));
  for (const [x, z] of [[100, 50], [-3, 7.5], [1234.5, 321]]) {
    assert.equal(fromBuf.heightAt(x, z), fromArr.heightAt(x, z));
    assert.equal(fromNodeBuf.heightAt(x, z), fromArr.heightAt(x, z));
  }
  assert.throws(() => createSim({ json: { id: 'x', stages: [j] }, height: buf }), /stages/);
});

test('the synthetic world fixture loads quietly under node --test', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const file = fileURLToPath(new URL('./fixtures/synthetic-world.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--test', file], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('a finished drop stays on the ground of a stage below 0, and null inputs are accepted', () => {
  const w = 50, h = 400, step = 4;
  const height = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) height[j * w + i] = -j * step * 0.2 + Math.abs(i - 25) * 0.5;
  const course = [];
  for (let k = 0; k < 150; k++) course.push({ x: 100, y: -k * 2, z: k * 10 + 10, hw: 10 });
  const sim = createSim({ json: { id: 'stage', height: { w, h, x0: 0, z0: 0, step }, course }, height }, { players: 2 });
  assert.doesNotThrow(() => sim.step(DT, null));
  const p = sim.state.players[0];
  for (let k = 0; k < 120 / DT && p.status !== 'finished'; k++) sim.step(DT, [{ y: 1 }, { connected: false }]);
  assert.equal(p.status, 'finished');
  run(sim, 1, () => [{}, { connected: false }]);
  assert.equal(sim.state.phase, 'race', 'still in the grace');
  const ground = sim.world.heightAt(p.pos.x, p.pos.z);
  assert.ok(ground < -250 && Math.abs(p.pos.y - ground) < 1, `y ${p.pos.y} on ground ${ground}`);
});

// A straight stage along +x on the ground h(x, z), the drop alone on it: a launch or a landing without the rest.
function lineSim(h) {
  const course = [];
  for (let x = 0; x <= 1500; x += 10) course.push({ x, y: h(x, 0), z: 0, hw: 14 });
  const json = { id: 'line', height: { w: 401, h: 61, x0: -50, z0: -120, step: 4 }, seaLevel: -1e5, course, branches: [], checkpoints: [30, 60, 90],
    zones: [], spawns: { start: [{ x: 5, y: h(5, 0), z: 0 }], water: [], animals: [], obstacles: [] }, finish: course.length - 1 };
  const sim = createSim(createWorldAccess(json, h), { players: 1, seed: 1 });
  while (sim.state.phase === 'countdown') sim.step(DT, []);
  return sim;
}

test('a drop landing on a steep face stays on it: it lands following the slope, not level', () => {
  const h = (x) => 2000 - 0.98 * x, sim = lineSim(h), p = sim.state.players[0];
  p.status = 'airborne'; p.pos = { x: 100, y: h(100) + p.radius + 1, z: 0 }; p.vel = { x: 30, y: -32, z: 0 };
  let k = 0;
  for (; k < 60 && p.status === 'airborne'; k++) sim.step(DT, [{}]);
  assert.equal(p.status, 'rolling', 'landed');
  assert.ok(p.vel.y < -20, `vy ${p.vel.y.toFixed(1)}: down the slope`);
  for (let i = 0; i < 120; i++) { sim.step(DT, [{}]); assert.equal(p.status, 'rolling', `relaunched ${i} steps after landing`); }
});

test('a drop rolling off a cliff edge still goes airborne', () => {
  const h = (x) => (x < 300 ? 2000 - 0.05 * x : 1985 - 3 * (x - 300)), sim = lineSim(h), p = sim.state.players[0];
  p.pos = { x: 200, y: h(200) + p.radius, z: 0 }; p.vel = { x: 30, y: -1.5, z: 0 };
  const seen = [];
  for (let i = 0; i < 240 && !seen.includes('airborne'); i++) { sim.step(DT, [{}]); if (p.pos.x > 290) seen.push(p.status); }
  assert.ok(seen.includes('airborne'), 'off the lip');
  assert.ok(p.pos.x < 320, `launched at the lip, at x ${p.pos.x.toFixed(0)}`);
});
