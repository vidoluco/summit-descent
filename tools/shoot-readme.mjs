#!/usr/bin/env node
// The pictures of the README, through the real page, the real server and real pad connections. The page's frame clock
// is stepped by hand (requestAnimationFrame is taken over before the game loads), so a slow capture cannot change
// what is shot and a film has an even frame rate. Raw files go to --dir (default docs/shots/readme, git ignored);
// tools/compose-readme.mjs makes docs/media/ from them.
//
// node tools/shoot-readme.mjs sweep <world>...      a whole race on one phone, a frame every --every s, to choose from
// node tools/shoot-readme.mjs split <world> [seed]  the same with two phones, split screen
// node tools/shoot-readme.mjs film <world> <stage> <from-to s> [--name n] [--fps 20] [--pads 1] [--start 0]   one PNG a frame
// node tools/shoot-readme.mjs at <world> <stage> <name> <seconds>...   single frames, seconds after the stage starts
// node tools/shoot-readme.mjs animal <world> [stage]   rides the bank until an animal comes to drink
// node tools/shoot-readme.mjs frozen <world> <stage>   brakes on an ice zone until the drop is frozen
// node tools/shoot-readme.mjs moments <world>       cloud flight and the frames around it, and the results screen
// node tools/shoot-readme.mjs lobby                 the TV vote with two real phone pages beside it
// Options: --dir <folder>, --seed <n>, --every <s>, --size 1920x1080. CHROMIUM=<path> picks the browser.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from '../server/index.js';
import { connectPad } from '../src/game/tools/pads.mjs';
import { makeCards } from './cards.mjs';
import { ROOT } from './perf/harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const dirArg = opt('dir', 'docs/shots/readme');
const DIR = isAbsolute(dirArg) ? dirArg : join(ROOT, dirArg);
const SEED = Number(opt('seed', 3));
const EVERY = Number(opt('every', 4));
const FPS = Number(opt('fps', 20));
const NAME = opt('name', '');
const PADS = Number(opt('pads', 1));
const START = opt('start', null); // film and at: the stage the race starts on (default: the stage shot)
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const [cmd, ...rest] = argv;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A headless shell: CHROMIUM, else the newest one in the usual caches.
function browserPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const look = [
    [join(homedir(), 'Library/Caches/ms-playwright'), (d) => join(d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'), /^chromium_headless_shell-/],
    [join(homedir(), '.cache/puppeteer/chrome-headless-shell'), (d) => join(d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'), /^mac_arm-/],
  ];
  for (const [base, exe, re] of look) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((x) => re.test(x)).sort().reverse()) if (existsSync(exe(join(base, d)))) return exe(join(base, d));
  }
  throw new Error('no headless shell found: set CHROMIUM');
}

// A dist of this run's own, so a build or a test running next to it cannot change the game under the capture.
async function ownDist() {
  const dist = mkdtempSync(join(tmpdir(), 'summit-descent-readme-'));
  const opts = { bundle: true, format: 'esm', minify: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' };
  await build({ ...opts, absWorkingDir: ROOT, entryPoints: ['src/main.js'], outfile: join(dist, 'game.js') });
  await build({ ...opts, absWorkingDir: ROOT, entryPoints: ['controller/pad.js'], outfile: join(dist, 'pad.js') });
  copyFileSync(join(ROOT, 'index.template.html'), join(dist, 'index.html'));
  copyFileSync(join(ROOT, 'controller/pad.html'), join(dist, 'pad.html'));
  mkdirSync(join(dist, 'data'));
  symlinkSync(join(ROOT, 'data/worlds'), join(dist, 'data/worlds'));
  mkdirSync(join(dist, 'assets/vendor'), { recursive: true });
  symlinkSync(join(ROOT, 'assets/vendor/animals'), join(dist, 'assets/vendor/animals'));
  symlinkSync(join(ROOT, 'assets/ui'), join(dist, 'assets/ui'));
  const backs = join(dist, 'assets/backdrops');
  mkdirSync(backs);
  const jpgs = readdirSync(join(ROOT, 'assets/backdrops')).filter((f) => /\.jpg$/i.test(f)).sort();
  for (const f of jpgs) symlinkSync(join(ROOT, 'assets/backdrops', f), join(backs, f));
  writeFileSync(join(backs, 'index.json'), JSON.stringify({ files: jpgs }));
  makeCards(join(ROOT, 'assets/backdrops'), join(backs, 'cards'));
  return dist;
}

// Runs in the page before its scripts: the frame clock under the game's control. The rAF timestamp is virtual;
// performance.now() follows it plus the real time spent in the frame, so the renderer's time budgets still end.
const CLOCK = () => {
  const real = performance.now.bind(performance), raf = requestAnimationFrame.bind(window);
  let manual = false, vnow = 0, at = 0, queue = [];
  performance.now = () => (manual ? vnow + (real() - at) : real());
  window.requestAnimationFrame = (cb) => {
    if (manual) { queue.push(cb); return 1; }
    return raf((t) => { if (manual) queue.push(cb); else cb(t); });
  };
  window.__clock = {
    enter() { vnow = real(); at = real(); manual = true; },
    step(ms) { vnow += ms; at = real(); const q = queue; queue = []; for (const f of q) f(vnow); },
  };
};

const dist = await ownDist();
const srv = createServer({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1', distDir: dist, padSilentMs: 1e9, reserveMs: 1e9 });
await srv.listen();
const base = `http://127.0.0.1:${srv.port}`, wsBase = `ws://127.0.0.1:${srv.port}/ws`;
const browser = await chromium.launch({ executablePath: browserPath(), headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
let padN = 0;

// A race under the hand-stepped clock, with n scripted pads (real WebSocket clients sending what a bot would do).
async function openRace({ world, stage = 0, seed = SEED, pads: n = 1 }) {
  const pads = [];
  for (let i = 0; i < n; i++) pads.push(await connectPad(wsBase, `readme-${process.pid}-${padN++}`));
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US' });
  await ctx.addInitScript(CLOCK);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) console.log('[console]', m.text().slice(0, 300)); });
  await page.goto(`${base}/?world=${world}&stage=${stage}&seed=${seed}&autostart&intro=0&lang=en&pr=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__game?.ready || window.__game?.error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__game.error);
  if (err) throw new Error(err);
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => window.__game.phase !== 'lobby', null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__clock.enter();
    window.__frame = (ms, n = 1, override = null) => {
      for (let i = 0; i < n; i++) window.__clock.step(ms);
      const g = window.__game;
      const inputs = [0, 1].map((s) => g.botInput(s));
      const p = g.players[0];
      return { inputs, phase: g.phase, stage: g.stage, t: g.t, mass: p?.mass, status: p?.status, y: p?.pos?.y, speed: p ? Math.hypot(p.vel.x, p.vel.z) : 0, error: g.error, drink: g.events.drink || 0, cloud: g.cloud?.t ?? null };
    };
  });
  const seq = pads.map(() => 0);
  const send = (r, steer) => pads.forEach((p, i) => {
    const a = steer?.(i, r) ?? r.inputs[i];
    p.send({ t: 'in', x: a.x, y: a.y, b: a.boost ? 1 : 0, seq: seq[i]++ });
  });
  const close = async () => { for (const p of pads) p.close(); await ctx.close(); await sleep(150); };
  // one drawn frame: the pads' last input is in, the clock moves
  const tick = async (ms, steer) => {
    const r = await page.evaluate((m) => window.__frame(m), ms);
    if (r.error) throw new Error(r.error);
    send(r, steer);
    await sleep(1);
    return r;
  };
  return { page, ctx, pads, tick, close };
}

const shot = (page, file, opts = {}) => page.screenshot({ path: join(DIR, file), ...(/\.jpe?g$/.test(file) ? { type: 'jpeg', quality: 92 } : {}), ...opts });
const stamp = (r) => `stage ${r.stage} ${r.phase} t ${r.t.toFixed(1)} mass ${(r.mass ?? 0).toFixed(2)} v ${r.speed.toFixed(0)}`;

async function sweep(world, { pads = 1, tag = 'sweep', seed = SEED } = {}) {
  const race = await openRace({ world, pads, seed });
  const ms = 1000 / 15;
  let next = 3 + EVERY, n = 0, r;
  do {
    r = await race.tick(ms);
    if (r.t >= next && r.phase !== 'results') {
      next += EVERY;
      const f = `${tag}-${world}-${String(n++).padStart(3, '0')}.jpg`;
      await shot(race.page, f);
      console.log(f, stamp(r));
    }
  } while (r.phase !== 'results' && r.t < 600);
  await race.close();
}

// Runs a race forward without drawing more than it must, until the stage has been going for `after` s.
async function toStage(race, stage, after = 0) {
  let r, t0 = null;
  for (;;) {
    r = await race.tick(1000 / 15);
    if (r.stage === stage && r.phase === 'race') { t0 ??= r.t; if (r.t - t0 >= after) return r; }
    if (r.phase === 'results') throw new Error('race over before the frame');
  }
}

async function film(world, stage, seconds) {
  const race = await openRace({ world, stage: Number(START ?? stage), pads: PADS });
  const name = NAME || `film-${world}-${stage}`;
  const out = join(DIR, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const [from, to] = seconds.split('-').map(Number);
  await toStage(race, stage, from);
  const count = Math.round((to - from) * FPS);
  for (let n = 0; n < count; n++) {
    const r = await race.tick(1000 / FPS);
    await race.page.screenshot({ path: join(out, `f${String(n).padStart(4, '0')}.png`) });
    if (n % FPS === 0) console.log(n, stamp(r));
  }
  await race.close();
}

async function at(world, stage, name, seconds) {
  const race = await openRace({ world, stage: Number(START ?? stage), pads: PADS });
  let done = 0;
  for (const s of seconds) {
    const r = await toStage(race, stage, s);
    await shot(race.page, `${name}-${String(s).replace('.', '_')}.jpg`);
    console.log(name, s, stamp(r));
    done++;
  }
  await race.close();
  return done;
}

// The way a player hugging the bank gets caught (src/game/tools/pads.mjs): the stick toward the next animal's bank.
async function animal(world, stage = 0) {
  const race = await openRace({ world, stage, pads: 1 });
  const plan = () => race.page.evaluate(() => {
    const g = window.__game, p = g.players[0];
    if (!p || p.status !== 'rolling') return null;
    const sp = Math.hypot(p.vel.x, p.vel.z) || 1, ux = p.vel.x / sp, uz = p.vel.z / sp;
    let best = null, bd = 150;
    (g.animals || []).forEach((a) => {
      const d = Math.hypot(a.x - p.pos.x, a.z - p.pos.z), ahead = (a.x - p.pos.x) * ux + (a.z - p.pos.z) * uz;
      const coming = a.state === 'approach' || a.state === 'drink';
      if (a.kind !== 'eagle' && a.state !== 'startled' && d < bd && (coming || ahead > -4)) { bd = d; best = a; }
    });
    if (!best) return null;
    const lat = (best.x - p.pos.x) * -uz + (best.z - p.pos.z) * ux;
    return { x: Math.max(-0.45, Math.min(0.45, lat / 6)), y: 0.2, boost: false };
  });
  let shots = 0, last = -1, r;
  do {
    const held = await plan();
    r = await race.tick(1000 / 20, (i, q) => held ?? q.inputs[i]);
    if (r.drink > last && r.drink > 0) {
      last = r.drink;
      const inView = await race.page.evaluate(() => {
        const g = window.__game, v = g.view;
        return v.animals.animals.some((a) => {
          if (a.mode !== 'drink') return false;
          const cam = v.renderer.cameras[0], q = cam.position.clone().set(a.x, a.y + 0.4, a.z).project(cam);
          const d = Math.hypot(cam.position.x - a.x, cam.position.z - a.z);
          return Math.abs(q.x) < 0.8 && q.y > -0.7 && q.y < 0.7 && q.z < 1 && d < 16;
        });
      });
      if (inView) {
        const f = `animal-${world}-${String(shots++).padStart(2, '0')}.jpg`;
        await shot(race.page, f);
        console.log(f, stamp(r));
      }
    }
  } while (shots < 6 && r.phase !== 'results' && r.t < 300);
  await race.close();
}

// A drop that stalls on an ice zone at the top of a stage (the stick held back) and freezes into its cube.
async function frozen(world, stage) {
  const race = await openRace({ world, stage, pads: 1 });
  let r, shots = 0;
  do {
    r = await race.tick(1000 / 20, () => ({ x: 0, y: -1, boost: false }));
    if (r.status === 'frozen') {
      await sleep(250);
      for (let i = 0; i < 6; i++) r = await race.tick(1000 / 20, () => ({ x: 0, y: -1, boost: false }));
      await shot(race.page, `frozen-${world}-${stage}-${shots++}.jpg`);
      console.log('frozen', stamp(r));
    }
  } while (shots < 3 && r.t < 40);
  await race.close();
}

// A race on one mountain: the cloud between two stages, the finish and the results.
async function moments(world) {
  const race = await openRace({ world, pads: 2 });
  const ms = 1000 / 15;
  let r, cloudShots = 0, lastCloud = -9;
  do {
    r = await race.tick(ms);
    if (r.phase === 'cloud' && r.cloud !== null && r.cloud - lastCloud > 0.9 && cloudShots < 12) {
      lastCloud = r.cloud;
      const f = `cloud-${world}-${String(cloudShots++).padStart(2, '0')}.jpg`;
      await shot(race.page, f);
      console.log(f, stamp(r), 'cloud', r.cloud.toFixed(2));
    }
    if (r.phase === 'race') lastCloud = -9;
  } while (r.phase !== 'results' && r.t < 600);
  for (let i = 0; i < 20; i++) await race.tick(ms);
  await sleep(800);
  await shot(race.page, `results-${world}.jpg`);
  console.log('results', stamp(r));
  await race.close();
}

// The real vote on the TV with two real phone pages joined: one has voted, the other is browsing. Then both vote, and
// the TV and the phones go through the verdict into the race. A real thumb holds the stick of the phone shot in the race.
async function lobby() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'en-US' });
  const tv = await ctx.newPage();
  tv.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await tv.goto(`${base}/?lang=en&pr=1&world=antelao&intro=0&seed=${SEED}`);
  await tv.waitForFunction(() => window.__game?.ready || window.__game?.error, null, { timeout: 240000 });
  await sleep(1500);
  await tv.screenshot({ path: join(DIR, 'tv-lobby.png') });
  const phone = async (label) => {
    const pc = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'en-US' });
    const page = await pc.newPage();
    page.on('pageerror', (e) => console.log(`[${label} pageerror]`, e.message));
    await page.goto(`${base}/pad?lang=en`);
    await page.waitForFunction(() => window.__pad?.joined && window.__pad.slot >= 0, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__pad.vote?.shown, null, { timeout: 15000 });
    return { ctx: pc, page, label, cdp: await pc.newCDPSession(page) };
  };
  const a = await phone('blue');
  const b = await phone('pink');
  await sleep(2500);
  const tapCard = async (p, id, side = false) => {
    const r = await p.page.evaluate((i) => window.__pad.voteRect(i), id);
    await p.page.touchscreen.tap(side ? r.x - r.w / 2 + 14 : r.x, r.y);
    await sleep(700);
  };
  await tapCard(a, 'antelao'); // the card in front: a vote
  await tapCard(b, 'svizzera', true); // a tap on the side card brings it to the front
  await sleep(1500);
  await tv.screenshot({ path: join(DIR, 'tv-vote.png') });
  await a.page.screenshot({ path: join(DIR, 'pad-voted.png') });
  await b.page.screenshot({ path: join(DIR, 'pad-browse.png') });
  await tapCard(b, 'svizzera');
  // the coin between two different mountains, on the TV
  await tv.waitForFunction(() => window.__game.vote?.phase === 'roll', null, { timeout: 15000 }).catch(() => console.log('no roll'));
  await sleep(1500);
  await tv.screenshot({ path: join(DIR, 'tv-roll.png') });
  await a.page.screenshot({ path: join(DIR, 'pad-roll.png') });
  await tv.waitForNavigation({ timeout: 15000 }).catch(() => {}); // the winner may be the other mountain: a reload
  await tv.waitForFunction(() => window.__game?.phase === 'race', null, { timeout: 120000 });
  await sleep(1500);
  const geo = await a.page.evaluate(() => {
    const s = document.getElementById('stick').getBoundingClientRect();
    return { x: s.left + s.width * 0.45, y: s.top + s.height * 0.6 };
  });
  await a.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geo.x, y: geo.y, id: 1 }] });
  await sleep(80);
  await a.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geo.x + 42, y: geo.y - 48, id: 1 }] });
  await sleep(600);
  await a.page.screenshot({ path: join(DIR, 'pad-race.png') });
  await tv.screenshot({ path: join(DIR, 'tv-race.png') });
  console.log('world', await tv.evaluate(() => window.__game.world));
  await a.ctx.close(); await b.ctx.close(); await ctx.close();
}

try {
  if (cmd === 'sweep') for (const w of rest) await sweep(w);
  if (cmd === 'split') await sweep(rest[0], { pads: 2, tag: 'split', seed: Number(rest[1] ?? SEED) });
  if (cmd === 'film') await film(rest[0], Number(rest[1]), rest[2]);
  if (cmd === 'at') await at(rest[0], Number(rest[1]), rest[2], rest.slice(3).map(Number));
  if (cmd === 'animal') await animal(rest[0], Number(rest[1] ?? 0));
  if (cmd === 'frozen') await frozen(rest[0], Number(rest[1] ?? 0));
  if (cmd === 'moments') await moments(rest[0]);
  if (cmd === 'lobby') await lobby();
} finally {
  await Promise.race([browser.close(), sleep(3000)]);
  await srv.close();
  rmSync(dist, { recursive: true, force: true });
}
process.exit(0);
