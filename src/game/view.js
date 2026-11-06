// What the host screen draws: the race renderer (src/render), the animals, the game's effects and the camera
// direction on top of the chase cameras: a slow sweep over the summit in the lobby, the ride behind a drop's
// cloud (when it evaporates at a stage end, during the flight to the next stage, until it rains back in), and
// the kicks on hard landings. Browser only (three.js, WebGL).
import * as THREE from 'three';
import { createRenderer } from '../render/index.js';
import { createAnimals } from '../render/animals/index.js';
import { makeSampler } from '../world/load.js';
import { createEffects } from './effects.js';
import { flightPath, flightU, flightCamera, FLIGHT } from './flight.js';

const SLOTS = 2;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
// The start shot (introCam), after the summit painting (src/main.js): a crane from high behind the drops, on the
// summit where every course starts, down into the chase camera. m behind the drop (uphill) and above it at the first
// frame; m down the course of the point it looks at; where the drop sits under the centre of the view (fraction of the
// half height); the fraction of the shot it holds before it comes down.
// The look back from the cloud (lookBack): s after the finish before the camera turns, s the turn takes, the
// fraction of the flight it stays looking back (all of a hop shorter than `hop` m, under the veil), and where it
// goes: `back` m further down the slope than the cloud and `rise` m above it, so the mountain just descended stands
// up behind the cloud instead of a wall of snow a few metres away (the playtest on the Everest), aimed at the real
// summit, pitched between pitch[0] and pitch[1] deg with the summit `summitAt` of the half height above the centre.
export const LOOK_BACK = { after: 0.5, turn: 2.2, until: 0.14, hop: 900, back: 260, rise: 160, pitch: [-4, 26], summitAt: 0.45 };
export const INTRO = { back: 46, up: 30, look: 260, dropAt: 0.5, hold: 0.25 };

