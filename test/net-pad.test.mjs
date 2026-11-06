// The phone pad in headless Chromium: two-finger touch (stick + SCATTO) reaches the host, hud and fx render.
// Skips when no playwright chromium is installed. SHOTS=<dir> saves portrait and landscape screenshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { startServer, host, sleep } from '../server/testing.js';

function chromiumPath() {
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    const exe = join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

const exe = chromiumPath();

test('pad page: joystick and SCATTO drive the host, hud and fx show', { skip: !exe && 'no chromium' }, async (t) => {
  const { chromium } = await import('playwright-core');
  const dist = mkdtempSync(join(tmpdir(), 'summit-descent-pad-'));
  copyFileSync('controller/pad.html', join(dist, 'pad.html'));
  await build({ entryPoints: ['controller/pad.js'], bundle: true, format: 'esm', outfile: join(dist, 'pad.js'), logLevel: 'warning' });
  const srv = await startServer({ distDir: dist });
  const browser = await chromium.launch({ executablePath: exe });
  t.after(async () => { await browser.close(); await srv.close(); });

  const h = await host(srv);
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'it-IT' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${srv.base}/pad`);
  assert.deepEqual(await h.next('join', 5000), { t: 'join', slot: 0, color: '#4aa6f2' });
  await page.waitForFunction(() => window.__pad?.joined);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#4aa6f2');
  assert.match(await page.textContent('#who'), /Giocatore 1/);
  assert.equal(await page.textContent('#btn b'), 'SCATTO');

  // Neutral input streams at about 30 Hz.
  const first = await h.next('in', 2000);
  assert.deepEqual([first.x, first.y, first.b], [0, 0, 0]);

  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const stick = { x: 250, y: 220, id: 1 };
  const btn = { x: 700, y: 200, id: 2 };
  await touch('touchStart', [stick]);
  await touch('touchMove', [{ ...stick, x: 250 + 200, y: 220 - 200 }]); // far up-right: clamped to the rim
  await touch('touchStart', [{ ...stick, x: 450, y: 20 }, btn]);
  const moved = await h.next((m) => m.t === 'in' && m.seq > first.seq && m.b === 1 && m.x > 0.5 && m.y > 0.5, 2000);
  assert.ok(Math.hypot(moved.x, moved.y) <= 1.0001, 'vector inside the unit circle');
  assert.ok(Math.abs(moved.x - moved.y) < 0.05, 'diagonal');
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'pad-landscape-active.png') });
  await touch('touchEnd', []);
  const released = await h.next((m) => m.t === 'in' && m.seq > moved.seq && m.b === 0 && m.x === 0 && m.y === 0, 2000);
  assert.ok(released.seq > moved.seq);

  // Dead zone: a tiny nudge stays at zero.
  await touch('touchStart', [stick]);
  await touch('touchMove', [{ ...stick, x: stick.x + 4 }]);
  await sleep(120);
  assert.equal(await page.evaluate(() => window.__pad.state.x), 0);
  await touch('touchEnd', []);

  h.send({ t: 'hud', slot: 0, mass: 2.35, place: 1 });
  await page.waitForFunction(() => document.getElementById('hud').classList.contains('show'));
  assert.equal(await page.textContent('#mass'), '2,4');
  assert.match(await page.textContent('#place'), /^1/);
  h.send({ t: 'fx', slot: 0, kind: 'freeze' });
  await page.waitForFunction(() => document.body.classList.contains('frozen'));
  assert.match(await page.textContent('#toastBig'), /Congelata/);
  if (process.env.SHOTS) {
    await sleep(400);
    await page.screenshot({ path: join(process.env.SHOTS, 'pad-landscape-freeze.png') });
  }

  // A second phone gets slot 1 and the coral accent; a third waits.
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'en-US' });
  const p2 = await ctxP.newPage();
  await p2.addInitScript(() => localStorage.setItem('summit-descent.padId', 'second-phone'));
  await p2.goto(`${srv.base}/pad`);
  assert.equal((await h.next((m) => m.t === 'join' && m.slot === 1, 5000)).color, '#f28bbd');
  h.send({ t: 'hud', slot: 1, mass: 0.8, place: 2 });
  // Each phone has its own language: this one follows its English browser, and the toggle switches it.
  await p2.waitForFunction(() => document.getElementById('hud').classList.contains('show'));
  assert.match(await p2.textContent('#who'), /Player 2/);
  assert.equal(await p2.textContent('#btn b'), 'BOOST');
  assert.equal(await p2.textContent('#mass'), '0.8');
  assert.equal(await p2.textContent('#place'), '2nd');
  await p2.tap('#lang');
  assert.match(await p2.textContent('#who'), /Giocatore 2/);
  assert.equal(await p2.textContent('#place'), '2°');
  assert.equal(await p2.evaluate(() => localStorage.getItem('summit-descent.lang')), 'it');
  await p2.tap('#lang');
  assert.equal(await p2.textContent('#btn b'), 'BOOST');
  assert.match(await page.textContent('#who'), /Giocatore 1/, 'the other phone keeps its language');
  if (process.env.SHOTS) { await sleep(600); await p2.screenshot({ path: join(process.env.SHOTS, 'pad-portrait.png') }); }
  const p3 = await ctx.newPage();
  await p3.addInitScript(() => localStorage.setItem('summit-descent.padId', 'third-phone'));
  await p3.goto(`${srv.base}/pad`);
  await p3.waitForFunction(() => /piena/.test(document.getElementById('ovTitle').textContent));
  if (process.env.SHOTS) await p3.screenshot({ path: join(process.env.SHOTS, 'pad-full.png') });

  // Server gone: the pad shows the lost-connection overlay and comes back on its own.
  await srv.close();
  await page.waitForFunction(() => /persa/.test(document.getElementById('ovTitle').textContent), null, { timeout: 8000 });
  assert.deepEqual(errors.filter((e) => !/WebSocket|ERR_CONNECTION/.test(e)), []);
});
