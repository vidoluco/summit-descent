// Shared by test/e2e-race.test.mjs and tools/perf/measure.mjs: the game exactly as `npm run play` serves it
// (node build.mjs into dist/, then `node server/index.js` as its own process on a free port), Chromium from the
// playwright cache with a chosen graphics backend, real phone pad pages (controller/pad.html with touch
// emulation) and a driver that steers them with what a bot would do.
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(homedir(), 'Library/Caches/ms-playwright');

// ---------- build and server ----------
export async function buildDist() {
  await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: ROOT });
}

export function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

// `node server/index.js` on a free port; resolves once it prints its URLs. log gets every line it prints.
export async function startServerProcess({ port, log = () => {} } = {}) {
  port ||= await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  const onLine = (b) => { for (const l of b.toString().split('\n')) if (l.trim()) { out.push(l); log(l); } };
  proc.stdout.on('data', onLine);
  proc.stderr.on('data', onLine);
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`server did not start: ${out.join(' | ')}`)), 15000);
    const check = () => { if (out.some((l) => /phone pad:/.test(l))) { clearTimeout(timer); ok(); } };
    proc.stdout.on('data', check);
    proc.once('exit', (code) => { clearTimeout(timer); fail(new Error(`server exited ${code}: ${out.join(' | ')}`)); });
  });
  return {
    port, proc, out, base: `http://127.0.0.1:${port}`,
    async close() {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await Promise.race([new Promise((r) => proc.once('exit', r)), new Promise((r) => setTimeout(r, 3000))]);
      if (proc.exitCode === null) proc.kill('SIGKILL');
    },
  };
}

// ---------- browser ----------
// metal: headless shell on the Mac's GPU through ANGLE Metal. gl: ANGLE OpenGL. swiftshader: the CPU rasteriser,
// not representative of a real Mac. headed: Chrome for Testing in a real window (Metal, a real compositor).
export const BACKENDS = {
  metal: { headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] },
  gl: { headless: true, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] },
  swiftshader: { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] },
  headed: { headless: false, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl'] },
};
export const UNCAPPED = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];

function newest(prefix, rel) {
  if (!existsSync(CACHE)) return null;
  for (const d of readdirSync(CACHE).filter((x) => x.startsWith(prefix)).sort().reverse()) {
    const exe = join(CACHE, d, rel);
    if (existsSync(exe)) return exe;
  }
  return null;
}
export const headlessShell = () => newest('chromium_headless_shell-', 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
export const chromeForTesting = () => newest('chromium-', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');

export async function launch(backend = 'metal', { uncapped = false, extra = [] } = {}) {
  const b = BACKENDS[backend];
  if (!b) throw new Error(`unknown backend ${backend}: ${Object.keys(BACKENDS).join(', ')}`);
  const executablePath = b.headless ? headlessShell() : chromeForTesting();
  if (!executablePath) throw new Error(`no ${b.headless ? 'chromium headless shell' : 'Chrome for Testing'} in ${CACHE}`);
  const { chromium } = await import('playwright-core');
  return chromium.launch({ executablePath, headless: b.headless, args: [...b.args, ...(uncapped ? UNCAPPED : []), ...extra] });
}

// The WebGL renderer string the page really got: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, ...)" or SwiftShader.
export async function gpuInfo(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { renderer: 'no webgl2', vendor: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) };
  });
}

// errors: page errors and console errors; warnings are kept apart.
function watch(page, label, log) {
  const errors = [], warnings = [];
  page.on('pageerror', (e) => { errors.push(`${label}: ${e.message}`); log(`[${label} pageerror] ${e.message}`); });
  page.on('console', (m) => {
    if (m.type() === 'error') { errors.push(`${label}: ${m.text()}`); log(`[${label} error] ${m.text()}`); }
    else if (m.type() === 'warning') warnings.push(`${label}: ${m.text()}`);
  });
  return { errors, warnings };
}

// The TV: 1920x1080 at pixel ratio 1, in its own context so its localStorage (saved language) starts empty.
// init: a function run in the page before its own scripts (tools/perf/measure.mjs times the frames with it).
export async function openHost(browser, url, { locale = 'en-US', log = () => {}, wait = true, init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const w = watch(page, 'host', log);
  await page.goto(url);
  if (wait) await page.waitForFunction(() => window.__game?.ready || window.__game?.error, null, { timeout: 120000 });
  return { ctx, page, ...w };
}

export const game = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game)));

