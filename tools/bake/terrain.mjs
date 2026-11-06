// Stage terrain at 1:1: the real DEM resampled on the stage grid, blurred a little (the 30 m DEM shows
// bilinear facets at 4 m), then the river bed and the branches carved into it.
import { segmentIndex, smoothstep, lerp, clamp } from './geom.mjs';

// Box around the points with margin m, aligned to multiples of step.
export function gridBox(points, m, step) {
  let xa = Infinity, xb = -Infinity, za = Infinity, zb = -Infinity;
  for (const p of points) {
    xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); za = Math.min(za, p.z); zb = Math.max(zb, p.z);
  }
  const x0 = Math.floor((xa - m) / step) * step, z0 = Math.floor((za - m) / step) * step;
  return { w: Math.ceil((xb + m - x0) / step) + 1, h: Math.ceil((zb + m - z0) / step) + 1, x0, z0, step };
}

// Samples f(x, z) on the grid nodes.
export function sampleGrid(meta, f) {
  const out = new Float32Array(meta.w * meta.h);
  for (let j = 0; j < meta.h; j++) for (let i = 0; i < meta.w; i++) out[j * meta.w + i] = f(meta.x0 + i * meta.step, meta.z0 + j * meta.step);
  return out;
}

// Separable Gaussian blur, sigma in metres, clamped edges.
export function blurGrid(meta, g, sigmaM) {
  const sig = sigmaM / meta.step, R = Math.ceil(sig * 3), k = [];
  for (let t = -R; t <= R; t++) k.push(Math.exp(-(t * t) / (2 * sig * sig)));
  const ks = k.reduce((a, b) => a + b), { w, h } = meta, tmp = new Float32Array(g.length), out = new Float32Array(g.length);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0;
    for (let t = -R; t <= R; t++) s += g[j * w + clamp(i + t, 0, w - 1)] * k[t + R];
    tmp[j * w + i] = s / ks;
  }
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let s = 0;
    for (let t = -R; t <= R; t++) s += tmp[clamp(j + t, 0, h - 1) * w + i] * k[t + R];
    out[j * w + i] = s / ks;
  }
  return out;
}

// Carve profile of a polyline [{x, z, y, hw, bank, bankW}]: flat bottom, U sides up to the bank
// height at hw, then a blend to the terrain over bankW. Returns (x, z, base) -> {y, bed} or null.
export function carver(line, maxW) {
  const xz = line.map((p) => [p.x, p.z]), near = segmentIndex(xz, 32);
  return (x, z, base) => {
    const n = near(x, z, maxW);
    if (!n) return null;
    const a = line[n.seg], b = line[n.seg + 1], t = n.t;
    const y = lerp(a.y, b.y, t), hw = lerp(a.hw, b.hw, t), bank = lerp(a.bank, b.bank, t), W = lerp(a.bankW, b.bankW, t);
    if (n.d > hw + W) return null;
    if (n.d <= hw) {
      const q = n.d / hw;
      return { y: y + bank * (q < 0.45 ? 0 : ((q - 0.45) / 0.55) ** 2), bed: y, inside: true };
    }
    return { y: lerp(y + bank, base, smoothstep((n.d - hw) / W)), bed: y, inside: false };
  };
}

// Carves the main line and the branches into the base grid. A branch may cut through the main banks
// but never below the main bed it crosses.
export function carveGrid(meta, base, main, branches) {
  const out = new Float32Array(base.length);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < meta.h; j++) for (let i = 0; i < meta.w; i++) {
    const k = j * meta.w + i, x = meta.x0 + i * meta.step, z = meta.z0 + j * meta.step, b = base[k];
    const m = main(x, z, b);
    let y = m ? m.y : b;
    for (const cb of branches) {
      const v = cb(x, z, b);
      if (v) y = Math.min(y, m?.inside ? Math.max(v.y, m.bed) : v.y);
    }
    out[k] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { grid: out, min, max };
}

// Adds a change of height given per line point (delta, along the line) to the ground around the line: in full
// out to `inner` m past the bed edge, fading to nothing at `outer` m. The waterfalls' rock steps across the valley.
export function reshapeGrid(meta, base, line, delta, inner = 25, outer = 140) {
  if (!delta.some((v) => v !== 0)) return base;
  const near = segmentIndex(line.map((p) => [p.x, p.z]), 32), out = Float32Array.from(base);
  for (let j = 0; j < meta.h; j++) for (let i = 0; i < meta.w; i++) {
    const n = near(meta.x0 + i * meta.step, meta.z0 + j * meta.step, 30 + outer);
    if (!n) continue;
    const d = lerp(delta[n.seg], delta[n.seg + 1], n.t);
    if (d) out[j * meta.w + i] += d * (1 - smoothstep((n.d - lerp(line[n.seg].hw, line[n.seg + 1].hw, n.t) - inner) / (outer - inner)));
  }
  return out;
}
