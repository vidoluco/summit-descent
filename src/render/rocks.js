// Rounded boulders: the obstacles of the stage inside the bed (the sim's rocks, at their radius) plus a few
// stones on the banks, and where the theme has them (rocks.field) the boulder fields of the open ground. One smooth
// noise-shaped geometry, instanced, in the shared cartoon material.
import * as THREE from 'three';
import { hash3, vnoise, smooth } from './math.js';

export function boulderGeometry(seed = 3, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.16 * vnoise(v.x * 1.6 + seed, v.z * 1.6, 11) + 0.08 * vnoise(v.y * 3 + seed, v.x * 3, 12);
    v.multiplyScalar(k); v.y = v.y > 0 ? v.y * 0.72 : v.y * 0.45; // a flattened, sitting boulder
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', p);
  m.setIndex(g.index);
  m.computeVertexNormals();
  return m;
}

// [{x, y, z, r}] for the obstacles plus bank stones. groundAt: drawn ground (local frame). streams: path index.
export function rockList(stage, groundAt, paths) {
  const out = (stage.spawns?.obstacles || []).map((o) => ({ x: o.x, y: groundAt(o.x, o.z), z: o.z, r: o.r ?? 2, bed: true }));
  const course = paths[0];
  for (let i = 8; i < course.n; i += 23) {
    if (hash3(i, 2, 7) < 0.45) continue;
    const side = hash3(i, 3, 7) < 0.5 ? -1 : 1, hw = course.hw[i];
    const t = side * hw * (1.02 + 0.25 * hash3(i, 4, 7));
    const x = course.x[i] - course.tz[i] * t, z = course.z[i] + course.tx[i] * t;
    out.push({ x, y: groundAt(x, z), z, r: 0.6 + 1.2 * hash3(i, 5, 7), bed: false });
  }
  return out;
}

// The boulder fields of theme.rocks.field (null: none) on the open ground beside the course: [{x, y, z, r}], local
// frame. field: { alt: [from, to] real m, spacing m between candidates, share of them kept inside a field, size m of
// the fields (noise cells), r: [min, max] m, clear: x hw kept off the water, near: m from the course, maxSlope deg,
// max boulders (thinned evenly beyond) }. streams: createPathIndex() of the stage. Deterministic per stage.
export function fieldRocks(stage, groundAt, streams, field) {
  if (!field) return [];
  const m = stage.height, o = stage.offset, S = field.spacing, out = [], hit = {}, e = 3;
  const x1 = m.x0 + (m.w - 1) * m.step, z1 = m.z0 + (m.h - 1) * m.step;
  for (let j = 0, z = m.z0 + S / 2; z < z1; j++, z += S) {
    for (let i = 0, x = m.x0 + S / 2; x < x1; i++, x += S) {
      const px = x + (hash3(i, j, 41) - 0.5) * S, pz = z + (hash3(i, j, 42) - 0.5) * S;
      if (!streams.nearest(px, pz, hit, field.near) || hit.d < hit.hw * field.clear) continue;
      const y = groundAt(px, pz), alt = y + o.y, gx = px + o.x, gz = pz + o.z;
      if (alt < field.alt[0] || alt > field.alt[1]) continue;
      // clumped: the fields are the high cells of a coarse noise, thinning out to the ends of the band
      const band = smooth(field.alt[0], field.alt[0] + 80, alt) * (1 - smooth(field.alt[1] - 80, field.alt[1], alt));
      const clump = smooth(0.05, 0.45, vnoise(gx / field.size, gz / field.size, 43) * 0.7 + vnoise(gx * 2.5 / field.size, gz * 2.5 / field.size, 44) * 0.3);
      if (hash3(i, j, 45) > field.share * clump * band) continue;
      const slope = Math.atan(Math.hypot(groundAt(px + e, pz) - groundAt(px - e, pz), groundAt(px, pz + e) - groundAt(px, pz - e)) / (2 * e)) * 57.2958;
      if (slope > field.maxSlope) continue;
      const u = hash3(i, j, 46); // mostly stones, a few big blocks
      out.push({ x: px, y, z: pz, r: field.r[0] + (field.r[1] - field.r[0]) * u * u * u, bed: false });
    }
  }
  if (out.length <= field.max) return out;
  const keep = field.max / out.length; // every (1 / keep)-th, evenly over the stage
  return out.filter((r, k) => Math.floor((k + 1) * keep) > Math.floor(k * keep));
}

export function rockMesh(list, material, detail = 3) {
  const mesh = new THREE.InstancedMesh(boulderGeometry(3, detail), material, Math.max(list.length, 1));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  list.forEach((r, i) => {
    e.set((hash3(i, 1, 9) - 0.5) * 0.3, hash3(i, 2, 9) * 6.28, (hash3(i, 3, 9) - 0.5) * 0.3);
    q.setFromEuler(e);
    const k = r.r * (0.9 + 0.2 * hash3(i, 4, 9));
    m4.compose(p.set(r.x, r.y - 0.15 * k, r.z), q, s.set(k * (1 + 0.3 * hash3(i, 5, 9)), k, k));
    mesh.setMatrixAt(i, m4);
  });
  mesh.count = list.length;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
