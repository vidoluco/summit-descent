// Chase camera of one view: a few metres up behind its drop, looking downhill along the stream, smoothly
// following, never under the ground nor with the ground between it and the drop. The heading blends the
// stream direction (steady) with the drop's velocity (responsive). Reuses its vectors: no allocation.
import * as THREE from 'three';
import { follow, lerp } from './math.js';
import { trackPath, indexAtS } from './path.js';
import { framing, lookOf, visualRadius } from './drop-look.js';

export function createChaseCamera(theme, aspect = 1) {
  const C = theme.camera, LOOK = lookOf(theme);
  const cam = new THREE.PerspectiveCamera(C.fov, aspect, C.near, C.far);
  const pos = new THREE.Vector3(), tmp = new THREE.Vector3();
  const st = { hint: -1, path: -1, init: false, dirX: 0, dirZ: 1, up: C.up, pitch: 0, steep: 0, frameBack: 1, frameUp: 1 };

  // p: sim player; paths: stagePaths(); ground(x, z): drawn ground
  function update(p, dt, paths, ground, snap = false) {
    const pid = p.branch >= 0 && paths[p.branch + 1] ? p.branch + 1 : 0, path = paths[pid];
    if (pid !== st.path) { st.hint = -1; st.path = pid; }
    const i = (st.hint = trackPath(path, p.pos.x, p.pos.z, st.hint));
    // stream direction over the look-ahead, continued on the course past the end of a branch
    const j = indexAtS(path, path.s[i] + C.lookAhead);
    let ax = path.x[j], az = path.z[j];
    if (pid > 0 && j === path.n - 1) { const c = paths[0], k = trackPath(c, ax, az, -1); const k2 = indexAtS(c, c.s[k] + C.lookAhead * 0.5); ax = c.x[k2]; az = c.z[k2]; }
    let dx = ax - path.x[i], dz = az - path.z[i];
    let l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > 3) {
      const b = C.courseBlend; dx = lerp(p.vel.x / sp, dx, b); dz = lerp(p.vel.z / sp, dz, b);
      l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    // smooth the heading itself, so a wobbly velocity does not shake the view
    const kh = snap || !st.init ? 1 : follow(C.aim * 0.6, dt);
    st.dirX = lerp(st.dirX, dx, kh); st.dirZ = lerp(st.dirZ, dz, kh);
    l = Math.hypot(st.dirX, st.dirZ) || 1; dx = st.dirX / l; dz = st.dirZ / l;
    const base = p.pos.y - p.radius;
    // on a steep run the ground behind the drop is high and would lift the camera far above it (small drops, seen
    // from the top): closer and lower there, by the bed slope over +-10 m, smoothed
    const a = Math.max(0, i - 5), b = Math.min(path.n - 1, i + 5), slope = Math.max(0, path.y[a] - path.y[b]) / Math.max(path.s[b] - path.s[a], 1);
    const steep = Math.min(slope / C.steep.slope, 1);
    st.steep = snap || !st.init ? steep : lerp(st.steep, steep, follow(1.5, dt));
    // a bigger drop and its rivulet get more room (drop-look.js framing), eased in as the water comes and goes
    const fr = framing(p, LOOK), kf = snap || !st.init ? 1 : follow(1.2, dt);
    st.frameBack = lerp(st.frameBack, fr.back, kf); st.frameUp = lerp(st.frameUp, fr.up, kf);
    const back = C.back * lerp(1, C.steep.back, st.steep) * st.frameBack, up = C.up * lerp(1, C.steep.up, st.steep) * st.frameUp;
    // the offset from the drop is smoothed (heading above, height here), not the camera position, so the
    // camera does not fall behind at 40 m/s
    const bx = p.pos.x - dx * back, bz = p.pos.z - dz * back;
    let wantUp = Math.max(base, ground(bx, bz)) + up - base;
    // above the ground, also a little to every side (on a steep face the slope beside the camera rises within the
    // near plane), and the ground never between the camera and the drop
    let need = ground(bx, bz) + C.clearance - base;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      need = Math.max(need, ground(bx + Math.cos(a) * C.clearance, bz + Math.sin(a) * C.clearance) + C.clearance * 0.5 - base);
    }
    for (let k = 1; k <= 4; k++) {
      const f = k / 5, g = ground(lerp(bx, p.pos.x, f), lerp(bz, p.pos.z, f)) + 0.6 - base; // the line of sight passes above this
      const lineY = lerp(wantUp, 0.7, f);
      if (g > lineY) need = Math.max(need, wantUp + (g - lineY) / (1 - f));
    }
    wantUp = Math.max(wantUp, need);
    const jump = snap || !st.init || (pos.x - bx) ** 2 + (pos.z - bz) ** 2 > 3600;
    st.up = jump ? wantUp : lerp(st.up, wantUp, follow(C.follow, dt));
    st.up = Math.max(st.up, need);
    pos.set(bx, base + st.up, bz);
    // aim: yaw along the heading (blended toward the look-ahead point), pitch so the drop sits at C.dropAt of the
    // view height whatever the slope; the pitch is smoothed, the yaw follows the smoothed heading
    const lx = lerp(p.pos.x, ax, 0.5) + dx * C.lookAhead * 0.5 - pos.x, lz = lerp(p.pos.z, az, 0.5) + dz * C.lookAhead * 0.5 - pos.z;
    const toDrop = Math.atan2(base + C.dropHeight * visualRadius(p, LOOK.grow) - pos.y, Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z));
    // on steep runs the drop sits lower in the view, so the view still reaches the horizon and the painted massif
    const dropAt = lerp(C.dropAt, C.steep.dropAt ?? C.dropAt, st.steep);
    const offset = Math.atan((dropAt - 0.5) * 2 * Math.tan((C.fov * Math.PI) / 360));
    let pitch = toDrop + offset;
    // a drop in the air off a step of a steep face is level with the camera, and the view would rise into the sky
    // with the face out of sight under it: the course ahead stays in view, at most C.keepAhead of the half height
    // under the centre (null: off), and the drop never leaves it
    if (Number.isFinite(C.keepAhead)) {
      const half = (C.fov * Math.PI) / 360, ahead = Math.atan2(path.y[j] - pos.y, Math.hypot(path.x[j] - pos.x, path.z[j] - pos.z));
      pitch = Math.max(Math.min(pitch, ahead + C.keepAhead * half), toDrop - 0.55 * half);
    }
    st.pitch = jump ? pitch : lerp(st.pitch, pitch, follow(C.aim, dt));
    st.init = true;
    const hl = Math.hypot(lx, lz) || 1, cp = Math.cos(st.pitch);
    tmp.set(pos.x + (lx / hl) * cp * 10, pos.y + Math.sin(st.pitch) * 10, pos.z + (lz / hl) * cp * 10);
    cam.position.copy(pos); cam.lookAt(tmp); cam.updateMatrixWorld();
  }
  function reset() { st.init = false; st.hint = -1; st.path = -1; }
  return { camera: cam, update, reset, state: st };
}

