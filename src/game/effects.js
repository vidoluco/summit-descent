// The game's own touches on top of the renderer, in the same cartoon look: the snowflake that melts into the
// drop at the start, a boost trail, ice shards when a cube breaks, little hearts when an animal drinks, the
// cloud that carries a drop between two stages (with its rain), and a camera kick on hard landings.
// Everything is pooled and reuses its objects; nothing is allocated per frame.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cartoon } from '../render/materials.js';
import { createDrop } from '../render/drop.js';
import { clamp, lerp, smooth } from '../render/math.js';

export const FX = {
  flake: { size: 1.25, spin: 0.6, front: 0.5 }, // x drop radius; rad/s; m toward the camera
  trail: { points: 22, width: 1.0, life: 0.32 }, // samples; x drop radius; s a sample lives (on the water surface)
  shards: { count: 14, life: 1.1, speed: 5.5, size: 0.22 },
  hearts: { max: 18, life: 1.5, rise: 1.6, size: 0.55, toDrop: 0.7 }, // m; fraction of the way from the animal to the drop
  cloud: { size: 2.0, form: 0.8, dissolve: 1.1, rain: 70, near: [10, 18], screen: [0.16, 0.3] }, // m (x the unit cloud, 4.4 m wide); s; s; drops/s;
  // a view whose camera comes nearer than near[1] m (the other drop's camera under a cloud that waits to rain) sees
  // it fade out, gone at near[0]; a cloud's own camera rides at least 21 m behind it. In another drop's view a cloud also
  // fades by its size on screen (radius / half the view height, from screen[0], gone at screen[1]), so it never
  // fills that view and covers its place HUD
  kick: { stiffness: 70, damping: 9, splash: [7, 22], max: 1.3 }, // spring; impact range m/s; m
};

// ---------- geometry ----------

// A six-armed flake with side branches, extruded and bevelled so it reads soft and rounded.
export function flakeGeometry() {
  const half = [[0.16, 0.09], [0.4, 0.065], [0.56, 0.27], [0.62, 0.22], [0.52, 0.06], [0.7, 0.055], [0.83, 0.17], [0.88, 0.13], [0.8, 0.045], [1, 0]];
  const shape = new THREE.Shape();
  let first = true;
  for (let arm = 0; arm < 6; arm++) {
    const a = (arm * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
    // from this arm's -side valley out to the tip and back on the +side
    const pts = [...half.map(([x, y]) => [x, -y]), ...half.slice(0, -1).reverse()];
    for (const [x, y] of pts) {
      const px = x * c - y * s, py = x * s + y * c;
      if (first) { shape.moveTo(px, py); first = false; } else shape.lineTo(px, py);
    }
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, -0.025);
  g.computeVertexNormals();
  return g;
}

// A fluffy cartoon cloud: overlapping spheres with their own smooth normals and a flattened belly.
export function cloudGeometry() {
  const puffs = [[0, 0.1, 0, 1], [0.95, -0.1, 0.1, 0.75], [-0.95, -0.12, -0.05, 0.72], [0.42, 0.55, 0, 0.66], [-0.45, 0.46, 0.12, 0.62],
    [0.05, -0.15, 0.55, 0.72], [0.2, -0.1, -0.6, 0.72], [1.62, -0.3, 0, 0.46], [-1.6, -0.32, 0.05, 0.44]];
  const parts = puffs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 4);
    g.deleteAttribute('uv');
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      // normals of the sphere itself: soft shading without seams where the puffs overlap
      const nx = p.getX(i) / r, ny = p.getY(i) / r, nz = p.getZ(i) / r;
      n.setXYZ(i, nx, ny, nz);
      let yy = p.getY(i) + y;
      if (yy < -0.42) yy = -0.42 - (yy + 0.42) * 0.25;
      p.setXYZ(i, p.getX(i) + x, yy, p.getZ(i) + z);
    }
    return g;
  });
  return mergeGeometries(parts);
}

function heartTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const heart = () => {
    g.beginPath();
    g.moveTo(64, 108);
    g.bezierCurveTo(18, 78, 10, 50, 22, 34);
    g.bezierCurveTo(36, 16, 58, 22, 64, 40);
    g.bezierCurveTo(70, 22, 92, 16, 106, 34);
    g.bezierCurveTo(118, 50, 110, 78, 64, 108);
    g.closePath();
  };
  g.lineJoin = 'round';
  heart(); g.fillStyle = '#ff6fa8'; g.fill();
  g.lineWidth = 7; g.strokeStyle = '#3a1830'; g.stroke();
  g.beginPath(); g.ellipse(42, 42, 9, 6, -0.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- the effects ----------

export function createEffects(r, { slots = 2 } = {}) {
  const scene = r.scene, theme = r.theme, shared = r.shared, envMap = r.envMap, particles = r.particles;
  const root = new THREE.Group();
  root.name = 'game-fx';
  scene.add(root);
  const facing = []; // objects turned toward the camera of each view (scene.onBeforeRender)
  const light = theme.drop.colors.map((c) => new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.55));

  // snowflakes
  const flakeGeo = flakeGeometry();
  const flakes = Array.from({ length: slots }, () => {
    const mat = new THREE.MeshPhysicalMaterial({ color: '#f6fbff', emissive: '#cfe6ff', emissiveIntensity: 0.45, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1,
      envMap, envMapIntensity: 0.9, transparent: true });
    const m = new THREE.Mesh(flakeGeo, mat);
    m.visible = false; m.renderOrder = 2;
    root.add(m);
    const f = { mesh: m, spin: 0, s: 0, pos: new THREE.Vector3(), sparkled: false };
    facing.push((cam) => {
      if (!m.visible) return;
      m.position.copy(f.pos);
      m.quaternion.copy(cam.quaternion);
      m.rotateZ(f.spin);
      // a little toward this camera, so the flake sits in front of the white drop it melts into
      const dx = cam.position.x - f.pos.x, dy = cam.position.y - f.pos.y, dz = cam.position.z - f.pos.z, l = Math.hypot(dx, dy, dz) || 1;
      m.position.x += (dx / l) * f.front; m.position.y += (dy / l) * f.front; m.position.z += (dz / l) * f.front;
      m.updateMatrixWorld(true);
    });
    return f;
  });

  // boost trails: a horizontal ribbon through the last positions, fading with age
  const T = FX.trail;
  const trails = Array.from({ length: slots }, (_, s) => {
    const n = T.points, pos = new Float32Array(n * 2 * 3), alpha = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: light[s % light.length] } },
      vertexShader: 'attribute float alpha; varying float vA; varying float vS; void main(){ vA = alpha; vS = float(gl_VertexID % 2); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; varying float vA; varying float vS; void main(){ float e = 1.0 - abs(vS * 2.0 - 1.0); float core = smoothstep(0.0, 0.8, e); gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6), vA * (0.25 + 0.75 * core)); }',
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.visible = false;
    root.add(mesh);
    return { mesh, pos, alpha, g, pts: Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, age: 1e9 })), head: 0 };
  });

  // ice shards
  const S = FX.shards, shardN = S.count * slots * 2;
  const shardGeo = new THREE.OctahedronGeometry(S.size, 0);
  shardGeo.scale(0.7, 1.6, 0.5);
  const shardMat = new THREE.MeshPhysicalMaterial({ color: theme.drop.ice, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.85, envMap, envMapIntensity: 1.3, flatShading: true });
  const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, shardN);
  shardMesh.count = 0; shardMesh.frustumCulled = false; shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(shardMesh);
  const shards = Array.from({ length: shardN }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler(), w: new THREE.Vector3(), age: 1e9, s: 1 }));
  let shardHead = 0;

  // hearts
  const H = FX.hearts, heartTex = heartTexture();
  const hearts = Array.from({ length: H.max }, () => {
    // alpha-tested and in the depth buffer, so the outline pass does not draw what is behind through the heart
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, alphaTest: 0.5 }));
    sp.visible = false; sp.renderOrder = 4;
    root.add(sp);
    return { sp, age: 1e9, x: 0, y: 0, z: 0, drift: 0, phase: 0 };
  });
  let heartHead = 0;

  // clouds
  const C = FX.cloud, cloudGeo = cloudGeometry();
  const clouds = Array.from({ length: slots }, (_, s) => {
    const mat = cartoon(new THREE.MeshLambertMaterial({ color: '#fffaf7', emissive: new THREE.Color('#ffe4ec'), emissiveIntensity: 0.32, transparent: true }), shared, {});
    const g = new THREE.Group();
    const body = new THREE.Mesh(cloudGeo, mat);
    // no shadow: under the low golden-hour sun a 9 m cloud throws a long grey slab over the pool it rises from
    // a soft tint of the drop's colour under the belly
    const tint = new THREE.Mesh(cloudGeo, new THREE.MeshBasicMaterial({ color: light[s % light.length], transparent: true, opacity: 0.35, depthWrite: false }));
    tint.scale.set(0.92, 0.5, 0.92); tint.position.y = -0.32;
    const drop = createDrop(s, theme, envMap);
    drop.root.scale.setScalar(1);
    g.add(body, tint, drop.root);
    g.visible = false;
    root.add(g);
    const fake = { slot: s, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.42, mass: 1, status: 'rolling', melt: 1, boost: 0, freeze: 0 };
    const c = { g, body, tint, mat, drop, fake, k: 0, want: 0, pos: new THREE.Vector3(), yaw: 0, raining: 0, sway: s * 1.7, opacity: 1, tintOpacity: 0.35, dropOn: false };
    facing.push((cam) => {
      if (!g.visible) return;
      const dist = cam.position.distanceTo(g.position);
      let f = smooth(C.near[0], C.near[1], dist);
      if (cam !== r.cameras[s]) f = Math.min(f, 1 - smooth(C.screen[0], C.screen[1], (2.2 * g.scale.x) / (Math.max(dist, 0.1) * Math.tan((cam.fov * Math.PI) / 360))));
      mat.opacity = c.opacity * f; tint.material.opacity = c.tintOpacity * f;
      body.visible = tint.visible = f > 0.02;
      drop.root.visible = c.dropOn && f > 0.5;
      if (drop.root.visible) { drop.faceCamera(cam); drop.root.updateMatrixWorld(true); }
    });
    return c;
  });
  const noWater = { inWater: false, waterY: -1e5, groundY: -1e5 };

  // camera kicks: a damped spring per view, pushed by hard landings and bumps
  const K = FX.kick;
  const kicks = Array.from({ length: slots }, () => ({ y: 0, v: 0, roll: 0, rv: 0 }));

  const prevScene = scene.onBeforeRender;
  scene.onBeforeRender = (...a) => { prevScene?.(...a); const cam = a[2]; for (const f of facing) f(cam); };

  function burstShards(x, y, z) {
    for (let i = 0; i < S.count; i++) {
      const sh = shards[shardHead]; shardHead = (shardHead + 1) % shardN;
      const a = particles.rnd() * Math.PI * 2, up = 0.5 + particles.rnd();
      sh.p.set(x, y, z);
      sh.v.set(Math.cos(a) * S.speed * (0.4 + particles.rnd()), S.speed * up, Math.sin(a) * S.speed * (0.4 + particles.rnd()));
      sh.rot.set(particles.rnd() * 6, particles.rnd() * 6, particles.rnd() * 6);
      sh.w.set(particles.rnd() * 14 - 7, particles.rnd() * 14 - 7, particles.rnd() * 14 - 7);
      sh.s = 0.6 + 0.8 * particles.rnd(); sh.age = 0;
    }
  }
  function heartAt(x, y, z, n = 2) {
    for (let i = 0; i < n; i++) {
      const h = hearts[heartHead]; heartHead = (heartHead + 1) % hearts.length;
      h.age = -i * 0.18; h.x = x + (particles.rnd() - 0.5) * 0.8; h.y = y; h.z = z + (particles.rnd() - 0.5) * 0.8;
      h.drift = (particles.rnd() - 0.5) * 0.8; h.phase = particles.rnd() * 6;
    }
  }

  // ---------- per frame ----------
  // state: the drawn (interpolated) sim state; events of this frame; dt in s; opts.cloud(slot) -> cloud pose or null
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s4 = new THREE.Vector3();
  function update(state, events, dt, { cloudPose } = {}) {
    const ps = state?.players || [];
    // flakes: full at melt 0, gone into the drop by melt 0.9
    for (let s = 0; s < slots; s++) {
      const f = flakes[s], p = ps[s];
      const melt = p ? p.melt ?? 1 : 1;
      const k = 1 - smooth(0.3, 0.92, melt);
      f.mesh.visible = !!p && k > 0.01 && p.status !== 'evaporated';
      if (!f.mesh.visible) { if (p && melt >= 1) f.sparkled = false; continue; }
      f.spin += FX.flake.spin * dt * (1 + 3 * (1 - k));
      const r = p.radius, h = theme.drop.height * r;
      f.pos.set(p.pos.x, p.pos.y - r + h * 0.42, p.pos.z);
      f.front = FX.flake.front + r * 0.4;
      const sc = FX.flake.size * h * 0.5 * (0.25 + 0.75 * k);
      f.mesh.scale.setScalar(sc);
      f.mesh.material.opacity = clamp(k * 1.6, 0, 1);
      // a few sparkles while it melts
      if (melt > 0.3 && particles.rnd() < dt * 22 * k) {
        const a = particles.rnd() * 6.283;
        particles.emit(f.pos.x + Math.cos(a) * sc, f.pos.y + (particles.rnd() - 0.3) * sc, f.pos.z + Math.sin(a) * sc, Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6, 0.8);
      }
    }

    // trails
    for (let s = 0; s < slots; s++) {
      const tr = trails[s], p = ps[s];
      const on = p && p.boost > 0 && (p.status === 'rolling' || p.status === 'airborne');
      for (const pt of tr.pts) pt.age += dt;
      if (on) {
        const pt = tr.pts[tr.head]; tr.head = (tr.head + 1) % tr.pts.length;
        // on the water surface (or the ground): a streak on the water, not a ribbon through the drop's centre
        // that climbs toward the chase camera on a downhill run and reads as a wall
        const wi = r.waterAt?.(s);
        pt.x = p.pos.x; pt.y = (wi && wi.inWater ? wi.waterY : p.pos.y - p.radius) + 0.04; pt.z = p.pos.z; pt.age = 0;
      }
      let alive = false;
      const n = tr.pts.length, w = T.width * (p?.radius ?? 0.55);
      for (let i = 0; i < n; i++) {
        // newest first
        const pt = tr.pts[(tr.head - 1 - i + n * 2) % n], nx = tr.pts[(tr.head - 2 - i + n * 2) % n];
        const u = clamp(1 - pt.age / T.life, 0, 1);
        if (u > 0) alive = true;
        let dx = pt.x - nx.x, dz = pt.z - nx.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const half = w * 0.5 * (0.35 + 0.65 * u) * (1 - i / n);
        const o = i * 6;
        tr.pos[o] = pt.x - dz * half; tr.pos[o + 1] = pt.y; tr.pos[o + 2] = pt.z + dx * half;
        tr.pos[o + 3] = pt.x + dz * half; tr.pos[o + 4] = pt.y; tr.pos[o + 5] = pt.z - dx * half;
        tr.alpha[i * 2] = tr.alpha[i * 2 + 1] = u * u * 0.85 * (1 - i / n);
      }
      tr.mesh.visible = alive;
      if (alive) { tr.g.attributes.position.needsUpdate = true; tr.g.attributes.alpha.needsUpdate = true; }
    }

    // events: shards, hearts, extra droplets on big falls, camera kicks
    for (const e of events || []) {
      const p = ps[e.slot];
      if (e.kind === 'thaw' && p) burstShards(p.pos.x, p.pos.y, p.pos.z);
      else if (e.kind === 'drink') {
        // between the animal's muzzle and the drop, nearer the drop: the chase camera always frames the drop,
        // while the animal can stand beside the camera, out of the view
        if (p) heartAt(lerp(e.x, p.pos.x, H.toDrop), p.pos.y + p.radius * 1.2, lerp(e.z, p.pos.z, H.toDrop), 2);
        else heartAt(e.x, e.y + 1.2, e.z, 2);
      }
      else if (e.kind === 'splash' && p) {
        const k = clamp((e.intensity - K.splash[0]) / (K.splash[1] - K.splash[0]), 0, 1);
        if (k > 0) { kicks[e.slot].v -= K.max * 9 * k; kicks[e.slot].rv += (particles.rnd() - 0.5) * 0.5 * k; }
        const n = Math.round(10 + 30 * k);
        for (let i = 0; i < n; i++) {
          const a = particles.rnd() * 6.283, sp = 3 + 7 * k * particles.rnd();
          particles.emit(p.pos.x, p.pos.y - p.radius * 0.6, p.pos.z, Math.cos(a) * sp, 3 + 6 * k * particles.rnd(), Math.sin(a) * sp, 1.3);
        }
      } else if (e.kind === 'bump' && e.slot >= 0 && e.intensity > 6) {
        kicks[e.slot].v -= Math.min(4, e.intensity * 0.25); kicks[e.slot].rv += (particles.rnd() - 0.5) * 0.25;
      } else if (e.kind === 'respawn' && e.reason === 'rain' && p) {
        kicks[e.slot].v -= 2.5;
        clouds[e.slot].raining = 1;
      }
    }

    for (let i = 0; i < shardN; i++) {
      const sh = shards[i];
      if (sh.age >= S.life) continue;
      sh.age += dt; sh.v.y -= 9.81 * dt; sh.p.addScaledVector(sh.v, dt);
      sh.rot.x += sh.w.x * dt; sh.rot.y += sh.w.y * dt; sh.rot.z += sh.w.z * dt;
    }
    let sn = 0;
    for (let i = 0; i < shardN; i++) {
      const sh = shards[i];
      if (sh.age >= S.life) continue;
      const k = sh.s * (1 - smooth(0.6, 1, sh.age / S.life));
      shardMesh.setMatrixAt(sn++, m4.compose(sh.p, q4.setFromEuler(sh.rot), s4.set(k, k, k)));
    }
    shardMesh.count = sn; shardMesh.instanceMatrix.needsUpdate = sn > 0;

    for (const h of hearts) {
      if (h.age >= H.life) { h.sp.visible = false; continue; }
      h.age += dt;
      if (h.age < 0) { h.sp.visible = false; continue; }
      const u = h.age / H.life;
      h.sp.visible = true;
      h.sp.position.set(h.x + Math.sin(h.phase + h.age * 4) * 0.25 + h.drift * u, h.y + H.rise * Math.sqrt(u) * 1.4, h.z);
      const pop = u < 0.15 ? smooth(0, 0.15, u) * 1.25 : lerp(1.25, 1, smooth(0.15, 0.35, u));
      h.sp.scale.setScalar(H.size * pop);
      h.sp.material.opacity = 1 - smooth(0.6, 1, u);
    }

    // clouds: the pose comes from the caller (game view), which knows where each drop's cloud is
    for (let s = 0; s < slots; s++) {
      const c = clouds[s];
      const pose = cloudPose?.(s);
      c.want = pose ? 1 : 0;
      const rate = c.want ? 1 / C.form : 1 / C.dissolve;
      c.k = clamp(c.k + (c.want ? dt : -dt) * rate, 0, 1);
      if (pose) { c.pos.set(pose.x, pose.y, pose.z); c.yaw = pose.yaw ?? c.yaw; }
      c.g.visible = c.k > 0.01;
      if (!c.g.visible) { c.raining = 0; continue; }
      c.sway += dt;
      const grow = smooth(0, 1, c.k), sc = C.size * (c.want ? lerp(0.35, 1, grow) : lerp(1.35, 1, grow));
      c.g.position.set(c.pos.x, c.pos.y + Math.sin(c.sway * 1.3) * 0.25, c.pos.z);
      c.g.rotation.set(0, c.yaw + Math.sin(c.sway * 0.7) * 0.06, Math.sin(c.sway * 0.9) * 0.04);
      c.g.scale.setScalar(sc);
      c.opacity = c.want ? 1 : grow; // per view in the facing hook, which fades it near a camera
      c.tintOpacity = 0.35 * grow;
      // the little drop rides on top of the cloud, sinking into it as the cloud dissolves
      const fp = c.fake;
      c.drop.update(fp, dt, noWater);
      c.drop.root.position.set(0, 0.95 - (1 - grow) * 0.7, -0.45); // in the top of the cloud, on the side the camera rides (local -z)
      c.drop.root.scale.setScalar(1.1 / (sc * theme.drop.height * fp.radius)); // about 1.1 m tall
      c.dropOn = c.want === 1 && pose?.drop !== false;
      // rain under the cloud while it hands the drop back, and when told to
      const raining = c.raining > 0 || pose?.rain;
      if (raining) {
        c.raining = Math.max(0, c.raining - dt);
        let n = C.rain * dt * sc / C.size;
        while (n > 0) {
          if (n < 1 && particles.rnd() > n) break;
          n -= 1;
          const ox = (particles.rnd() - 0.5) * 2.6 * sc, oz = (particles.rnd() - 0.5) * 1.6 * sc;
          particles.emit(c.g.position.x + ox, c.g.position.y - 0.4 * sc, c.g.position.z + oz, 0, -9 - 4 * particles.rnd(), 0, 1.1);
        }
      }
    }

    for (const k of kicks) {
      k.v += (-K.stiffness * k.y - K.damping * k.v) * dt; k.y += k.v * dt; k.y = clamp(k.y, -K.max, K.max);
      k.rv += (-K.stiffness * k.roll - K.damping * k.rv) * dt; k.roll += k.rv * dt;
    }
  }

  // the camera kick of a view, applied after the chase camera has placed it
  function applyKick(slot, cam) {
    const k = kicks[slot];
    if (Math.abs(k.y) < 1e-4 && Math.abs(k.roll) < 1e-4) return;
    cam.position.y += k.y;
    cam.rotateZ(k.roll);
    cam.updateMatrixWorld();
  }

  function clear() {
    for (const tr of trails) { for (const pt of tr.pts) pt.age = 1e9; tr.mesh.visible = false; }
    for (const sh of shards) sh.age = 1e9;
    for (const h of hearts) { h.age = 1e9; h.sp.visible = false; }
    for (const k of kicks) { k.y = k.v = k.roll = k.rv = 0; }
  }

  // Compiles the effects' shaders before the race needs them: render(fn) draws one frame with every effect forced
  // visible at a tiny scale and no frustum culling (a program compiles on its first draw, against the real render
  // targets), then everything goes back as it was. Without it the countdown stutters as the snowflakes appear.
  function warm(render) {
    const saved = [];
    root.traverse((o) => {
      if (o === root) return;
      saved.push([o, o.visible, o.frustumCulled, o.scale.clone(), o.count]);
      o.visible = true; o.frustumCulled = false; o.scale.setScalar(1e-4);
      if (o.isInstancedMesh) o.count = 1;
    });
    try { render(); } finally {
      for (const [o, v, f, sc, n] of saved) { o.visible = v; o.frustumCulled = f; o.scale.copy(sc); if (o.isInstancedMesh) o.count = n; }
    }
  }

  return { update, applyKick, clear, warm, kicks, clouds, flakes, root, burstShards, heartAt };
}

