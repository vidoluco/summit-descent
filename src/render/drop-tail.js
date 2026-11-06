// The wake behind a grown drop: once a drop holds more water than it can keep round (drop-look.js), the extra
// streams out behind it as a little torrent of its own, lying flat on the river along the path it just ran. It
// leaves the drop's back narrow and fans out behind it, translucent water (the river's light colour with a little of
// the drop's), foam lines along its two edges and white streaks running back along the flow, a thin rim in a light
// tone of the drop's colour (never a dark ink: it is water, not a body), and it fades out to nothing within a few
// body radii, so it never reaches the chase camera. Its line follows the path but bends at most theme.tail.bend
// sideways per metre (a rock hit turns the drop at once, its wake swings round smoothly), and it only lies on
// water: on a bank it fades away. Droplets are thrown off its sides at speed and in a burst when water is spent
// (a boost, a sip, a steal). It lengthens as water arrives and is pulled in fast when spent.
// One small dynamic mesh and a few instanced droplets per drop, rewritten on the CPU each frame (no allocation).
import * as THREE from 'three';
import { DROP_LOOK, tailLength, tailSpread, tailWidth } from './drop-look.js';
import { clamp, follow, hash3, lerp } from './math.js';

const SEG = 32, ACROSS = 6; // samples along, quads across (a flat strip on the surface)
const HIST = 200; // recorded points of the path behind the drop
const DROPS = 36; // droplets in the pool of one drop
export const LIFT = 0.05; // m the wake lies above the water surface (with a polygon offset against it)

function tailMaterial(color, theme, L) {
  const c = new THREE.Color(color), W = theme.water;
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: {
      uWater: { value: new THREE.Color(W.light).lerp(c, L.tint) }, uDeep: { value: new THREE.Color(W.base).lerp(c, L.tint * 0.8) },
      uFoam: { value: new THREE.Color(W.foam) }, uRimColor: { value: c.clone().lerp(new THREE.Color('#ffffff'), 0.35) },
      uTime: { value: 0 }, uLen: { value: 1 }, uOpacity: { value: 1 }, uMid: { value: L.opacity }, uRim: { value: L.rim },
    },
    vertexShader: /* glsl */`
      attribute vec2 flow; varying vec2 vF; varying vec3 vW;
      void main(){ vF = flow; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uWater, uDeep, uFoam, uRimColor; uniform float uTime, uLen, uOpacity, uMid, uRim; varying vec2 vF; varying vec3 vW;
      float h1(float x){ return fract(sin(x * 91.3) * 43758.5); }
      float n1(float x){ float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){
        float u = vF.x / uLen, across = vF.y, edge = min(across, 1.0 - across) * 2.0; // 0 at the edges, 1 in the middle
        // the water of the wake: lighter in its middle, a touch deeper toward the edges
        vec3 c = mix(uDeep, uWater, smoothstep(0.0, 0.8, edge));
        // white streaks running back along the flow (the river slides past the drop): five lanes, tapered dashes
        float x = across * 5.0 + 0.15 * sin(vF.x * 0.9 + floor(across * 5.0) * 2.1 - uTime * 3.0);
        float lane = floor(x), inLane = abs(fract(x) - 0.5);
        float per = 1.4 + h1(lane) * 1.2, ph = fract(vF.x / per - uTime * 2.2 + h1(lane + 3.0) * 7.0), seg = ph / 0.45;
        float wdt = 0.14 * sin(3.14159 * clamp(seg, 0.0, 1.0));
        float dash = step(seg, 1.0) * (1.0 - smoothstep(wdt - 0.05, wdt, inLane)) * step(0.35, h1(lane + floor(vF.x / per) * 5.0));
        // foam lines along both edges of the fan, broken up and thinning out with it
        float lipW = 0.2 + 0.12 * n1(vF.x * 1.9 - uTime * 3.5 + across * 7.0);
        float lip = (1.0 - smoothstep(uRim, uRim + lipW, edge)) * step(uRim, edge) * (1.0 - smoothstep(0.55, 1.0, u));
        float foam = clamp(max(lip, dash * 0.8), 0.0, 1.0);
        c = mix(c, uFoam, foam);
        // the rim: a light tone of the drop's colour outside the foam, where the wake leaves the drop (it melts into
        // the river farther back); the outermost sliver feathered, so the fan has no hard glassy edge
        float rim = (1.0 - step(uRim, edge)) * (1.0 - smoothstep(0.15, 0.5, u));
        c = mix(c, uRimColor, rim);
        // it fades out along its length, and thins away right under a camera
        float a = uOpacity * mix(uMid, 0.95, max(foam, rim * 0.8)) * pow(1.0 - smoothstep(0.0, 1.0, u), 1.4) * smoothstep(0.0, 0.08, u + 0.02) * smoothstep(0.0, 0.025, edge)
          * smoothstep(2.5, 6.0, length(cameraPosition - vW));
        if (a < 0.02) discard;
        gl_FragColor = vec4(c, a);
      }`,
  });
}

