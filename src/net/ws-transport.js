// WebSocket transport for the host page: {onMessage(fn), send(msg)} per the network contract.
// Reconnects with backoff. While the socket is down it delivers {t:'leave', slot} for both slots,
// so the game sees the pads as gone; the server re-sends {t:'join'} on reconnect.
// A newer host tab closes this one with code 4000: the transport then stops for good.

export function createWsTransport({ url, WebSocketImpl = globalThis.WebSocket, slots = 2 } = {}) {
  if (!url) {
    const loc = globalThis.location;
    const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:';
    url = `${proto}//${loc?.host || 'localhost:5190'}/ws?role=host`;
  }
  const listeners = new Set();
  const statusListeners = new Set();
  let ws = null;
  let status = 'connecting';
  let retry = 0;
  let timer = null;
  let stopped = false;

  const emit = (m) => { for (const fn of listeners) { try { fn(m); } catch (e) { console.error(e); } } };
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    for (const fn of statusListeners) { try { fn(s); } catch (e) { console.error(e); } }
  };

  function connect() {
    if (stopped) return;
    setStatus('connecting');
    let sock;
    try { sock = new WebSocketImpl(url); } catch { return schedule(); }
    ws = sock;
    sock.onopen = () => { retry = 0; setStatus('open'); };
    sock.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (m && typeof m === 'object' && typeof m.t === 'string') emit(m);
    };
    sock.onerror = () => {};
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      for (let s = 0; s < slots; s++) emit({ t: 'leave', slot: s });
      if (ev?.code === 4000) {
        stopped = true;
        setStatus('replaced');
        return;
      }
      schedule();
    };
  }

  function schedule() {
    if (stopped) return;
    setStatus('closed');
    const delay = Math.min(5000, 400 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
    clearTimeout(timer);
    timer = setTimeout(connect, delay);
  }

  connect();

  return {
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    send(msg) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
      return false;
    },
    onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); },
    get status() { return status; },
    close() {
      stopped = true;
      clearTimeout(timer);
      const s = ws;
      ws = null;
      try { s?.close(); } catch {}
      setStatus('closed');
    },
  };
}
