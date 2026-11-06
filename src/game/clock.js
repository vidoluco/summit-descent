// Fixed-step game clock decoupled from the frame rate: each frame adds its real time (times the speed),
// the sim steps at a fixed dt as many times as fit, and the leftover fraction `alpha` interpolates the drawing
// between the last two steps. A long stall (tab in background) drops time instead of fast-forwarding.
export function createClock({ dt = 1 / 60, maxSteps = 8, speed = 1 } = {}) {
  let acc = 0;
  return {
    dt,
    get speed() { return speed; },
    set speed(v) { speed = Math.max(0, +v || 0); },
    // frameDt in s -> how many fixed steps to run now; then read alpha
    advance(frameDt) {
      acc += Math.max(0, Math.min(frameDt, 0.25)) * speed;
      let n = Math.floor(acc / dt + 1e-9);
      const cap = Math.ceil(maxSteps * Math.max(1, speed));
      if (n > cap) { n = cap; acc = 0; } else acc -= n * dt;
      return n;
    },
    get alpha() { return Math.max(0, Math.min(1, acc / dt)); },
    reset() { acc = 0; },
  };
}

// Interpolated copy of the sim players for the renderer: capture() before each step stores where every
// drop was, view(state, alpha) blends toward where it is now. Reuses its objects: no allocation per frame.
// A jump longer than `snap` m (respawn, stage swap) is not blended.
export function createInterp({ slots = 2, snap = 12 } = {}) {
  const prev = Array.from({ length: slots }, () => ({ x: 0, y: 0, z: 0, ok: false }));
  const players = Array.from({ length: slots }, () => ({}));
  const pos = Array.from({ length: slots }, () => ({ x: 0, y: 0, z: 0 }));
  const view = { players: [], pickups: [], animals: [], events: [], phase: 'countdown', t: 0 };
  return {
    capture(state) {
      for (let s = 0; s < slots; s++) {
        const p = state?.players[s], q = prev[s];
        if (!p) { q.ok = false; continue; }
        q.x = p.pos.x; q.y = p.pos.y; q.z = p.pos.z; q.ok = true;
      }
    },
    reset() { for (const q of prev) q.ok = false; },
    view(state, alpha, events = state.events) {
      view.players.length = 0;
      for (let s = 0; s < state.players.length && s < slots; s++) {
        const p = state.players[s], q = prev[s], out = Object.assign(players[s], p), o = pos[s];
        out.pos = o; // never the sim's own object
        const far = !q.ok || Math.abs(p.pos.x - q.x) + Math.abs(p.pos.z - q.z) > snap;
        const a = far ? 1 : alpha;
        o.x = q.x + (p.pos.x - q.x) * a; o.y = q.y + (p.pos.y - q.y) * a; o.z = q.z + (p.pos.z - q.z) * a;
        view.players.push(out);
      }
      view.pickups = state.pickups; view.animals = state.animals; view.events = events;
      view.phase = state.phase; view.t = state.t; view.stage = state.stage;
      return view;
    },
  };
}
