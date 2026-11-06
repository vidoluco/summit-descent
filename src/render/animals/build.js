// Species spec + extracted triangle soup -> the arrays of one smooth animal geometry, ready for a
// BufferGeometry. Pure (no three.js): orient to the game frame (+z forward, +y up, feet on y = 0, metres),
// weld, paint the face colours on the species palette, reshape, round off (Taubin + subdivision), add
// bead eyes, then per-corner rig weights that the vertex shader uses for the procedural motion.
import { weld, bounds, mapVertices, mapFaces, taubin, subdivide, merge, ellipsoid, toCorners } from './mesh.js';

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function linearHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [toLin(((n >> 16) & 255) / 255), toLin(((n >> 8) & 255) / 255), toLin((n & 255) / 255)];
}
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// Source colour helpers for the paint rules, on sRGB 0..1: luma, hue (deg) and saturation.
export function describe(rgb) {
  const [r, g, b] = rgb.map(toSrgb), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { luma: 0.299 * r + 0.587 * g + 0.114 * b, hue: (h * 60 + 360) % 360, sat: mx ? d / mx : 0 };
}

// A frame in which the spec functions work: p in metres, f in fractions of the bounding box
// (f.x and f.z from -0.5 to 0.5, f.y from 0 at the feet to 1 at the top).
export function frameOf(b) {
  const [sx, sy, sz] = b.size;
  return {
    size: b.size,
    f: (x, y, z) => ({ x: x / sx, y: y / sy, z: z / sz }),
    m: (fx, fy, fz) => [fx * sx, fy * sy, fz * sz],
  };
}

const mix = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export { smooth };

