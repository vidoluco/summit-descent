// Runtime view of a world (world.json + height.bin): terrain sampling and course geometry.
// Pure math, no three.js. Paths: id 0 is the main course, id k+1 is branches[k] (with the course
// points at `from` and `to` stitched on its ends). Tangents are unit vectors in the x/z plane,
// pointing downstream; "right" of a tangent t is (-t.z, t.x). Every path point also carries the grade of
// its stretch (drop per meter of arc, downhill positive) over GRADE_SPAN m on each side, from the baked y.

// Identical to web-swing tools/dem-lib.mjs bilinear(): clamped at the edges.
export function bilinear({ w, h, x0, z0, step }, data, x, z) {
  const u = Math.min(Math.max((x - x0) / step, 0), w - 1), v = Math.min(Math.max((z - z0) / step, 0), h - 1);
  const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2);
  const fu = u - i, fv = v - j, k = j * w + i;
  return data[k] * (1 - fu) * (1 - fv) + data[k + 1] * fu * (1 - fv) + data[k + w] * (1 - fu) * fv + data[k + w + 1] * fu * fv;
}

// Decodes a little endian Float32 buffer (ArrayBuffer, Buffer or typed array view).
export function floatsFromBuffer(buf, count) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer;
  const off = buf instanceof ArrayBuffer ? 0 : buf.byteOffset;
  const len = buf instanceof ArrayBuffer ? buf.byteLength : buf.byteLength;
  if (count !== undefined && len !== count * 4) throw new Error(`grid is ${len} bytes, expected ${count * 4}`);
  const out = new Float32Array(len / 4);
  const dv = new DataView(ab, off, len);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

export const GRADE_SPAN = 50; // m of arc on each side of a point for its grade

export function makePath(points) {
  const n = points.length;
  if (n < 2) throw new Error('a path needs at least 2 points');
  const pts = points.map((p) => ({ x: p.x, y: p.y, z: p.z, hw: p.hw ?? 10 }));
  const s = new Float64Array(n);
  const segLen = new Float64Array(n - 1);
  const stx = new Float64Array(n - 1), stz = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z;
    const l = Math.hypot(dx, dz) || 1e-6;
    segLen[i] = l; stx[i] = dx / l; stz[i] = dz / l;
    s[i + 1] = s[i] + l;
  }
  // Vertex tangents: average of the adjacent segments, so the tangent turns smoothly along a bend.
  const vtx = new Float64Array(n), vtz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 2, i);
    let tx = stx[a] + stx[b], tz = stz[a] + stz[b];
    const l = Math.hypot(tx, tz) || 1;
    vtx[i] = tx / l; vtz[i] = tz / l;
  }
  // Grade of the stretch around each point: the course y, not the terrain under the drop, so a bump or a
  // carved bank does not change it.
  const yAt = (q) => {
    if (q <= 0) return pts[0].y;
    if (q >= s[n - 1]) return pts[n - 1].y;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= q) lo = m; else hi = m; }
    const t = (q - s[lo]) / segLen[lo];
    return pts[lo].y + (pts[lo + 1].y - pts[lo].y) * t;
  };
  const grade = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, s[i] - GRADE_SPAN), b = Math.min(s[n - 1], s[i] + GRADE_SPAN);
    const g = b > a ? (yAt(a) - yAt(b)) / (b - a) : 0;
    grade[i] = Number.isFinite(g) ? g : 0; // a path without y has no grade
  }
  return { pts, n, s, segLen, stx, stz, vtx, vtz, grade, length: s[n - 1] };
}

function projectSeg(path, i, x, z) {
  const a = path.pts[i];
  const dx = x - a.x, dz = z - a.z;
  const l = path.segLen[i];
  let t = (dx * path.stx[i] + dz * path.stz[i]) / l;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const px = a.x + path.stx[i] * l * t, pz = a.z + path.stz[i] * l * t;
  const ex = x - px, ez = z - pz;
  return { t, d2: ex * ex + ez * ez };
}

// Closest point on a path. hint: segment index to search around (window segments each side);
// without a hint the whole path is searched.
export function nearestOnPath(path, x, z, hint, window = 30) {
  let lo = 0, hi = path.n - 2;
  if (hint !== undefined && hint !== null && hint >= 0) {
    lo = Math.max(0, Math.floor(hint) - window);
    hi = Math.min(path.n - 2, Math.floor(hint) + window);
  }
  let best = -1, bt = 0, bd = Infinity;
  for (let i = lo; i <= hi; i++) {
    const r = projectSeg(path, i, x, z);
    if (r.d2 < bd) { bd = r.d2; best = i; bt = r.t; }
  }
  return describe(path, best, bt, x, z);
}

function describe(path, i, t, x, z) {
  const a = path.pts[i], b = path.pts[i + 1];
  let tx = path.vtx[i] * (1 - t) + path.vtx[i + 1] * t, tz = path.vtz[i] * (1 - t) + path.vtz[i + 1] * t;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl; tz /= tl;
  const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
  const lateral = (x - cx) * -path.stz[i] + (z - cz) * path.stx[i];
  return {
    index: i,
    t,
    dist: Math.hypot(x - cx, z - cz),
    lateral, // signed, positive to the right of the downstream direction
    tangent: { x: tx, z: tz },
    s: path.s[i] + path.segLen[i] * t,
    hw: a.hw + (b.hw - a.hw) * t,
    y: a.y + (b.y - a.y) * t,
    grade: path.grade[i] + (path.grade[i + 1] - path.grade[i]) * t, // drop per meter around here, downhill > 0
    cx, cz,
  };
}

