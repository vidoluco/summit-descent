// Server protocol: slots, relay, reservation, full room, malformed input. Real ws clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, fakeDist, host, pad, client, sleep } from '../server/testing.js';
import { SLOT_COLORS } from '../server/room.js';

test('pads get slot 0 then 1 with their colours, host is told', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const wa = await a.next('welcome');
  assert.equal(wa.slot, 0);
  assert.equal(wa.color, SLOT_COLORS[0]);
  assert.equal(wa.host, true);
  assert.deepEqual(await h.next('join'), { t: 'join', slot: 0, color: SLOT_COLORS[0] });
  const b = await pad(srv, 'bbbb');
  assert.equal((await b.next('welcome')).slot, 1);
  assert.deepEqual(await h.next('join'), { t: 'join', slot: 1, color: SLOT_COLORS[1] });
  assert.notEqual(SLOT_COLORS[0], SLOT_COLORS[1]);
});

// The phone is painted with the colour the server hands out: it must be the drop's colour on the TV (playtest r1:
// the pink phone was coral and said 'Rosa').
test('slot colours are the TV drops\' colours, on the server, the host input and the pad', async () => {
  const { PLAYER_COLORS } = await import('../src/ui/icons.js');
  const { DEFAULT_COLORS } = await import('../src/net/input.js');
  const tv = PLAYER_COLORS.map((c) => c.main);
  assert.deepEqual(SLOT_COLORS, tv);
  assert.deepEqual(DEFAULT_COLORS, tv);
  // the vote badge of the other phone
  const padSrc = readFileSync(new URL('../controller/pad.js', import.meta.url), 'utf8');
  assert.ok(padSrc.includes(`slot === 0 ? '${tv[1]}' : '${tv[0]}'`), 'pad.js --other matches the TV colours');
});

test('pad input is stamped with the slot and relayed to the host', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  b.send({ t: 'in', x: 0.5, y: -0.25, b: 1, seq: 7, slot: 0 }); // a forged slot is overwritten
  assert.deepEqual(await h.next('in'), { t: 'in', slot: 1, x: 0.5, y: -0.25, b: 1, seq: 7 });
  a.send({ t: 'in', x: 3, y: -9, b: 0, seq: 1 });
  assert.deepEqual(await h.next('in'), { t: 'in', slot: 0, x: 1, y: -1, b: 0, seq: 1 });
});

test('host fx and hud reach only the pad in that slot', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  h.send({ t: 'fx', slot: 1, kind: 'freeze' });
  h.send({ t: 'hud', slot: 0, mass: 1.5, place: 2 });
  assert.deepEqual(await b.next('fx'), { t: 'fx', slot: 1, kind: 'freeze' });
  assert.deepEqual(await a.next('hud'), { t: 'hud', slot: 0, mass: 1.5, place: 2 });
  assert.ok(await a.none('fx'));
  assert.ok(await b.none('hud'));
  h.send({ t: 'fx', slot: 5, kind: 'buzz' });
  h.send({ t: 'fx', kind: 'buzz' });
  assert.ok(await a.none('fx'));
  assert.ok(await b.none('fx'));
});

test('leave keeps the slot for the same id, reconnection resumes it', async (t) => {
  const srv = await startServer({ reserveMs: 60000 });
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  await a.close();
  assert.deepEqual(await h.next('leave'), { t: 'leave', slot: 0 });
  // A newcomer while slot 0 is reserved has to wait.
  const c = await pad(srv, 'cccc');
  assert.equal((await c.next()).t, 'full');
  const a2 = await pad(srv, 'aaaa');
  assert.equal((await a2.next('welcome')).slot, 0);
  assert.deepEqual(await h.next('join'), { t: 'join', slot: 0, color: SLOT_COLORS[0] });
  a2.send({ t: 'in', x: 0.1, y: 0.2, b: 0, seq: 0 });
  assert.equal((await h.next('in')).slot, 0);
  assert.ok(await c.none('welcome'));
});

test('reloading pad with the same id takes over its slot without a leave', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  await h.next('join');
  const a2 = await pad(srv, 'aaaa');
  assert.equal((await a2.next('welcome')).slot, 0);
  assert.equal(await a.closed(), 4001);
  assert.ok(await h.none('leave'));
  a2.send({ t: 'in', x: 0, y: 1, b: 0, seq: 1 });
  assert.equal((await h.next('in')).y, 1);
});

