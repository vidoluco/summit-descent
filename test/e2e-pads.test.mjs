// The two phones, end to end, as two players will use them (test/helpers/phones.mjs): the real server as
// its own process, the TV in headless chromium, two phones opened from the URL the TV shows and the QR it draws,
// each in its own mobile context (an iPhone in landscape in Italian, an Android in portrait in English), thumbs
// driven by real CDP touch events. They join, start the race with SCATTO, steer their drops apart and back
// together, boost, let go, put a second finger down, lose the Wi-Fi and lock the phone, and a third phone finds the
// room full. Touch to host latency is measured and reported (p50 / p95). PADS_SHOTS=<dir> saves the phone screens.
// Ports 8205-8208 (this unit's own tonight). Skips without the playwright chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { translator } from '../src/i18n/index.js';
import { lanAddress } from '../server/index.js';
import { until, game } from '../tools/perf/harness.mjs';
import { headlessShell, launch, buildGame, startGame, NORDVPN, launchPhones, webkitAvailable, openTV, shownPadUrl, openPhone, hostInputs, latency } from './helpers/phones.mjs';

const skip = !headlessShell() && 'no chromium';
const SHOTS = process.env.PADS_SHOTS || null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = (p, name) => (SHOTS ? p.page.screenshot({ path: join(SHOTS, `${name}.png`) }) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const it = translator('it'), en = translator('en');

let dist = null, tvBrowser = null, phones = null;
before(async () => {
  if (skip) return;
  dist = await buildGame();
  assert.equal(dist.warning, null, 'the game bundles from source');
  tvBrowser = await launch('metal');
  phones = await launchPhones();
});
after(async () => {
  const close = (b) => b && Promise.race([b.close(), sleep(3000)]);
  await close(phones);
  await close(tvBrowser);
});

// Waits for fn() (async, in node) to be truthy; returns its value. what: said when it times out.
async function waitFor(fn, what, timeout = 8000, every = 50) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out: ${what} (last ${JSON.stringify(last)})`);
}
const visible = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })), sel);

test('the TV shows a URL a phone can open: the Wi-Fi address with NordVPN up, a QR that decodes to it, and LAN_IP overrides it', { skip }, async (t) => {
  const lan = lanAddress(undefined, {});
  // A Mac with NordVPN connected: its NordLynx and Meshnet tunnels listed before the Wi-Fi. Without a Wi-Fi here
  // (a CI box) the tunnels would be the only answer and no phone could open them, so they are left out.
  const g1 = await startGame({ port: 8205, dist, vpn: lan ? NORDVPN : null });
  t.after(() => g1.close());
  const tv1 = await openTV(tvBrowser, g1, { wait: false });
  t.after(() => tv1.ctx.close());
  const s1 = await shownPadUrl(tv1);
  assert.equal(s1.qr, s1.text, 'the QR encodes the URL printed under it');
  assert.equal(s1.text, `http://${lan || '127.0.0.1'}:8205/pad`, 'the address of the Wi-Fi interface, not a tunnel');
  assert.equal(g1.padUrl, s1.text, 'the console prints the same URL');
  if (lan) {
    t.diagnostic(`with NordVPN up the console offers: ${g1.others}`);
    assert.match(g1.others, /10\.5\.0\.2 \(utun4\).*100\.81\.12\.4 \(utun5\)/, 'the tunnels are listed as the other addresses, Meshnet last');
    assert.equal(g1.vpnWarning, false, 'no VPN warning: the QR is on the Wi-Fi');
  }
  // the phone opens exactly that URL, through its own Wi-Fi (the proxy), and gets slot 0
  const p = await openPhone(phones, s1.qr, { device: 'android', label: 'lan' });
  t.after(() => p.close());
  assert.equal(await p.slot, 0);
  assert.ok(p.radio.connections > 0, 'the phone talks to the Mac through its Wi-Fi');

  // LAN_IP wins over everything, the VPN included
  const g2 = await startGame({ port: 8206, dist, lanIp: '127.0.0.1', vpn: NORDVPN });
  t.after(() => g2.close());
  const tv2 = await openTV(tvBrowser, g2, { wait: false });
  t.after(() => tv2.ctx.close());
  const s2 = await shownPadUrl(tv2);
  assert.deepEqual([s2.text, s2.qr], ['http://127.0.0.1:8206/pad', 'http://127.0.0.1:8206/pad'], 'LAN_IP picks the address');
  const q = await openPhone(phones, s2.qr, { device: 'iphone', label: 'override' });
  t.after(() => q.close());
  assert.equal(await q.slot, 0);
});