export async function until(page, pred, timeout = 240000) {
  await page.waitForFunction(`(() => { const g = window.__game; return !!g && (g.error || (${pred})); })()`, null, { timeout, polling: 50 });
  const g = await game(page);
  if (g.error) throw new Error(`game error: ${g.error}`);
  return g;
}

// A phone: the real controller page, landscape, touch, its own context (own localStorage, so its own pad id).
export async function openPad(browser, base, { locale = 'en-US', label = 'pad', log = () => {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale });
  const page = await ctx.newPage();
  const w = watch(page, label, log);
  await page.goto(`${base}/pad`);
  await page.waitForFunction(() => window.__pad?.joined && window.__pad.slot >= 0, null, { timeout: 15000 });
  const cdp = await ctx.newCDPSession(page);
  // where the thumb rests and where BOOST is, and the stick radius the page uses (controller/pad.js radius())
  const geo = await page.evaluate(() => {
    const s = document.getElementById('stick').getBoundingClientRect();
    const b = document.getElementById('boost').getBoundingClientRect();
    return { sx: s.left + s.width * 0.45, sy: s.top + s.height * 0.6, R: Math.max(52, Math.min(110, Math.min(s.width, s.height) * 0.2)), bx: b.left + b.width / 2, by: b.top + b.height / 2 };
  });
  return { ctx, page, cdp, geo, label, ...w, slot: await page.evaluate(() => window.__pad.slot) };
}

const DEAD = 0.12; // controller/pad.js dead zone
// The thumb position on the stick that makes the pad send (x, y), inside the rim so the base never slides.
export function thumbFor(geo, x, y) {
  const m = Math.min(1, Math.hypot(x, y));
  if (m < 1e-3) return { x: geo.sx, y: geo.sy };
  const d = geo.R * Math.min(0.9999, DEAD + m * (1 - DEAD)); // on the rim at most, never past it
  return { x: geo.sx + (x / Math.hypot(x, y)) * d, y: geo.sy - (y / Math.hypot(x, y)) * d };
}

// Touches the pad pages like two thumbs: the stick held down and moved to what the host's bot advisor would steer
// (window.__game.botInput), BOOST tapped when the bot boosts. Returns { stop(), ticks }.
// Input.dispatchTouchEvent semantics it relies on (test/e2e-drive.test.mjs holds them): a touchEnd lifts exactly the
// points it lists, an empty list lifts every finger, and a touchMove that leaves a point out does not lift it.
export function drivePads(host, pads, { hz = 20, log = () => {} } = {}) {
  const st = pads.map(() => ({ down: false, btn: false, last: null }));
  const touch = (p, type, points) => p.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  let running = true, ticks = 0;
  const pts = (p, s, thumb) => [...(s.down ? [{ ...thumb, id: 1 }] : []), ...(s.btn ? [{ x: p.geo.bx, y: p.geo.by, id: 2 }] : [])];
  async function tick() {
    const plan = await host.evaluate((slots) => {
      const g = window.__game;
      if (!g?.botInput || !['race', 'cloud', 'finish', 'countdown'].includes(g.phase)) return null;
      return slots.map((s) => g.botInput(s));
    }, pads.map((p) => p.slot)).catch(() => null);
    if (!plan) return;
    ticks++;
    await Promise.all(pads.map(async (p, i) => {
      const s = st[i], want = plan[i];
      const thumb = thumbFor(p.geo, want.x, want.y);
      // the stick's base floats to where the thumb lands (controller/pad.js): land on the rest point, then move
      if (!s.down) { s.down = true; await touch(p, 'touchStart', pts(p, s, thumbFor(p.geo, 0, 0))); }
      await touch(p, 'touchMove', pts(p, s, thumb));
      s.last = thumb;
      // a touchEnd that lists BOOST alone: the stick stays down while BOOST lifts
      if (s.btn) { s.btn = false; await touch(p, 'touchEnd', [{ x: p.geo.bx, y: p.geo.by, id: 2 }]); }
      else if (want.boost) { s.btn = true; await touch(p, 'touchStart', pts(p, s, thumb)); }
    })).catch((e) => log(`drive: ${e.message}`));
  }
  const done = (async () => {
    while (running) {
      const t0 = Date.now();
      await tick();
      // unref'd: a test that fails before stop() ends instead of ticking forever against a closed browser
      await new Promise((r) => setTimeout(r, Math.max(0, 1000 / hz - (Date.now() - t0))).unref());
    }
  })();
  return {
    get ticks() { return ticks; },
    async stop() {
      running = false;
      await done;
      await Promise.all(pads.map((p, i) => (st[i].down || st[i].btn ? touch(p, 'touchEnd', pts(p, st[i], st[i].last)).catch(() => {}) : null)));
      st.forEach((s) => { s.down = false; s.btn = false; });
    },
  };
}

