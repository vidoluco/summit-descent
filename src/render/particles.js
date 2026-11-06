// Spray: one pooled point cloud for the wake behind the drops, splash bursts (landings, bumps, pickups) and
// the mist at waterfall feet. Fixed-size typed arrays, a ring buffer, no allocation per frame.
import * as THREE from 'three';
import { hash3 } from './math.js';

export function createParticles(theme, shared) {
  const P = theme.particles, N = P.max;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), age = new Float32Array(N), size = new Float32Array(N);
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -1e5;
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('size', aSize); geo.setAttribute('alpha', aAlpha);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { ...shared.fog, uScale: { value: 500 }, uColor: { value: new THREE.Color(P.color) } },
    vertexShader: /* glsl */`attribute float size, alpha; uniform float uScale; varying float vA; varying float vFogDepth; varying float vY;
      void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFogDepth = -mv.z;
        vA = alpha * smoothstep(2.5, 7.0, -mv.z); // spray right at a camera would be a big white blur: fade it out
        gl_PointSize = clamp(size * uScale / max(-mv.z, 0.1), 0.0, 96.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uFogColor; uniform float uFogDensity, uFogFalloff, uFogBase, uFogMax, uFogYOffset;
      uniform vec3 uColor; varying float vA; varying float vFogDepth; varying float vY;
      void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
        float a = vA * (1.0 - smoothstep(0.35, 1.0, r));
        float f = (1.0 - exp(-uFogDensity * vFogDepth)) * exp(-max(vY + uFogYOffset - uFogBase, 0.0) * uFogFalloff);
        gl_FragColor = vec4(mix(uColor, uFogColor, min(f, uFogMax)), a); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 3;
  let head = 0, seed = 1;
  const rnd = () => hash3(seed++, 17, 5);

  // one particle at (x, y, z) with velocity (vx, vy, vz)
  function emit(x, y, z, vx, vy, vz, s = 1) {
    const i = head; head = (head + 1) % N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    age[i] = 0; life[i] = P.life[0] + (P.life[1] - P.life[0]) * rnd();
    size[i] = P.size * s * (0.6 + 0.8 * rnd());
  }
  function burst(x, y, z, n, speed = 4, s = 1) {
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.283, h = 0.4 + rnd();
      emit(x, y, z, Math.cos(a) * speed * (0.4 + rnd()), speed * h, Math.sin(a) * speed * (0.4 + rnd()), s);
    }
  }
  // spray behind a moving drop: (x, y, z) its base, (vx, vz) its velocity
  const carry = [0, 0, 0, 0];
  function wake(slot, x, y, z, vx, vz, radius, dt) {
    const sp = Math.hypot(vx, vz);
    if (sp < 2) return;
    carry[slot] += P.wake * (sp / 30) * dt * 2;
    while (carry[slot] >= 1) {
      carry[slot] -= 1;
      const side = rnd() < 0.5 ? -1 : 1, nx = -vz / sp, nz = vx / sp;
      const ox = nx * side * radius * (0.6 + 0.5 * rnd()), oz = nz * side * radius * (0.6 + 0.5 * rnd());
      emit(x + ox - (vx / sp) * radius * 0.4, y + 0.05, z + oz - (vz / sp) * radius * 0.4,
        vx * 0.25 + nx * side * (1 + 2 * rnd()), 1.2 + 2.2 * rnd() * Math.min(sp / 20, 1.5), vz * 0.25 + nz * side * (1 + 2 * rnd()), 0.8 + radius);
    }
  }
  function update(dt) {
    for (let i = 0; i < N; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; continue; }
      age[i] += dt;
      vel[i * 3 + 1] -= 9.81 * dt;
      const drag = Math.exp(-1.8 * dt);
      vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const u = age[i] / life[i];
      alpha[i] = Math.min(1, u * 8) * (1 - u) * 0.75;
    }
    aPos.needsUpdate = true; aSize.needsUpdate = true; aAlpha.needsUpdate = true;
  }
  function clear() { age.fill(1e9); alpha.fill(0); }
  clear();
  return { points, emit, burst, wake, update, clear, rnd, material: mat };
}
