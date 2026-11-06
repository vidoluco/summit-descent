// The players' drops: a glossy smooth teardrop with a cute face (two dark oval eyes with a highlight, a small
// smile), P1 blue and P2 pink. It visibly grows with its water (drop-look.js: faster than the sim's cube root
// radius and rounder, on a spring, so every pickup pops it bigger with a jiggle, a glow and a ripple ring over the
// water, and a sip or a boost wobbles it smaller), and past the size a drop can hold the extra water streams behind
// it as a flat foamy wake (drop-tail.js). Squash and stretch from speed and landings, a lean into turns, a
// snowflake-white tint while it melts at the start, an ice cube when frozen, a fade and rise when it evaporates, a
// churning foam collar where it sits in the water (tilted to the slope of the run). Its round bottom clears the
// drawn ground all around it (a bank, a slope), not only under its centre. The face turns toward the camera of the
// view being drawn, and the other player's drop fades when it passes right by that camera.
// It is drawn after the spray (renderOrder 4 > 3, the spray writes no depth): no particle ever lands on a face.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, follow, lerp } from './math.js';
import { bodyScale, lookOf } from './drop-look.js';
import { createTail } from './drop-tail.js';

export const UNIT_H = 1.36; // height of the unit teardrop (radius 0.5 at its widest)

// The drop of the HUD icon (src/ui/icons.js DROP, 'M32 4 C 40 22 58 38 58 55 A 26 26 0 0 1 6 55 ...'), in units of
// its radius and a little lower (the icon is 1.48 tall, the reference's drops about 1.3): a round bottom (a half
// sphere up to y 0.5, the widest point at 37 % of the height), then plump convex sides up to a short tip. Speed
// stretches it only a little (theme.drop.squashMax).
export function dropProfile(n = 56) {
  const pts = [], nb = Math.round(n * 0.4), k = (UNIT_H - 0.5) / 0.98;
  for (let i = 0; i <= nb; i++) { const a = (i / nb) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.max(0.5 * Math.sin(a), 0.0001), 0.5 - 0.5 * Math.cos(a))); }
  const P = [[0.5, 0.5], [0.5, 0.5 + 0.327 * k], [0.154, 0.5 + 0.635 * k], [0, UNIT_H]];
  for (let i = 1; i <= n - nb; i++) {
    const t = i / (n - nb), u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const x = w.reduce((s, k, j) => s + k * P[j][0], 0), y = w.reduce((s, k, j) => s + k * P[j][1], 0);
    pts.push(new THREE.Vector2(Math.max(x, 0.0001), y));
  }
  return pts;
}

// Radius of the unit drop at height y (0..UNIT_H), for placing the face on the shell.
const PROFILE = dropProfile(400);
export function dropRadiusAt(y) {
  for (let i = 1; i < PROFILE.length; i++) {
    const a = PROFILE[i - 1], b = PROFILE[i];
    if (y <= b.y) return a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y || 1));
  }
  return 0;
}

let sharedGeo = null;
const dropGeometry = () => sharedGeo || (sharedGeo = new THREE.LatheGeometry(dropProfile(), 64));

// Eye ring at EYE_Y, the smile under it: both above the waterline even when the drop sits a little in the water.
const EYE_Y = 0.6, SMILE_Y = 0.4;