// slot colour, theme; L: DROP_LOOK.tail overrides
export function createTail(color, theme, L = DROP_LOOK.tail) {
  const group = new THREE.Group();
  group.name = 'drop-tail';
  // the strip: SEG + 1 rows of ACROSS + 1 vertices
  const nv = (SEG + 1) * (ACROSS + 1);
  const pos = new Float32Array(nv * 3), flow = new Float32Array(nv * 2), idx = [];
  for (let i = 0; i < SEG; i++) for (let j = 0; j < ACROSS; j++) {
    // wound to face up: rows run back from the drop, columns to its right
    const a = i * (ACROSS + 1) + j, b = a + ACROSS + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('flow', new THREE.BufferAttribute(flow, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const mat = tailMaterial(color, theme, L);
  const tube = new THREE.Mesh(geo, mat);
  tube.frustumCulled = false; tube.renderOrder = 2; tube.visible = false;
  // droplets thrown off the sides: drawn before the drops (renderOrder 3 < 4, no depth write), so none lands on a face
  const dropMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.6), emissive: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.4),
    emissiveIntensity: 0.55, transparent: true, opacity: 0.95, depthWrite: false });
  const drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), dropMat, DROPS);
  drops.count = 0; drops.frustumCulled = false; drops.renderOrder = 3; drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(tube, drops);

  // the path behind the drop (stage frame): a ring buffer of points on the surface, newest at head - 1
  const hx = new Float32Array(HIST), hy = new Float32Array(HIST), hz = new Float32Array(HIST);
  let head = 0, count = 0;
  // the polyline the wake is laid on: the live contact point, then the recorded points, with their arc length
  const px = new Float32Array(HIST + 1), py = new Float32Array(HIST + 1), pz = new Float32Array(HIST + 1), ps = new Float32Array(HIST + 1);
  const dp = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 1e9, life: 1, s: 0.05 }));
  let dHead = 0, seed = 1;
  const rnd = () => hash3(seed++, 29, 3);
  // ax, az: the smoothed direction behind the drop (against its motion); wet: 0..1 on the water
  const st = { len: 0, width: 0, spread: 0, time: 0, mass: -1, lx: 0, ly: 0, lz: 0, shown: 0, air: false, n: 1, ax: 0, az: -1, wet: 0, bend: 0 };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), tv = new THREE.Vector3();

  function reset() { head = count = 0; st.len = 0; st.mass = -1; st.wet = 0; tube.visible = false; for (const d of dp) d.age = 1e9; drops.count = 0; }

  function spawn(x, y, z, vx, vy, vz, s, life) {
    const d = dp[dHead]; dHead = (dHead + 1) % DROPS;
    d.x = x; d.y = y; d.z = z; d.vx = vx; d.vy = vy; d.vz = vz; d.s = s; d.life = life; d.age = 0;
  }

  // point at arc length s along the laid polyline (n points), into tv; returns the segment index
  function at(s, n) {
    let k = 1;
    while (k < n - 1 && ps[k] < s) k++;
    const f = clamp((s - ps[k - 1]) / Math.max(ps[k] - ps[k - 1], 1e-4), 0, 1);
    tv.set(lerp(px[k - 1], px[k], f), lerp(py[k - 1], py[k], f), lerp(pz[k - 1], pz[k], f));
    return k;
  }

  // p: sim player; surfY: the surface under it (water or ground, stage frame); rv: drawn body radius (m);
  // origin: the drop root's position (the wake is its child, written relative to it); fade: 0..1 of the drop;
  // onWater: the drop sits in the water (the wake fades in there, out on a bank)
  function update(p, dt, surfY, rv, origin, fade, onWater = true) {
    st.time += dt;
    // a frame with no surface or size under the drop (between stages, at a game clock run many times faster)
    // draws no wake and records nothing, so no NaN reaches the path or the mesh
    if (!Number.isFinite(surfY) || !Number.isFinite(rv) || !Number.isFinite(origin.x + origin.y + origin.z) || !Number.isFinite(p.pos.x + p.pos.z)) {
      tube.visible = false;
      return;
    }
    // in the air the stream breaks up into droplets (as a falling jet does) and gathers again where the drop lands;
    // frozen, its water is in the ice cube
    const air = p.status === 'airborne', live = p.status === 'rolling' || air;
    if (air && !st.air && tube.visible) {
      const len0 = st.shown, k = Math.min(DROPS, Math.round(len0 * 2.5));
      for (let i = 0; i < k; i++) {
        at(rnd() * len0, st.n);
        spawn(tv.x, tv.y + 0.1, tv.z, p.vel.x * 0.85 + (rnd() - 0.5) * 3, 1 + 2 * rnd(), p.vel.z * 0.85 + (rnd() - 0.5) * 3, rv * (0.05 + 0.05 * rnd()), 0.5 + 0.4 * rnd());
      }
    }
    if (!air && st.air) head = count = 0;
    st.air = air;
    // the path: a jump (respawn, stage swap) starts it again
    const cx = p.pos.x, cy = surfY, cz = p.pos.z;
    if (count && (cx - st.lx) ** 2 + (cz - st.lz) ** 2 > 400) reset();
    if (!air && (!count || (cx - st.lx) ** 2 + (cy - st.ly) ** 2 + (cz - st.lz) ** 2 >= L.spacing * L.spacing)) {
      hx[head] = cx; hy[head] = cy; hz[head] = cz; head = (head + 1) % HIST; count = Math.min(count + 1, HIST);
      st.lx = cx; st.ly = cy; st.lz = cz;
    }
    // the direction behind the drop, smoothed: a sudden turn swings the wake round instead of kinking it
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > 1) {
      const k = st.mass < 0 ? 1 : follow(5, dt);
      st.ax = lerp(st.ax, -p.vel.x / sp, k); st.az = lerp(st.az, -p.vel.z / sp, k);
      const al = Math.hypot(st.ax, st.az) || 1; st.ax /= al; st.az /= al;
    }
    st.wet = lerp(st.wet, onWater && !air ? 1 : 0, follow(L.wet, dt));
    // length and widths: toward the mass's, slowly up, fast down; spent water (a drop of the mass) throws droplets
    const m = p.mass ?? 1, want = live ? tailLength(m, L) * rv : 0, wantW = tailWidth(m, L), wantS = tailSpread(m, L);
    st.len = lerp(st.len, want, follow(want > st.len ? L.grow : L.shrink, dt));
    const kw = st.mass < 0 ? 1 : follow(wantW > st.width ? L.grow : L.shrink, dt);
    st.width = lerp(st.width, wantW, kw); st.spread = lerp(st.spread, wantS, kw);
    const lost = st.mass >= 0 ? st.mass - m : 0;
    st.mass = m;
    // lay the polyline: the contact point now, then back through the recorded path
    px[0] = cx; py[0] = cy; pz[0] = cz; ps[0] = 0;
    let n = 1;
    for (let k = 0; k < count && ps[n - 1] < st.len + 1; k++) {
      const i = (head - 1 - k + HIST) % HIST;
      const l = Math.hypot(hx[i] - px[n - 1], hy[i] - py[n - 1], hz[i] - pz[n - 1]);
      if (l < 1e-3) continue;
      px[n] = hx[i]; py[n] = hy[i]; pz[n] = hz[i]; ps[n] = ps[n - 1] + l; n++;
    }
    const len = Math.min(st.len, ps[n - 1]);
    const show = !air && len > L.min && fade > 0.05 && st.wet > 0.05 && n > 2;
    st.n = n;
    tube.visible = show;
    st.bend = 0;
    if (show) {
      const ox = origin.x, oy = origin.y, oz = origin.z, ax = st.ax, az = st.az;
      // side vector of the wake (right of the direction behind)
      const sx = -az, sz = ax;
      for (let i = 0; i <= SEG; i++) {
        const s = (len * i) / SEG, u = s / len;
        // the path point here, then its sideways offset from the line straight behind, held to the bend
        at(s, n);
        const lat = clamp((tv.x - cx) * sx + (tv.z - cz) * sz, -L.bend * s, L.bend * s);
        st.bend = Math.max(st.bend, s > 0.5 ? Math.abs(lat) / s : 0);
        const wander = rv * L.meander * Math.sin((s / L.meanderLength - st.time * L.meanderSpeed) * Math.PI * 2) * Math.min(1, s / 3);
        const x = cx + ax * s + sx * (lat + wander), z = cz + az * s + sz * (lat + wander);
        // on the surface where the path ran (a steep run: the water behind is higher), never far off the drop's own
        const y = clamp(tv.y, cy - 0.3 * s, cy + 0.9 * s) + LIFT;
        // half width: out of the drop's back, fanning out behind it in a V (straight foam lines, as behind a boat)
        const w = rv * lerp(st.width, st.spread, Math.pow(u, 0.85)) * (0.85 + 0.15 * fade);
        for (let j = 0; j <= ACROSS; j++) {
          const a = j / ACROSS * 2 - 1, o = (i * (ACROSS + 1) + j) * 3;
          pos[o] = x + sx * w * a - ox; pos[o + 1] = y - oy; pos[o + 2] = z + sz * w * a - oz;
          const f = (i * (ACROSS + 1) + j) * 2; flow[f] = s; flow[f + 1] = j / ACROSS;
        }
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.flow.needsUpdate = true;
      mat.uniforms.uLen.value = len; mat.uniforms.uTime.value = st.time; mat.uniforms.uOpacity.value = fade * st.wet;
      // droplets: off the sides of the front half at speed, and a burst where water was just spent; outside the
      // drawn body and low, so from the chase camera they fly beside the drop, not over its face
      const share = clamp(len / (rv * L.length[1]), 0, 1);
      let k = dt * 14 * share * clamp(sp / 25, 0, 1.5);
      if (lost > 0.02) k += clamp(lost * 100, 3, 14);
      while (k > 0) {
        if (k < 1 && rnd() > k) break;
        k -= 1;
        const s = rv + rnd() * Math.min(len * 0.5, 3), side = rnd() < 0.5 ? -1 : 1;
        const ww = rv * (1.15 + 0.4 * rnd()), out = 1.2 + 2.4 * rnd();
        // they keep most of the water's speed (thrown back toward the camera they would fly into it)
        spawn(cx + ax * s + sx * ww * side, cy + 0.08, cz + az * s + sz * ww * side, sx * out * side + p.vel.x * 0.9, 0.8 + 1.4 * rnd(), sz * out * side + p.vel.z * 0.9,
          rv * (0.035 + 0.035 * rnd()), 0.35 + 0.3 * rnd());
      }
    }
    // droplets fly and fall, drawn relative to the drop root
    let dn = 0;
    for (const d of dp) {
      if (d.age >= d.life) continue;
      d.age += dt; d.vy -= 9.81 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const k = d.s * (1 - Math.pow(d.age / d.life, 3));
      if (k <= 0) continue;
      drops.setMatrixAt(dn++, m4.compose(sv.set(d.x - origin.x, d.y - origin.y, d.z - origin.z), q, tv.set(k, k * 1.25, k)));
    }
    drops.count = dn; drops.instanceMatrix.needsUpdate = dn > 0;
    st.shown = show ? len : 0;
  }

  return { group, update, reset, state: st, material: mat };
}