test('third pad gets full, waits, and joins when a reserved slot times out', async (t) => {
  const srv = await startServer({ reserveMs: 150 });
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  const c = await pad(srv, 'cccc');
  assert.deepEqual(await c.next(), { t: 'full' });
  assert.deepEqual(await h.next('full'), { t: 'full', waiting: 1 }, 'the TV hears it too, for its "room is full" toast');
  c.send({ t: 'in', x: 1, y: 1, b: 1, seq: 0 }); // a waiting pad cannot drive anyone
  assert.ok(await h.none('in'));
  await h.next('join');
  await h.next('join');
  await b.close();
  assert.deepEqual(await h.next('leave'), { t: 'leave', slot: 1 });
  const w = await c.next('welcome', 2000);
  assert.equal(w.slot, 1);
  assert.deepEqual(await h.next((m) => m.t === 'join'), { t: 'join', slot: 1, color: SLOT_COLORS[1] });
  // b is now too late: the room is full again.
  const b2 = await pad(srv, 'bbbb');
  assert.deepEqual(await b2.next(), { t: 'full' });
});

test('slot frees after the reservation timeout and a new id can take it', async (t) => {
  const srv = await startServer({ reserveMs: 120 });
  t.after(() => srv.close());
  await host(srv);
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  await a.close();
  await sleep(250);
  const z = await pad(srv, 'zzzz');
  assert.equal((await z.next('welcome')).slot, 0);
  assert.equal(srv.room.status().slots[0].id, 'zzzz');
});

test('a waiting pad that disconnects leaves the queue', async (t) => {
  const srv = await startServer({ reserveMs: 100 });
  t.after(() => srv.close());
  await host(srv);
  const a = await pad(srv, 'aaaa');
  const b = await pad(srv, 'bbbb');
  await a.next('welcome');
  await b.next('welcome');
  const c = await pad(srv, 'cccc');
  await c.next('full');
  const d = await pad(srv, 'dddd');
  await d.next('full');
  await c.close();
  await a.close();
  assert.equal((await d.next('welcome', 2000)).slot, 0);
  assert.equal(srv.room.status().waiting, 0);
});

test('last host wins and gets the current pads; pads hear host on/off', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const a = await pad(srv, 'aaaa');
  const wa = await a.next('welcome');
  assert.equal(wa.host, false);
  const h1 = await host(srv);
  assert.deepEqual(await h1.next('join'), { t: 'join', slot: 0, color: SLOT_COLORS[0] });
  assert.deepEqual(await a.next('host'), { t: 'host', on: true });
  const h2 = await host(srv);
  assert.equal(await h1.closed(), 4000);
  assert.deepEqual(await h2.next('join'), { t: 'join', slot: 0, color: SLOT_COLORS[0] });
  a.send({ t: 'in', x: 0.3, y: 0, b: 0, seq: 3 });
  assert.equal((await h2.next('in')).x, 0.3);
  await h2.close();
  assert.deepEqual(await a.next((m) => m.t === 'host' && m.on === false), { t: 'host', on: false });
});

test('malformed messages are ignored and the connection survives', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  a.send('not json');
  a.send('[1,2,3]');
  a.send('null');
  a.send({ t: 'in' });
  a.send({ t: 'in', x: '1', y: 0, b: 0, seq: 0 });
  a.send({ t: 'in', x: null, y: 0 });
  a.send({ t: 'bogus', x: 1 });
  a.send('x'.repeat(5000));
  h.send('{oops');
  h.send({ slot: 0 });
  h.send({ t: 'fx', slot: '0', kind: 'buzz' });
  assert.ok(await h.none('in'));
  assert.ok(await a.none('fx'));
  a.send({ t: 'in', x: NaN, y: 0.5, b: 2, seq: -4 }); // NaN serialises to null: dropped
  a.send({ t: 'in', x: 0.2, y: 0.5, b: 2, seq: -4 });
  assert.deepEqual(await h.next('in'), { t: 'in', slot: 0, x: 0.2, y: 0.5, b: 0, seq: 0 });
  a.send({ t: 'ping', ts: 42 });
  assert.deepEqual(await a.next('pong'), { t: 'pong', ts: 42 });
});

test('pads without a valid id get one assigned; bad roles are refused', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const p = client(`${srv.wsBase}?role=pad&id=${encodeURIComponent('<script>')}`);
  await p.open();
  const w = await p.next('welcome');
  assert.match(w.id, /^[0-9a-f-]{36}$/);
  const bad = new WebSocket(`${srv.wsBase}?role=admin`);
  await new Promise((ok) => { bad.on('error', ok); bad.on('close', ok); });
  assert.notEqual(bad.readyState, WebSocket.OPEN);
  const wrongPath = new WebSocket(`ws://127.0.0.1:${srv.port}/nope?role=host`);
  await new Promise((ok) => { wrongPath.on('error', ok); wrongPath.on('close', ok); });
  assert.notEqual(wrongPath.readyState, WebSocket.OPEN);
});