function face(dark, theme) {
  const D = theme.drop, g = new THREE.Group();
  const white = new THREE.MeshBasicMaterial({ color: D.eyeWhite, transparent: true }), black = new THREE.MeshBasicMaterial({ color: D.eye, transparent: true });
  const mats = [white, black];
  const lookOut = new THREE.Vector3();
  // the shell leans back above its widest point: the eyes lie on it (facing along its normal), not upright
  const re = dropRadiusAt(EYE_Y), lean = (dropRadiusAt(EYE_Y - 0.02) - dropRadiusAt(EYE_Y + 0.02)) / 0.04;
  for (const sg of [-1, 1]) {
    const ex = sg * 0.16, ey = EYE_Y, r = Math.sqrt(Math.max(0, re * re - ex * ex));
    // the surface normal there (a surface of revolution: x / r, -dr/dy, z / r); each disc sits just off the shell along it
    const nrm = new THREE.Vector3(ex / re, lean, r / re).normalize();
    const disc = (radius, segs, mat, dx, dy, off) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(radius, segs), mat);
      m.position.set(ex + dx, ey + dy, r).addScaledVector(nrm, off);
      m.lookAt(lookOut.copy(m.position).add(nrm));
      return m;
    };
    const rim = disc(0.105, 32, white, 0, 0, 0.008); rim.scale.set(0.86, 1, 1);
    const eye = disc(0.07, 32, black, 0, -0.004, 0.012); eye.scale.set(0.82, 1, 1);
    const hl = disc(0.022, 16, white, 0.02, 0.026, 0.016);
    g.add(rim, eye, hl);
  }
  const curve = new THREE.EllipseCurve(0, 0, 0.07, 0.045, Math.PI * 1.15, Math.PI * 1.85);
  const sp = curve.getPoints(20).map((p) => { const rs = dropRadiusAt(SMILE_Y + p.y); return new THREE.Vector3(p.x, SMILE_Y + p.y, Math.sqrt(Math.max(0, rs * rs - p.x * p.x)) * 0.99 + 0.012); });
  const smile = new THREE.MeshBasicMaterial({ color: D.smile || dark, transparent: true });
  mats.push(smile);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 20, 0.012, 6), smile));
  return { group: g, mats };
}