// Point at arc length s along a path (clamped).
export function pointOnPath(path, s) {
  if (s <= 0) return describe(path, 0, 0, path.pts[0].x, path.pts[0].z);
  if (s >= path.length) {
    const p = path.pts[path.n - 1];
    return describe(path, path.n - 2, 1, p.x, p.z);
  }
  let lo = 0, hi = path.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.s[m] <= s) lo = m; else hi = m; }
  const t = (s - path.s[lo]) / path.segLen[lo];
  const a = path.pts[lo], b = path.pts[lo + 1];
  return describe(path, lo, t, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
}

// Index of the segment containing arc length s on a path.
export function indexAtS(path, s) {
  if (s <= 0) return 0;
  if (s >= path.length) return path.n - 1;
  let lo = 0, hi = path.n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.s[m] <= s) lo = m; else hi = m; }
  return lo;
}

// worldJson: parsed world.json. height: Float32Array of w*h meters, or a function (x, z) -> m.
// backdrop: optional Float32Array (or function) for the coarse surrounding grid.
export function createWorldAccess(worldJson, height, backdrop) {
  const json = worldJson;
  const hm = json.height;
  let heightAt;
  // height.bin as fetched (ArrayBuffer, Buffer, DataView) is decoded as little endian Float32.
  const grid = (g) => (g instanceof ArrayBuffer || (ArrayBuffer.isView(g) && !(g instanceof Float32Array)) ? floatsFromBuffer(g) : g);
  height = grid(height);
  backdrop = grid(backdrop);
  if (typeof height === 'function') heightAt = height;
  else {
    if (!height || height.length !== hm.w * hm.h) throw new Error(`height grid needs ${hm.w * hm.h} values, got ${height?.length}`);
    heightAt = (x, z) => bilinear(hm, height, x, z);
  }
  let backdropAt = null;
  if (typeof backdrop === 'function') backdropAt = backdrop;
  else if (backdrop && json.backdrop) backdropAt = (x, z) => bilinear(json.backdrop, backdrop, x, z);

  const eps = Math.max(0.5, (hm?.step ?? 4) * 0.5);
  const gradAt = (x, z) => ({
    x: (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps),
    z: (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps),
  });
  const normalAt = (x, z) => {
    const g = gradAt(x, z);
    const l = Math.hypot(g.x, 1, g.z);
    return { x: -g.x / l, y: 1 / l, z: -g.z / l };
  };

  const course = makePath(json.course);
  const paths = [course];
  const branches = (json.branches || []).map((b, k) => {
    const a = json.course[b.from], z = json.course[b.to];
    const pts = [...(b.points || [])];
    const near = (p, q) => Math.hypot(p.x - q.x, p.z - q.z) < 1;
    if (!pts.length || !near(pts[0], a)) pts.unshift({ ...a, hw: pts[0]?.hw ?? a.hw });
    if (!near(pts[pts.length - 1], z)) pts.push({ ...z, hw: pts[pts.length - 1]?.hw ?? z.hw });
    const path = makePath(pts);
    paths.push(path);
    return { id: k + 1, kind: b.kind, from: b.from, to: b.to, path, sFrom: course.s[b.from], sTo: course.s[b.to] };
  });

  const finish = json.finish ?? course.n - 1;
  const zones = (json.zones || []).map((zn) => ({ kind: zn.kind, from: zn.from, to: zn.to, sFrom: course.s[zn.from], sTo: course.s[zn.to] }));

  // Main-course-equivalent arc length for a position on any path: a branch maps linearly onto
  // the stretch of course it replaces, so progress is comparable between drops.
  const equivalentS = (pathId, s) => {
    if (!pathId) return s;
    const b = branches[pathId - 1];
    const f = Math.min(Math.max(s / b.path.length, 0), 1);
    return b.sFrom + f * (b.sTo - b.sFrom);
  };
  const zonesAt = (sEq) => {
    const out = { ice: false, sun: false, rain: false, waterfall: false };
    for (const zn of zones) if (sEq >= zn.sFrom && sEq <= zn.sTo) out[zn.kind] = true;
    return out;
  };

  return {
    json,
    id: json.id,
    seaLevel: json.seaLevel ?? 0,
    heightAt,
    gradAt,
    normalAt,
    backdropAt,
    course,
    paths,
    branches,
    zones,
    checkpoints: json.checkpoints || [],
    finish,
    sFinish: course.s[finish],
    courseLength: course.length,
    equivalentS,
    zonesAt,
    nearestCourse: (pos, hintIndex) => nearestOnPath(course, pos.x, pos.z, hintIndex),
    nearestPath: (pathId, pos, hintIndex, window) => nearestOnPath(paths[pathId], pos.x, pos.z, hintIndex, window),
    pointAt: (pathId, s) => pointOnPath(paths[pathId], s),
    indexAtS: (pathId, s) => indexAtS(paths[pathId], s),
  };
}