test('silent clients are dropped by the heartbeat', async (t) => {
  // Server and clients share this process: a short interval lets a CPU stall (the browser tests run in parallel)
  // fire the heartbeat before the host's queued pong is read, dropping the host too. 300 ms keeps a margin.
  const srv = await startServer({ pingMs: 300, reserveMs: 60000 });
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  // Stop answering pings: ws auto-pongs, so pause the socket so no pong is sent.
  a.ws._socket.pause();
  a.ws.pong = () => {};
  assert.deepEqual(await h.next('leave', 3000), { t: 'leave', slot: 0 });
});

test('http: host page, pad page, static files, qr, info, traversal', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const get = (p) => fetch(srv.base + p);
  let r = await get('/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /host/);
  r = await get('/pad');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(await r.text(), /pad/);
  r = await get('/app.js');
  assert.match(r.headers.get('content-type'), /javascript/);
  r = await get('/data/h.bin');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3, 4]);
  r = await get('/qr.svg?u=' + encodeURIComponent('http://192.168.1.5:5190/pad'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/svg+xml');
  assert.match(await r.text(), /^<svg/);
  r = await get('/api/info');
  const info = await r.json();
  assert.match(info.lanUrl, new RegExp(`^http://[\\d.]+:${srv.port}/$`));
  assert.equal(info.padUrl, info.lanUrl + 'pad');
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fetc/passwd', '/nope.js', '/%00']) {
    assert.equal((await get(p)).status, 404, p);
  }
  r = await fetch(srv.base + '/pad/?x=1', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/pad?x=1');
  r = await fetch(srv.base + '/', { method: 'POST' });
  assert.equal(r.status, 405);
});

test('listen fails cleanly when the port is taken', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const { createServer } = await import('../server/index.js');
  const other = createServer({ port: srv.port, host: '127.0.0.1' });
  await assert.rejects(other.listen(), { code: 'EADDRINUSE' });
});

test('lan address prefers Wi-Fi over a VPN tunnel, LAN_IP overrides', async () => {
  const { lanAddress } = await import('../server/index.js');
  const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal });
  const ifaces = { lo0: [v4('127.0.0.1', true)], utun7: [v4('10.5.0.2')], en0: [{ family: 'IPv6', address: 'fe80::1', internal: false }, v4('192.168.1.20')] };
  assert.equal(lanAddress(ifaces, {}), '192.168.1.20');
  assert.equal(lanAddress({ utun7: [v4('10.5.0.2')] }, {}), '10.5.0.2');
  assert.equal(lanAddress({ lo0: [v4('127.0.0.1', true)] }, {}), null);
  assert.equal(lanAddress(ifaces, { LAN_IP: '192.168.9.9' }), '192.168.9.9');
  assert.equal(lanAddress({ en0: [v4('169.254.10.3')], en5: [v4('192.168.1.7')] }, {}), '192.168.1.7');
});

test('lan address: NordVPN and other tunnels never win over the Wi-Fi, on macOS, Linux and Windows', async () => {
  const { lanAddress, lanAddresses, viaVpn } = await import('../server/index.js');
  const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal });
  // macOS with NordVPN (NordLynx is a utun), Meshnet on another utun, Docker's bridge, the Wi-Fi listed last
  const mac = { lo0: [v4('127.0.0.1', true)], utun4: [v4('10.5.0.2')], utun5: [v4('100.81.12.4')], bridge100: [v4('192.168.64.1')], en0: [v4('192.168.0.108')] };
  assert.equal(lanAddress(mac, {}), '192.168.0.108');
  const order = lanAddresses(mac).map((f) => f.name);
  assert.equal(order[0], 'en0');
  assert.equal(order.at(-1), 'utun5', 'the carrier-grade Meshnet address comes last');
  assert.equal(viaVpn(mac, '192.168.0.108'), false);
  // Linux: nordlynx, wg0, tailscale0, a ZeroTier zt*, the Wi-Fi as wlp2s0
  const linux = { nordlynx: [v4('10.5.0.2')], wg0: [v4('10.8.0.3')], tailscale0: [v4('100.101.1.2')], ztabc123: [v4('10.147.17.5')], wlp2s0: [v4('192.168.1.42')] };
  assert.equal(lanAddress(linux, {}), '192.168.1.42');
  // Windows adapter names
  const win = { 'NordLynx': [v4('10.5.0.2')], 'TAP-NordVPN Windows Adapter V9': [v4('10.8.1.6')], 'vEthernet (WSL)': [v4('172.24.80.1')], 'Wi-Fi': [v4('192.168.1.13')] };
  assert.equal(lanAddress(win, {}), '192.168.1.13');
  // an unknown interface name: a private LAN range still beats a carrier-grade one
  assert.equal(lanAddress({ foo0: [v4('100.64.0.9')], bar0: [v4('192.168.8.3')] }, {}), '192.168.8.3');
  // only the VPN is up: it is still the answer (the console warns), and LAN_IP still overrides everything
  assert.equal(lanAddress({ utun4: [v4('10.5.0.2')] }, {}), '10.5.0.2');
  assert.equal(viaVpn({ utun4: [v4('10.5.0.2')] }, '10.5.0.2'), true);
  assert.equal(lanAddress(mac, { LAN_IP: '10.5.0.2' }), '10.5.0.2');
});