// The foam collar where the drop sits in the water: a white band with a ragged, churning outer edge, pushed out
// into a bow in front at speed, and loose flecks of foam around it. In the ring's own plane (unit drop radius 0.5).
function collarMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uA: { value: 1 }, uTime: { value: 0 }, uDir: { value: new THREE.Vector2(0, 1) }, uBow: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      varying vec2 vP; uniform float uA, uTime, uBow; uniform vec2 uDir;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float r = length(vP); vec2 d = vP / max(r, 1e-4);
        float front = dot(d, uDir), ang = atan(d.y, d.x);
        // ragged outer edge, churning, pushed out ahead of the drop
        float edge = 0.6 + 0.07 * n2(vec2(ang * 3.0, uTime * 2.0)) + 0.05 * n2(vec2(ang * 9.0, -uTime * 3.0)) + uBow * 0.14 * max(front, 0.0);
        float band = smoothstep(0.44, 0.5, r) * (1.0 - smoothstep(edge - 0.025, edge, r));
        // flecks just outside, drifting back along the flow
        float fleck = step(0.72, n2(vP * 11.0 + uDir * uTime * 3.0)) * (1.0 - smoothstep(edge, edge + 0.22, r)) * step(edge, r);
        float a = max(band, fleck * 0.9);
        if (a * uA < 0.02) discard;
        vec3 c = mix(vec3(0.82, 0.92, 1.0), vec3(1.0), smoothstep(0.5, 0.56, r));
        gl_FragColor = vec4(c, a * uA);
      }`,
  });
}

// The ripple a pickup sends out: a thin foam ring in the ring's own plane, widening and fading.
function rippleMaterial() {
  return new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// Lowest base (the bottom of the round body) at which a sphere of radius r over (x, z) clears the ground g(x, z):
// sampled under its centre and on two rings of eight points, each asking centre >= ground + sqrt(r^2 - d^2).
const RINGS = [0.5, 0.92], DIRS = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
export function groundClearance(g, x, z, r) {
  let base = g(x, z);
  for (const f of RINGS) {
    const d = f * r, rise = Math.sqrt(r * r - d * d) - r;
    for (const [cx, cz] of DIRS) base = Math.max(base, g(x + cx * d, z + cz * d) + rise);
  }
  return base;
}

function blobMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uA: { value: 0.3 } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vU; uniform float uA; void main(){ float r = length(vU); gl_FragColor = vec4(0.04, 0.08, 0.12, uA * (1.0 - smoothstep(0.2, 1.0, r))); }',
  });
}

// theme.drop.look: overrides of DROP_LOOK (drop-look.js); tail: false draws no wake
export function createDrop(slot, theme, envMap) {
  const LK = lookOf(theme), G = LK.grow, TL = LK.tail;
  const D = theme.drop, color = new THREE.Color(D.colors[slot % D.colors.length]), dark = D.outline[slot % D.outline.length];
  const root = new THREE.Group(), tilt = new THREE.Group(), body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  const mat = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: D.gloss, clearcoat: 1, clearcoatRoughness: 0.08,
    envMap, envMapIntensity: 0.8, transparent: true });
  const shell = new THREE.Mesh(dropGeometry(), mat); shell.castShadow = true; shell.renderOrder = 4;
  const f = face(dark, theme);
  f.group.traverse((o) => { o.renderOrder = 4; });
  body.add(shell, f.group);
  // ice cube around the drop
  const iceMat = new THREE.MeshPhysicalMaterial({ color: D.ice, roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0, envMap, envMapIntensity: 1.2, depthWrite: false });
  const ice = new THREE.Mesh(new RoundedBoxGeometry(1.25, 1.6, 1.25, 3, 0.18), iceMat);
  ice.position.y = 0.76; ice.rotation.set(0.12, 0.5, -0.08); ice.renderOrder = 6;
  body.add(ice);
  // waterline ring and soft blob shadow (not scaled by the squash)
  const ringMat = collarMaterial();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.95, 64, 1), ringMat); ring.renderOrder = 5;
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.5, 64, 1), rippleMaterial()); ripple.renderOrder = 5; ripple.visible = false;
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), blobMaterial()); blob.rotation.x = -Math.PI / 2;
  root.add(ring, ripple, blob);
  // the wake behind it, in the stage frame relative to the root (which only moves, never turns or scales)
  const tail = TL ? createTail(D.colors[slot % D.colors.length], theme, TL) : null;
  if (tail) root.add(tail.group);
  root.visible = false;

  const white = new THREE.Color('#ffffff'), baseColor = color.clone(), snow = new THREE.Color(D.snow), frost = new THREE.Color(D.ice), tmpC = new THREE.Color();
  const st = { yaw: 0, vy: 0, squash: 0, squashV: 0, lean: 0, back: 0, prevStatus: '', fade: 1, pop: 1, inWater: false, waterY: 0, scale: 1,
    rv: 0, rvV: 0, mass: -1, flash: 0, slope: 0, sx: 0, sy: 0, sz: 0, gulp: 1e9, sight: 0, near: 1 };
  // the surface the drop just ran over (the stretch its chase camera looks across): a ring of points every 0.5 m
  const SN = 48, bx = new Float32Array(SN), by = new Float32Array(SN), bz = new Float32Array(SN);
  let bHead = 0, bCount = 0;

  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), tiltQ = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();

  // p: sim player; dt: s; water: { inWater, waterY, groundY, waterUp } for the float, the ring and the shadow, and
  // optionally groundAt(x, z) (the drawn ground, for the clearance) and camera (its chase camera's position)
  function update(p, dt, water) {
    if (!p) { root.visible = false; return; }
    root.visible = true;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    // heading of the motion and the turn rate
    let yaw = st.yaw;
    if (sp > 0.5) {
      const target = Math.atan2(p.vel.x, p.vel.z);
      let dy = target - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const k = follow(8, dt); yaw = st.yaw + dy * k;
      const rate = dt > 0 ? (dy * k) / dt : 0;
      st.lean = lerp(st.lean, clamp(-rate * D.lean * (sp / 30), -D.leanMax, D.leanMax), follow(6, dt));
    } else st.lean = lerp(st.lean, 0, follow(4, dt));
    st.yaw = yaw;
    // squash and stretch: stretch with speed (and boost), a damped spring on landing and bumps
    if (st.prevStatus === 'airborne' && p.status === 'rolling') st.squashV -= 3.5;
    // stepped at 120 Hz at most, like the size spring: one step of a whole frame at a sped-up clock (0.17 s at
    // ?speed=10) is unstable, and the squash then grows without bound until the drop and its tail are drawn at NaN
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      st.squashV += (-90 * st.squash - 9 * st.squashV) * h; st.squash += st.squashV * h;
    }
    const stretch = clamp(sp * D.squash + (p.boost > 0 ? 0.05 : 0), 0, D.squashMax) + st.squash;
    // a grown drop is rounder too (its belly, not only its size)
    const sy = 1 + stretch, sxz = (1 / Math.sqrt(Math.max(sy, 0.3))) * (1 + G.belly * clamp(bodyScale(p.mass ?? 1, G) - 1, 0, 1));
    st.back = lerp(st.back, clamp(sp / 40, 0, 1) * 0.15, follow(5, dt));
    // evaporation / respawn / finish
    const gone = p.status === 'evaporated' || p.status === 'finished';
    st.fade = clamp(st.fade + (gone ? -dt / D.evaporate : dt * 3), 0, 1);
    if (st.prevStatus === 'evaporated' && p.status !== 'evaporated') st.pop = 0.35;
    st.pop = lerp(st.pop, 1, follow(7, dt));
    // drawn size: a spring toward the size of this mass, snapped on a new stage or a respawn; water gained pops it
    // (the spring overshoots, the body jiggles and glows), water lost wobbles it
    const mass = p.mass ?? 1, rvT = (p.radius / Math.cbrt(Math.max(mass, 0.01))) * bodyScale(mass, G);
    if (!st.prevStatus || st.mass < 0 || (st.prevStatus === 'evaporated' && p.status !== 'evaporated')) { st.rv = rvT; st.rvV = 0; if (!st.prevStatus) { tail?.reset(); bCount = 0; st.sight = 0; } }
    else {
      const dm = mass - st.mass;
      if (dm > 0.04) { st.flash = G.flash; st.squashV -= 2.4; st.rvV += G.kick * rvT * Math.min(dm / 0.2, 2); st.gulp = 0; }
      else if (dm < -0.02) { st.squashV += 1.6; st.rvV -= G.shrink * rvT * Math.min(-dm / 0.2, 2); }
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        st.rvV += (G.stiffness * (rvT - st.rv) - G.damping * st.rvV) * h; st.rv += st.rvV * h;
      }
    }
    st.mass = mass;
    st.flash = lerp(st.flash, 0, follow(4, dt));
    st.prevStatus = p.status;
    const scale = (D.height * st.rv) / UNIT_H * st.pop * (gone ? lerp(0.6, 1, st.fade) : 1);
    st.scale = scale;
    // float: in the water the drop never sits deeper than D.float of its height, so its face stays above the sheet
    let baseY = p.pos.y - p.radius, floatY = -Infinity;
    // and on a steep run it rises toward the water just upstream, which the chase camera looks over (up to sitting
    // on the surface, never above it)
    if (water.inWater && p.status !== 'airborne') {
      // on a steep chute the sheet rises toward the camera across the drop's own width: its round bottom sits on the
      // sloping surface (tangent to it, lifted by r (sqrt(1 + slope^2) - 1)), or the sheet cuts it off below the eyes
      const h = UNIT_H * scale * sy, r = 0.5 * scale * sxz, onSlope = r * (Math.sqrt(1 + st.slope * st.slope) - 1);
      baseY = floatY = Math.max(baseY, water.waterY - D.float * h + onSlope, Math.min((water.waterUp ?? water.waterY) - D.floatUp * h, water.waterY + onSlope));
    } else if (p.status === 'rolling') {
      // on the ground (a bank, a meadow) it stands on the drawn ground rather than sinking into it
      baseY = Math.max(baseY, water.groundY - 0.03 * UNIT_H * scale);
    }
    // and its round bottom clears the ground all around it: on a slope or at a bank the uphill side cut into it
    if (p.status !== 'airborne' && water.groundAt) baseY = Math.max(baseY, groundClearance(water.groundAt, p.pos.x, p.pos.z, 0.5 * scale * sxz) - 0.03 * UNIT_H * scale);
    // its face always clears the surface its own chase camera looks across: below the lip of a step the foam just
    // upstream would hide all but its eyes, so there it rides up on the whitewater, as much as that takes
    baseY += sightLift(p, baseY, water.inWater ? water.waterY : water.groundY, UNIT_H * scale * sy, water.camera, dt);
    root.position.set(p.pos.x, baseY + (gone ? (1 - st.fade) * 3 : 0) + D.bob * Math.sin(performance.now() / 260 + p.slot * 2) * (p.status === 'rolling' ? 1 : 0), p.pos.z);
    tilt.rotation.set(-st.back, yaw, st.lean, 'YXZ');
    tilt.scale.set(scale * sxz, scale * sy, scale * sxz);
    // material state: melt (snowflake white), ice, fade
    const melt = p.melt ?? 1;
    tmpC.copy(snow).lerp(baseColor, clamp(melt, 0, 1));
    mat.color.copy(tmpC); mat.emissive.copy(tmpC);
    mat.emissiveIntensity = 0.22 + st.flash;
    if (st.flash > 0.01) mat.emissive.lerp(white, st.flash * 0.6);
    // a rising freeze frosts the shell (pale icy tint, a twinkle); the cube only shows once the drop is frozen
    const frozen = p.status === 'frozen', fr = frozen ? 1 : clamp(p.freeze || 0, 0, 1);
    iceMat.opacity = lerp(iceMat.opacity, frozen ? D.iceOpacity : 0, follow(frozen ? 10 : 6, dt));
    ice.visible = iceMat.opacity > 0.01;
    if (fr > 0) {
      mat.color.lerp(frost, fr * 0.55);
      mat.emissive.lerp(frost, fr * (0.45 + 0.25 * Math.sin(performance.now() / 90 + p.slot * 3)));
    }
    if (frozen) mat.color.lerp(snow, 0.35);
    mat.opacity = st.fade;
    for (const m of f.mats) m.opacity = st.fade;
    shell.visible = f.group.visible = st.fade > 0.01;
    // ring on the water, shadow on whatever is below
    st.inWater = water.inWater; st.waterY = water.waterY;
    // pushed up out of the water by a bank, it sits on the bank: no collar, no wake there
    const onWater = water.inWater && p.status !== 'airborne' && baseY - st.sight < floatY + 0.04 * UNIT_H * scale;
    ring.visible = onWater && st.fade > 0.2;
    ring.position.set(0, (water.waterY - baseY) + 0.03, 0); ring.scale.setScalar(scale * (1 + 0.06 * Math.sin(performance.now() / 300 + p.slot)));
    // the collar lies on the water, which slopes down the run: tilted to the slope the drop just came down (its
    // surface drop over the last metres), or its upstream half would sink under the sheet
    const run = Math.hypot(p.pos.x - st.sx, p.pos.z - st.sz);
    if (!onWater || run > 20) { st.sx = p.pos.x; st.sy = water.waterY; st.sz = p.pos.z; if (!onWater) st.slope = 0; }
    else if (run > 1.5) {
      st.slope = lerp(st.slope, clamp((st.sy - water.waterY) / run, 0, 1.2), follow(6, dt));
      st.sx = p.pos.x; st.sy = water.waterY; st.sz = p.pos.z;
    }
    if (sp > 0.5) nrm.set(st.slope * p.vel.x / sp, 1, st.slope * p.vel.z / sp).normalize(); else nrm.copy(UP);
    ring.quaternion.copy(tiltQ.setFromUnitVectors(UP, nrm).multiply(flat));
    const U = ringMat.uniforms;
    U.uA.value = st.fade; U.uTime.value += dt; U.uBow.value = clamp(sp / 30, 0, 1);
    // the ring lies in its xy plane turned flat: the world heading (x, z) is (x, -z) there
    if (sp > 0.5) U.uDir.value.set(p.vel.x / sp, -p.vel.z / sp);
    // the gulp: a ripple ring widening from the drop over the water (or the ground) right after a pickup
    st.gulp += dt;
    const gk = st.gulp / G.gulp;
    ripple.visible = gk < 1 && st.fade > 0.2 && p.status !== 'airborne';
    if (ripple.visible) {
      ripple.position.set(0, (onWater ? water.waterY : water.groundY) - baseY + 0.05, 0);
      ripple.quaternion.copy(ring.quaternion);
      ripple.scale.setScalar(scale * (1.1 + 2.2 * Math.sqrt(gk)));
      ripple.material.opacity = 0.85 * Math.pow(1 - gk, 1.5) * st.fade;
    }
    blob.position.set(0, (water.inWater ? water.waterY : water.groundY) - baseY + 0.03, 0);
    blob.scale.setScalar(scale * (p.status === 'airborne' ? 0.7 : 1));
    blob.material.uniforms.uA.value = 0.32 * st.fade;
    if (tail) tail.update(p, dt, water.inWater ? water.waterY : water.groundY, st.rv, root.position, st.fade, onWater);
  }

  // How far the drop must rise so that the line from its chase camera c (as of the last frame) to the lower part of
  // its face passes over every point of the surface it just ran, between the two; smoothed, quick up and slow down.
  function sightLift(p, baseY, surfY, h, c, dt) {
    const air = p.status === 'airborne';
    if (bCount && (p.pos.x - bx[(bHead + SN - 1) % SN]) ** 2 + (p.pos.z - bz[(bHead + SN - 1) % SN]) ** 2 > 400) bCount = 0; // a respawn
    if (!air && Number.isFinite(surfY) && (!bCount || (p.pos.x - bx[(bHead + SN - 1) % SN]) ** 2 + (p.pos.z - bz[(bHead + SN - 1) % SN]) ** 2 > 0.25)) {
      bx[bHead] = p.pos.x; by[bHead] = surfY; bz[bHead] = p.pos.z; bHead = (bHead + 1) % SN; bCount = Math.min(bCount + 1, SN);
    }
    let want = 0;
    if (c && !air && p.status !== 'evaporated' && p.status !== 'finished') {
      const D2 = Math.hypot(c.x - p.pos.x, c.z - p.pos.z), e = D.sightAt * h;
      for (let k = 0; k < bCount; k++) {
        // t: share of the way from the drop to the camera (points past the camera are not between the two)
        const i = (bHead - 1 - k + SN) % SN, t = Math.hypot(bx[i] - p.pos.x, bz[i] - p.pos.z) / Math.max(D2, 1e-3);
        if (t <= 0.05 || t >= 0.8 || Math.hypot(c.x - bx[i], c.z - bz[i]) > D2) continue;
        // the line at that point: (base + e) (1 - t) + camera y t, above the surface there
        want = Math.max(want, (by[i] + 0.05 - c.y * t) / (1 - t) - e - baseY);
      }
      want = clamp(want, 0, D.sightMax * h);
    }
    if (!Number.isFinite(want)) want = 0;
    st.sight = lerp(st.sight, want, follow(want > st.sight ? 14 : 3, dt));
    return st.sight;
  }

  // face toward a camera (yaw of the body inside the tilt frame); own: the position of the drop that camera chases.
  // A drop well in front of it (the other player's, passing between the camera and its drop) fades to a ghost, or
  // it would fill the view and hide the HUD corner
  function faceCamera(cam, own) {
    const dx = cam.position.x - root.position.x, dz = cam.position.z - root.position.z;
    body.rotation.y = Math.atan2(dx, dz) - st.yaw;
    const d = Math.hypot(dx, dz, cam.position.y - root.position.y), ref = own ? cam.position.distanceTo(own) : 0;
    const k = ref > 0 ? clamp((d - 0.45 * ref) / (0.35 * ref), 0, 1) : 1, near = Math.max(0.22, k * k * (3 - 2 * k));
    st.near = near;
    // a ghost writes no depth (no outline drawn round it, nothing hidden behind it) and its face goes first
    mat.opacity = st.fade * near; mat.depthWrite = near > 0.95;
    for (const m of f.mats) { m.opacity = st.fade * near * near; m.depthWrite = near > 0.95; }
  }
  return { root, update, faceCamera, state: st, material: mat, tail };
}

// Small water drops to pick up, instanced (no face).
export function createPickups(theme, envMap, cap = 96) {
  const geo = dropGeometry().clone();
  const mat = new THREE.MeshPhysicalMaterial({ color: theme.drop.colors[0], emissive: '#3c8fd8', emissiveIntensity: 0.25, roughness: 0.15, clearcoat: 1, envMap, envMapIntensity: 0.9 });
  mat.color.set('#7cc6f2');
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function update(pickups, t) {
    let n = 0;
    for (let i = 0; i < pickups.length && n < cap; i++) {
      const pk = pickups[i];
      if (!pk.active) continue;
      q.setFromAxisAngle(up, t * 1.5 + pk.id);
      const k = 0.55 + 0.04 * Math.sin(t * 4 + pk.id);
      m4.compose(v.set(pk.pos.x, pk.pos.y - 0.2 + 0.15 * Math.sin(t * 2.5 + pk.id), pk.pos.z), q, s.set(k, k, k));
      mesh.setMatrixAt(n++, m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}
