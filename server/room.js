// Single room with two slots. No game logic: it assigns slots and relays messages.
// The drops' colours on the TV (src/ui/icons.js PLAYER_COLORS main): the pad paints its stick and SCATTO with them.
export const SLOT_COLORS = ['#4aa6f2', '#f28bbd']; // slot 0 azzurro, slot 1 rosa
export const SLOT_NAMES = ['azzurro', 'rosa'];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPEN = 1;

export function validId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

const clamp1 = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

// Returns a sanitised 'in' message without slot, or null when the payload is not a usable input.
export function sanitizeInput(m) {
  if (!m || m.t !== 'in') return null;
  if (typeof m.x !== 'number' || typeof m.y !== 'number') return null;
  const seq = Number.isSafeInteger(m.seq) && m.seq >= 0 ? m.seq : 0;
  return { x: clamp1(m.x), y: clamp1(m.y), b: m.b === 1 || m.b === true ? 1 : 0, seq };
}

// Returns a sanitised 'vote' message without slot (the lobby's mountain vote: the card the phone shows, lock true
// when the player voted for it), or null.
const WORLD_RE = /^[a-z0-9_-]{1,32}$/;
export function sanitizeVote(m) {
  if (!m || m.t !== 'vote' || typeof m.world !== 'string' || !WORLD_RE.test(m.world)) return null;
  return { world: m.world, lock: m.lock === true };
}

export function createRoom({ reserveMs = 60000, log = () => {} } = {}) {
  // slots[i] = { id, ws, timer } ; ws null while the slot is reserved after a leave
  const slots = [null, null];
  const waiting = []; // pads that got {t:'full'}: [{ id, ws }]
  let host = null;

  const send = (ws, msg) => {
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  };
  const toHost = (msg) => send(host, msg);

  function seat(slot, id, ws) {
    const prev = slots[slot];
    if (prev?.timer) clearTimeout(prev.timer);
    slots[slot] = { id, ws, timer: null };
    ws._slot = slot;
    send(ws, { t: 'welcome', slot, color: SLOT_COLORS[slot], id, host: !!host });
    toHost({ t: 'join', slot, color: SLOT_COLORS[slot] });
    log(`pad ${id.slice(0, 8)} -> slot ${slot}`);
  }

  function promoteWaiting() {
    for (let s = 0; s < slots.length && waiting.length; s++) {
      if (slots[s]) continue;
      // A socket that is already closing would be seated and then reserve the slot for 60 s.
      let w = waiting.shift();
      while (w && w.ws.readyState !== OPEN) w = waiting.shift();
      if (w) seat(s, w.id, w.ws);
    }
  }

  function addPad(ws, id) {
    ws._role = 'pad';
    ws._id = id;
    ws._slot = -1;
    // Same id comes back (reload, network blip): take its slot, kicking a stale socket if any.
    const mine = slots.findIndex((s) => s && s.id === id);
    if (mine >= 0) {
      const old = slots[mine].ws;
      if (old && old !== ws) {
        old._slot = -1;
        old._replaced = true;
        try { old.close(4001, 'replaced'); } catch {}
      }
      seat(mine, id, ws);
      return;
    }
    // An id already queued: replace the queued socket.
    const q = waiting.findIndex((w) => w.id === id);
    if (q >= 0) {
      const old = waiting[q].ws;
      old._replaced = true;
      try { old.close(4001, 'replaced'); } catch {}
      waiting.splice(q, 1);
    }
    const free = slots.findIndex((s) => !s);
    if (free >= 0) {
      seat(free, id, ws);
      return;
    }
    waiting.push({ id, ws });
    send(ws, { t: 'full' });
    toHost({ t: 'full', waiting: waiting.length }); // the TV shows "the room is full" too
    log(`pad ${id.slice(0, 8)} waiting (room full)`);
  }

  function removePad(ws) {
    if (ws._replaced) return;
    const wi = waiting.findIndex((w) => w.ws === ws);
    if (wi >= 0) waiting.splice(wi, 1);
    const slot = ws._slot;
    if (slot < 0 || !slots[slot] || slots[slot].ws !== ws) return;
    const entry = slots[slot];
    entry.ws = null;
    toHost({ t: 'leave', slot });
    log(`pad ${entry.id.slice(0, 8)} left slot ${slot}, reserved ${reserveMs} ms`);
    entry.timer = setTimeout(() => {
      if (slots[slot] !== entry || entry.ws) return;
      slots[slot] = null;
      log(`slot ${slot} free`);
      promoteWaiting();
    }, reserveMs);
    entry.timer.unref?.();
  }

  function addHost(ws) {
    ws._role = 'host';
    if (host && host !== ws) {
      const old = host;
      old._replaced = true;
      try { old.close(4000, 'replaced'); } catch {}
      log('host replaced by a newer tab');
    }
    host = ws;
    for (let s = 0; s < slots.length; s++) {
      if (slots[s]?.ws) {
        send(ws, { t: 'join', slot: s, color: SLOT_COLORS[s] });
        send(slots[s].ws, { t: 'host', on: true });
      }
    }
    log('host connected');
  }

  function removeHost(ws) {
    if (host !== ws) return;
    host = null;
    for (const s of slots) if (s?.ws) send(s.ws, { t: 'host', on: false });
    log('host disconnected');
  }

  function fromPad(ws, m) {
    if (m.t === 'ping') {
      ws._pings = true; // it speaks the pad page's keep-alive: the server may hold it to padSilentMs
      send(ws, { t: 'pong', ts: Number.isFinite(m.ts) ? m.ts : 0 });
      return;
    }
    const slot = ws._slot;
    if (slot < 0 || slots[slot]?.ws !== ws) return;
    if (m.t === 'vote') {
      const vote = sanitizeVote(m);
      if (vote) toHost({ t: 'vote', slot, ...vote });
      return;
    }
    const input = sanitizeInput(m);
    if (!input) return;
    toHost({ t: 'in', slot, ...input });
  }

  function fromHost(ws, m) {
    if (ws !== host) return;
    if (typeof m.t !== 'string' || !Number.isInteger(m.slot)) return;
    const entry = slots[m.slot];
    if (entry?.ws) send(entry.ws, m);
  }

  function message(ws, raw) {
    if (raw.length > 4096) return;
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    if (ws._role === 'pad') fromPad(ws, m);
    else if (ws._role === 'host') fromHost(ws, m);
  }

  function close() {
    for (const s of slots) if (s?.timer) clearTimeout(s.timer);
  }

  const status = () => ({
    host: !!host,
    slots: slots.map((s) => (s ? { id: s.id, connected: !!s.ws } : null)),
    waiting: waiting.length,
  });

  return { addPad, removePad, addHost, removeHost, message, close, status };
}
