// Two real phones for the end to end tests and the playtesters: the game served by `node server/index.js` as its
// own process, the TV as the host page, and each phone as the real controller page opened from the URL the TV
// shows (its text and its QR, decoded from the screenshot), in a mobile browser context (an iPhone or an Android
// preset, portrait or landscape, touch, its own localStorage) driven by real touch events (CDP
// Input.dispatchTouchEvent), one finger per thumb. Each phone reaches the Mac through its own little Wi-Fi: an
// HTTP proxy that the test can cut (half-open sockets, like a phone walking out of range) and bring back.
//
//   const dist = await buildGame();                             // a private dist/ for this run
//   const game = await startGame({ port: 8205, dist });         // lanIp: '127.0.0.1' forces the address,
//                                                               // vpn: NORDVPN adds NordLynx/Meshnet tunnels
//   const browser = await launchPhones();                       // a chromium with per-context proxies
//   const tv = await openTV(tvBrowser, game, { lang: 'it' });   // tools/perf/harness.mjs openHost + traces
//   const { text, qr } = await shownPadUrl(tv);                 // what the lobby prints and what its QR encodes
//   const a = await openPhone(browser, qr, { device: 'iphone', orientation: 'landscape', label: 'blue' });
//   await a.steer(1, 0);  await a.tapBoost();  await a.release();
//   await a.dropWifi();  await a.restoreWifi();  await a.lock();  await a.unlock();
//   latency(a, tv)  // touch -> host socket and touch -> sim read, p50 / p95 in ms
//
// Every phone method returns once the touches are dispatched; read what the page did with a.state() and what the
// host got with hostInputs(tv). Touch semantics (test/e2e-drive.test.mjs holds them): a touchEnd lifts exactly the
// points it lists, and a touchMove carries every finger still down.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, symlinkSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import { build } from 'esbuild';
import { ROOT, headlessShell, launch, openHost } from '../../tools/perf/harness.mjs';

export { ROOT, headlessShell, launch };

