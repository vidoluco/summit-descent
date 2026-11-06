// Summit Descent race simulation (spec "Contratto 3"). Pure math, deterministic for a given seed and input
// sequence, no three.js. createSim(world, {mode, players, seed, tuning}) -> sim with
// sim.step(dt, inputs) and sim.state. See src/sim/tuning.js for every constant and its unit.
// Short mode plays one stage at a time: create the next stage's sim with
// {final: isLastStage, carry: previousSim.carry()} so mass, race clock and the gap between drops
// carry over. Only the final stage starts the 30 s grace and marks DNFs.
import { TUNING, mergeTuning, vmaxFor, catchupFor, radiusFor } from './tuning.js';
import { createRng } from './rng.js';
import { createWorldAccess, nearestOnPath } from './world-access.js';

export { TUNING, createWorldAccess };

const RACING = new Set(['rolling', 'airborne', 'frozen']);
const frozenStatus = (p) => p.status === 'frozen';
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Accepts a world access object, {json, height, backdrop}, or a parsed world.json with heightAt().
function toWorld(world) {
  if (world && typeof world.nearestCourse === 'function' && world.paths) return world;
  const j = world?.json ?? world;
  if (j && Array.isArray(j.stages) && !j.course) throw new Error('createSim: world.json has stages, pass one stage (its json and height grid)');
  if (world && world.json && (world.height || world.heightAt)) return createWorldAccess(world.json, world.height ?? world.heightAt, world.backdrop ?? world.backdropAt);
  if (world && world.course && typeof world.heightAt === 'function') return createWorldAccess(world, world.heightAt, world.backdropAt);
  throw new Error('createSim: world must be a world access object, {json, height} or world.json with heightAt()');
}