test('two phones race: both steer at once, SCATTO boosts, letting go recentres, a second finger never steals the stick', { skip }, async (t) => {
  const g = await startGame({ port: 8207, dist });
  t.after(() => g.close());
  // no start shot: the race starts as the second phone is ready, so the phones are checked at once (see e2e-race for
  // the whole flow). Around here a run of this file can see the test process, and the phones' Wi-Fi proxies in it,
  // stall for ~10 s (no timer fires, the CPU profile idle); the start shot's 2.4 s put the start buzz in that window.
  const tv = await openTV(tvBrowser, g, { lang: 'it', query: 'intro=0' });
  t.after(() => tv.ctx.close());
  const { qr } = await shownPadUrl(tv);
  const blue = await openPhone(phones, qr, { device: 'iphone', orientation: 'landscape', locale: 'it-IT', label: 'blue' });
  t.after(() => blue.close());
  const pink = await openPhone(phones, qr, { device: 'android', orientation: 'portrait', locale: 'en-US', label: 'pink' });
  t.after(() => pink.close());
  assert.deepEqual([await blue.slot, await pink.slot], [0, 1], 'first phone blue, second pink');

  // each phone in its own language and colour, with its player number; the TV lobby shows both
  assert.equal(await blue.page.textContent('#who'), `${it('pad.player', { n: 1 })} ${it('pad.color0')}`);
  assert.equal(await pink.page.textContent('#who'), `${en('pad.player', { n: 2 })} ${en('pad.color1')}`);
  assert.equal(await blue.page.textContent('#btn b'), it('pad.boost'));
  assert.equal(await pink.page.textContent('#btn b'), en('pad.boost'));
  const accent = (p) => p.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  assert.deepEqual([await accent(blue), await accent(pink)], ['#4aa6f2', '#f28bbd']);
  await tv.page.waitForFunction(() => document.querySelectorAll('.lobby .slot.on').length === 2, null, { timeout: 10000 });
  await waitFor(async () => (await blue.state()).phase === 'lobby', 'the blue pad hears it is in the lobby');
  assert.equal(await blue.page.textContent('#banner'), it('pad.lobbyPress'));
  await shot(blue, 'iphone-landscape-lobby');
  await shot(pink, 'android-portrait-lobby');

  // SCATTO on both phones starts the race
  await blue.tapBoost();
  await waitFor(async () => (await blue.state()).phase === 'ready', 'blue ready');
  assert.equal(await blue.page.textContent('#banner'), it('pad.lobbyReady'));
  await pink.tapBoost();
  await until(tv.page, "g.phase === 'race' && g.players.every((p) => p.status === 'rolling') && g.t > 4.5", 30000);
  assert.deepEqual((await game(tv.page)).bots, [false, false], 'both drops are driven by the phones');
  // each phone buzzed on the start and shows its own drop's mass and place, as the TV has them
  for (const [slot, p, lang] of [[0, blue, 'it'], [1, pink, 'en']]) {
    await waitFor(() => p.peek(() => document.getElementById('hud').classList.contains('show') && !!document.getElementById('place').textContent), `${p.label} shows its mass and place`);
    // the drop may pick up water between the two reads (its mass jumps), and side by side at the start the two
    // drops swap places from one step to the next: read both until they agree, for a while
    const placeOf = (n) => (lang === 'it' ? `${n}°` : `${n}${{ 1: 'st', 2: 'nd' }[n]}`);
    let shown, me, mass;
    for (const end = Date.now() + 4000; ;) {
      shown = await p.peek(() => ({ mass: document.getElementById('mass').textContent, place: document.getElementById('place').textContent }));
      me = (await game(tv.page)).players[slot];
      mass = Number(shown.mass.replace(',', '.'));
      if ((Math.abs(mass - me.mass) < 0.15 && shown.place === placeOf(me.place)) || Date.now() > end) break;
      await sleep(150);
    }
    t.diagnostic(`${p.label} pad shows mass ${shown.mass} place ${shown.place}; the sim has ${me.mass.toFixed(2)}, ${me.place}`);
    assert.ok(Math.abs(mass - me.mass) < 0.15, `${p.label}: the pad's mass ${shown.mass} is the drop's ${me.mass}`);
    assert.equal(shown.place, placeOf(me.place));
    const buzzes = await p.vibrations();
    assert.ok(buzzes.some((v) => v.p === 40 && v.ok), `${p.label} buzzed when the race went: ${JSON.stringify(buzzes)}, race events ${JSON.stringify((await game(tv.page)).events)}`);
  }

  // ---- both phones at once: blue steers right, pink left, then the other way round ----
  // The two drops start side by side; their separation along the course's right (from the mean velocity) must
  // grow while they steer apart and shrink while they steer back.
  const sep = async () => {
    const [a, b] = (await game(tv.page)).players;
    const vx = a.vel.x + b.vel.x, vz = a.vel.z + b.vel.z, n = Math.hypot(vx, vz) || 1;
    return ((a.pos.x - b.pos.x) * -vz + (a.pos.z - b.pos.z) * vx) / n; // right of travel = (-dz, dx)
  };
  const since = Date.now();
  await Promise.all([blue.steer(0, 0), pink.steer(0, 0)]); // thumbs land
  const s0 = await sep();
  await Promise.all([blue.steer(1, 0), pink.steer(-1, 0)]);
  await sleep(1100);
  const s1 = await sep();
  await Promise.all([blue.steer(-1, 0), pink.steer(1, 0)]);
  // The drops keep their sideways speed for a moment after the sticks reverse, and a loaded machine runs fewer
  // frames per second: the gap may still widen briefly. It must then close by more than 1 m from its widest.
  let peak = s1, s2 = s1;
  for (const end = Date.now() + 6000; Date.now() < end; ) {
    await sleep(150);
    s2 = await sep();
    peak = Math.max(peak, s2);
    if (peak - s2 > 1) break;
  }
  t.diagnostic(`separation blue - pink along the course's right: ${s0.toFixed(2)} m -> apart ${s1.toFixed(2)} m -> widest ${peak.toFixed(2)} m -> together ${s2.toFixed(2)} m`);
  assert.ok(s1 - s0 > 1, `steering apart moves blue right of pink: ${s0.toFixed(2)} -> ${s1.toFixed(2)}`);
  assert.ok(peak - s2 > 1, `steering back closes the gap: widest ${peak.toFixed(2)} -> ${s2.toFixed(2)}`);
  // what the TV received: blue at full right and full left, pink the mirror, at the same time
  const host = await hostInputs(tv);
  const got = (slot, x) => host.rx.some((r) => r.slot === slot && r.at >= since && Math.abs(r.x - x) < 0.02);
  assert.ok(got(0, 1) && got(0, -1) && got(1, -1) && got(1, 1), 'the host got both full deflections from both phones');
  await shot(blue, 'iphone-landscape-steer');
  await shot(pink, 'android-portrait-steer');

  // ---- letting go returns to centre: the knob hides, the pad sends 0, the host reads 0 ----
  await Promise.all([blue.release(), pink.release()]);
  await waitFor(async () => { const r = (await hostInputs(tv)).rx; const last = (s) => r.filter((x) => x.slot === s).at(-1); return last(0)?.x === 0 && last(0)?.y === 0 && last(1)?.x === 0 && last(1)?.y === 0; }, 'the host reads both sticks centred');
  assert.equal(await blue.page.evaluate(() => document.getElementById('stick').classList.contains('active')), false, 'the knob is gone');

  // ---- SCATTO boosts the drop: a boost event, a jump in speed, the recharge ring; a press while it charges does nothing ----
  const speed = async (slot) => { const p = (await game(tv.page)).players[slot]; return Math.hypot(p.vel.x, p.vel.z); };
  const boosts = async () => (await game(tv.page)).events.boost || 0;
  const n0 = await boosts(), v0 = await speed(0), m0 = (await game(tv.page)).players[0].mass;
  await blue.tapBoost();
  await waitFor(async () => (await boosts()) > n0, 'the sim boosted');
  const v1 = await speed(0), m1 = (await game(tv.page)).players[0].mass;
  t.diagnostic(`boost: speed ${v0.toFixed(1)} -> ${v1.toFixed(1)} m/s, mass ${m0.toFixed(2)} -> ${m1.toFixed(2)}`);
  assert.ok(v1 > v0 + 2, `the drop sped up: ${v0.toFixed(1)} -> ${v1.toFixed(1)} m/s`);
  assert.ok(await blue.page.evaluate(() => window.__pad.cooling && document.getElementById('boost').classList.contains('cooling')), 'the ring recharges');
  await shot(blue, 'iphone-landscape-cooldown');
  await sleep(300);
  await blue.tapBoost();
  await sleep(400);
  assert.equal(await boosts(), n0 + 1, 'a press while recharging does not boost');

  // ---- a second finger on the stick, a third on SCATTO, the SCATTO finger sliding over: the stick stays put ----
  await blue.steer(0.9, 0);
  await waitFor(async () => (await blue.state()).x > 0.85, 'blue held right');
  const g0 = await blue.geo();
  const intruder = await blue.down(g0.sx - 120, g0.sy + 30);
  await blue.slide(intruder, g0.sx - 200, g0.sy - 60, { steps: 8, ms: 80 });
  let s = await blue.state();
  assert.ok(s.x > 0.85 && Math.abs(s.y) < 0.05, `a second finger on the stick does not take it: ${JSON.stringify(s)}`);
  await blue.tapBoost();
  const onBoost = await blue.down(g0.bx, g0.by);
  await blue.slide(onBoost, g0.sx + 40, g0.sy, { steps: 8, ms: 80 }); // from SCATTO into the stick zone
  s = await blue.state();
  assert.ok(s.x > 0.85 && s.b === 1, `a finger sliding off SCATTO keeps it held and leaves the stick alone: ${JSON.stringify(s)}`);
  await blue.up(intruder);
  await blue.up(onBoost);
  s = await blue.state();
  assert.ok(s.x > 0.85 && s.b === 0, `lifting the other fingers leaves the thumb steering: ${JSON.stringify(s)}`);
  await blue.release();

  // ---- latency from the touch to the host, both phones ----
  for (const p of [blue, pink]) {
    const l = await latency(p, tv, { since });
    t.diagnostic(`${p.label} (${p.device}) touch -> host socket: p50 ${l.socket.p50.toFixed(1)} ms, p95 ${l.socket.p95.toFixed(1)} ms, max ${l.socket.max.toFixed(1)} ms (n ${l.socket.n}); touch -> sim read: p50 ${l.sim.p50.toFixed(1)} ms, p95 ${l.sim.p95.toFixed(1)} ms (n ${l.sim.n})`);
    assert.ok(l.socket.n >= 20, `${p.label}: enough samples (${l.socket.n})`);
    assert.ok(l.socket.p95 < 120, `${p.label}: touch -> host p95 ${l.socket.p95} ms`);
  }

  // ---- the third phone: the room is full, on its screen and on the TV ----
  const third = await openPhone(phones, qr, { device: 'android', locale: 'it-IT', label: 'third', wait: false });
  t.after(() => third.close());
  await waitFor(async () => (await third.state()).overlay?.includes(it('pad.full')), 'the third phone says the room is full');
  assert.equal(await third.page.textContent('#ovText'), it('pad.fullText'));
  await tv.page.waitForFunction((title) => [...document.querySelectorAll('.toast.card')].some((el) => el.textContent.includes(title) && el.checkVisibility({ opacityProperty: true })), it('ui.full.title'), { timeout: 5000 });
  await shot(third, 'android-landscape-full');
  await third.close();

  // ---- blue walks out of the Wi-Fi: the TV waits for the blue drop, the pad says so, the slot comes back ----
  blue.dropWifi();
  await tv.page.waitForFunction((txt) => { const w = document.querySelector('.half[data-slot="0"] .waiting'); return w?.checkVisibility() && w.textContent.includes(txt); }, it('ui.waiting0'), { timeout: 8000 });
  await waitFor(async () => (await blue.state()).overlay?.includes(it('pad.lost')), 'the blue pad says the connection is lost');
  await shot(blue, 'iphone-landscape-lost');
  blue.restoreWifi();
  await waitFor(async () => { const st = await blue.state(); return st.joined && st.slot === 0 && !st.overlay; }, 'blue is back in slot 0', 15000);
  await tv.page.waitForFunction(() => !document.querySelector('.half[data-slot="0"] .waiting').checkVisibility(), null, { timeout: 5000 });
  await blue.steer(1, 0);
  await waitFor(async () => (await hostInputs(tv)).rx.some((r) => r.slot === 0 && r.x > 0.95 && r.at > Date.now() - 1000), 'blue steers again after the Wi-Fi came back');
  await blue.release();

  // ---- pink locks the phone: the same, and the drop is back when it unlocks ----
  await pink.lock();
  await tv.page.waitForFunction((txt) => { const w = document.querySelector('.half[data-slot="1"] .waiting'); return w?.checkVisibility() && w.textContent.includes(txt); }, it('ui.waiting1'), { timeout: 8000 });
  await pink.unlock();
  await waitFor(async () => { const st = await pink.state(); return st.joined && st.slot === 1 && !st.overlay; }, 'pink is back in slot 1', 15000);
  await tv.page.waitForFunction(() => !document.querySelector('.half[data-slot="1"] .waiting').checkVisibility(), null, { timeout: 5000 });
  await pink.steer(-1, 0);
  await waitFor(async () => (await hostInputs(tv)).rx.some((r) => r.slot === 1 && r.x < -0.95 && r.at > Date.now() - 1000), 'pink steers again after unlocking');
  await pink.release();

  const errs = [...blue.errors, ...pink.errors, ...tv.errors].filter((e) => !/ERR_|WebSocket|net::/.test(e));
  assert.deepEqual(errs, [], 'no page errors');
});

