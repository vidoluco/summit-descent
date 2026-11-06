// Polyline helpers for the bake. Points are [x, z] arrays in metres.

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
export const smoothstep = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

export function arcLengths(p) {
  const s = [0];
  for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return s;
}

// Point at arc length t along p (with precomputed s), linear between nodes, clamped.
export function pointAt(p, s, t) {
  t = clamp(t, 0, s.at(-1));
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - s[lo]) / Math.max(s[hi] - s[lo], 1e-9);
  return [lerp(p[lo][0], p[hi][0], f), lerp(p[lo][1], p[hi][1], f)];
}

export function resample(p, ds) {
  const s = arcLengths(p), n = Math.max(2, Math.round(s.at(-1) / ds) + 1), step = s.at(-1) / (n - 1);
  return Array.from({ length: n }, (_, i) => pointAt(p, s, i * step));
}

// Gaussian smoothing of a uniformly sampled polyline, sigma in samples; ends are held by mirroring.
export function smoothPolyline(p, sigma) {
  if (sigma <= 0) return p.map((q) => q.slice());
  const R = Math.ceil(sigma * 3), k = [];
  for (let i = -R; i <= R; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const n = p.length, out = [];
  const at = (i) => {
    if (i >= 0 && i < n) return p[i];
    const j = i < 0 ? -i : 2 * (n - 1) - i;
    const a = i < 0 ? p[0] : p[n - 1], b = p[clamp(j, 0, n - 1)];
    return [2 * a[0] - b[0], 2 * a[1] - b[1]];
  };
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0, ws = 0;
    for (let t = -R; t <= R; t++) {
      const q = at(i + t), w = k[t + R];
      x += q[0] * w; z += q[1] * w; ws += w;
    }
    out.push([x / ws, z / ws]);
  }
  return out;
}

// 1D Gaussian smoothing with mirrored ends.
export function smooth1d(a, sigma) {
  if (sigma <= 0) return a.slice();
  const R = Math.ceil(sigma * 3), n = a.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, ws = 0;
    for (let t = -R; t <= R; t++) {
      let j = i + t;
      if (j < 0) j = -j;
      if (j > n - 1) j = 2 * (n - 1) - j;
      j = clamp(j, 0, n - 1);
      const w = Math.exp(-(t * t) / (2 * sigma * sigma));
      s += a[j] * w; ws += w;
    }
    out[i] = s / ws;
  }
  return out;
}

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Nearest point of segment ab to q: { d2, t } with t in [0, 1].
export function segNearest(ax, az, bx, bz, qx, qz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? clamp(((qx - ax) * dx + (qz - az) * dz) / L2, 0, 1) : 0;
  const ex = ax + dx * t - qx, ez = az + dz * t - qz;
  return { d2: ex * ex + ez * ez, t };
}

// Bucket index of polyline segments for nearest-point queries within a radius.
export function segmentIndex(pts, cell = 32) {
  const map = new Map();
  const key = (i, j) => i * 100003 + j;
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
    const i0 = Math.floor(Math.min(ax, bx) / cell), i1 = Math.floor(Math.max(ax, bx) / cell);
    const j0 = Math.floor(Math.min(az, bz) / cell), j1 = Math.floor(Math.max(az, bz) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
  }
  // Nearest segment within radius r: { seg, t, d, side } or null. side > 0 is to the right of travel.
  return function nearest(qx, qz, r) {
    const ci = Math.floor(qx / cell), cj = Math.floor(qz / cell), R = Math.ceil(r / cell);
    let best = null, bd = r * r;
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++) {
      const list = map.get(key(i, j));
      if (!list) continue;
      for (const s of list) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
        const n = segNearest(ax, az, bx, bz, qx, qz);
        if (n.d2 < bd) { bd = n.d2; best = { seg: s, t: n.t }; }
      }
    }
    if (!best) return null;
    const [ax, az] = pts[best.seg], [bx, bz] = pts[best.seg + 1];
    const cross = (bx - ax) * (qz - az) - (bz - az) * (qx - ax);
    return { ...best, d: Math.sqrt(bd), side: Math.sign(cross) || 1 };
  };
}