// One BOOST tap on a pad page, as a thumb would: touch down on the button, lift.
export async function tapBoost(p) {
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.geo.bx, y: p.geo.by, id: 3 }] });
  await new Promise((r) => setTimeout(r, 90));
  await p.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.geo.bx, y: p.geo.by, id: 3 }] });
}

// ---------- checks ----------
// The end of the race against the grace (spec, "Arrivo"), on the sim's own clock instead of a wall-clock poll: once
// the race is over the sim stops stepping, so window.__game.t stays at the step that ended it (state.t, countdown
// included) and the results carry each finish time from the start signal. A race with a DNF ends `grace` s after the
// first finish; one where everyone finished ends on the last finish. Returns what is wrong, [] when nothing is.
export function finishProblems(g, { countdown, grace, dt }) {
  const end = g.t - countdown;
  const times = g.results.filter((p) => p.finished).map((p) => p.time);
  if (!times.length) return ['nobody finished'];
  const first = Math.min(...times), last = Math.max(...times), tol = 2 * dt;
  const out = [];
  if (last > end + tol) out.push(`a finish at ${last.toFixed(3)} s, after the race ended at ${end.toFixed(3)} s`);
  for (const p of g.results) {
    if (!p.finished && Math.abs(end - first - grace) > tol) out.push(`slot ${p.slot} did not finish, and the race ended ${(end - first).toFixed(3)} s after the first finish, not ${grace} s`);
  }
  if (times.length === g.results.length && Math.abs(end - last) > tol) out.push(`everyone finished at ${last.toFixed(3)} s, and the race ran on to ${end.toFixed(3)} s`);
  return out;
}

// Paths of every number in window.__game that is NaN or infinite (JSON copies would hide them as null).
export function nonFinite(page) {
  return page.evaluate(() => {
    const bad = [];
    const seen = new Set();
    const walk = (v, path) => {
      if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(`${path}=${v}`); return; }
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
    };
    walk(window.__game, '__game');
    return bad;
  });
}

// The visible text of the page, one entry per text node (hidden subtrees skipped).
export function visibleTexts(page, root = 'body') {
  return page.evaluate((sel) => {
    const out = [];
    const shown = (el) => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : !!el.offsetParent;
    const walk = (el) => {
      if (!shown(el) || ['SCRIPT', 'STYLE', 'svg'].includes(el.tagName)) return;
      for (const n of el.childNodes) {
        const text = n.nodeType === 3 ? n.textContent.replace(/\s+/g, ' ').trim() : '';
        if (text) out.push({ cls: el.className?.baseVal ?? el.className ?? '', text });
      }
      for (const c of el.children) walk(c);
    };
    const r = document.querySelector(sel);
    if (r) walk(r);
    return out;
  }, root);
}

// Does every visible string come from the dictionary of `lang`? Dictionary values become patterns ({x} matches a
// filled-in value, HTML values are matched on their text); numbers, ordinal suffixes, times, URLs and the stage
// labels baked into the world are data, not text. Returns the strings that match nothing in `lang`, and the
// ones that only match the other language's dictionary.
export function foreignStrings(texts, dicts, lang, { labels = [] } = {}) {
  const other = lang === 'it' ? 'en' : 'it';
  const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const pats = (d) => Object.values(d).flatMap((v) => {
    const txt = v.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
    return txt.split('\n').map((part) => part.trim()).filter(Boolean).map((part) => new RegExp(`^${esc(part).replace(/\\?\{\w+\}/g, '.+?').replace(/\s+/g, '\\s*')}$`, 's'));
  });
  const mine = pats(dicts[lang]), theirs = pats(dicts[other]);
  const data = [/^[\d\s.,:°'’–-]+$/, /^(st|nd|rd|th|°)$/, /^[\w.-]+:\d+\/pad$/, /^×\d+$/];
  const bad = [], wrongLang = [];
  for (const { text } of texts) {
    if (data.some((r) => r.test(text)) || labels.includes(text)) continue;
    if (mine.some((r) => r.test(text))) continue;
    if (theirs.some((r) => r.test(text))) wrongLang.push(text); else bad.push(text);
  }
  return { bad, wrongLang };
}
