// Game-side input and keyboard fallback, with a stub transport, plus ws-transport against the real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createInput } from '../src/net/input.js';
import { createKeyboard } from '../src/net/keyboard.js';
import { createWsTransport } from '../src/net/ws-transport.js';
import { startServer, pad, sleep } from '../server/testing.js';

function stub() {
  let fn = null;
  const sent = [];
  return { sent, onMessage(f) { fn = f; }, send(m) { sent.push(m); }, push(m) { fn(m); } };
}
function fakeTarget() {
  const ls = {};
  return {
    addEventListener(t, f) { (ls[t] ||= []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((g) => g !== f); },
    key(type, code) { for (const f of ls[type] || []) f({ code, preventDefault() {} }); },
  };
}

test('get returns neutral disconnected state before any pad', () => {
  const input = createInput(stub(), { keyboard: null });
  for (const s of [0, 1, 2, -1, 0.5, 'x']) {
    assert.deepEqual(input.get(s), { x: 0, y: 0, boost: false, connected: false, source: null });
  }
});

test('join, in, leave drive get(slot); values are clamped', () => {
  const tr = stub();
  let t = 0;
  const input = createInput(tr, { keyboard: null, now: () => t });
  tr.push({ t: 'join', slot: 1, color: '#123456' });
  assert.equal(input.color(1), '#123456');
  assert.deepEqual(input.get(1), { x: 0, y: 0, boost: false, connected: true, source: 'pad' });
  tr.push({ t: 'in', slot: 1, x: 5, y: -7, b: 1, seq: 1 });
  assert.deepEqual(input.get(1), { x: 1, y: -1, boost: true, connected: true, source: 'pad' });
  tr.push({ t: 'in', slot: 1, x: NaN, y: 'a', b: 0, seq: 2 });
  assert.deepEqual(input.get(1), { x: 0, y: 0, boost: false, connected: true, source: 'pad' });
  tr.push({ t: 'in', slot: 1, x: 0.25, y: 0.5, b: 0, seq: 3 });
  assert.deepEqual(input.get(1), { x: 0.25, y: 0.5, boost: false, connected: true, source: 'pad' });
  assert.equal(input.get(0).connected, false);
  tr.push({ t: 'leave', slot: 1 });
  assert.deepEqual(input.get(1), { x: 0, y: 0, boost: false, connected: false, source: null });
  // Input for a slot that is not joined, or for a bad slot, is ignored.
  tr.push({ t: 'in', slot: 1, x: 1, y: 1, b: 1, seq: 9 });
  tr.push({ t: 'in', slot: 9, x: 1, y: 1, b: 1, seq: 9 });
  assert.equal(input.get(1).connected, false);
});

test('out-of-order seq is dropped, a rejoin resets the sequence', () => {
  const tr = stub();
  const input = createInput(tr, { keyboard: null, now: () => 0 });
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: 0.5, y: 0, b: 0, seq: 10 });
  tr.push({ t: 'in', slot: 0, x: -0.5, y: 0, b: 0, seq: 4 });
  assert.equal(input.get(0).x, 0.5);
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: -0.5, y: 0, b: 0, seq: 0 });
  assert.equal(input.get(0).x, -0.5);
});

test('a boost tap between two frames is not lost', () => {
  const tr = stub();
  const input = createInput(tr, { keyboard: null, now: () => 0 });
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 1, seq: 1 });
  tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 0, seq: 2 });
  assert.equal(input.get(0).boost, true);
  assert.equal(input.get(0).boost, false);
});

test('stale pad input decays to zero but stays connected', () => {
  const tr = stub();
  let t = 0;
  const input = createInput(tr, { keyboard: null, now: () => t, staleMs: 500 });
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: 1, y: 1, b: 0, seq: 1 });
  t = 400;
  assert.equal(input.get(0).x, 1);
  t = 900;
  assert.deepEqual(input.get(0), { x: 0, y: 0, boost: false, connected: true, source: 'pad' });
});

test('send stamps the slot and forwards to the transport', () => {
  const tr = stub();
  const input = createInput(tr, { keyboard: null });
  assert.equal(input.send(1, { t: 'fx', kind: 'drink' }), true);
  assert.equal(input.send(1, { t: 'hud', mass: 2, place: 1, slot: 0 }), true);
  assert.equal(input.send(3, { t: 'fx', kind: 'buzz' }), false);
  assert.deepEqual(tr.sent, [{ t: 'fx', kind: 'drink', slot: 1 }, { t: 'hud', mass: 2, place: 1, slot: 1 }]);
});

test('on() observes join and leave', () => {
  const tr = stub();
  const input = createInput(tr, { keyboard: null });
  const seen = [];
  input.on((m) => seen.push(m.t + m.slot));
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 0, seq: 1 });
  tr.push({ t: 'leave', slot: 0 });
  tr.push({ t: 'leave', slot: 0 });
  assert.deepEqual(seen, ['join0', 'leave0']);
});

