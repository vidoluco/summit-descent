// Small numeric helpers shared by the render modules. Pure math, no three.js, no allocation in the hot ones.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const D2R = Math.PI / 180;

// Integer hash -> [0, 1).
export function hash3(a, b, c) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Value noise in [-1, 1], smooth (C1).
export function vnoise(x, z, seed = 0) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash3(i, j, seed), b = hash3(i + 1, j, seed), c = hash3(i, j + 1, seed), d = hash3(i + 1, j + 1, seed);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
}

export const fbm = (x, z, s) => vnoise(x, z, s) * 0.6 + vnoise(x * 2.1, z * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, z * 4.3, s + 2) * 0.1;

// '#rrggbb' -> [r, g, b] in linear light (what three.js expects in vertex colour attributes).
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function linear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [toLin(((n >> 16) & 255) / 255), toLin(((n >> 8) & 255) / 255), toLin((n & 255) / 255)];
}

// Exponential smoothing factor for a rate k (1/s) over dt, frame-rate independent.
export const follow = (k, dt) => 1 - Math.exp(-k * dt);