export function createView(canvas, world, { pixelRatio, assets = 'assets/vendor/animals/' } = {}) {
  const r = createRenderer(canvas, { world, stage: -1, pixelRatio });
  const fx = createEffects(r);
  const animals = createAnimals(r.scene, { theme: r.theme, shared: r.shared, base: assets, world: world.json?.id, ground: (x, z) => r.groundAt(x, z) });
  animals.ready.catch((e) => console.warn(`animals: ${e.message}`));
  const backdrop = world.backdrop ? makeSampler(world.json.backdrop, world.backdrop) : null;
  const groundG = (x, z) => (backdrop ? backdrop.heightAt(x, z) : 0);
  let stageK = -1, layout = { mode: 'split', slots: [0, 1] }, W = 2, H = 2;

  // per slot: where its cloud is and how much the camera follows the cloud instead of the chase rig
  const cams = Array.from({ length: SLOTS }, () => ({ w: 0, pose: null, finishAt: null, finishT: null, rain: false, awaitRain: false }));
  const chasePos = new THREE.Vector3(), chaseQ = new THREE.Quaternion(), tmpQ = new THREE.Quaternion(), look = new THREE.Vector3();
  const helper = new THREE.PerspectiveCamera(); // a camera, so lookAt() aims its -z like the real ones
  let flight = null; // { key, paths[slot] } for the current cloud phase
  let time = 0;

  // Builds stage k (terrain, water, trees). The stage already on screen (the lobby's, at a race start) is only
  // reset, so the countdown does not stutter on a rebuild.
  function setStage(k, data) {
    if (k !== stageK || r.stage !== data.json) r.setStage(data.json, data.height);
    stageK = k;
    fx.clear();
    animals.spawn(data.json.spawns?.animals || []);
    for (const c of cams) { c.finishAt = null; c.finishT = null; c.awaitRain = false; c.w = 0; } // a 'stage' event sets awaitRain right after
  }

  function setLayout(slots) {
    layout = slots.length === 1 ? { mode: 'single', slots } : { mode: 'split', slots: [0, 1] };
    r.setLayout(layout.mode, layout.slots);
    animals.setResolution(Math.floor(W / layout.slots.length), H);
  }

  function resize(w, h) {
    W = w; H = h;
    r.resize(w, h);
    animals.setResolution(Math.floor(w / layout.slots.length), h);
  }

  const offsetOf = (k) => world.json.stages[k].offset;
  const toLocalOf = (k, p, out) => { const o = offsetOf(k); out.x = p.x - o.x; out.y = p.y - o.y; out.z = p.z - o.z; return out; };

  // The cloud pose of every slot for this frame, in the frame of the stage on screen, or null.
  const poses = Array.from({ length: SLOTS }, () => ({ x: 0, y: 0, z: 0, yaw: 0, arc: 0, rain: false, drop: true }));
  function cloudPoses(race, state) {
    const out = [null, null];
    if (!race) return out;
    const cl = race.cloud;
    if (race.phase === 'cloud' && cl && cl.t >= 0) {
      const key = `${cl.from}>${cl.to}`;
      if (!flight || flight.key !== key) {
        const from = world.json.stages[cl.from].offset, to = world.json.stages[cl.to].offset;
        const toStage = race.stageData(cl.to)?.json || world.json.stages[cl.to];
        flight = {
          key,
          paths: cl.fromPos.map((p0, s) => {
            const p = cams[s].finishAt || p0; // where its cloud formed
            // the start of the next stage: its spawn point (the sim puts the drop there when it rains)
            const sp = toStage.spawns?.start?.[s] || { x: 0, y: 0, z: 0 };
            const end = { x: sp.x + to.x, y: (Number.isFinite(sp.y) ? sp.y : 0) + to.y, z: sp.z + to.z };
            return flightPath({ x: p.x + from.x, y: p.y - 0.5 + from.y, z: p.z + from.z }, end, groundG);
          }),
        };
      }
      const k = cl.swapped ? cl.to : cl.from;
      for (let s = 0; s < SLOTS; s++) {
        const g = flight.paths[s].at(flightU(cl.t, cl.duration, cl.delays[s]), poses[s]);
        toLocalOf(k, g, poses[s]);
        poses[s].rain = false; poses[s].drop = true;
        out[s] = poses[s];
      }
      return out;
    }
    if (!state) return out;
    for (let s = 0; s < SLOTS; s++) {
      const p = state.players[s], c = cams[s];
      if (!p) continue;
      if (p.status === 'finished' && c.finishAt) {
        // evaporating at the end of a stage: the cloud forms over the drop and drifts up
        const u = smooth((time - c.finishT) / 1.4);
        Object.assign(poses[s], { x: c.finishAt.x, y: c.finishAt.y + FLIGHT.rise * u - 0.5, z: c.finishAt.z, yaw: c.finishAt.yaw, arc: 0, rain: false, drop: u > 0.4 });
        out[s] = poses[s];
      } else if (p.status === 'evaporated' && c.awaitRain && flight) {
        // hovering over the start of the stage until the sim rains this drop in
        const g = flight.paths[s].at(1, poses[s]);
        toLocalOf(stageK, g, poses[s]);
        poses[s].rain = false; poses[s].drop = true;
        out[s] = poses[s];
      }
    }
    return out;
  }

  // events of this frame that change the camera direction
  function onEvents(race, state, events) {
    for (const e of events) {
      if (e.kind === 'finish') {
        const p = state.players[e.slot];
        const d = race?.sim?.track(e.slot)?.tangent || { x: 0, z: 1 };
        cams[e.slot].finishAt = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: Math.atan2(d.x, d.z) };
        cams[e.slot].finishT = time;
      } else if (e.kind === 'stage') {
        for (const c of cams) { c.awaitRain = true; c.finishAt = null; }
      } else if (e.kind === 'respawn' && e.reason === 'rain') {
        cams[e.slot].awaitRain = false;
      }
    }
  }

  // The summit of the world (where the first stage starts) in the frame of the stage on screen.
  const summitG = (() => { const s = world.json.stages[0], c = s.course?.[0]; return c ? { x: c.x + s.offset.x, y: c.y + s.offset.y, z: c.z + s.offset.z } : null; })();
  const summitL = { x: 0, y: 0, z: 0 };

  // back 0..1: how far the camera has turned round to look back up the mountain (lookBack): it cranes up and down
  // the slope from the cloud and turns to the real summit, the cloud far below and the mountain filling the frame
  const backQ = new THREE.Quaternion();
  function cloudCam(pose, dir, back = 0, fov = 46) {
    const c = flightCamera(pose, dir);
    // never inside the terrain
    const g = r.groundAt(c.x, c.z);
    if (c.y < g + 3) c.y = g + 3;
    helper.position.set(c.x, c.y, c.z);
    helper.lookAt(look.set(c.lx, c.ly, c.lz));
    if (back > 0 && summitG && stageK >= 0) {
      const s = toLocalOf(stageK, summitG, summitL);
      let ux = s.x - pose.x, uz = s.z - pose.z;
      const ul = Math.hypot(ux, uz);
      // on the summit itself (a cloud that formed there) the mountain is behind the way it came: back up the course
      if (ul < 50) { ux = -dir.x; uz = -dir.z; } else { ux /= ul; uz /= ul; }
      const bx = pose.x - ux * LOOK_BACK.back, bz = pose.z - uz * LOOK_BACK.back;
      const by = Math.max(pose.y, r.groundAt(bx, bz)) + LOOK_BACK.rise;
      const hd = Math.max(1, Math.hypot(s.x - bx, s.z - bz));
      const D = Math.PI / 180, up = Math.atan2(s.y - by, hd) - Math.atan(LOOK_BACK.summitAt * Math.tan((fov * D) / 2));
      const pitch = Math.max(LOOK_BACK.pitch[0] * D, Math.min(LOOK_BACK.pitch[1] * D, up));
      const k = smooth(back);
      tmpQ.copy(helper.quaternion);
      const x = lerp(c.x, bx, k), y = lerp(c.y, by, k), z = lerp(c.z, bz, k);
      helper.position.set(x, y, z);
      helper.lookAt(look.set(x + ux * Math.cos(pitch) * 10, y + Math.sin(pitch) * 10, z + uz * Math.cos(pitch) * 10));
      backQ.copy(helper.quaternion);
      helper.quaternion.copy(tmpQ).slerp(backQ, k);
    }
    return helper;
  }

  // Aims cam (at x, y, z) toward (ax, az) on the level, pitched so the point at sits dropAt of the half view height
  // under the centre of a vertical fov (deg).
  function aimAbove(cam, x, y, z, ax, az, at, dropAt, fov) {
    const hd = Math.hypot(at.x - x, at.z - z) || 1, pitch = Math.atan2(at.y - y, hd) + Math.atan(dropAt * Math.tan((fov * Math.PI) / 360));
    let hx = ax - x, hz = az - z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    cam.position.set(x, y, z);
    cam.lookAt(look.set(x + hx * Math.cos(pitch) * 10, y + Math.sin(pitch) * 10, z + hz * Math.cos(pitch) * 10));
  }

  // Once a drop has evaporated at a stage end its camera cranes up and turns to look back up the mountain it came
  // down (the summit painting sits there, paint.js; the other drop may still be coming down), and turns downhill
  // again in the first part of the flight, before the veil swaps the next stage in (on a short hop, under the veil
  // itself). 0 downhill .. 1 looking back.
  function lookBack(race, c, s) {
    if (c.finishT === null || !Number.isFinite(c.finishT)) return 0;
    let b = smooth((time - c.finishT - LOOK_BACK.after) / LOOK_BACK.turn);
    const cl = race?.phase === 'cloud' ? race.cloud : null;
    if (cl && cl.t >= 0) {
      const until = (flight?.paths[s]?.length ?? Infinity) < LOOK_BACK.hop ? cl.swapAt - 0.08 : LOOK_BACK.until;
      b = Math.min(b, 1 - smooth((cl.t / cl.duration - until) / (cl.swapAt - until)));
    } else if (!c.finishAt) b = 0; // hovering over the next stage, waiting to rain in
    return b;
  }

  // Lobby: a slow sweep behind the two snowflakes at the start, looking down the first stage toward the massif.
  function lobbyCamera(state, cam) {
    const ps = state.players;
    const cx = (ps[0].pos.x + ps[1].pos.x) / 2, cz = (ps[0].pos.z + ps[1].pos.z) / 2, cy = (ps[0].pos.y + ps[1].pos.y) / 2;
    const st = r.stage, c = st?.course;
    let dx = 0, dz = 1;
    if (c && c.length > 12) { dx = c[12].x - c[0].x; dz = c[12].z - c[0].z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    const a = Math.sin(time * 0.12) * 0.35;
    const ca = Math.cos(a), sa = Math.sin(a);
    const bx = dx * ca - dz * sa, bz = dx * sa + dz * ca;
    const x = cx - bx * 11, z = cz - bz * 11;
    const y = Math.max(cy + 4.2, r.groundAt(x, z) + 2.5);
    cam.position.set(x, y, z);
    cam.lookAt(cx + dx * 40, cy - 6, cz + dz * 40);
    cam.updateMatrixWorld();
  }

  // The start shot (intro 0..1, src/main.js: the summit painting and the title, then the countdown). Every course
  // starts on the summit, so a camera looking back up would see the rim and an empty sky (the playtest on the
  // Kerinci): it looks down the way the drops are going instead, from high behind them, the valley and its painting
  // ahead, and cranes down into the chase camera for the start.
  const introQ = new THREE.Quaternion();
  function introCam(s, state, u, cam) {
    const p = state.players[s], c = r.stage?.course;
    if (!p || !c || c.length < 2) return;
    let j = 1;
    while (j < c.length - 1 && Math.hypot(c[j].x - c[0].x, c[j].z - c[0].z) < INTRO.look) j++;
    let dx = c[j].x - c[0].x, dz = c[j].z - c[0].z;
    const run = Math.hypot(dx, dz) || 1;
    dx /= run; dz /= run;
    const x = p.pos.x - dx * INTRO.back, z = p.pos.z - dz * INTRO.back;
    const y = Math.max(p.pos.y + INTRO.up, r.groundAt(x, z) + INTRO.up * 0.5);
    // the drop under the centre of the view (INTRO.dropAt of the half height), the course and the valley beyond it
    aimAbove(helper, x, y, z, p.pos.x + dx * INTRO.look, p.pos.z + dz * INTRO.look, p.pos, INTRO.dropAt, cam.fov);
    introQ.copy(helper.quaternion);
    const k = smooth((u - INTRO.hold) / (1 - INTRO.hold - 0.04));
    chasePos.copy(cam.position); chaseQ.copy(cam.quaternion);
    cam.position.set(x, y, z).lerp(chasePos, k);
    cam.quaternion.copy(introQ).slerp(chaseQ, k);
    cam.updateMatrixWorld();
  }

  // One frame. state: the drawn (interpolated) sim state; events: everything the sim emitted since the last frame;
  // mode: 'lobby' | 'race'; race: the race controller (for the cloud phase); intro: 0..1 through the start shot, or null.
  function frame(state, events, dt, { mode = 'race', race = null, intro = null } = {}) {
    time += dt;
    if (stageK < 0 || !state) return;
    if (mode === 'race') onEvents(race, state, events);
    r.update(state, dt, events);
    const ps = cloudPoses(mode === 'race' ? race : null, state);
    fx.update(state, events, dt, { cloudPose: (s) => ps[s] });
    animals.update(dt, state.players, events, state.animals);
    if (mode === 'lobby') { lobbyCamera(state, r.cameras[0]); r.render(); return; }
    for (let s = 0; s < SLOTS; s++) {
      const cam = r.cameras[s], c = cams[s], pose = ps[s];
      if (intro !== null && intro < 1) { introCam(s, state, intro, cam); continue; }
      const want = pose ? 1 : 0;
      c.w = Math.max(0, Math.min(1, c.w + (want ? dt / 0.9 : -dt / 0.8)));
      if (pose) c.pose = { ...pose };
      if (c.w > 0 && c.pose) {
        const back = lookBack(race, c, s), dir = { x: Math.sin(c.pose.yaw), z: Math.cos(c.pose.yaw) };
        const target = cloudCam(c.pose, dir, back, cam.fov);
        const k = race?.phase === 'cloud' && race.cloud.t >= 0 ? 1 : smooth(c.w);
        chasePos.copy(cam.position); chaseQ.copy(cam.quaternion);
        cam.position.lerpVectors(chasePos, target.position, k);
        tmpQ.copy(target.quaternion);
        cam.quaternion.copy(chaseQ).slerp(tmpQ, k);
        cam.updateMatrixWorld();
      }
      fx.applyKick(s, cam);
    }
    r.render();
  }

  // a white-pink veil (0..1) at the top of the flight, when the next stage is swapped in under the cloud
  function veil(race) {
    const cl = race?.phase === 'cloud' ? race.cloud : null;
    if (!cl || cl.t < 0) return 0;
    const u = cl.t / cl.duration, m = cl.swapAt;
    return Math.exp(-(((u - m) / 0.075) ** 2));
  }

  // one frame that compiles the game's own effect shaders (call once the lobby is on screen)
  const warm = () => fx.warm(() => r.render());

  return {
    renderer: r, effects: fx, animals,
    setStage, setLayout, resize, frame, veil, warm,
    get stage() { return stageK; },
    get stats() { return r.stats; },
    get time() { return time; },
  };
}
