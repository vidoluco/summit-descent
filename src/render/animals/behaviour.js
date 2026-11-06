// What every animal does from frame to frame, as plain numbers (no three.js): where it stands, where it
// faces, how it leans, and the motion parameters the vertex shader animates (gait, head, wings, tail).
//
// Two ways to drive it. With the sim's animals (sim.state.animals, same order as spawns.animals) the sim
// owns position, heading and state (wander, approach, drink, startled), so what the players see matches
// who is really drinking; the herd smooths them and adds the reactions the sim does not model (alert on a
// splash or a bump close by, the gulp on each 'drink' event, looking around, grazing). Without them (the
// lineup, a menu backdrop) the herd runs its own copy of the same rules against the drops it is given.
// The golden eagle never drinks: it circles above its spawn point either way.
// The moment an animal picks a drop it looks up at it and `call` runs from 1 down to 0 over RULES.callTime s:
// index.js pops a "!" over its head for that time, so the players learn that stopping by an animal draws it.
import { SPECIES } from './registry.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const follow = (k, dt) => 1 - Math.exp(-k * dt);
const angleTo = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// The sim's animal rules (src/sim/tuning.js animal), used when the herd drives itself. The sim's slow and
// fast are fractions of a racing drop's top speed; the herd's own drops (a lineup, a menu) have none, so
// here they stay plain m/s, and the sim's call of a stopped drop from further off is left out.
export const RULES = {
  sense: 12, slowSpeed: 9, fastSpeed: 16, scareRadius: 6, wanderRadius: 15, leash: 40, reach: 2.5,
  fleeTime: 4, alertRadius: 14, alertTime: 1.6, sipInterval: 0.6, callTime: 1.8,
};

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const dropPos = (d) => d.pos || d;
const dropSpeed = (d) => d.speed ?? (d.vel ? Math.hypot(d.vel.x, d.vel.z) : 0);
const dropActive = (d) => !d.status || d.status === 'rolling';

