// Stream paths for drawing: the course and branch polylines (points every ~10 m) resampled into smooth
// curves (Catmull-Rom through the baked points, so the curve still passes through every point and keeps
// the bed height there), plus a spatial index for "how far from the stream is this point".
// Tangents point downstream; "right" of a tangent t is (-t.z, t.x), as in src/sim/world-access.js.
import { clamp } from './math.js';

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

// points: [{x, y, z, hw}] -> { n, x, y, z, hw, s, tx, tz, length } typed arrays, a sample every ~step metres.
// y is the bed, kept non-increasing (the bake guarantees a descending course; the spline must not add bumps).
export function densifyPath(points, step = 2) {
  const m = points.length;
  if (m < 2) throw new Error('densifyPath: a path needs at least 2 points');
  const P = (i) => points[clamp(i, 0, m - 1)];
  const xs = [], ys = [], zs = [], hws = [];
  for (let i = 0; i < m - 1; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    const len = Math.hypot(c.x - b.x, c.z - b.z);
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      xs.push(cr(a.x, b.x, c.x, d.x, t)); zs.push(cr(a.z, b.z, c.z, d.z, t));
      ys.push(b.y + (c.y - b.y) * t); // linear in y: exact at the points, never above the bake's bed
      hws.push(cr(a.hw ?? 10, b.hw ?? 10, c.hw ?? 10, d.hw ?? 10, t));
    }
  }
  const last = points[m - 1];
  xs.push(last.x); ys.push(last.y); zs.push(last.z); hws.push(last.hw ?? 10);
  const n = xs.length;
  const out = { n, x: Float64Array.from(xs), y: Float64Array.from(ys), z: Float64Array.from(zs), hw: Float64Array.from(hws),
    s: new Float64Array(n), tx: new Float64Array(n), tz: new Float64Array(n), length: 0 };
  for (let i = 1; i < n; i++) out.s[i] = out.s[i - 1] + Math.hypot(out.x[i] - out.x[i - 1], out.z[i] - out.z[i - 1]);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = out.x[b] - out.x[a], dz = out.z[b] - out.z[a], l = Math.hypot(dx, dz) || 1;
    out.tx[i] = dx / l; out.tz[i] = dz / l;
  }
  out.length = out.s[n - 1];
  return out;
}

// All stream paths of a stage: id 0 the course, id k+1 branches[k]; branch endpoints sit on the course.
export function stagePaths(stage, step = 2) {
  const paths = [densifyPath(stage.course, step)];
  for (const b of stage.branches || []) paths.push(densifyPath(b.points, step));
  return paths;
}

// Spatial index over the samples of several paths. nearest(x, z, out) fills out with
// {d, path, i, hw, y, lat} (lat: signed lateral distance, + to the right) or returns false beyond reach.
// A dense grid of cells (counting sort, flat arrays) over the samples plus `reach`, and per cell a lower bound
// of the distance to any sample (an 8-neighbour chamfer distance transform of the occupied cells): a query far
// from every stream is answered from that bound alone, and a query that does find one starts its rings of
// cells where the first sample can be, not at its own cell. Exact: the answer is the nearest sample.
export function createPathIndex(paths, cell = 24, reach = 400) {
  let N = 0;
  for (const p of paths) N += p.n;
  const PX = new Float64Array(N), PZ = new Float64Array(N), PP = new Int32Array(N), PI = new Int32Array(N);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, q = 0;
  paths.forEach((p, pi) => {
    for (let i = 0; i < p.n; i++, q++) {
      PX[q] = p.x[i]; PZ[q] = p.z[i]; PP[q] = pi; PI[q] = i;
      minX = Math.min(minX, p.x[i]); maxX = Math.max(maxX, p.x[i]); minZ = Math.min(minZ, p.z[i]); maxZ = Math.max(maxZ, p.z[i]);
    }
  });
  const pad = reach + 2 * cell, gx0 = minX - pad, gz0 = minZ - pad;
  const gw = Math.ceil((maxX - minX + 2 * pad) / cell) + 1, gh = Math.ceil((maxZ - minZ + 2 * pad) / cell) + 1;
  const start = new Int32Array(gw * gh + 1), items = new Int32Array(N), cellOf = new Int32Array(N);
  for (let k = 0; k < N; k++) { const c = Math.floor((PZ[k] - gz0) / cell) * gw + Math.floor((PX[k] - gx0) / cell); cellOf[k] = c; start[c + 1]++; }
  for (let c = 0; c < gw * gh; c++) start[c + 1] += start[c];
  const fill = start.slice(0, gw * gh);
  for (let k = 0; k < N; k++) items[fill[cellOf[k]]++] = k;
  // chamfer distance (in cells) from each cell centre to the nearest occupied cell centre: >= the euclidean one
  const D = new Float32Array(gw * gh).fill(1e9), R2 = Math.SQRT2;
  for (let c = 0; c < gw * gh; c++) if (start[c + 1] > start[c]) D[c] = 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const c = j * gw + i; let d = D[c];
    if (i > 0) d = Math.min(d, D[c - 1] + 1);
    if (j > 0) { d = Math.min(d, D[c - gw] + 1); if (i > 0) d = Math.min(d, D[c - gw - 1] + R2); if (i < gw - 1) d = Math.min(d, D[c - gw + 1] + R2); }
    D[c] = d;
  }
  for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) {
    const c = j * gw + i; let d = D[c];
    if (i < gw - 1) d = Math.min(d, D[c + 1] + 1);
    if (j < gh - 1) { d = Math.min(d, D[c + gw] + 1); if (i < gw - 1) d = Math.min(d, D[c + gw + 1] + R2); if (i > 0) d = Math.min(d, D[c + gw - 1] + R2); }
    D[c] = d;
  }
  // a sample in an occupied cell and the query in its own cell are each within cell/sqrt(2) of the centres
  const lowerBound = (c) => Math.max(0, (D[c] * cell) / 1.0825 - cell * R2);
  let qx = 0, qz = 0, bd = Infinity, bk = -1;
  function visit(i, j) {
    if (i < 0 || j < 0 || i >= gw || j >= gh) return;
    const c = j * gw + i;
    for (let a = start[c], b = start[c + 1]; a < b; a++) {
      const k = items[a], dx = PX[k] - qx, dz = PZ[k] - qz, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bk = k; }
    }
  }
  // no allocation: safe to call every frame. maxD up to reach.
  function nearest(x, z, out, maxD = reach) {
    const ci = Math.floor((x - gx0) / cell), cj = Math.floor((z - gz0) / cell);
    if (ci < 0 || cj < 0 || ci >= gw || cj >= gh) return false; // farther than reach from every sample
    const lb = lowerBound(cj * gw + ci);
    if (lb > maxD) return false;
    qx = x; qz = z; bd = Infinity; bk = -1;
    // rings of cells (perimeter only) from the first that can hold a sample (ring r lies within (r + 1) cell sqrt(2)),
    // stop once a ring cannot hold anything closer
    for (let r = Math.max(0, Math.ceil(lb / (cell * R2)) - 1); r * cell <= maxD + cell; r++) {
      if (r === 0) visit(ci, cj);
      else {
        for (let a = -r; a <= r; a++) { visit(ci + a, cj - r); visit(ci + a, cj + r); }
        for (let b = -r + 1; b < r; b++) { visit(ci - r, cj + b); visit(ci + r, cj + b); }
      }
      if (bk >= 0 && Math.sqrt(bd) < r * cell) break;
    }
    if (bk < 0 || Math.sqrt(bd) > maxD) return false;
    const bp = PP[bk], bi = PI[bk], p = paths[bp];
    out.d = Math.sqrt(bd); out.path = bp; out.i = bi; out.hw = p.hw[bi]; out.y = p.y[bi];
    out.lat = (x - p.x[bi]) * -p.tz[bi] + (z - p.z[bi]) * p.tx[bi];
    // m beyond either end of the path (0 along it): the bed is carved a little past the last point, with no water on it
    const along = (x - p.x[bi]) * p.tx[bi] + (z - p.z[bi]) * p.tz[bi];
    out.past = bi === p.n - 1 ? Math.max(0, along) : bi === 0 ? Math.max(0, -along) : 0;
    return true;
  }
  return { nearest };
}

