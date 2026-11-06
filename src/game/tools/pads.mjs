// Two scripted phones for the browser tests and screenshots: real WebSocket pad clients on the real server,
// sending {t:'in', x, y, b, seq} at 30 Hz like controller/pad.js. They steer with what a bot would do (the host
// page's __game.botInput test hook), and `dawdle` slots ride the bed edge on the bank of the next animal so it
// comes down to drink, the way a player hugging the bank gets caught. It stays at race speed and in the bed (the
// stick held toward the bank under tuning bed.wallStick), and gives up on an animal that has not come over after
// `perAnimal` s and tries the next one.
import WebSocket from 'ws';

export async function connectPad(wsBase, id) {
  const ws = new WebSocket(`${wsBase}?role=pad&id=${id}`);
  const inbox = [];
  ws.on('message', (raw) => { try { inbox.push(JSON.parse(raw.toString())); } catch {} });
  await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail); });
  return { ws, inbox, id, send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)), close: () => ws.close() };
}

// page: the playwright host page; pads: already connected pads by slot (connect them before the host page opens,
// so ?autostart sees both phones at once). Returns { pads, stop(), drop(slot), rejoin(slot) }.
export async function scriptedPads(page, wsBase, { pads = [], slots = [0, 1], dawdle = [], hz = 30, drinks = 2, dawdleFor = 60, perAnimal = 6 } = {}) {
  for (const s of slots) pads[s] ||= await connectPad(wsBase, `scripted-pad-${s}`);
  const seq = [0, 0];
  let dawdled = 0; // s spent dawdling: it gives up after dawdleFor, so an icy bank cannot hold it forever
  const tried = {}; // 'stage:animal' -> s spent dawdling by it
  let running = true, busy = false;
  const timer = setInterval(async () => {
    if (!running || busy) return;
    busy = true;
    try {
      if (dawdled > dawdleFor) dawdle = [];
      const skip = Object.keys(tried).filter((k) => tried[k] > perAnimal);
      const plan = await page.evaluate(({ dawdle, drinks, skip }) => {
        const g = window.__game;
        if (!g || !g.botInput) return null;
        return [0, 1].map((s) => {
          const i = g.botInput(s), p = g.players[s];
          // hug the bank of the next animal ahead, until it has drunk a few sips
          if (p && dawdle.includes(s) && (g.events.drink || 0) < drinks && p.status === 'rolling') {
            const sp = Math.hypot(p.vel.x, p.vel.z) || 1, ux = p.vel.x / sp, uz = p.vel.z / sp;
            let best = null, bd = 150, key = null; // the edge is a few seconds of steering away at race speed
            (g.animals || []).forEach((a, i) => {
              const d = Math.hypot(a.x - p.pos.x, a.z - p.pos.z), k = `${g.stage}:${i}`;
              const ahead = (a.x - p.pos.x) * ux + (a.z - p.pos.z) * uz;
              const coming = a.state === 'approach' || a.state === 'drink';
              if (a.kind !== 'eagle' && a.state !== 'startled' && d < bd && (coming || (ahead > -4 && !skip.includes(k)))) { bd = d; best = a; key = k; }
            });
            if (best) {
              const lat = (best.x - p.pos.x) * -uz + (best.z - p.pos.z) * ux;
              return { x: Math.max(-0.45, Math.min(0.45, lat / 6)), y: 1, b: 0, dawdle: key };
            }
          }
          return { x: i.x, y: i.y, b: i.boost ? 1 : 0 };
        });
      }, { dawdle, drinks, skip });
      for (const p of plan || []) if (p.dawdle) { dawdled += 1 / hz; tried[p.dawdle] = (tried[p.dawdle] || 0) + 1 / hz; }
      if (plan) for (const s of slots) if (pads[s] && pads[s].ws.readyState === 1) pads[s].send({ t: 'in', x: plan[s].x, y: plan[s].y, b: plan[s].b, seq: seq[s]++ });
    } catch { /* page navigating or closed */ }
    busy = false;
  }, 1000 / hz);
  return {
    pads,
    stop() { running = false; clearInterval(timer); for (const p of pads) p?.close(); },
    halt() { running = false; clearInterval(timer); }, // stops sending, the phones stay connected
    async drop(s) { pads[s].close(); await new Promise((r) => pads[s].ws.once('close', r)); },
    async rejoin(s) { pads[s] = await connectPad(wsBase, `scripted-pad-${s}`); },
  };
}