export function buildSpecies(soup, spec) {
  // orient: 3x3 row-major rotation from the source frame to the game frame
  const R = spec.orient || [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let mesh = weld(soup.positions, null, soup.colors);
  mesh = mapVertices(mesh, (x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z]);
  if (spec.keep) { // drop parts of the source (a perch, a base) by face centroid in the oriented frame
    const b0 = bounds(mesh.pos), fr0 = frameOf(b0);
    const keepIdx = [], keepCol = [];
    for (let f = 0; f < mesh.idx.length / 3; f++) {
      const c = [0, 1, 2].map((k) => (mesh.pos[mesh.idx[f * 3] * 3 + k] + mesh.pos[mesh.idx[f * 3 + 1] * 3 + k] + mesh.pos[mesh.idx[f * 3 + 2] * 3 + k]) / 3);
      const f0 = fr0.f(c[0] - (b0.min[0] + b0.max[0]) / 2, c[1] - b0.min[1], c[2] - (b0.min[2] + b0.max[2]) / 2);
      if (!spec.keep(f0, [mesh.col[f * 3], mesh.col[f * 3 + 1], mesh.col[f * 3 + 2]])) continue;
      keepIdx.push(mesh.idx[f * 3], mesh.idx[f * 3 + 1], mesh.idx[f * 3 + 2]); keepCol.push(mesh.col[f * 3], mesh.col[f * 3 + 1], mesh.col[f * 3 + 2]);
    }
    mesh = { ...mesh, idx: new Uint32Array(keepIdx), col: new Float32Array(keepCol) };
  }
  // normalise: centred on x and z, feet on y = 0, scaled to the species size in metres
  let b = bounds(usedPositions(mesh));
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  const S = spec.size.height ? spec.size.height / b.size[1] : spec.size.length ? spec.size.length / b.size[2] : spec.size.span / b.size[0];
  mesh = mapVertices(mesh, (x, y, z) => [(x - cx) * S, (y - y0) * S, (z - cz) * S]);
  b = bounds(usedPositions(mesh));
  const fr = frameOf(b);
  // paint: rule(source rgb, fraction coords, metres, describe) -> palette key
  // the face keeps its key as a tag, so repaint() can redraw region borders on the fine final mesh
  const pal = Object.fromEntries(Object.entries(spec.colors).map(([k, hex]) => [k, linearHex(hex)]));
  const keys = Object.keys(pal);
  if (spec.paint) {
    const tag = new Int16Array(mesh.idx.length / 3).fill(-1);
    mesh = mapFaces(mesh, (rgb, c, f) => {
      const key = spec.paint(describe(rgb), fr.f(c[0], c[1], c[2]), c, rgb);
      if (key && !pal[key]) throw new Error(`${spec.id}: paint key ${key} not in colors`);
      tag[f] = key ? keys.indexOf(key) : -1;
      return key ? pal[key] : null;
    });
    mesh.tag = tag;
  }
  if (spec.deform) mesh = mapVertices(mesh, (x, y, z) => spec.deform([x, y, z], fr.f(x, y, z), fr));
  if (spec.taubin) mesh = taubin(mesh, spec.taubin);
  if (spec.subdivide) mesh = subdivide(mesh, spec.subdivide);
  // bead eyes with a glint, placed in source fractions and carried through the reshape; with `surface`
  // the x of the fraction is ignored and the bead sits on the outer skin at that height and depth, sunk
  // by that fraction of its radius (a bead lost inside a cheek or floating off it reads as no eye at all)
  const sx0 = fr.size[0];
  const onSkin = (c, side, r, sink) => {
    let best = -Infinity;
    for (let tol = r * 1.2; best === -Infinity && tol < sx0; tol *= 2) {
      for (let v = 0; v < mesh.pos.length; v += 3) {
        const x = mesh.pos[v] * side;
        if (x > best && Math.abs(mesh.pos[v + 1] - c[1]) < tol && Math.abs(mesh.pos[v + 2] - c[2]) < tol) best = x;
      }
    }
    return [side * (best - sink * r), c[1], c[2]];
  };
  const place = (f, side = 1, e = null) => {
    const p0 = fr.m(...f), p = spec.deform ? spec.deform(p0, fr.f(...p0), fr) : p0;
    return e?.surface != null ? onSkin(p, side, typeof e.r === 'number' ? e.r : e.r[0], e.surface) : p;
  };
  for (const e of spec.eyes || []) {
    for (const side of e.mirror === false ? [1] : [1, -1]) {
      const c = place([e.f[0] * side, e.f[1], e.f[2]], side, e), r = e.r;
      mesh = merge(mesh, ellipsoid(c, [r * (e.flat ?? 0.7), r, r], pal[e.color || 'eye'] || linearHex('#16110f')));
      if (e.glint !== false) {
        const g = [c[0] + side * r * 0.25, c[1] + r * 0.45, c[2] + r * 0.55];
        mesh = merge(mesh, ellipsoid(g, [r * 0.3, r * 0.3, r * 0.3], linearHex('#ffffff'), 1));
      }
    }
  }
  // small rounded parts (ears, a nose): ellipsoids half sunk into the surface, placed like the eyes
  for (const e of spec.parts || []) {
    for (const side of e.mirror === false ? [1] : [1, -1]) {
      const m0 = merge(mesh, ellipsoid(place([e.f[0] * side, e.f[1], e.f[2]], side, e), e.r, pal[e.color], 2));
      if (mesh.tag) m0.tag.fill(keys.indexOf(e.color), mesh.idx.length / 3);
      mesh = m0;
    }
  }
  // the ground contact after reshaping
  b = bounds(usedPositions(mesh));
  if (Math.abs(b.min[1]) > 1e-6 && !spec.flying) mesh = mapVertices(mesh, (x, y, z) => [x, y - b.min[1], z]);
  b = bounds(usedPositions(mesh));
  const frame = frameOf(b);
  const corners = toCorners(mesh, { creaseDeg: spec.creaseDeg ?? 75 });
  // repaint(key, fractions, metres) per corner on the final surface -> key, or [keyA, keyB, t] for a blend;
  // per corner, so region borders are smooth curves across the triangles, not face staircases
  if (spec.repaint) {
    for (let i = 0; i < corners.count; i++) {
      const tag = mesh.tag ? mesh.tag[(i / 3) | 0] : -1;
      if (tag < 0 && mesh.tag) continue; // eyes and other added parts keep their colour
      const x = corners.position[i * 3], y = corners.position[i * 3 + 1], z = corners.position[i * 3 + 2];
      const r = spec.repaint(keys[tag], frame.f(x, y, z), [x, y, z]);
      if (!r) continue;
      const c = typeof r === 'string' ? pal[r] : mix(pal[r[0]], pal[r[1]], r[2]);
      corners.color.set(c, i * 3);
    }
  }
  // rig weights per corner: [head, leg, leg phase, wing (signed) or tail]
  const rig = new Float32Array(corners.count * 4);
  const R0 = spec.rig || {};
  for (let i = 0; i < corners.count; i++) {
    const x = corners.position[i * 3], y = corners.position[i * 3 + 1], z = corners.position[i * 3 + 2], f = frame.f(x, y, z);
    rig[i * 4] = R0.head ? R0.head(f) : 0;
    const leg = R0.leg ? R0.leg(f) : null;
    rig[i * 4 + 1] = leg ? leg.w : 0;
    rig[i * 4 + 2] = leg ? leg.phase : 0;
    rig[i * 4 + 3] = R0.wing ? R0.wing(f) : R0.tail ? R0.tail(f) : 0;
  }
  return { ...corners, rig, size: b.size, frame, faces: mesh.idx.length / 3, pivots: R0.pivots ? R0.pivots(frame) : {} };
}

// Bounding box over the vertices that faces still use (keep() may orphan some).
function usedPositions(mesh) {
  const used = new Uint8Array(mesh.pos.length / 3);
  for (const v of mesh.idx) used[v] = 1;
  const out = [];
  for (let v = 0; v < used.length; v++) if (used[v]) out.push(mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]);
  return out;
}
