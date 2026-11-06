// Game-side input per the network contract: createInput(transport) -> { get(slot), send(slot, msg) }.
// transport is any {onMessage(fn), send(msg)}: the WebSocket one, a test stub, a future AirConsole adapter.
// Axes: x in [-1,1] right positive, y in [-1,1] up positive (up = forward = downhill).
// Extras beyond the contract: get() also returns `source` ('pad' | 'keyboard' | null);
// on(fn) observes join/leave/full; color(slot); dispose().
// Test hook: with globalThis.__netTrace = { rx: [], read: [] } set before the page loads, every pad input is
// logged when it arrives (rx) and when a get() first hands it to the game (read), in epoch ms, so the browser
// tests can measure touch to host latency (test/helpers/phones.mjs).
import { createKeyboard } from './keyboard.js';

export const DEFAULT_COLORS = ['#4aa6f2', '#f28bbd']; // server/room.js SLOT_COLORS
const SLOTS = 2;
const MAX_PRESSES = 8;
const clamp1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
const validSlot = (s) => Number.isInteger(s) && s >= 0 && s < SLOTS;

export function createInput(transport, {
  keyboard = typeof window !== 'undefined' ? createKeyboard(window) : null,
  now = () => (globalThis.performance?.now?.() ?? Date.now()),
  staleMs = 1000,
} = {}) {
  const pads = Array.from({ length: SLOTS }, (_, i) => ({
    connected: false, x: 0, y: 0, b: false, presses: 0, out: false, seq: -1, at: 0, color: DEFAULT_COLORS[i],
  }));
  const reset = { x: 0, y: 0, b: false, presses: 0, out: false };
  const listeners = new Set();
  const trace = globalThis.__netTrace?.rx && globalThis.__netTrace?.read ? globalThis.__netTrace : null;
  const epoch = () => (globalThis.performance ? performance.timeOrigin + performance.now() : Date.now());
  const read = [-1, -1]; // last seq a get() handed out, per slot (traced only)
  const log = (list, rec) => { if (list.length > 20000) list.splice(0, 10000); list.push(rec); };

  const off = transport.onMessage((m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'in') {
      if (!validSlot(m.slot)) return;
      const p = pads[m.slot];
      if (!p.connected) return;
      if (Number.isSafeInteger(m.seq)) {
        if (m.seq < p.seq) return;
        p.seq = m.seq;
      }
      p.x = clamp1(m.x);
      p.y = clamp1(m.y);
      const b = m.b === 1 || m.b === true;
      // Wi-Fi power save delivers inputs in bursts: count every press so ice-breaking taps are not merged.
      if (b && !p.b) p.presses = Math.min(MAX_PRESSES, p.presses + 1);
      p.b = b;
      p.at = now();
      if (trace) log(trace.rx, { slot: m.slot, seq: p.seq, x: p.x, y: p.y, b: b ? 1 : 0, at: epoch() });
      return;
    }
    if (m.t === 'join' && validSlot(m.slot)) {
      const p = pads[m.slot];
      Object.assign(p, reset, { connected: true, seq: -1, at: now() });
      if (typeof m.color === 'string') p.color = m.color;
    } else if (m.t === 'leave' && validSlot(m.slot)) {
      const p = pads[m.slot];
      if (!p.connected) return;
      Object.assign(p, reset, { connected: false });
    } else if (m.t !== 'full') {
      return;
    }
    for (const fn of listeners) { try { fn(m); } catch (e) { console.error(e); } }
  });

  return {
    get(slot) {
      if (!validSlot(slot)) return { x: 0, y: 0, boost: false, connected: false, source: null };
      const p = pads[slot];
      if (p.connected) {
        const stale = now() - p.at > staleMs;
        // One frame per queued press, with a released frame between presses so the sim sees each edge.
        let boost;
        if (p.presses > 0) {
          boost = !p.out;
          if (boost) p.presses--;
        } else {
          boost = p.b && !stale;
        }
        p.out = boost;
        if (trace && p.seq !== read[slot]) { read[slot] = p.seq; log(trace.read, { slot, seq: p.seq, at: epoch() }); }
        if (stale) return { x: 0, y: 0, boost, connected: true, source: 'pad' };
        return { x: p.x, y: p.y, boost, connected: true, source: 'pad' };
      }
      const k = keyboard?.get(slot);
      if (k) return { x: clamp1(k.x), y: clamp1(k.y), boost: !!k.boost, connected: true, source: 'keyboard' };
      return { x: 0, y: 0, boost: false, connected: false, source: null };
    },
    send(slot, msg) {
      if (!validSlot(slot) || !msg || typeof msg !== 'object') return false;
      return transport.send({ ...msg, slot }) !== false;
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    color(slot) { return validSlot(slot) ? pads[slot].color : null; },
    padConnected(slot) { return validSlot(slot) && pads[slot].connected; },
    dispose() { if (typeof off === 'function') off(); keyboard?.dispose?.(); },
  };
}