// Every phone both ways round, with a scripted host (server/testing.js) playing the race: what the player sees
// (SCATTO big, on screen, clear of the bars and the banner; the longest banner on one line inside the screen; room
// for the stick around the thumb) and how the stick feels (a dead zone, the knob under the thumb, the base dragged
// along past the rim so a reversal answers at once, up is forward, release recentres), SCATTO with the stick held,
// and the recharge ring. Each check reads what the host received, not only the page.
test('every phone, portrait and landscape: layout, dead zone, knob under the thumb, stick and SCATTO together, recharge ring', { skip }, async (t) => {
  const { startServer, host } = await import('../server/testing.js');
  const srv = await startServer({ distDir: dist.dir, host: '0.0.0.0', port: 8209, reserveMs: 200 });
  t.after(() => srv.close());
  const h = await host(srv);
  const url = `http://${lanAddress(undefined, {}) || '127.0.0.1'}:8209/pad`;
  const overlap = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  const inside = (a, vw, vh) => a.l >= -0.5 && a.t >= -0.5 && a.r <= vw + 0.5 && a.b <= vh + 0.5;
  for (const device of ['iphone', 'android']) for (const orientation of ['landscape', 'portrait']) {
    const name = `${device}-${orientation}`;
    const lang = device === 'iphone' ? 'it' : 'en';
    const tr = translator(lang);
    h.inbox.length = 0;
    const p = await openPhone(phones, url, { device, orientation, locale: lang === 'it' ? 'it-IT' : 'en-US', label: name, padId: `layout-${name}` });
    const slot = await p.slot;
    await h.next((m) => m.t === 'join' && m.slot === slot, 5000);
    const lastIn = () => h.inbox.filter((m) => m.t === 'in' && m.slot === slot).at(-1);

    // the busiest screen: the results banner (the longest line) with mass and place up
    h.send({ t: 'phase', slot, phase: 'results' });
    h.send({ t: 'hud', slot, mass: 2.4, place: 2 });
    await waitFor(() => p.peek(() => document.getElementById('hud').classList.contains('show') && document.getElementById('banner').classList.contains('show')), `${name}: hud and banner up`);
    await sleep(400); // their fade-in
    const L = await p.peek(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const q = (sel) => r(document.querySelector(sel));
      return {
        vw: innerWidth, vh: innerHeight, btn: q('#btn'), stick: q('#stick'), banner: q('#banner'),
        bars: [...document.querySelectorAll('#top > :not(.spacer), #hud .card')].map(r), mass: document.getElementById('mass').textContent,
        place: document.getElementById('place').textContent, banner1: document.getElementById('banner').textContent,
      };
    });
    const g = await p.geo();
    t.diagnostic(`${name} ${L.vw}x${L.vh}: SCATTO ${Math.round(L.btn.w)} px, stick zone ${Math.round(L.stick.w)}x${Math.round(L.stick.h)}, R ${Math.round(g.R)} px, banner ${Math.round(L.banner.w)} px`);
    assert.ok(inside(L.btn, L.vw, L.vh), `${name}: SCATTO is on screen ${JSON.stringify(L.btn)}`);
    assert.ok(L.btn.w >= 150, `${name}: SCATTO is big (${L.btn.w} px)`);
    assert.ok(inside(L.banner, L.vw, L.vh), `${name}: the banner fits the screen ${JSON.stringify(L.banner)}`);
    assert.ok(!overlap(L.btn, L.banner), `${name}: the banner does not cover SCATTO`);
    for (const b of L.bars) assert.ok(!overlap(L.btn, b), `${name}: the top bar and the hud stay off SCATTO`);
    L.bars.forEach((a, i) => L.bars.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), `${name}: the pills of the top bar do not overlap ${JSON.stringify([a, b])}`)));
    assert.equal(L.banner1, tr('pad.results'));
    assert.equal(L.mass, lang === 'it' ? '2,4' : '2.4');
    assert.equal(L.place, lang === 'it' ? '2°' : '2nd');
    assert.ok(g.sx - g.R >= L.stick.l && g.sx + g.R <= L.stick.r && g.sy - g.R >= L.stick.t && g.sy + g.R <= L.stick.b, `${name}: a full stick fits around the resting thumb`);

    // the dead zone: a thumb that wobbles a little sends nothing
    h.send({ t: 'phase', slot, phase: 'race' });
    const rest = { x: g.sx, y: g.sy };
    const thumb = await p.down(rest.x, rest.y);
    await p.slide(thumb, rest.x + g.R * g.dead * 0.6, rest.y - g.R * g.dead * 0.4, { steps: 6, ms: 60 });
    await sleep(150);
    let st = await p.state();
    assert.deepEqual([st.x, st.y], [0, 0], `${name}: inside the dead zone the stick reads 0`);
    assert.ok(h.inbox.filter((m) => m.t === 'in' && m.slot === slot).every((m) => m.x === 0 && m.y === 0), `${name}: and the host got only zeros`);

    // the knob sits under the thumb; the base stays where the thumb landed
    const centre = (sel) => p.peek((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
    await p.slide(thumb, rest.x + g.R * 0.5, rest.y, { steps: 6, ms: 60 });
    let k = await centre('#knob'), b = await centre('#base');
    assert.ok(Math.hypot(k.x - rest.x - g.R * 0.5, k.y - rest.y) < 1.5, `${name}: the knob is under the thumb ${JSON.stringify(k)}`);
    assert.ok(Math.hypot(b.x - rest.x, b.y - rest.y) < 1.5, `${name}: the base stays put inside the rim`);
    st = await p.state();
    const half = (0.5 - g.dead) / (1 - g.dead);
    assert.ok(Math.abs(st.x - half) < 0.02 && Math.abs(st.y) < 0.02, `${name}: half way out reads ${half.toFixed(2)}: ${st.x}`);

    // past the rim the base comes along: still under the thumb, full right, and a reversal answers at once
    await p.slide(thumb, rest.x + g.R * 2, rest.y, { steps: 8, ms: 80 });
    k = await centre('#knob'); b = await centre('#base');
    assert.ok(Math.hypot(k.x - rest.x - g.R * 2, k.y - rest.y) < 1.5, `${name}: past the rim the knob is still under the thumb`);
    assert.ok(Math.abs(b.x - (rest.x + g.R)) < 1.5, `${name}: the base was dragged along ${b.x} vs ${rest.x + g.R}`);
    await waitFor(() => lastIn()?.x > 0.97, `${name}: the host reads full right`, 3000);
    await p.slide(thumb, rest.x + g.R * 0.5, rest.y, { steps: 6, ms: 60 });
    await waitFor(() => lastIn()?.x < -0.4, `${name}: back by one and a half radii reads left at once (${lastIn()?.x})`, 3000);

    // up is forward (downhill), down is back
    await p.slide(thumb, b.x, b.y - g.R, { steps: 6, ms: 60 });
    await waitFor(() => lastIn()?.y > 0.98 && Math.abs(lastIn().x) < 0.02, `${name}: thumb up reads forward`, 3000);
    await p.slide(thumb, b.x, b.y + g.R, { steps: 6, ms: 60 });
    await waitFor(() => lastIn()?.y < -0.98, `${name}: thumb down reads back`, 3000);

    // SCATTO with the stick held right: one message carries both, and lifting SCATTO keeps the stick
    await p.slide(thumb, b.x + g.R, b.y, { steps: 6, ms: 60 });
    await waitFor(() => lastIn()?.x > 0.97, `${name}: right again`, 3000);
    // upright the thumb now sits on the column's edge: nothing between the knob and the screen clips it
    const clipped = await p.peek(() => { const out = []; for (let el = document.getElementById('knob').parentElement; el && el !== document.body; el = el.parentElement) if (getComputedStyle(el).overflow !== 'visible') out.push(el.id); return out; });
    assert.deepEqual(clipped, [], `${name}: the knob is never cut off`);
    await p.boostDown();
    await waitFor(() => lastIn()?.b === 1 && lastIn().x > 0.97, `${name}: SCATTO and full right together`, 3000);
    assert.ok(await p.peek(() => window.__pad.cooling && document.getElementById('boost').classList.contains('cooling')), `${name}: a boost in a race starts the recharge ring`);
    await shot(p, `layout-${name}`);
    await p.boostUp();
    await waitFor(() => lastIn()?.b === 0 && lastIn().x > 0.97, `${name}: SCATTO up, stick still right`, 3000);

    // release: the knob goes, the host reads the centre
    await p.up(thumb);
    await waitFor(() => lastIn()?.x === 0 && lastIn().y === 0, `${name}: release recentres`, 3000);
    assert.equal(await p.peek(() => document.getElementById('stick').classList.contains('active')), false);
    // the ring refills in TUNING.boost.cooldown and the button pops back
    await waitFor(() => p.peek(() => document.getElementById('boost').classList.contains('ready') && !window.__pad.cooling), `${name}: SCATTO is ready again`, 5000, 100);
    assert.deepEqual(p.errors, [], `${name}: no page errors`);
    await p.close();
    await h.next((m) => m.t === 'leave' && m.slot === slot, 6000);
    await sleep(300); // the 200 ms reservation runs out
  }
});