test('keyboard: WASD+Shift for slot 0, arrows+Enter for slot 1, only without a pad', () => {
  const tr = stub();
  const target = fakeTarget();
  const input = createInput(tr, { keyboard: createKeyboard(target), now: () => 0 });
  assert.equal(input.get(0).connected, false);
  target.key('keydown', 'KeyW');
  target.key('keydown', 'KeyD');
  const g = input.get(0);
  assert.equal(g.source, 'keyboard');
  assert.equal(g.connected, true);
  assert.ok(Math.abs(g.x - Math.SQRT1_2) < 1e-9 && Math.abs(g.y - Math.SQRT1_2) < 1e-9);
  assert.equal(input.get(1).connected, false);
  target.key('keydown', 'ArrowLeft');
  target.key('keydown', 'Enter');
  target.key('keyup', 'Enter');
  assert.deepEqual(input.get(1), { x: -1, y: 0, boost: true, connected: true, source: 'keyboard' });
  assert.equal(input.get(1).boost, false);
  target.key('keydown', 'ShiftLeft');
  assert.equal(input.get(0).boost, true);
  assert.equal(input.get(0).boost, true);
  target.key('keyup', 'ShiftLeft');
  target.key('keyup', 'KeyW');
  target.key('keyup', 'KeyD');
  assert.deepEqual(input.get(0), { x: 0, y: 0, boost: false, connected: true, source: 'keyboard' });
  // A pad on slot 0 takes over; the keyboard is ignored for that slot.
  target.key('keydown', 'KeyA');
  tr.push({ t: 'join', slot: 0 });
  assert.deepEqual(input.get(0), { x: 0, y: 0, boost: false, connected: true, source: 'pad' });
  tr.push({ t: 'leave', slot: 0 });
  assert.equal(input.get(0).x, -1);
  input.dispose();
});

test('ws-transport talks to the real server, reports leave on drop, stops when replaced', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const url = `${srv.wsBase}?role=host`;
  const tr = createWsTransport({ url, WebSocketImpl: WebSocket });
  const input = createInput(tr, { keyboard: null });
  const statuses = [];
  tr.onStatus((s) => statuses.push(s));
  const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await sleep(10); } };
  await until(() => tr.status === 'open');
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  await until(() => input.get(0).connected);
  a.send({ t: 'in', x: 0.4, y: -0.6, b: 1, seq: 1 });
  await until(() => input.get(0).x === 0.4);
  input.send(0, { t: 'fx', kind: 'finish' });
  assert.deepEqual(await a.next('fx'), { t: 'fx', kind: 'finish', slot: 0 });
  // A second host tab replaces this one: leave is synthesised and the transport stops.
  const tr2 = createWsTransport({ url, WebSocketImpl: WebSocket });
  await until(() => tr.status === 'replaced');
  assert.equal(input.get(0).connected, false);
  assert.ok(statuses.includes('open') && statuses.at(-1) === 'replaced');
  await until(() => tr2.status === 'open');
  tr2.close();
  tr.close();
});

test('ws-transport reconnects after the server restarts on the same port', async (t) => {
  let srv = await startServer();
  const port = srv.port;
  const tr = createWsTransport({ url: `${srv.wsBase}?role=host`, WebSocketImpl: WebSocket });
  t.after(() => { tr.close(); return srv.close(); });
  const until = async (fn, ms = 6000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await sleep(10); } };
  await until(() => tr.status === 'open');
  await srv.close();
  await until(() => tr.status !== 'open');
  srv = await startServer({ port });
  await until(() => tr.status === 'open');
});

test('a burst of presses arriving in one frame is replayed as separate presses', () => {
  const tr = stub();
  const input = createInput(tr, { keyboard: null, now: () => 0 });
  tr.push({ t: 'join', slot: 0 });
  let seq = 1;
  for (let i = 0; i < 3; i++) {
    tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 1, seq: seq++ });
    tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 0, seq: seq++ });
  }
  const frames = Array.from({ length: 7 }, () => input.get(0).boost);
  assert.deepEqual(frames, [true, false, true, false, true, false, false]);
  // Holding still reads as held after the press is delivered.
  tr.push({ t: 'in', slot: 0, x: 0, y: 0, b: 1, seq: seq++ });
  assert.deepEqual([input.get(0).boost, input.get(0).boost], [true, true]);
});

test('a held button does not keep boosting once the pad goes stale', () => {
  const tr = stub();
  let t = 0;
  const input = createInput(tr, { keyboard: null, now: () => t, staleMs: 500 });
  tr.push({ t: 'join', slot: 0 });
  tr.push({ t: 'in', slot: 0, x: 0, y: 1, b: 1, seq: 1 });
  assert.equal(input.get(0).boost, true);
  t = 2000;
  assert.deepEqual(input.get(0), { x: 0, y: 0, boost: false, connected: true, source: 'pad' });
});