// ---------- the game, built and served ----------
// A dist/ of this run's own, so another agent rebuilding dist/ halfway through a test cannot change the game under
// it: `node build.mjs` first (best effort: it refreshes dist/ with whatever static folders build.mjs copies), then
// a temp folder with links to everything in dist/ and its own fresh bundles of the game and the pad, and the two
// pages copied from source. If the game does not bundle right now (someone's work in progress), the last good
// dist/game.js is used and `warning` says so; the pad must always bundle. Resolves to { dir, warning }.
export async function buildGame({ log = () => {} } = {}) {
  let warning = null;
  try { await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: ROOT }); } catch (e) { log(`build.mjs failed: ${e.message.split('\n')[0]}`); }
  const dir = mkdtempSync(join(tmpdir(), 'summit-descent-phones-'));
  const own = new Set(['game.js', 'game.js.map', 'pad.js', 'pad.js.map', 'index.html', 'pad.html']);
  for (const f of existsSync(join(ROOT, 'dist')) ? readdirSync(join(ROOT, 'dist')) : []) if (!own.has(f)) symlinkSync(join(ROOT, 'dist', f), join(dir, f));
  const bundle = (entry, out) => build({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', target: 'es2022', minify: true, outfile: join(dir, out), legalComments: 'none', logLevel: 'silent' });
  await bundle('controller/pad.js', 'pad.js');
  try {
    await bundle('src/main.js', 'game.js');
  } catch (e) {
    if (!existsSync(join(ROOT, 'dist/game.js'))) throw e;
    copyFileSync(join(ROOT, 'dist/game.js'), join(dir, 'game.js'));
    warning = `the game does not bundle right now (${e.errors?.[0]?.text || e.message}): using the last dist/game.js`;
    log(warning);
  }
  copyFileSync(join(ROOT, 'index.template.html'), join(dir, 'index.html'));
  copyFileSync(join(ROOT, 'controller/pad.html'), join(dir, 'pad.html'));
  return { dir, warning };
}

// `node server/index.js` on `port` (the test's own: several agents share this Mac), with PORT, LAN_IP and DIST
// (buildGame().dir) through the environment exactly as a player would set them. Resolves once it printed its URLs.
// vpn: extra network interfaces the server sees ahead of the real ones ({ utun4: '10.5.0.2' }, or NORDVPN), as a
// Mac with NordVPN connected lists them: a preload replaces os.networkInterfaces() in that process only.
export const NORDVPN = { utun4: '10.5.0.2', utun5: '100.81.12.4' }; // NordLynx and Meshnet on macOS
export async function startGame({ port, lanIp, dist, vpn = null, env = {}, log = () => {} } = {}) {
  if (!port) throw new Error('startGame needs a port');
  const e = { ...process.env, ...env, PORT: String(port) };
  if (lanIp) e.LAN_IP = lanIp; else delete e.LAN_IP;
  if (dist) e.DIST = dist.dir || dist;
  if (vpn) {
    const dir = mkdtempSync(join(tmpdir(), 'summit-descent-vpn-'));
    const fake = Object.fromEntries(Object.entries(vpn).map(([name, address]) => [name, [{ address, netmask: '255.255.255.255', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/32` }]]));
    writeFileSync(join(dir, 'vpn.mjs'), `import os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nconst real = os.networkInterfaces, fake = ${JSON.stringify(fake)};\nos.networkInterfaces = () => { const r = real(), out = {}; for (const k of Object.keys(fake)) out[k] = [...(r[k] || []), ...fake[k]]; return { ...out, ...Object.fromEntries(Object.entries(r).filter(([k]) => !fake[k])) }; };\nsyncBuiltinESMExports();\n`);
    e.NODE_OPTIONS = `${e.NODE_OPTIONS || ''} --import ${pathToFileURL(join(dir, 'vpn.mjs')).href}`.trim();
  }
  // The port is ours, but a server of ours from a moment ago may still be letting it go (and another agent may
  // borrow it for a second): a busy port is retried for 10 s before giving up.
  let proc, out;
  for (const end = Date.now() + 10000; ;) {
    proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    out = [];
    const lines = out;
    const onLine = (b) => { for (const l of b.toString().split('\n')) if (l.trim()) { lines.push(l); log(l); } };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);
    const p = proc;
    try {
      await new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`server did not start: ${lines.join(' | ')}`)), 15000);
        const check = () => { if (lines.some((l) => /phone pad:/.test(l))) { clearTimeout(timer); ok(); } };
        p.stdout.on('data', check);
        p.once('exit', (code) => { clearTimeout(timer); fail(new Error(`server exited ${code}: ${lines.join(' | ')}`)); });
      });
      break;
    } catch (err) {
      if (!/already in use/.test(err.message) || Date.now() > end) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const padLine = out.find((l) => /phone pad:/.test(l));
  return {
    port, proc, out,
    base: `http://127.0.0.1:${port}`,
    padUrl: padLine.replace(/^.*phone pad:\s*/, '').trim(),
    // the console lines a player reads when the QR does not work: the VPN warning and the other addresses
    get vpnWarning() { return out.some((l) => /VPN tunnel/.test(l)); },
    get others() { return (out.find((l) => /other addresses:/.test(l)) || '').replace(/^.*other addresses:\s*/, '').replace(/\s*\(LAN_IP.*$/, ''); },
    async close() {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => proc.once('exit', r)), new Promise((r) => setTimeout(r, 3000))]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

// A chromium for the phones. Per-context proxies (each phone's Wi-Fi) need one set at launch; no context uses it.
export async function launchPhones({ engine = 'chromium' } = {}) {
  const pw = await import('playwright-core');
  if (engine === 'webkit') return pw.webkit.launch();
  const executablePath = headlessShell();
  if (!executablePath) throw new Error('no chromium headless shell in the playwright cache');
  return pw.chromium.launch({ executablePath, proxy: { server: 'http://per-context' } });
}

// Is the playwright webkit there (npx playwright-core install webkit)? Its launch fails fast when it is not.
export async function webkitAvailable() {
  try { const b = await (await import('playwright-core')).webkit.launch(); await b.close(); return true; } catch { return false; }
}

// ---------- the TV ----------
// The host page (tools/perf/harness.mjs openHost: 1920x1080, its own context), with the host input trace on:
// src/net/input.js records every pad input it receives (rx) and the first sim read of it (read), epoch ms.
export async function openTV(browser, game, { lang = 'en', query = '', locale, log = () => {}, wait = true } = {}) {
  const url = `${game.base}/?lang=${lang}${query ? `&${query}` : ''}`;
  const tv = await openHost(browser, url, { locale: locale || (lang === 'it' ? 'it-IT' : 'en-US'), log, wait, init: () => { globalThis.__netTrace = { rx: [], read: [] }; } });
  return { ...tv, url };
}

// What the TV lobby shows a phone: the URL printed under the QR, and the URL its QR code decodes to (from a
// screenshot of the QR as drawn, so a QR that encodes the wrong thing or does not scan fails here).
export async function shownPadUrl(tv) {
  const page = tv.page;
  await page.waitForFunction(() => { const i = document.querySelector('.lobby .qr img'); return i?.complete && i.naturalWidth > 0 && /\/pad/.test(document.querySelector('.lobby .url')?.textContent || ''); }, null, { timeout: 15000 });
  const text = (await page.textContent('.lobby .url')).trim();
  // the QR image the lobby shows, drawn on a white card and read back as pixels
  const img = await page.evaluate(() => {
    const el = document.querySelector('.lobby .qr img');
    const size = 400, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.drawImage(el, 20, 20, size - 40, size - 40);
    return { width: size, height: size, data: [...g.getImageData(0, 0, size, size).data] };
  });
  const { default: jsQR } = await import('jsqr');
  const code = jsQR(Uint8ClampedArray.from(img.data), img.width, img.height);
  return { text: `http://${text}`, qr: code?.data || null };
}

// What src/net/input.js on the TV recorded: { rx: [{slot, seq, x, y, b, at}], read: [{slot, seq, at}] }.
export const hostInputs = (tv) => tv.page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__netTrace)));

// ---------- a phone's Wi-Fi ----------
// An HTTP proxy (plain requests and CONNECT tunnels, which chromium uses for ws://) between one phone and the Mac.
// drop(): every open connection goes silent without closing (a phone out of range: no FIN, no RST), and new ones
// hang. restore(): the silent ones are torn down and traffic flows again.
export async function wifi() {
  const live = new Set();
  let down = false;
  const parked = new Set();
  const park = (sock) => { parked.add(sock); sock.on('close', () => parked.delete(sock)); sock.on('error', () => {}); };
  const pair = (a, b) => {
    const p = { a, b };
    live.add(p);
    const end = () => { live.delete(p); a.destroy(); b.destroy(); };
    a.on('error', end); b.on('error', end); a.on('close', end); b.on('close', end);
    a.pipe(b); b.pipe(a);
    return p;
  };
  // Upstream requests reuse their connections, as a phone's browser does on the Wi-Fi: a new TCP connection to the
  // LAN address now and then takes a second on this Mac, and a page loading pictures would wait on that.
  const agent = new http.Agent({ keepAlive: true, maxSockets: 6 });
  const server = http.createServer((req, res) => {
    if (down) return park(req.socket);
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    const up = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, agent, headers: (({ 'proxy-connection': _, connection: __, ...h }) => h)(req.headers) }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  server.on('connect', (req, sock, head) => {
    if (down) return park(sock);
    const [host, port] = req.url.split(':');
    const up = net.connect(Number(port), host, () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      pair(sock, up);
    });
    up.on('error', () => sock.destroy());
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  server.unref(); // a test that forgets close() still ends
  return {
    server: `http://127.0.0.1:${server.address().port}`,
    get down() { return down; },
    get connections() { return live.size; },
    drop() {
      down = true;
      for (const { a, b } of live) { a.unpipe(b); b.unpipe(a); a.pause(); b.pause(); }
    },
    restore() {
      down = false;
      for (const { a, b } of [...live]) { a.destroy(); b.destroy(); }
      for (const s of [...parked]) s.destroy();
    },
    close() {
      agent.destroy();
      for (const { a, b } of [...live]) { a.destroy(); b.destroy(); }
      for (const s of [...parked]) s.destroy();
      return new Promise((ok) => { server.close(() => ok()); server.closeAllConnections?.(); });
    },
  };
}

// ---------- a phone ----------
// device: 'iphone' (iPhone 15), 'android' (Pixel 7) or any playwright device name; orientation picks its
// landscape preset. Records navigator.vibrate calls and the pad trace (controller/pad.js: every input it sent and
// when the touch behind it happened). net: false skips the proxy (a page on 127.0.0.1 bypasses proxies anyway).
export const DEVICES = { iphone: 'iPhone 15', android: 'Pixel 7' };

export async function openPhone(browser, url, { device = 'android', orientation = 'landscape', locale = 'en-US', label = 'phone', net = true, padId = null, wait = true, log = () => {} } = {}) {
  const { devices } = await import('playwright-core');
  const name = (DEVICES[device] || device) + (orientation === 'landscape' ? ' landscape' : '');
  const preset = devices[name];
  if (!preset) throw new Error(`unknown device ${name}`);
  const { defaultBrowserType, ...opts } = preset;
  const engine = browser.browserType().name();
  const radio = net && engine === 'chromium' ? await wifi() : null;
  const ctx = await browser.newContext({ ...opts, locale, ...(radio ? { proxy: { server: radio.server, bypass: '<-loopback>' } } : {}) });
  await ctx.addInitScript((id) => {
    window.__padTrace = [];
    window.__vibrations = [];
    if (id) localStorage.setItem('summit-descent.padId', id);
    // the real vibrate still runs (and still refuses calls before the first tap); we keep what was asked and when
    const real = navigator.vibrate?.bind(navigator);
    if (real) navigator.vibrate = (p) => { const ok = real(p); window.__vibrations.push({ p, ok, at: Date.now() }); return ok; };
  }, padId);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(`${label}: ${e.message}`); log(`[${label} pageerror] ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(`${label}: ${m.text()}`); log(`[${label} error] ${m.text()}`); } });
  await page.goto(url);
  const cdp = engine === 'chromium' ? await ctx.newCDPSession(page) : null;
  // A phone in a hand is the page in front: with several phones in one headless browser only one would have the
  // focus, and chromium throttles the others (their socket stops delivering after a few idle seconds)
  await cdp?.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Reads the page without touching it. Playwright's own evaluate counts as a user gesture in chromium (it would
  // unlock vibrate, full screen and the keep-awake video as if a finger had tapped), so on chromium the phone
  // reads through CDP with userGesture off; on webkit there is no such gesture to give.
  const peek = async (fn, arg) => {
    if (!cdp) return page.evaluate(fn, arg);
    const r = await cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg ?? null)})`, returnByValue: true, awaitPromise: true, userGesture: false });
    if (r.exceptionDetails) throw new Error(`${label}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  if (wait) {
    const end = Date.now() + 15000;
    while (!(await peek(() => !!(window.__pad?.joined && window.__pad.slot >= 0)))) {
      if (Date.now() > end) throw new Error(`${label}: did not join (${await peek(() => document.getElementById('ovTitle')?.textContent)})`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // ---------- fingers ----------
  const fingers = new Map(); // id -> {x, y}
  let nextId = 10;
  const pts = () => [...fingers.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 9, radiusY: 9, force: 1 }));
  let target = cdp; // the page the fingers land on (aim() moves them to another tab of this phone)
  // WebKit has no CDP: its fingers are pointer events dispatched in the page (pointerType touch, each finger kept
  // on the element it landed on, as pointer capture would), which drive the pad's own handlers but not the
  // browser's gestures (no scroll or zoom to test there).
  const synth = (type, touchPoints) => page.evaluate(({ type, touchPoints }) => {
    const on = (window.__fingers ||= {});
    const fire = (el, kind, p, first) => el.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, composed: true, pointerId: p.id, pointerType: 'touch', isPrimary: first, clientX: p.x, clientY: p.y, buttons: kind === 'pointerup' ? 0 : 1, pressure: kind === 'pointerup' ? 0 : 0.5, width: 18, height: 18 }));
    for (const p of touchPoints) {
      if (type === 'touchStart' && !on[p.id]) { on[p.id] = document.elementFromPoint(p.x, p.y) || document.body; fire(on[p.id], 'pointerdown', p, Object.keys(on).length === 1); }
      else if (type === 'touchMove' && on[p.id]) fire(on[p.id], 'pointermove', p, false);
      else if (type === 'touchEnd' && on[p.id]) { fire(on[p.id], 'pointerup', p, false); delete on[p.id]; }
    }
  }, { type, touchPoints });
  const touch = (type, touchPoints) => (target ? target.send('Input.dispatchTouchEvent', { type, touchPoints }) : synth(type, touchPoints));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function down(x, y) {
    const id = nextId++;
    fingers.set(id, { x, y });
    await touch('touchStart', pts());
    return id;
  }
  async function move(id, x, y) {
    fingers.set(id, { x, y });
    await touch('touchMove', pts());
  }
  async function up(id) {
    const p = fingers.get(id);
    if (!p) return;
    fingers.delete(id);
    await touch('touchEnd', [{ id, x: p.x, y: p.y }]);
  }
  // A finger sliding from where it is to (x, y) in `steps` touchmoves over `ms`.
  async function slide(id, x, y, { steps = 10, ms = 120 } = {}) {
    const from = fingers.get(id);
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      await move(id, from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      if (ms) await sleep(ms / steps);
    }
  }

  // Where the stick rests a thumb and where BOOST is, in the page's current layout, and the stick radius
  // controller/pad.js uses (window.__pad.geometry()).
  const geo = () => peek(() => window.__pad.geometry());
  let stickFinger = null, boostFinger = null, rest = null;

  const phone = {
    label, device: name, ctx, page, cdp, radio, errors, url,
    get slot() { return peek(() => window.__pad.slot); },
    state: () => peek(() => ({ ...window.__pad.state, slot: window.__pad.slot, joined: window.__pad.joined, phase: window.__pad.phase, overlay: document.getElementById('overlay').classList.contains('hide') ? null : document.getElementById('ovTitle').textContent })),
    trace: () => peek(() => window.__padTrace.slice()),
    vibrations: () => peek(() => window.__vibrations.slice()),
    peek,
    geo,
    fingers: () => [...fingers.keys()],
    // raw fingers, for the tests that poke where a thumb would not (a second finger on the stick, a pinch)
    down, move, up, slide,
    // The fingers land on another page of this phone (brought to front: touches only reach the tab in front),
    // or back on the pad with aim(phone.page).
    async aim(pg) { await pg.bringToFront(); target = pg === page ? cdp : await ctx.newCDPSession(pg); },

    // The thumb lands on the stick's rest point (or `at`) and slides to the point that means (x, y): direction
    // and magnitude past the dead zone, inside the rim so the base does not slide along.
    async steer(x, y, { steps = 12, ms = 150, at = null } = {}) {
      const g = await geo();
      if (stickFinger === null) { rest = at || { x: g.sx, y: g.sy }; stickFinger = await down(rest.x, rest.y); }
      const m = Math.min(1, Math.hypot(x, y));
      const d = m < 1e-3 ? 0 : g.R * Math.min(0.999, g.dead + m * (1 - g.dead));
      const a = Math.atan2(y, x);
      await slide(stickFinger, rest.x + Math.cos(a) * d, rest.y - Math.sin(a) * d, { steps, ms });
    },
    async releaseStick() { if (stickFinger !== null) { await up(stickFinger); stickFinger = null; } },
    async boostDown() { if (boostFinger === null) { const g = await geo(); boostFinger = await down(g.bx, g.by); } },
    async boostUp() { if (boostFinger !== null) { await up(boostFinger); boostFinger = null; } },
    async tapBoost(ms = 90) { await phone.boostDown(); await sleep(ms); await phone.boostUp(); },
    async release() { for (const id of [...fingers.keys()]) await up(id); stickFinger = null; boostFinger = null; },

    // ---------- the phone's life ----------
    dropWifi() { if (!radio) throw new Error('this phone has no proxy'); radio.drop(); },
    restoreWifi() { radio?.restore(); },
    // Locked: the page goes hidden, its Wi-Fi sleeps and its JavaScript stops, as iOS does to a locked phone.
    async lock() {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      fingers.clear(); stickFinger = null; boostFinger = null;
      radio?.drop();
      await cdp?.send('Page.setWebLifecycleState', { state: 'frozen' });
    },
    async unlock() {
      radio?.restore();
      await cdp?.send('Page.setWebLifecycleState', { state: 'active' });
      await page.evaluate(() => {
        delete document.visibilityState;
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    },
    async close() { await ctx.close().catch(() => {}); await radio?.close(); },
  };
  return phone;
}

// ---------- numbers ----------
export function percentile(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

// Touch to host, per input the phone sent because a finger moved or BOOST changed: `socket` is the touch event to
// the host socket receiving it, `sim` the touch to the first sim step that read it. ms, joined on (slot, seq).
export async function latency(phone, tv, { since = 0 } = {}) {
  const slot = await phone.slot;
  const sent = (await phone.trace()).filter((r) => r.touch && r.touch >= since);
  const host = await hostInputs(tv);
  const rx = new Map(host.rx.filter((r) => r.slot === slot).map((r) => [r.seq, r.at]));
  const read = new Map(host.read.filter((r) => r.slot === slot).map((r) => [r.seq, r.at]));
  const socket = [], sim = [];
  for (const s of sent) {
    if (rx.has(s.seq)) socket.push(rx.get(s.seq) - s.touch);
    if (read.has(s.seq)) sim.push(read.get(s.seq) - s.touch);
  }
  const sum = (xs) => ({ n: xs.length, p50: percentile(xs, 50), p95: percentile(xs, 95), max: xs.length ? Math.max(...xs) : NaN });
  return { sent: sent.length, socket: sum(socket), sim: sum(sim) };
}