// The pad page alone with a scripted host (server/testing.js): what a thumb must not do to the page, the screen
// kept awake, and the buzzes. A plain page in the same phone shows the same gestures do scroll, zoom and select
// there, so a pass on the pad is the pad's doing, not gestures that never landed.
test('the pad page does not scroll, zoom or select, keeps the screen awake, and buzzes only after the first tap', { skip }, async (t) => {
  const { startServer, host } = await import('../server/testing.js');
  const srv = await startServer({ distDir: dist.dir, host: '0.0.0.0', port: 8208 });
  t.after(() => srv.close());
  const h = await host(srv);
  const url = `http://${lanAddress(undefined, {}) || '127.0.0.1'}:8208/pad`;
  const p = await openPhone(phones, url, { device: 'android', orientation: 'portrait', label: 'hygiene' });
  t.after(() => p.close());
  await h.next('join', 5000);

  // the gestures: a long swipe up, a two-finger pinch out, a long press on the player's name
  const swipe = async (x, y0, y1) => { const id = await p.down(x, y0); await p.slide(id, x, y1, { steps: 12, ms: 150 }); await p.up(id); };
  const pinch = async (cx, cy) => {
    const a = await p.down(cx - 20, cy), b = await p.down(cx + 20, cy);
    for (let i = 1; i <= 10; i++) { await p.move(a, cx - 20 - i * 12, cy); await p.move(b, cx + 20 + i * 12, cy); await sleep(15); }
    await p.up(a); await p.up(b);
  };
  const press = async (x, y) => { const id = await p.down(x, y); await sleep(900); await p.up(id); };
  const view = (page) => (page === p.page ? p.peek : page.evaluate.bind(page))(() => ({ scroll: Math.round(scrollY + document.scrollingElement.scrollTop), scale: visualViewport.scale, sel: String(getSelection()) }));
  const gestures = async (page, at) => { await swipe(at.x, at.y + 150, at.y - 250); await sleep(300); await press(at.tx, at.ty); await pinch(at.x, at.y); await sleep(400); return view(page); };

  // the control: a plain long page in the same phone
  const ctl = await p.ctx.newPage();
  await ctl.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><body style="font:20px sans-serif">${'<p id="w">Summit descent water drop text to select. </p>'.repeat(80)}</body>`);
  await p.aim(ctl);
  const box = await ctl.locator('#w').first().boundingBox();
  const c = await gestures(ctl, { x: 200, y: 400, tx: box.x + 30, ty: box.y + box.height / 2 });
  t.diagnostic(`plain page under the same gestures: ${JSON.stringify(c)}`);
  assert.ok(c.scroll > 50, 'the swipe scrolls a plain page');
  assert.ok(c.scale > 1.05, 'the pinch zooms a plain page');
  await p.aim(p.page);
  await ctl.close();

  // the pad: a vibration asked before any tap would be refused (and logged) by Chrome; none is asked
  h.send({ t: 'fx', slot: 0, kind: 'buzz' });
  await sleep(200);
  assert.deepEqual(await p.vibrations(), [], 'no buzz before the first tap');
  assert.equal(await p.peek(() => window.__pad.awake), null, 'not awake before a tap on plain http');

  const g = await p.geo();
  const who = await p.peek(() => { const r = document.getElementById('who').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const v = await gestures(p.page, { x: g.sx, y: g.sy, tx: who.x + who.width / 2, ty: who.y + who.height / 2 });
  t.diagnostic(`pad page under the same gestures: ${JSON.stringify(v)}`);
  assert.deepEqual(v, { scroll: 0, scale: 1, sel: '' }, 'the pad does not scroll, zoom or select');
  assert.equal((await p.state()).x, 0, 'and the stick is centred afterwards');

  // the first lifted finger was a user gesture: the screen stays on (the Wake Lock API needs https, which a LAN
  // page is not, so a muted looping video does it), and the buzzes go through
  await p.tapBoost();
  const awake = await waitFor(() => p.peek(() => window.__pad.awake), 'the screen is kept awake');
  const secure = await p.peek(() => isSecureContext);
  t.diagnostic(`screen awake via ${awake} (secure context: ${secure}, wakeLock API: ${await p.peek(() => 'wakeLock' in navigator)})`);
  if (!secure) {
    assert.equal(awake, 'video');
    assert.equal(await p.peek(() => { const vid = document.querySelector('video'); return !!vid && !vid.paused && vid.muted; }), true, 'the keep-awake video plays, muted');
  }
  for (const kind of ['buzz', 'drink', 'freeze', 'finish']) h.send({ t: 'fx', slot: 0, kind, place: 1 });
  await waitFor(async () => (await p.vibrations()).length >= 4, 'four buzzes');
  const vib = await p.vibrations();
  t.diagnostic(`vibrations: ${JSON.stringify(vib.map((x) => x.p))}`);
  assert.ok(vib.every((x) => x.ok), 'every vibration was accepted');
  assert.deepEqual(vib.slice(-4).map((x) => x.p), [40, [25, 50, 25], [60, 40, 60, 40, 120], [80, 60, 80, 60, 300]]);
  assert.deepEqual(p.errors, [], 'no console errors (Chrome logs a refused vibrate as one)');
});

// The pad in WebKit with the iPhone preset (npx playwright-core install webkit; skipped without it): Safari's engine
// lays it out, joins, takes a real tap on SCATTO (page.touchscreen) and the stick through pointer events, and has
// the Safari-only pieces in place: no navigator.vibrate so the switch haptic is there instead, gesture events
// cancelled, touch-action and user-select off, the keep-awake video on plain http.
const webkit = skip ? false : await webkitAvailable();
test('the pad on WebKit as an iPhone: layout, join, tap, stick, Safari quirks', { skip: skip || (!webkit && 'no playwright webkit') }, async (t) => {
  const { startServer, host } = await import('../server/testing.js');
  const srv = await startServer({ distDir: dist.dir, host: '0.0.0.0', port: 8208 });
  t.after(() => srv.close());
  const h = await host(srv);
  const wk = await launchPhones({ engine: 'webkit' });
  t.after(() => wk.close());
  const url = `http://${lanAddress(undefined, {}) || '127.0.0.1'}:8208/pad`;
  // the same iPhone (one pad id) opened sideways, then upright: it takes its own slot back both times
  for (const orientation of ['landscape', 'portrait']) {
    const p = await openPhone(wk, url, { device: 'iphone', orientation, locale: 'it-IT', label: `webkit-${orientation}`, padId: 'webkit-iphone' });
    const slot = await p.slot;
    assert.equal(slot, 0, 'joined slot 0');
    assert.deepEqual(await h.next((m) => m.t === 'join', 5000), { t: 'join', slot: 0, color: '#4aa6f2' });
    assert.equal(await p.page.textContent('#btn b'), it('pad.boost'));
    const quirks = await p.page.evaluate(() => {
      const ev = new Event('gesturestart', { cancelable: true });
      document.dispatchEvent(ev);
      const cs = getComputedStyle(document.body);
      const g = window.__pad.geometry();
      return {
        vibrate: 'vibrate' in navigator, haptic: !!document.querySelector('label > input[switch]'), gestureCancelled: ev.defaultPrevented,
        touchAction: cs.touchAction, userSelect: cs.webkitUserSelect || cs.userSelect, callout: cs.webkitTouchCallout ?? 'n/a',
        fills: Math.abs(document.getElementById('app').getBoundingClientRect().height - innerHeight) < 1, btn: Math.round(g.br * 2), R: Math.round(g.R),
      };
    });
    t.diagnostic(`webkit ${orientation}: ${JSON.stringify(quirks)}`);
    assert.equal(quirks.gestureCancelled, true, 'pinch gesture events are cancelled');
    assert.equal(quirks.touchAction, 'none');
    assert.equal(quirks.userSelect, 'none');
    assert.equal(quirks.fills, true, 'the pad fills the visible viewport (no 100vh overflow)');
    assert.ok(quirks.btn >= 120, `SCATTO is big: ${quirks.btn} px`);
    if (!quirks.vibrate) assert.equal(quirks.haptic, true, 'no vibrate: the switch haptic is wired');
    await shot(p, `webkit-iphone-${orientation}`);
    // a real tap on SCATTO
    const g = await p.geo();
    await p.page.touchscreen.tap(g.bx, g.by);
    await h.next((m) => m.t === 'in' && m.slot === 0 && m.b === 1, 3000);
    // the stick, through pointer events
    await p.steer(1, 0);
    await h.next((m) => m.t === 'in' && m.slot === 0 && m.x > 0.95, 3000);
    await p.release();
    await h.next((m) => m.t === 'in' && m.slot === 0 && m.x === 0 && m.y === 0, 3000);
    t.diagnostic(`webkit ${orientation} screen awake via ${await p.peek(() => window.__pad.awake)}`);
    assert.deepEqual(p.errors, []);
    await p.close();
    await h.next('leave', 6000);
  }
});