export function stateHash(state) {
  const s = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Elastic-ish impulse between two bodies on the horizontal plane. Conserves m*v exactly.
export function collideDrops(a, b, e) {
  let nx = b.pos.x - a.pos.x, nz = b.pos.z - a.pos.z;
  let d = Math.hypot(nx, nz);
  if (d < 1e-6) { nx = 1; nz = 0; d = 1e-6; } else { nx /= d; nz /= d; }
  const overlap = a.radius + b.radius - d;
  const ma = a.mass, mb = b.mass, sum = ma + mb;
  if (overlap > 0) {
    a.pos.x -= nx * overlap * (mb / sum); a.pos.z -= nz * overlap * (mb / sum);
    b.pos.x += nx * overlap * (ma / sum); b.pos.z += nz * overlap * (ma / sum);
  }
  const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
  if (rel >= 0) return 0;
  const j = (-(1 + e) * rel) / (1 / ma + 1 / mb);
  a.vel.x -= (j / ma) * nx; a.vel.z -= (j / ma) * nz;
  b.vel.x += (j / mb) * nx; b.vel.z += (j / mb) * nz;
  return -rel;
}

export function createSim(worldIn, { mode = 'race', players = 2, seed = 1, tuning, final = true, carry = null } = {}) {
  if (mode !== 'race') throw new Error(`createSim: unsupported mode ${mode}`);
  const W = toWorld(worldIn);
  const T = mergeTuning(TUNING, tuning);
  const G = T.gravity;
  const rng = createRng(seed);
  const spawns = W.json.spawns || {};
  const course = W.course;
  // A finished drop floats on the sea only when the world (or stage) declares one: stage heights are
  // local and can sit far below 0.
  const sea = Number.isFinite(W.json.seaLevel) ? W.json.seaLevel : -Infinity;

  const raceStart = carry ? carry.raceStart : T.countdown; // state.t of the start signal
  const state = {
    t: carry ? carry.t : 0,
    phase: carry ? 'race' : 'countdown',
    countdown: carry ? 0 : T.countdown, // s left before the start
    grace: null, // s left for the others once someone finished (final stage only)
    stage: carry ? carry.stage : 0, // stages already played before this one
    final: !!final, // the finish of this stage ends the race
    players: [],
    pickups: [],
    animals: [],
    events: [],
  };
  const priv = [];
  let nextPickupId = 0;
  let finishedCount = 0;
  const emit = (ev) => state.events.push(ev);

  const startPos = (slot) => {
    const st = spawns.start?.[slot];
    if (st) return { x: st.x, z: st.z };
    const q = W.pointAt(0, Math.min(10, course.length));
    const off = (slot - (players - 1) / 2) * T.respawn.spacing;
    return { x: q.cx - q.tangent.z * off, z: q.cz + q.tangent.x * off };
  };

  for (let slot = 0; slot < players; slot++) {
    const sp = startPos(slot);
    const c = carry?.players?.[slot];
    const cm = c && Number.isFinite(c.mass) ? c.mass : T.mass.start;
    const mass = cm < T.mass.evaporate ? T.mass.respawn : Math.min(cm, T.mass.max), radius = radiusFor(T, mass);
    state.players.push({
      slot,
      pos: { x: sp.x, y: W.heightAt(sp.x, sp.z) + radius, z: sp.z },
      vel: { x: 0, y: 0, z: 0 },
      speed: 0,
      mass,
      radius,
      status: c ? 'evaporated' : 'rolling', // a carried drop waits in the cloud, then rains in
      progress: 0, // 0..1 of the way to the finish (main course equivalent)
      dist: 0, // m along the course (main course equivalent)
      lap: state.stage, // index of the stage being played
      checkpoint: -1, // index into world.checkpoints of the last one passed, -1 = start
      place: slot + 1, // live rank, final once finished
      freeze: 0, // 0..1, a cube at 1
      cracks: 0, // boost presses on the current ice cube
      boostCooldown: 0, // s
      boost: 0, // s of active boost left
      melt: carry ? 1 : 0, // 0 snowflake .. 1 drop, during the countdown
      branch: -1, // index into world.branches while on one
      offCourse: 0, // s spent far from the course
      connected: true,
      finishTime: null, // s from the start signal
    });
    priv.push({ pathId: 0, hint: W.paths.map(() => undefined), track: null, sEq: 0, zones: null, bed: 1,
      alt: null, forkChoice: 0, flow: { x: 1, z: 0 }, prevBoost: false, airTime: 0, iceImmune: 0, stole: false, drunk: false, startIndex: 0,
      reached: 0, catchup: 0, // furthest main-course-equivalent s reached in this stage; m/s of rubber band
      vmax: null, // m/s, top speed on its stretch and in its lane at the last rolling step (no rubber band, no boost)
      onBank: false, // touching the bank past the bed edge (a hit counts once per contact)
      boostPower: 1, // 0..1 strength of the current boost (its mass at the press)
      respawnTimer: c ? Math.max(0, +c.delay || 0) : 0, respawnReason: c ? 'rain' : 'evaporate', order: c?.place ?? slot + 1 });
  }
  for (let slot = 0; slot < players; slot++) {
    track(slot, true);
    priv[slot].startIndex = priv[slot].pathId === 0 ? priv[slot].track.index : 0;
    priv[slot].reached = course.s[priv[slot].startIndex];
  }

  for (const w of spawns.water || []) {
    state.pickups.push({ id: nextPickupId++, kind: 'water', pos: { x: w.x, y: W.heightAt(w.x, w.z) + 0.5, z: w.z }, active: true, t0: 0, respawnAt: null });
  }
  const rainZones = W.zones.filter((z) => z.kind === 'rain').map((z) => ({ ...z, timer: 0 }));

  (spawns.animals || []).forEach((a, i) => {
    state.animals.push({ id: i, kind: a.kind, pos: { x: a.x, y: W.heightAt(a.x, a.z), z: a.z }, heading: 0, state: 'wander', target: -1, speed: 0 });
  });
  // side: the bank of the main course it lives on (+1 right, -1 left). A flying one (the eagle) never drinks.
  const animalPriv = state.animals.map((a, i) => {
    const near = W.nearestCourse(a.pos);
    return { home: { x: a.pos.x, z: a.pos.z }, goal: { x: a.pos.x, z: a.pos.z }, timer: 0, sip: 0, flee: null,
      flying: !!spawns.animals[i].flying, side: near.lateral < 0 ? -1 : 1, hint: near.index };
  });
  const rocks = (spawns.obstacles || []).map((o) => ({ x: o.x, y: o.y ?? W.heightAt(o.x, o.z), z: o.z, r: o.r ?? 2 }));

  // Nearest point on the path the drop is following, with branch switching by proximity.
  function track(slot, full = false) {
    const p = state.players[slot], q = priv[slot];
    let best, bestId, alt = null;
    const globalSearch = () => {
      best = null;
      for (let id = 0; id < W.paths.length; id++) {
        const r = nearestOnPath(W.paths[id], p.pos.x, p.pos.z);
        if (!best || r.dist < best.dist - (id ? 0.5 : 0)) { best = r; bestId = id; }
      }
    };
    if (full) globalSearch();
    else {
      best = W.nearestPath(q.pathId, p.pos, q.hint[q.pathId]);
      bestId = q.pathId;
      if (q.pathId === 0) {
        const main = best;
        for (const b of W.branches) {
          if (main.index < b.from - 3 || main.index > b.from + 15) continue;
          const r = W.nearestPath(b.id, p.pos, 0, 16);
          // Overlapping beds near a fork: only the steering choice, or leaving the main bed, switches.
          const chosen = q.forkChoice === b.id || main.dist > main.hw;
          if (chosen && r.dist + 0.5 < best.dist) { best = r; bestId = b.id; }
          else if (r.dist < r.hw + 10) { alt = r; alt.pathId = b.id; }
        }
      } else {
        const b = W.branches[q.pathId - 1];
        const n = b.path.n;
        if (best.index <= 12 || best.index >= n - 14) {
          const m = W.nearestPath(0, p.pos, best.index <= 12 ? b.from : b.to, 14);
          const atEnd = best.index === n - 2 && best.t >= 1;
          const leaving = best.index >= n - 14 || best.dist > best.hw;
          if (atEnd || (leaving && m.dist + 0.5 < best.dist)) { best = m; bestId = 0; }
        }
      }
      if (best.dist > best.hw + 80) globalSearch();
    }
    q.pathId = bestId;
    q.hint[bestId] = best.index;
    q.track = best;
    q.alt = alt;
    q.flow = best.tangent;
    q.sEq = W.equivalentS(bestId, best.s);
    q.zones = W.zonesAt(q.sEq);
    // A safe branch runs in the shade of its gorge: no sun evaporation on it.
    if (bestId && W.branches[bestId - 1].kind === 'safe') q.zones.sun = false;
    q.bed = clamp((best.hw + T.bed.edge - best.dist) / T.bed.edge, 0, 1);
    p.branch = bestId ? bestId - 1 : -1;
  }

  function respawn(slot, reason) {
    const p = state.players[slot], q = priv[slot];
    let ci, cp, x, z;
    if (reason === 'rain') {
      const sp = startPos(slot);
      cp = W.nearestCourse(sp); ci = cp.index; x = sp.x; z = sp.z;
    } else {
      // The last checkpoint passed, or the last respawn mark (every T.respawn.every m) if that is further down.
      const sCp = course.s[p.checkpoint >= 0 ? W.checkpoints[p.checkpoint] : q.startIndex];
      const sMark = Math.floor(q.reached / T.respawn.every) * T.respawn.every;
      const sAt = Math.min(Math.max(sCp, sMark), W.sFinish);
      cp = W.pointAt(0, sAt); ci = cp.index;
      const off = (slot - (players - 1) / 2) * T.respawn.spacing;
      x = cp.cx - cp.tangent.z * off; z = cp.cz + cp.tangent.x * off;
    }
    if (reason === 'evaporate') p.mass = T.mass.respawn;
    p.radius = radiusFor(T, p.mass);
    p.pos = { x, y: W.heightAt(x, z) + p.radius, z };
    p.vel = { x: cp.tangent.x * T.respawn.speed, y: 0, z: cp.tangent.z * T.respawn.speed };
    // Already following the slope, or a steep spot would launch it off the ground on the first step.
    const g = W.gradAt(x, z);
    p.vel.y = clamp(g.x * p.vel.x + g.z * p.vel.z, -T.speed.maxVy, T.speed.maxVy);
    p.status = 'rolling';
    p.freeze = 0; p.cracks = 0; p.offCourse = 0; p.boost = 0;
    q.pathId = 0; q.hint[0] = ci; q.airTime = 0; q.iceImmune = T.ice.immune; q.drunk = false; q.onBank = false;
    track(slot);
    emit({ kind: 'respawn', slot, reason, checkpoint: p.checkpoint, x, y: p.pos.y, z });
  }

  function scareAnimal(i, by) {
    const a = state.animals[i], ap = animalPriv[i];
    if (a.state === 'startled') return;
    a.state = 'startled'; a.target = -1; ap.timer = T.animal.startled; ap.flee = { x: by.pos.x, z: by.pos.z };
    emit({ kind: 'scare', slot: by.slot, animal: i, animalKind: a.kind, x: a.pos.x, y: a.pos.y, z: a.pos.z });
  }

  function tryBoost(slot, pressed) {
    const p = state.players[slot], q = priv[slot];
    if (!pressed) return;
    if (p.status === 'frozen') {
      p.cracks++;
      if (p.cracks >= T.ice.presses) {
        p.status = 'rolling'; p.freeze = 0; p.cracks = 0; q.iceImmune = T.ice.immune;
        const t = q.flow;
        p.vel.x += t.x * T.ice.pop; p.vel.z += t.z * T.ice.pop;
        emit({ kind: 'thaw', slot, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      }
      return;
    }
    if (p.status !== 'rolling' || p.boostCooldown > 0 || p.mass < T.boost.minMass) return;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const t = q.flow;
    const dx = sp > 2 ? p.vel.x / sp : t.x, dz = sp > 2 ? p.vel.z / sp : t.z;
    // A small drop has little to push with: below T.boost.fullMass the kick is weaker.
    q.boostPower = clamp(p.mass / T.boost.fullMass, 0, 1);
    p.vel.x += dx * T.boost.impulse * q.boostPower; p.vel.z += dz * T.boost.impulse * q.boostPower;
    p.mass -= T.boost.cost;
    p.boost = T.boost.time; p.boostCooldown = T.boost.cooldown; q.stole = false;
    emit({ kind: 'boost', slot, x: p.pos.x, y: p.pos.y, z: p.pos.z });
    state.animals.forEach((a, i) => {
      const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if (a.target === slot || d < T.animal.boostScare) scareAnimal(i, p);
    });
  }

  function movePlayer(slot, inp, dt) {
    const p = state.players[slot], q = priv[slot];
    // At a fork the flow follows the branch the stick points to, so steering chooses the road.
    let t = q.track.tangent;
    q.forkChoice = 0;
    if (q.alt && !frozenStatus(p)) {
      const m = q.track, b = q.alt, mrx = -m.tangent.z, mrz = m.tangent.x;
      const side = b.tangent.x * mrx + b.tangent.z * mrz + 0.02 * ((b.cx - m.cx) * mrx + (b.cz - m.cz) * mrz);
      const sgn = side > 0 ? 1 : -1;
      if (inp.x * sgn > T.fork.stick || m.lateral * sgn > T.fork.offset * m.hw) { t = b.tangent; q.forkChoice = b.pathId; }
    }
    q.flow = t;
    const rx = -t.z, rz = t.x;
    let vx = p.vel.x, vz = p.vel.z;
    const sp = Math.hypot(vx, vz);
    const hx = sp > 1e-6 ? vx / sp : t.x, hz = sp > 1e-6 ? vz / sp : t.z;
    const vt = vx * t.x + vz * t.z, vl = vx * rx + vz * rz;
    const bed = q.bed;
    const frozen = p.status === 'frozen';
    const paused = !p.connected;
    let ax = 0, az = 0, at = 0, al = 0;

    if (p.status === 'airborne') {
      if (!paused) {
        al += inp.x * T.steer.lateral * T.steer.air;
        // Off a step of the main course (or a safe branch) the drop still falls down its gorge: the speed
        // across the course fades and it drifts back over the bed, unless the stick holds it out. A shortcut's
        // jumps keep their risk of landing off the bed.
        const onShortcut = q.pathId && W.branches[q.pathId - 1].kind === 'shortcut';
        if (!onShortcut && !q.forkChoice) {
          const tr = q.track, out = tr.lateral < 0 ? -1 : 1;
          al -= T.air.grip * vl * (1 - clamp(inp.x * Math.sign(vl), 0, 1));
          al -= out * T.air.pull * clamp((Math.abs(tr.lateral) - T.bed.bankFrom * tr.hw) / tr.hw, 0, 1) * (1 - clamp(inp.x * out, 0, 1));
        }
        ax += (at * t.x + al * rx); az += (at * t.z + al * rz);
      }
      ax -= hx * T.speed.drag * sp * sp; az -= hz * T.speed.drag * sp * sp;
      p.vel.x = vx + ax * dt; p.vel.z = vz + az * dt; p.vel.y -= G * dt;
      p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.pos.y += p.vel.y * dt;
      q.airTime += dt;
      const ground = W.heightAt(p.pos.x, p.pos.z) + p.radius;
      if (p.pos.y <= ground) {
        const impact = -p.vel.y;
        p.pos.y = ground; p.vel.y = 0;
        p.vel.x *= T.air.landingKeep; p.vel.z *= T.air.landingKeep;
        // Landed following the slope (as on a respawn), or a steep face would launch it again on the next step.
        const gl = W.gradAt(p.pos.x, p.pos.z);
        p.vel.y = clamp(gl.x * p.vel.x + gl.z * p.vel.z, -T.speed.maxVy, T.speed.maxVy);
        p.status = 'rolling';
        if (q.airTime >= T.air.splashMinAir) {
          let lost = 0;
          if (impact > T.air.hardImpact) lost = Math.min(T.air.splashLossMax, (T.air.splashLoss * (impact - T.air.hardImpact)) / 10);
          p.mass -= lost;
          emit({ kind: 'splash', slot, intensity: impact, air: q.airTime, lost, x: p.pos.x, y: p.pos.y, z: p.pos.z });
        }
        q.airTime = 0;
      }
      return;
    }

    // Gravity along the terrain (horizontal part of the along-slope acceleration).
    const g = W.gradAt(p.pos.x, p.pos.z);
    const m2 = g.x * g.x + g.z * g.z;
    if (!paused) { ax += (-G * g.x) / (1 + m2); az += (-G * g.z) / (1 + m2); }

    const grade = q.track.grade;
    // A river runs fastest down the middle: toward the banks the flow drags on the bed and slows (T.bed.edgeSlow).
    const lane = q.forkChoice ? 0 : clamp(Math.abs(q.track.lateral) / q.track.hw, 0, 1);
    const vmax = vmaxFor(T, p.mass, grade) * (1 - T.bed.edgeSlow * lane * lane);
    q.vmax = vmax;
    const cap = vmax + q.catchup + (p.boost > 0 ? T.boost.extraCap * q.boostPower : 0);
    let fric, grip;
    if (frozen) { fric = T.ice.cubeFriction; grip = 0; }
    else {
      fric = T.offBed.friction + (T.bed.friction - T.offBed.friction) * bed;
      grip = T.offBed.grip + (T.bed.grip - T.offBed.grip) * bed;
      if (q.zones.ice) grip = Math.min(grip, T.ice.grip);
    }
    if (paused) fric = 3;
    if (!frozen && !paused) {
      const cruise = T.speed.cruiseFrac * vmax + q.catchup;
      if (vt < cruise) at += T.bed.current * bed * (cruise - vt);
      const sf = (1 / (1 - T.steer.massFactor + T.steer.massFactor * p.mass)) * (T.offBed.steer + (1 - T.offBed.steer) * bed);
      al += inp.x * T.steer.lateral * sf;
      if (inp.y > 0) at += inp.y * T.steer.forward;
      if (p.boost > 0) {
        at += T.boost.accel * q.boostPower;
        // A boost aimed at the other drop just ahead homes in on it a little, so a steal is a skill, not luck.
        for (const o of state.players) {
          if (o === p || !RACING.has(o.status)) continue;
          const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
          const along = ox * t.x + oz * t.z, side = ox * rx + oz * rz;
          if (along > 0 && along < T.boost.homingAhead && Math.abs(side) < T.boost.homingSide) al += T.boost.homing * clamp(side / 1.5, -1, 1);
        }
      }
    }
    al -= grip * vl;
    ax += at * t.x + al * rx; az += at * t.z + al * rz;
    if (!frozen && !paused && !q.forkChoice) {
      const tr = q.track, out = tr.lateral < 0 ? -1 : 1, off = Math.abs(tr.lateral), from = T.bed.bankFrom * tr.hw;
      const u = off <= tr.hw + T.bed.edge ? clamp((off - from) / (tr.hw - from), 0, 1) : 0;
      if (u > 0) {
        const ox = -tr.tangent.z * out, oz = tr.tangent.x * out; // outward, across the bed
        const vout = vx * ox + vz * oz;
        const push = (1 - clamp((inp.x * out - T.bed.liftFrom) / (T.bed.liftFull - T.bed.liftFrom), 0, 1)) * u * (T.bed.bank + (vout > 0 ? T.bed.bankDamp * vout : 0));
        ax -= ox * push; az -= oz * push;
      }
    }
    ax -= vx * fric; az -= vz * fric;
    if (sp > cap) { ax -= hx * (sp - cap) * T.speed.overDamp; az -= hz * (sp - cap) * T.speed.overDamp; }
    ax -= hx * T.speed.drag * sp * sp; az -= hz * T.speed.drag * sp * sp;
    if (q.drunk) { ax -= vx * T.animal.holdDrag; az -= vz * T.animal.holdDrag; }

    vx += ax * dt; vz += az * dt;
    // Braking never reverses the drop.
    if (!frozen && !paused && inp.y < 0 && sp > 0) {
      const b = Math.min(-inp.y * T.steer.brake * dt, Math.hypot(vx, vz));
      const ns = Math.hypot(vx, vz);
      if (ns > 1e-6) { vx -= (vx / ns) * b; vz -= (vz / ns) * b; }
    }
    p.vel.x = vx; p.vel.z = vz;
    const y0 = p.pos.y, vy0 = p.vel.y;
    p.pos.x += vx * dt; p.pos.z += vz * dt;

    const ground = W.heightAt(p.pos.x, p.pos.z) + p.radius;
    const yBallistic = y0 + vy0 * dt - 0.5 * G * dt * dt;
    if (!frozen && yBallistic - ground > T.air.launchGap && !paused) {
      p.status = 'airborne';
      p.pos.y = yBallistic; p.vel.y = vy0 - G * dt;
      q.airTime = 0;
    } else {
      p.pos.y = ground;
      p.vel.y = clamp((ground - y0) / dt, -T.speed.maxVy, T.speed.maxVy);
    }
  }

  // The wall at the bed edge (T.bed.wall): only a deliberate steer out, a jump, or a fork choice gets past it.
  // A drop that left the ground at the lip of the bank (the slope falls away past the outside of a bend) hits the
  // same wall within T.bed.wallLip s of flight, as long as it is not on a shortcut, whose jumps keep their risk.
  // Coming onto the bank fast is a hit, whether the wall then holds the drop or it climbs over: the bank takes
  // speed and sprays water off it, from nothing at wallBump m/s in to the most at wallHard (once per contact, not
  // while it rides along it): a bend taken a little wide is a graze, steering into the bank is a crash.
  function bankWall(slot, inp) {
    const p = state.players[slot], q = priv[slot], tr = q.track;
    const lip = p.status === 'airborne' && q.airTime < T.bed.wallLip && !(q.pathId && W.branches[q.pathId - 1].kind === 'shortcut');
    if ((p.status !== 'rolling' && !lip) || !p.connected || q.forkChoice) return;
    const out = tr.lateral < 0 ? -1 : 1, limit = tr.hw + T.bed.wall, off = Math.abs(tr.lateral);
    const ox = -tr.tangent.z * out, oz = tr.tangent.x * out;
    if (off < tr.hw - T.bed.edge) q.onBank = false;
    else if (off > tr.hw && off <= limit + 4 && !q.onBank) {
      q.onBank = true;
      const vin = p.vel.x * ox + p.vel.z * oz;
      if (vin > T.bed.wallBump) {
        const hard = clamp((vin - T.bed.wallBump) / (T.bed.wallHard - T.bed.wallBump), 0, 1);
        const keep = 1 - T.bed.wallBleed * hard;
        p.vel.x *= keep; p.vel.z *= keep;
        const lost = Math.min(T.bed.wallLoss * hard, Math.max(0, p.mass - T.mass.evaporate));
        p.mass -= lost;
        emit({ kind: 'bump', slot, other: -1, obstacle: 'bank', intensity: vin, lost, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      }
    }
    if (off <= limit || off > limit + 4) return; // inside, or already out
    if (inp.x * out > T.bed.wallStick) return;
    const back = off - limit;
    p.pos.x -= ox * back; p.pos.z -= oz * back;
    p.pos.y = W.heightAt(p.pos.x, p.pos.z) + p.radius;
    if (lip) {
      p.status = 'rolling'; q.airTime = 0;
      const g = W.gradAt(p.pos.x, p.pos.z);
      p.vel.y = clamp(g.x * p.vel.x + g.z * p.vel.z, -T.speed.maxVy, T.speed.maxVy);
    }
    const vout = p.vel.x * ox + p.vel.z * oz;
    if (vout > 0) { p.vel.x -= (1 + T.bed.wallBounce) * vout * ox; p.vel.z -= (1 + T.bed.wallBounce) * vout * oz; }
    track(slot);
  }

  function evaporate(slot, reason) {
    const p = state.players[slot], q = priv[slot];
    p.status = 'evaporated'; p.vel = { x: 0, y: 0, z: 0 }; p.boost = 0; p.freeze = 0; p.cracks = 0;
    q.respawnTimer = T.respawn.delay; q.respawnReason = 'evaporate'; q.drunk = false;
    for (const a of state.animals) if (a.target === slot) { a.state = 'wander'; a.target = -1; }
    emit({ kind: 'evaporate', slot, reason, x: p.pos.x, y: p.pos.y, z: p.pos.z });
  }

  // An animal wades in from its own bank at most `depth` m into the bed (animal.wade): the middle of the bed is
  // safe at race speed. A drop that stopped (animal.call*) it walks out to wherever it is.
  function wade(ap, x, z, depth = T.animal.wade) {
    const g = W.nearestCourse({ x, z }, ap.hint);
    ap.hint = g.index;
    if (g.lateral * ap.side >= g.hw - depth) return { x, z };
    const off = ap.side * (g.hw - depth);
    return { x: g.cx - g.tangent.z * off, z: g.cz + g.tangent.x * off };
  }

  function updateAnimals(dt) {
    for (const q of priv) q.drunk = false;
    const A = T.animal;
    // Slow and fast are relative to the drop's top speed on its stretch and in its lane (rubber band included), so
    // the rule reads the same on a 70 % snowfield and on the valley stream: riding with the current is slow, a boost fast.
    // Both are horizontal speeds, as the cap in movePlayer: p.speed counts the fall too, a fifth more on a 60 %
    // face, and there a drop at its cap never read as slow.
    const topSpeed = (p) => (priv[p.slot].vmax ?? vmaxFor(T, p.mass, priv[p.slot].track?.grade ?? 0)) + (priv[p.slot].catchup || 0);
    const speed = (p) => Math.hypot(p.vel.x, p.vel.z);
    // How long each drop has been stopping: under callFrac, or the stick held back (a player braking by an
    // animal on a steep face is still fast). A hairpin that costs speed for a moment is not a stop.
    for (const p of state.players) {
      const q = priv[p.slot];
      q.stopped = speed(p) < A.callFrac * topSpeed(p) || (q.stick ?? 0) <= -A.callStick ? (q.stopped || 0) + dt : 0;
    }
    state.animals.forEach((a, i) => {
      const ap = animalPriv[i];
      let tx = a.pos.x, tz = a.pos.z, spd = 0;
      if (a.state === 'startled') {
        ap.timer -= dt;
        const dx = a.pos.x - ap.flee.x, dz = a.pos.z - ap.flee.z, d = Math.hypot(dx, dz) || 1;
        tx = a.pos.x + (dx / d) * 5; tz = a.pos.z + (dz / d) * 5; spd = A.fleeSpeed;
        if (Math.hypot(a.pos.x - ap.home.x, a.pos.z - ap.home.z) > A.leash) spd = 0;
        if (ap.timer <= 0) { a.state = 'wander'; ap.goal = { x: ap.home.x, z: ap.home.z }; ap.timer = 3; }
      } else {
        // A fast pass close by scares it.
        for (const p of state.players) {
          if (!RACING.has(p.status)) continue;
          const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
          if (speed(p) > A.fastFrac * topSpeed(p) && (d < A.scareRadius || (a.target === p.slot && d < A.sense))) { scareAnimal(i, p); return; }
        }
        const homeD = Math.hypot(a.pos.x - ap.home.x, a.pos.z - ap.home.z);
        if (a.state === 'wander') {
          ap.timer -= dt;
          if (ap.timer <= 0 || Math.hypot(ap.goal.x - a.pos.x, ap.goal.z - a.pos.z) < 0.5) {
            const ang = rng.range(0, Math.PI * 2), r = rng.range(0, A.wanderRadius);
            ap.goal = { x: ap.home.x + Math.cos(ang) * r, z: ap.home.z + Math.sin(ang) * r };
            // It grazes on its own bank: a goal in the water or across it moves back to A.bank m past the edge.
            const g = W.nearestCourse(ap.goal, ap.hint);
            if (g.lateral * ap.side < g.hw + A.bank) {
              const off = ap.side * (g.hw + A.bank);
              ap.goal = { x: g.cx - g.tangent.z * off, z: g.cz + g.tangent.x * off };
            }
            ap.timer = rng.range(2, 5);
          }
          tx = ap.goal.x; tz = ap.goal.z; spd = A.wanderSpeed;
          // A drop riding with the current draws it from A.sense (it has to ride the edge), one that stopped
          // from A.call, anywhere in the bed: a player who brakes by an animal is always visited.
          let best = -1, bd = Infinity, called = false;
          for (const p of state.players) {
            // Nobody can move yet in the countdown, and a drop whose pad dropped out is left alone.
            if (ap.flying || state.phase !== 'race' || p.status !== 'rolling' || !p.connected || speed(p) >= A.slowFrac * topSpeed(p)) continue;
            const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z), stopped = priv[p.slot].stopped >= A.callAfter;
            // at race speed only a drop over on the animal's side of the bed: in a narrow stream (the springs
            // of the Piave, 8-10 m wide) the middle is inside A.sense, and it must stay the safe line
            const tr = priv[p.slot].track, near = tr && tr.lateral * ap.side > A.edgeFrac * tr.hw;
            if ((stopped || near) && d < (stopped ? A.call : A.sense) && d < bd && !state.animals.some((o) => o !== a && o.target === p.slot)) { bd = d; best = p.slot; called = stopped; }
          }
          if (best >= 0) { a.state = 'approach'; a.target = best; ap.called = called; }
        }
        if (a.state === 'approach' || a.state === 'drink') {
          const p = state.players[a.target];
          const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
          if (ap.called && speed(p) >= A.slowFrac * topSpeed(p)) ap.called = false; // it rode on: the edge rule again
          const lost = p.status !== 'rolling' || !p.connected || d > (ap.called ? A.call : A.sense) * 1.5 || homeD > A.leash;
          if (lost) { a.state = 'wander'; a.target = -1; ap.called = false; ap.goal = { x: ap.home.x, z: ap.home.z }; ap.timer = 3; }
          else if (a.state === 'approach') {
            // It heads the drop off: a drop riding by at race speed outruns any animal chasing it, so while
            // the drop is still coming it runs to the drop's line abeam of itself, and chases once passed.
            const v = Math.hypot(p.vel.x, p.vel.z) || 1;
            const along = Math.max(0, ((a.pos.x - p.pos.x) * p.vel.x + (a.pos.z - p.pos.z) * p.vel.z) / v);
            tx = p.pos.x + (p.vel.x / v) * along; tz = p.pos.z + (p.vel.z / v) * along; spd = A.approachSpeed;
            ({ x: tx, z: tz } = wade(ap, tx, tz, ap.called ? Infinity : A.wade));
            if (d < p.radius + A.reach) { a.state = 'drink'; ap.sip = 0; } // the first sip at once: every latch is felt
          } else if (d > p.radius + A.reach * 1.5) {
            a.state = 'approach'; // the drop pulled out of reach (toward the middle, where it cannot follow)
          } else {
            // It drinks from beside the drop on its own bank, a little ahead of it, facing it: where the chase
            // camera behind the drop sees it.
            const keep = p.radius + A.reach * 0.7, t = priv[p.slot].track.tangent;
            tx = p.pos.x + (-t.z * ap.side * 0.7 + t.x * 0.75) * keep; tz = p.pos.z + (t.x * ap.side * 0.7 + t.z * 0.75) * keep;
            ({ x: tx, z: tz } = wade(ap, tx, tz, ap.called ? Infinity : A.wade));
            spd = Math.max(A.approachSpeed, speed(p) * 1.2);
            priv[p.slot].drunk = true;
            ap.sip -= dt;
            if (ap.sip <= 0) {
              ap.sip = A.sipInterval;
              const amount = Math.min(A.sip, p.mass);
              p.mass -= amount;
              emit({ kind: 'drink', slot: p.slot, animal: i, animalKind: a.kind, amount, x: a.pos.x, y: a.pos.y, z: a.pos.z });
            }
          }
        }
      }
      const dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz);
      const stepLen = Math.min(d, spd * dt);
      if (stepLen > 1e-4) {
        a.pos.x += (dx / d) * stepLen; a.pos.z += (dz / d) * stepLen;
        a.heading = Math.atan2(dx, dz);
      }
      if (a.state === 'drink') { const p = state.players[a.target]; a.heading = Math.atan2(p.pos.x - a.pos.x, p.pos.z - a.pos.z); } // faces the drop
      a.speed = stepLen / dt;
      a.pos.y = W.heightAt(a.pos.x, a.pos.z);
    });
  }

  function step(dt = T.dt, inputs) {
    inputs = inputs || [];
    state.events = [];
    state.t += dt;
    if (state.phase === 'done') return state;

    const ins = [];
    for (let slot = 0; slot < players; slot++) {
      const i = inputs[slot] || {};
      ins.push({ x: clamp(+i.x || 0, -1, 1), y: clamp(+i.y || 0, -1, 1), boost: !!i.boost, connected: i.connected !== false });
    }

    if (state.phase === 'countdown') {
      state.countdown = Math.max(0, state.countdown - dt);
      for (let slot = 0; slot < players; slot++) {
        const p = state.players[slot];
        p.melt = 1 - state.countdown / T.countdown;
        p.pos.y = W.heightAt(p.pos.x, p.pos.z) + p.radius;
        priv[slot].prevBoost = ins[slot].boost;
        p.connected = ins[slot].connected;
      }
      updateAnimals(dt);
      if (state.countdown <= 0) state.phase = 'race';
      return state;
    }

    // Pickups: water drops come back, rain falls in rain zones.
    for (const pk of state.pickups) if (!pk.active && pk.respawnAt !== null && state.t >= pk.respawnAt) { pk.active = true; pk.respawnAt = null; }
    state.pickups = state.pickups.filter((pk) => pk.kind !== 'rain' || (pk.active && state.t - pk.t0 < T.pickup.rainLife));
    rainZones.forEach((z, zi) => {
      z.timer -= dt;
      if (z.timer > 0) return;
      z.timer = T.pickup.rainInterval;
      if (state.pickups.filter((pk) => pk.kind === 'rain' && pk.zone === zi).length >= T.pickup.rainMax) return;
      const s = rng.range(z.sFrom, z.sTo);
      const c = W.pointAt(0, s);
      const lat = rng.range(-0.8, 0.8) * c.hw;
      const x = c.cx - c.tangent.z * lat, zz = c.cz + c.tangent.x * lat;
      state.pickups.push({ id: nextPickupId++, kind: 'rain', zone: zi, pos: { x, y: W.heightAt(x, zz) + 0.5, z: zz }, active: true, t0: state.t, respawnAt: null });
    });

    // The rubber band: how far each drop is behind the one furthest down this stage.
    const lead = Math.max(...state.players.map((p) => (p.status === 'finished' ? W.sFinish : p.dist)));
    for (let slot = 0; slot < players; slot++) {
      const p = state.players[slot], q = priv[slot], inp = ins[slot];
      q.catchup = catchupFor(T, lead - p.dist);
      p.connected = inp.connected;
      p.melt = 1;
      const pressed = inp.boost && !q.prevBoost && inp.connected;
      q.prevBoost = inp.boost;
      q.stick = inp.y; // the animals read a brake as a stop (updateAnimals)
      p.boostCooldown = Math.max(0, p.boostCooldown - dt);
      p.boost = Math.max(0, p.boost - dt);
      q.iceImmune = Math.max(0, q.iceImmune - dt);

      if (p.status === 'finished') {
        const k = Math.exp(-1.5 * dt);
        p.vel.x *= k; p.vel.z *= k; p.vel.y = 0;
        p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
        p.pos.y = Math.max(W.heightAt(p.pos.x, p.pos.z), sea) + p.radius * 0.3;
        p.speed = Math.hypot(p.vel.x, p.vel.z);
        continue;
      }
      if (p.status === 'evaporated') {
        q.respawnTimer -= dt;
        if (q.respawnTimer <= 0) respawn(slot, q.respawnReason);
        continue;
      }
      tryBoost(slot, pressed);
      movePlayer(slot, inp, dt);
      track(slot);
      bankWall(slot, inp);
      p.speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
    }

    // Drop against drop.
    for (let i = 0; i < players; i++) for (let j = i + 1; j < players; j++) {
      const a = state.players[i], b = state.players[j];
      if (!RACING.has(a.status) || !RACING.has(b.status)) continue;
      const dy = Math.abs(a.pos.y - b.pos.y);
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      const touch = a.radius + b.radius;
      // A boosting drop steals from a little further than touching (T.collide.stealReach).
      const boosting = a.boost > 0 || b.boost > 0;
      if (d >= touch + (boosting ? T.collide.stealReach : 0) || dy > touch + (boosting ? T.collide.stealReach : 0)) continue;
      const nx = d > 1e-6 ? (b.pos.x - a.pos.x) / d : 1, nz = d > 1e-6 ? (b.pos.z - a.pos.z) / d : 0;
      const closing = -((b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz);
      const mx = (a.pos.x + b.pos.x) / 2, my = (a.pos.y + b.pos.y) / 2, mz = (a.pos.z + b.pos.z) / 2;
      if (d < touch && dy <= touch) {
        const rel = collideDrops(a, b, T.collide.restitution);
        if (rel >= T.collide.bumpEvent) {
          emit({ kind: 'bump', slot: i, other: j, intensity: rel, x: mx, y: my, z: mz });
          emit({ kind: 'bump', slot: j, other: i, intensity: rel, x: mx, y: my, z: mz });
        }
      }
      for (const [thief, victim] of [[a, b], [b, a]]) {
        const tq = priv[thief.slot];
        if (thief.boost <= 0 || tq.stole || closing < T.collide.stealMinRel || victim.boost > thief.boost) continue;
        const amount = Math.max(0, Math.min(T.collide.steal, victim.mass - T.collide.minMassLeft, T.mass.max - thief.mass));
        if (amount <= 0) continue;
        victim.mass -= amount; thief.mass += amount; tq.stole = true;
        emit({ kind: 'steal', slot: thief.slot, from: victim.slot, amount, x: mx, y: my, z: mz });
        break;
      }
    }

    for (let slot = 0; slot < players; slot++) {
      const p = state.players[slot], q = priv[slot];
      if (!RACING.has(p.status)) continue;
      let hotRock = false;
      for (const r of rocks) {
        const dx = p.pos.x - r.x, dz = p.pos.z - r.z, d = Math.hypot(dx, dz);
        const reach = r.r + p.radius;
        if (d < reach + T.rock.touch && p.pos.y < r.y + r.r * 1.2 + p.radius) hotRock = true;
        if (d >= reach || p.pos.y > r.y + r.r * 1.2 + p.radius) continue;
        const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
        p.pos.x = r.x + nx * reach; p.pos.z = r.z + nz * reach;
        const vn = p.vel.x * nx + p.vel.z * nz;
        if (vn < 0) {
          p.vel.x -= (1 + T.rock.restitution) * vn * nx; p.vel.z -= (1 + T.rock.restitution) * vn * nz;
          // Water flows around a rock: a head-on hit is deflected sideways, toward the bed center.
          let px = -nz, pz = nx;
          const vside = p.vel.x * px + p.vel.z * pz;
          const tr = priv[slot].track;
          const toCenter = (tr.cx - p.pos.x) * px + (tr.cz - p.pos.z) * pz;
          const sgn = Math.abs(vside) > 0.5 ? Math.sign(vside) : toCenter >= 0 ? 1 : -1;
          p.vel.x += px * sgn * -vn * T.rock.slide; p.vel.z += pz * sgn * -vn * T.rock.slide;
          if (-vn > 3) emit({ kind: 'bump', slot, other: -1, obstacle: 'rock', intensity: -vn, x: p.pos.x, y: p.pos.y, z: p.pos.z });
        }
      }

      // Pickups.
      for (const pk of state.pickups) {
        if (!pk.active || p.status === 'frozen') continue;
        const d = Math.hypot(pk.pos.x - p.pos.x, pk.pos.z - p.pos.z);
        if (d > p.radius + T.pickup.reach || Math.abs(pk.pos.y - p.pos.y) > 3) continue;
        // A boost through it scoops up the spray as well (T.pickup.boostBonus): SCATTO aimed at water pays for itself.
        const gain = Math.min((pk.kind === 'rain' ? T.pickup.rain : T.pickup.water) * (p.boost > 0 ? T.pickup.boostBonus : 1), T.mass.max - p.mass);
        p.mass += gain;
        pk.active = false;
        if (pk.kind === 'water') pk.respawnAt = state.t + T.pickup.waterRespawn;
        emit({ kind: 'pickup', slot, pickup: pk.id, type: pk.kind, amount: gain, x: pk.pos.x, y: pk.pos.y, z: pk.pos.z });
      }

      // Ice.
      if (p.status === 'rolling') {
        const started = state.t - raceStart >= T.ice.startGrace;
        if (q.zones.ice && q.iceImmune <= 0 && p.connected && started) {
          const hs = Math.hypot(p.vel.x, p.vel.z);
          p.freeze += ((hs < T.ice.baseSpeed ? T.ice.base : 0) + T.ice.slow * clamp(1 - hs / T.ice.slowSpeed, 0, 1)) * dt;
          if (p.freeze >= 1) {
            p.freeze = 1; p.status = 'frozen'; p.cracks = 0; p.boost = 0;
            emit({ kind: 'freeze', slot, x: p.pos.x, y: p.pos.y, z: p.pos.z });
          }
        } else p.freeze = Math.max(0, p.freeze - T.ice.thaw * dt);
      }

      // Evaporation, faster in the sun, on dry ground and on hot rocks.
      if (p.status !== 'frozen' && p.connected) {
        const rate = T.evap.base * Math.pow(p.mass, 2 / 3) + (q.zones.sun ? T.evap.sun : 0) + T.evap.offBed * (1 - q.bed) + (hotRock ? T.evap.rock : 0);
        p.mass -= rate * dt;
      }
      p.mass = Math.min(p.mass, T.mass.max);
      p.radius = radiusFor(T, Math.max(p.mass, 0.01));
      if (p.mass < T.mass.evaporate) { evaporate(slot, q.drunk ? 'drunk' : 'heat'); continue; }

      // Too far from any path for too long.
      const tr = q.track;
      if (p.connected && tr.dist > tr.hw + T.respawn.offCourseMargin) p.offCourse += dt;
      else p.offCourse = 0;
      if (p.offCourse >= T.respawn.offCourseTime) { respawn(slot, 'offcourse'); continue; }

      // Progress, checkpoints, finish.
      p.dist = q.sEq;
      if (q.bed > 0.5) q.reached = Math.max(q.reached, q.sEq); // respawn marks count only once reached in the bed
      p.progress = clamp(q.sEq / W.sFinish, 0, 1);
      while (p.checkpoint + 1 < W.checkpoints.length && q.sEq >= course.s[W.checkpoints[p.checkpoint + 1]]) {
        p.checkpoint++;
        emit({ kind: 'checkpoint', slot, checkpoint: p.checkpoint, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      }
      if (q.sEq >= W.sFinish) {
        p.status = 'finished';
        p.place = ++finishedCount;
        p.finishTime = state.t - raceStart;
        p.progress = 1;
        if (state.grace === null && state.final) state.grace = T.grace;
        emit({ kind: 'finish', slot, place: p.place, time: p.finishTime, final: state.final, stage: state.stage, x: p.pos.x, y: p.pos.y, z: p.pos.z });
      }
    }

    updateAnimals(dt);
    for (const p of state.players) p.speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);

    // Live ranking: finishers by place, then by distance down the course.
    const order = state.players.slice().sort((a, b) => {
      const fa = a.status === 'finished', fb = b.status === 'finished';
      if (fa !== fb) return fa ? -1 : 1;
      if (fa) return a.place - b.place;
      return b.dist - a.dist || priv[a.slot].order - priv[b.slot].order;
    });
    order.forEach((p, i) => { if (p.status !== 'finished') p.place = i + 1; });

    if (state.grace !== null) {
      state.grace = Math.max(0, state.grace - dt);
      if (state.grace <= 0 || finishedCount === players) {
        state.phase = 'done';
        for (const p of state.players) if (p.status !== 'finished') p.dnf = true;
      }
    }
    // An intermediate stage ends when every drop reached its end (a missing pad is waited for).
    if (!state.final && finishedCount === players) state.phase = 'done';
    return state;
  }

  return {
    state,
    world: W,
    tuning: T,
    step,
    hash: () => stateHash(state),
    // What the next stage's sim needs: createSim(next, {final, carry: sim.carry()}). Each drop rains
    // into the next stage `delay` s after the first one, so the gap at the end of this stage is kept,
    // and the clock resumes from the first arrival so waiting in the cloud costs nobody time.
    carry() {
      const times = state.players.map((p) => (p.status === 'finished' ? p.finishTime : state.t - raceStart));
      const first = Math.min(...times);
      return {
        stage: state.stage + 1,
        raceStart,
        t: raceStart + first,
        players: state.players.map((p, i) => ({ slot: p.slot, mass: p.mass, delay: times[i] - first, place: p.place })),
      };
    },
    // Where a drop is on the course, for bots, cameras and the HUD.
    track(slot) {
      const q = priv[slot], tr = q.track;
      return { pathId: q.pathId, branch: q.pathId - 1, index: tr.index, t: tr.t, s: tr.s, sEq: q.sEq, dist: tr.dist,
        lateral: tr.lateral, tangent: { ...q.flow }, pathTangent: { ...tr.tangent }, hw: tr.hw, inBed: q.bed, zones: { ...q.zones }, drunk: q.drunk };
    },
    // Test and debug helper: put a drop somewhere, optionally with a velocity and mass.
    place(slot, pos, { vel, mass, status } = {}) {
      const p = state.players[slot], q = priv[slot];
      if (mass !== undefined) p.mass = mass;
      p.radius = radiusFor(T, p.mass);
      p.pos = { x: pos.x, y: W.heightAt(pos.x, pos.z) + p.radius, z: pos.z };
      p.vel = vel ? { x: vel.x, y: 0, z: vel.z } : { x: 0, y: 0, z: 0 };
      p.status = status || 'rolling';
      p.offCourse = 0; q.airTime = 0; q.onBank = false;
      track(slot, true);
      p.dist = q.sEq;
    },
  };
}