test('a pad that goes silent is dropped within padSilentMs, the host hears it leave, the same phone gets its slot back', async (t) => {
  const srv = await startServer({ padSilentMs: 400, reserveMs: 60000 });
  t.after(() => srv.close());
  const h = await host(srv);
  const a = await pad(srv, 'aaaa');
  await a.next('welcome');
  await h.next('join');
  // it pings once, then the socket stays open (pongs and all) but the pad sends nothing: a phone out of Wi-Fi
  // range or locked
  a.send({ t: 'ping', ts: 1 });
  await a.next('pong');
  const t0 = Date.now();
  assert.deepEqual(await h.next('leave', 3000), { t: 'leave', slot: 0 });
  assert.ok(Date.now() - t0 < 1500, `dropped after ${Date.now() - t0} ms`);
  // a talking pad stays
  const b = await pad(srv, 'bbbb');
  await b.next('welcome');
  const talk = setInterval(() => b.send({ t: 'ping', ts: 1 }), 100);
  t.after(() => clearInterval(talk));
  assert.equal(await h.none((m) => m.t === 'leave' && m.slot === 1, 900), true, 'a pad that pings is kept');
  const a2 = await pad(srv, 'aaaa');
  assert.equal((await a2.next('welcome')).slot, 0, 'the same phone comes back to its slot');
});

test('a pad that never pings (a scripted client) is left to the heartbeat, not held to padSilentMs', async (t) => {
  const srv = await startServer({ padSilentMs: 300 });
  t.after(() => srv.close());
  const h = await host(srv);
  const quiet = await pad(srv, 'qqqq');
  await quiet.next('welcome');
  await h.next('join');
  quiet.send({ t: 'in', x: 0.5, y: 0, b: 0, seq: 1 });
  await h.next('in');
  assert.equal(await h.none('leave', 1000), true, 'still seated after three times padSilentMs');
});

test('room: a queued socket that is already closing is skipped on promotion', async () => {
  const { createRoom } = await import('../server/room.js');
  const fake = (state = 1) => ({ readyState: state, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {} });
  const room = createRoom({ reserveMs: 20 });
  const a = fake();
  const b = fake();
  room.addPad(a, 'aaaa');
  room.addPad(b, 'bbbb');
  const dying = fake();
  const next = fake();
  room.addPad(dying, 'cccc');
  room.addPad(next, 'dddd');
  dying.readyState = 2; // CLOSING: its close event has not fired yet
  room.removePad(a);
  await sleep(80);
  assert.equal(room.status().slots[0].id, 'dddd');
  assert.equal(next.sent.at(-1).t, 'welcome');
  assert.equal(room.status().waiting, 0);
  room.removePad(dying); // late close event: nothing to undo
  assert.equal(room.status().slots[0].id, 'dddd');
  room.close();
});

test('favicon: no 404 (204 unless dist ships one), both pages declare the inline drop icon', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  let r = await fetch(srv.base + '/favicon.ico');
  assert.equal(r.status, 204);
  assert.equal((await r.arrayBuffer()).byteLength, 0);
  const dist = fakeDist();
  writeFileSync(join(dist, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
  const withIcon = await startServer({ distDir: dist });
  t.after(() => withIcon.close());
  r = await fetch(withIcon.base + '/favicon.ico');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/x-icon');
  for (const page of ['index.template.html', 'controller/pad.html']) {
    assert.match(readFileSync(page, 'utf8'), /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,<svg /, page);
  }
});

test('the server banner names the game Summit Descent', async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: '0', LAN_IP: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  try {
    await new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`no banner: ${out}`)), 5000);
      child.stdout.on('data', (d) => { out += d; if (out.includes('phone pad:')) { clearTimeout(timer); ok(); } });
      child.on('exit', (code) => { clearTimeout(timer); fail(new Error(`server exited ${code}: ${out}`)); });
    });
  } finally {
    child.kill('SIGTERM');
  }
  assert.match(out, /^\s*Summit Descent$/m);
  assert.doesNotMatch(out, /summit to sea/i);
});