// Index of the sample of path nearest to (x, z), searching around a hint (the previous answer): O(window).
export function trackPath(path, x, z, hint = -1, window = 60) {
  let lo = 0, hi = path.n - 1;
  if (hint >= 0) { lo = Math.max(0, hint - window); hi = Math.min(path.n - 1, hint + window); }
  let bd = Infinity, bi = lo;
  for (let i = lo; i <= hi; i++) {
    const d = (path.x[i] - x) ** 2 + (path.z[i] - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  // the drop jumped (respawn, new stage): fall back to a full search
  if (hint >= 0 && (bi === lo || bi === hi) && bd > 900) return trackPath(path, x, z, -1);
  return bi;
}

// Sample index at arc length s (clamped), by bisection.
export function indexAtS(path, s) {
  if (s <= 0) return 0;
  if (s >= path.length) return path.n - 1;
  let a = 0, b = path.n - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (path.s[m] <= s) a = m; else b = m; }
  return a;
}

// Bed height at (x, z) near sample i of path: the bed line interpolated along the stream (on a steep run the
// nearest 2 m sample alone is off by up to half a metre).
export function bedAt(path, i, x, z) {
  const along = (x - path.x[i]) * path.tx[i] + (z - path.z[i]) * path.tz[i];
  const j = along >= 0 ? Math.min(i + 1, path.n - 1) : Math.max(i - 1, 0);
  const ds = Math.abs(path.s[j] - path.s[i]);
  if (ds < 1e-6) return path.y[i];
  return path.y[i] + (path.y[j] - path.y[i]) * Math.min(Math.abs(along) / ds, 1);
}

// The path continued past its last sample for a rounded end of the water sheet: `len` m along the last tangent,
// the bed following the drawn ground down the carved trench (never climbing), the half width closing on a
// half circle. Same fields as densifyPath(); the original samples are kept as they are.
export function roundEnd(path, ground, len, step = 2) {
  const k = Math.max(2, Math.ceil(len / step)), n = path.n, m = n + k, e = n - 1;
  const out = { n: m, length: 0 };
  for (const f of ['x', 'y', 'z', 'hw', 's', 'tx', 'tz']) { out[f] = new Float64Array(m); out[f].set(path[f]); }
  for (let q = 1; q <= k; q++) {
    const a = (q / k) * len, i = e + q;
    out.x[i] = path.x[e] + path.tx[e] * a; out.z[i] = path.z[e] + path.tz[e] * a;
    out.y[i] = Math.min(out.y[i - 1], ground(out.x[i], out.z[i]));
    out.hw[i] = path.hw[e] * Math.sqrt(Math.max(0, 1 - (a / len) ** 2));
    out.s[i] = path.s[e] + a; out.tx[i] = path.tx[e]; out.tz[i] = path.tz[e];
  }
  out.length = out.s[m - 1];
  return out;
}
