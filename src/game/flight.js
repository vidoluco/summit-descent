// The cloud's flight between two stages over the real terrain (pure math, tested in node). Positions are in the
// global frame of world.json (stage frames are translations of it). The path eases out of the end of one stage,
// climbs in an arc that always clears the backdrop terrain under it by `clear` m, and eases down to hover over
// the start of the next stage. The camera rides behind the cloud, higher and further back at the top of the arc.
import { CLOUD } from './race.js';

export const FLIGHT = {
  rise: 7, // m above the drop where its cloud forms
  hover: 13, // m above the start point where the cloud waits to rain the drop in
  arc: [60, 420], // m extra height at the top of the arc, from the distance flown (8 %), clamped
  clear: 90, // m above the highest ground within `window` m of the path
  window: 160, // m
  samples: 96,
  lag: 0.12, // fraction of the path the trailing cloud lags at most, at the middle of the flight
  cam: { back: [21, 46], up: [5, 26], look: [6, 70] }, // m at the ends .. at the top of the arc
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const ease = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; };

// from, to: {x, y, z} global positions of the drop at the end of one stage and at the start of the next.
// ground(x, z): global terrain height. Returns { at(u, out) -> {x, y, z, yaw, arc}, length, top }.
export function flightPath(from, to, ground, F = FLIGHT) {
  const a = { x: from.x, y: from.y + F.rise, z: from.z };
  const b = { x: to.x, y: to.y + F.hover, z: to.z };
  const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz) || 1;
  const ux = dx / dist, uz = dz / dist;
  const H = clamp(dist * 0.08, F.arc[0], F.arc[1]);
  const n = F.samples, ys = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const u = i / n, e = ease(u);
    const x = lerp(a.x, b.x, e), z = lerp(a.z, b.z, e);
    const base = lerp(a.y, b.y, e) + Math.sin(Math.PI * u) * H;
    // the highest ground around this point (along and across the path)
    let g = -Infinity;
    for (const [s, l] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]) {
      g = Math.max(g, ground(x + (ux * s - uz * l) * F.window, z + (uz * s + ux * l) * F.window));
    }
    // near the ends the cloud is allowed down to its stage (that ground is where the drop is)
    const w = smooth(u / 0.18) * smooth((1 - u) / 0.18);
    ys[i] = Math.max(base, lerp(base, g + F.clear, w));
  }
  // soften the profile, then make sure it still clears the ground
  for (let pass = 0; pass < 3; pass++) {
    const c = Float64Array.from(ys);
    for (let i = 1; i < n; i++) ys[i] = Math.max(c[i], (c[i - 1] + 2 * c[i] + c[i + 1]) / 4);
  }
  ys[0] = a.y; ys[n] = b.y;
  const yaw = Math.atan2(ux, uz);
  let top = -Infinity;
  for (const y of ys) top = Math.max(top, y);
  return {
    length: dist,
    top,
    from: a,
    to: b,
    dir: { x: ux, z: uz },
    at(u, out = {}) {
      u = clamp(u, 0, 1);
      const e = ease(u), f = u * n, i = Math.min(n - 1, Math.floor(f)), t = f - i;
      out.x = lerp(a.x, b.x, e); out.z = lerp(a.z, b.z, e);
      out.y = lerp(ys[i], ys[i + 1], t);
      out.yaw = yaw;
      out.arc = Math.sin(Math.PI * u);
      return out;
    },
  };
}

// Where each slot's cloud is during the flight, at flight time t of `duration` s: the leader on schedule, the
// others lagging a little in the middle (the gap of the stage end, scaled), all hovering at the end.
export function flightU(t, duration = CLOUD.duration, delay = 0, F = FLIGHT) {
  const u = clamp(t / duration, 0, 1);
  const lag = Math.min(F.lag, delay / 60);
  return clamp(u - lag * Math.sin(Math.PI * u), 0, 1);
}

// Camera behind a cloud at pose p (global or local, any frame): {x, y, z} and the point it looks at.
export function flightCamera(p, dir, out = { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0 }, F = FLIGHT) {
  const k = smooth(p.arc ?? 0);
  const back = lerp(F.cam.back[0], F.cam.back[1], k), up = lerp(F.cam.up[0], F.cam.up[1], k), look = lerp(F.cam.look[0], F.cam.look[1], k);
  out.x = p.x - dir.x * back; out.z = p.z - dir.z * back; out.y = p.y + up;
  out.lx = p.x + dir.x * look; out.lz = p.z + dir.z * look; out.ly = p.y - up * 0.35;
  return out;
}