// opts: { ground(x, z) -> y, seed, rules }
export function createHerd({ ground = null, seed = 1, rules = RULES } = {}) {
  const R = { ...RULES, ...rules };
  const animals = [];
  const rand = rng(seed * 2654435761);
  const range = (a, b) => a + (b - a) * rand();
  const groundY = (a, x, z) => (ground ? ground(x, z) : a.home.y);

  // list: world spawns.animals ({kind, x, y, z, flying?}) or {species, x, z, radius}
  function spawn(list) {
    animals.length = 0;
    for (const [i, s] of (list || []).entries()) {
      const kind = s.kind || s.species, spec = SPECIES[kind];
      if (!spec) continue;
      const M = spec.motion || {};
      const home = { x: s.x, y: s.y ?? (ground ? ground(s.x, s.z) : 0), z: s.z };
      const a = {
        index: i, kind, flying: !!(spec.flying || s.flying), radius: s.radius ?? R.sense, home,
        x: s.x, y: home.y, z: s.z, heading: range(0, TAU), speed: 0,
        mode: spec.flying ? 'soar' : 'idle', timer: range(1, 4), goal: { x: s.x, z: s.z }, target: -1, threat: null,
        phase: range(0, TAU), gait: 0, head: 0, headYaw: 0, lookAt: 0, flap: 0, tail: 0, pitch: 0, roll: 0, bob: 0,
        stretch: 0, gulp: 0, sips: 0, alert: 0, sip: 0, call: 0, M,
      };
      if (a.flying) {
        a.circle = range(...(M.circle || [35, 45])); a.alt = range(...(M.height || [30, 40]));
        a.dir = rand() < 0.5 ? -1 : 1; a.angle = range(0, TAU); a.flapT = range(...(M.flapEvery || [3, 6]));
        a.y = groundY(a, s.x, s.z) + a.alt;
      }
      animals.push(a);
    }
    return animals;
  }

  function moveToward(a, tx, tz, speed, dt) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, speed * dt);
    if (step > 1e-4) { a.x += (dx / d) * step; a.z += (dz / d) * step; turn(a, Math.atan2(dx, dz), dt, 6); }
    a.speed = step / dt;
    return d;
  }
  const turn = (a, h, dt, k) => { a.heading += angleTo(a.heading, h) * follow(k, dt); };

  // The herd's own copy of the sim rules.
  function think(a, dt, drops) {
    const M = a.M;
    a.timer -= dt;
    const near = drops.map((d, slot) => ({ d, slot, p: dropPos(d), v: dropSpeed(d) }))
      .filter((o) => dropActive(o.d))
      .map((o) => ({ ...o, dist: Math.hypot(o.p.x - a.x, o.p.z - a.z) }));
    if (a.mode !== 'flee') {
      const fast = near.find((o) => o.v > R.fastSpeed && (o.dist < R.scareRadius || (a.target === o.slot && o.dist < a.radius)));
      if (fast) { startle(a, fast.p); return; }
    }
    const homeD = Math.hypot(a.x - a.home.x, a.z - a.home.z);
    switch (a.mode) {
      case 'flee': {
        const t = a.threat, dx = a.x - t.x, dz = a.z - t.z, d = Math.hypot(dx, dz) || 1;
        moveToward(a, a.x + (dx / d) * 5, a.z + (dz / d) * 5, homeD > R.leash ? 0 : M.run || 5, dt);
        if (a.timer <= 0) { a.mode = 'wander'; a.goal = { x: a.home.x, z: a.home.z }; a.timer = 30; }
        return;
      }
      case 'approach': case 'drink': {
        const o = near.find((n) => n.slot === a.target);
        if (!o || o.dist > a.radius * 1.5 || homeD > R.leash) { a.mode = 'idle'; a.target = -1; a.timer = 2; return; }
        const reach = (o.d.radius || 0.6) + R.reach;
        if (a.mode === 'approach') {
          moveToward(a, o.p.x, o.p.z, (M.run || 4) * 0.6, dt);
          if (o.dist < reach) { a.mode = 'drink'; a.sip = R.sipInterval * 0.5; }
        } else {
          const keep = reach * 0.7, k = keep / (o.dist || 1);
          moveToward(a, o.p.x - (o.p.x - a.x) * k, o.p.z - (o.p.z - a.z) * k, Math.max((M.run || 4) * 0.6, o.v * 1.2), dt);
          turn(a, Math.atan2(o.p.x - a.x, o.p.z - a.z), dt, 8);
          a.sip -= dt;
          if (a.sip <= 0) { a.sip = R.sipInterval; a.gulp = 1; a.sips++; }
        }
        return;
      }
      default: {
        // idle or wander, and a slow drop in range draws it in (one animal per drop)
        const slow = near.filter((o) => o.v < R.slowSpeed && o.dist < a.radius && !animals.some((b) => b !== a && b.target === o.slot))
          .sort((p, q) => p.dist - q.dist)[0];
        if (slow) { a.mode = 'approach'; a.target = slow.slot; noticed(a, slow.p); return; }
        if (a.mode === 'wander') {
          const far = homeD > R.wanderRadius; // trotting back home after a scare
          const d = moveToward(a, a.goal.x, a.goal.z, far ? Math.max(M.walk || 1, (M.run || 4) * 0.4) : M.walk || 1, dt);
          if (d < 0.4 || a.timer <= 0) { a.mode = 'idle'; a.timer = range(1.5, 5); }
        } else {
          a.speed = 0;
          if (a.timer <= 0) {
            const ang = range(0, TAU), r = range(0, R.wanderRadius);
            a.goal = { x: a.home.x + Math.cos(ang) * r, z: a.home.z + Math.sin(ang) * r };
            a.mode = 'wander'; a.timer = range(3, 8);
          }
        }
      }
    }
  }

  // It has picked a drop: head up and toward it, and the "!" (call) over its head.
  function noticed(a, at) {
    a.call = 1;
    if (!at) return;
    a.alert = R.alertTime * 0.6; a.alertYaw = clamp(angleTo(a.heading, Math.atan2(at.x - a.x, at.z - a.z)) / 1.2, -1, 1);
  }

  function startle(a, from) {
    if (a.flying) return;
    a.mode = 'flee'; a.target = -1; a.timer = R.fleeTime; a.threat = { x: from.x, z: from.z };
  }

  // Follow the sim's animal i: smoothed position and heading, state mapped onto the herd's modes.
  function mirror(a, s, dt, drops) {
    const k = follow(14, dt), px = a.x, pz = a.z;
    a.x += (s.pos.x - a.x) * k; a.z += (s.pos.z - a.z) * k; a.y = s.pos.y;
    const moved = Math.hypot(a.x - px, a.z - pz) / dt;
    a.speed = s.speed ?? moved;
    if (a.speed > 0.05) turn(a, s.heading, dt, 10);
    const prev = a.mode;
    a.mode = s.state === 'startled' ? 'flee' : s.state === 'drink' ? 'drink' : s.state === 'approach' ? 'approach' : a.speed > 0.1 ? 'wander' : 'idle';
    a.target = s.target ?? -1;
    if (a.mode === 'approach' && prev !== 'approach' && prev !== 'drink') noticed(a, drops[a.target] && dropPos(drops[a.target]));
    if (a.mode === 'idle' && prev !== 'idle') a.timer = range(1.5, 4);
  }

  function soar(a, dt) {
    const M = a.M, v = M.glide || 12;
    a.angle += (a.dir * v * dt) / a.circle;
    const tx = a.home.x + Math.cos(a.angle) * a.circle, tz = a.home.z + Math.sin(a.angle) * a.circle;
    a.x = tx; a.z = tz;
    a.heading = Math.atan2(-Math.sin(a.angle) * a.dir, Math.cos(a.angle) * a.dir);
    const gy = groundY(a, tx, tz) + a.alt + Math.sin(a.angle * 2) * 2;
    a.y += (gy - a.y) * follow(1.5, dt);
    a.roll = -a.dir * 0.32; a.speed = v;
    a.flapT -= dt;
    if (a.flapT <= 0) { a.flapping = 1.6; a.flapT = range(...(M.flapEvery || [3, 6])); }
    if (a.flapping > 0) { a.flapping -= dt; a.phase += dt * 6.5; a.flap = Math.sin(a.phase) * 0.9 * clamp(a.flapping * 2, 0, 1); }
    else a.flap += (0.12 - a.flap) * follow(3, dt); // a slight dihedral when gliding
    a.headYaw = Math.sin(a.angle * 3) * 0.4;
  }

  // Motion parameters from what it is doing.
  function animate(a, dt) {
    const M = a.M;
    const run = M.run || 4, gaitT = clamp(a.speed / run, 0, 1) + (a.speed > 0.05 ? 0.25 : 0);
    a.gait += (Math.min(1, gaitT) - a.gait) * follow(8, dt);
    a.phase += (a.speed / (M.stride || 0.5)) * Math.PI * dt;
    const hop = M.gait === 'hop';
    a.bob = hop ? Math.abs(Math.sin(a.phase)) * (M.hop || 0.05) * clamp(a.speed / (M.walk || 1), 0, 1.6) : Math.abs(Math.sin(a.phase)) * 0.012 * a.gait;
    // head: down to drink or graze, up and toward the trouble when alert, looking around when idle
    let head = 0, yaw = 0;
    if (a.mode === 'drink') head = 1 - 0.35 * Math.sin(Math.min(1, a.gulp) * Math.PI);
    else if (a.mode === 'approach') head = 0.25;
    else if (a.mode === 'idle') {
      a.lookT = (a.lookT ?? 0) - dt;
      if (a.lookT <= 0) { a.lookAt = (rand() * 2 - 1) * 0.9; a.grazing = M.graze && rand() < M.graze * 0.6; a.lookT = range(1.2, 3.5); }
      yaw = a.lookAt; head = a.grazing ? 0.75 : 0;
    }
    if (a.alert > 0) { head = -0.45; yaw = a.alertYaw; }
    a.head += (head - a.head) * follow(5, dt);
    a.headYaw += (clamp(yaw, -1, 1) - a.headYaw) * follow(4, dt);
    a.gulp = Math.max(0, a.gulp - dt * 2.5);
    // body: a marmot runs on all fours (leans forward), stands tall when alert
    const running = a.mode === 'drink' ? 0 : clamp(a.speed / (M.walk || 1) - 0.3, 0, 1);
    a.pitch += ((M.runPitch || 0) * running - a.pitch) * follow(6, dt);
    a.stretch += ((a.alert > 0 ? M.alertStretch || 0 : 0) - a.stretch) * follow(6, dt);
    a.tail = Math.sin(a.phase * 1.3 + a.index) * (0.3 + 0.7 * a.gait) + (a.alert > 0 ? Math.sin(performanceTime * 18) * 0.8 : 0);
    a.alert = Math.max(0, a.alert - dt);
    a.call = Math.max(0, a.call - dt / R.callTime);
  }
  let performanceTime = 0;

  // events: the sim's step events. 'drink' -> gulp, 'scare' -> flee, 'splash' and 'bump' close by -> alert,
  // or flee when very close.
  function react(events) {
    for (const e of events || []) {
      if (e.kind === 'drink' || e.kind === 'scare') {
        const a = animals.find((b) => b.index === e.animal);
        if (!a || a.flying) continue;
        if (e.kind === 'drink') { a.gulp = 1; a.sips++; if (a.mode !== 'drink' && !a.mirrored) a.mode = 'drink'; }
        else startle(a, e);
        continue;
      }
      if (e.kind !== 'splash' && e.kind !== 'bump') continue;
      for (const a of animals) {
        if (a.flying || a.mode === 'flee') continue;
        const d = Math.hypot(e.x - a.x, e.z - a.z), r = R.alertRadius * (e.kind === 'splash' ? 1 : 0.7);
        if (d > r) continue;
        if (d < r * 0.35 && !a.mirrored) { startle(a, e); continue; }
        a.alert = R.alertTime; a.alertYaw = clamp(angleTo(a.heading, Math.atan2(e.x - a.x, e.z - a.z)) / 1.2, -1, 1);
      }
    }
  }

  // drops: the sim's players (or {pos, speed, radius}); simAnimals: sim.state.animals, optional.
  function update(dt, drops = [], events = [], simAnimals = null) {
    performanceTime += dt;
    react(events);
    for (const a of animals) {
      if (a.flying) { soar(a, dt); continue; }
      const s = simAnimals && simAnimals[a.index];
      a.mirrored = !!s;
      if (s) mirror(a, s, dt, drops);
      else { think(a, dt, drops); a.y = groundY(a, a.x, a.z); }
      animate(a, dt);
    }
    return animals;
  }

  return { animals, spawn, update };
}
