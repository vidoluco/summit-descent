// The whole game in headless Chromium on the Mac's GPU, served by the real server: a ?bots=2 race from the lobby
// to the valley floor and the results; two scripted phones over WebSocket (inputs, fx and hud back to them, a
// phone that drops out and comes back, BOOST on a phone for the rematch once its lockout is over); the lobby's
// BOOST rules (a tap only makes a phone ready, a held BOOST races a bot), a late phone in the bot's slot told it
// plays from the next race, and a held BOOST on the results back to the lobby. Skips without the playwright chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, symlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromiumPath, GPU_ARGS, backdropIndex } from '../src/render/debug/shoot.mjs';
import { startGame, openHost, game, until } from '../src/game/tools/shoot.mjs';
import { connectPad, scriptedPads } from '../src/game/tools/pads.mjs';
import { makeCards } from '../tools/cards.mjs';

const exe = chromiumPath();
const skip = !exe && 'no chromium';

async function dist() {
  const dir = mkdtempSync(join(tmpdir(), 'summit-descent-game-'));
  for (const [entry, out] of [['src/main.js', 'game.js'], ['controller/pad.js', 'pad.js']]) {
    await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(dir, out), target: 'es2022', logLevel: 'warning' });
  }
  copyFileSync('index.template.html', join(dir, 'index.html'));
  copyFileSync('controller/pad.html', join(dir, 'pad.html'));
  mkdirSync(join(dir, 'data'));
  symlinkSync(resolve('data/worlds'), join(dir, 'data/worlds'));
  mkdirSync(join(dir, 'assets/vendor'), { recursive: true });
  symlinkSync(resolve('assets/vendor/animals'), join(dir, 'assets/vendor/animals'));
  // the painted backdrops and their list, as build.mjs ships them
  mkdirSync(join(dir, 'assets/backdrops'));
  for (const f of JSON.parse(backdropIndex()).files) symlinkSync(resolve('assets/backdrops', f), join(dir, 'assets/backdrops', f));
  writeFileSync(join(dir, 'assets/backdrops/index.json'), backdropIndex());
  // the lobby vote's card paintings and animal stickers
  makeCards('assets/backdrops', join(dir, 'assets/backdrops/cards'));
  symlinkSync(resolve('assets/ui'), join(dir, 'assets/ui'));
  return dir;
}

let shared = null;
async function setup(t) {
  if (!shared) {
    const { chromium } = await import('playwright-core');
    const srv = await startGame({ distDir: await dist() });
    const browser = await chromium.launch({ executablePath: exe, args: GPU_ARGS });
    shared = { srv, browser, wsBase: `ws://127.0.0.1:${srv.port}/ws`, users: 0 };
  }
  shared.users++;
  t.after(async () => {
    if (--shared.users > 0) return;
    const s = shared; shared = null;
    await Promise.race([s.browser.close(), new Promise((r) => setTimeout(r, 3000))]);
    await s.srv.close();
  });
  return shared;
}

// polls __game and records the phases and stages it goes through
function tracker(page) {
  const seen = { phases: [], stages: [], minFps: Infinity, maxFps: 0 };
  let on = true;
  const sample = async () => {
    const g = await page.evaluate(() => ({ phase: window.__game.phase, stage: window.__game.stage, fps: window.__game.fps }));
    if (seen.phases.at(-1) !== g.phase) seen.phases.push(g.phase);
    if (seen.stages.at(-1) !== g.stage) seen.stages.push(g.stage);
    if (g.fps > 0) { seen.minFps = Math.min(seen.minFps, g.fps); seen.maxFps = Math.max(seen.maxFps, g.fps); }
  };
  const done = (async () => {
    while (on) {
      try { await sample(); } catch { break; }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  // one last sample after the loop, so a phase reached just before stop() is not missed under load
  return { seen, stop: async () => { on = false; await done; await sample().catch(() => {}); } };
}

test('?bots=2: lobby, countdown, every stage with the cloud between, the valley floor, results', { skip, timeout: 240000 }, async (t) => {
  const { srv, browser } = await setup(t);
  const { page, errors } = await openHost(browser, `${srv.base}/?bots=2&autostart&speed=10&lang=it`);
  // a NaN geometry names itself when three reports it: the meshes holding non-finite positions, with their parents
  await page.evaluate(() => {
    const error = console.error;
    window.__nanMeshes = [];
    console.error = (...a) => {
      if (/radius is NaN/.test(String(a[0])) && !window.__nanMeshes.length) {
        window.__game.view?.renderer?.scene?.traverse((o) => {
          const p = o.geometry?.attributes?.position?.array;
          if (!p) return;
          const bad = [0, 0, 0];
          for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad[i % 3]++;
          if (!bad[0] && !bad[1] && !bad[2]) return;
          const path = [];
          for (let c = o; c; c = c.parent) path.push(c.name || c.type);
          window.__nanMeshes.push(`x ${bad[0]} y ${bad[1]} z ${bad[2]} of ${p.length / 3} vertices: ${path.join(' < ')} (phase ${window.__game.phase}, stage ${window.__game.stage}, players ${JSON.stringify(window.__game.players.map((q) => [q.status, q.mass]))})`);
        });
      }
      error(...a);
    };
  });
  const tr = tracker(page);
  const g = await until(page, "g.phase === 'results'", 200000);
  await tr.stop();
  assert.deepEqual(errors, [], `meshes with non-finite positions: ${(await page.evaluate(() => window.__nanMeshes)).join('; ') || 'none found'}`);
  assert.deepEqual(g.bots, [true, true]);
  assert.deepEqual(g.layout, [0, 1]);
  assert.deepEqual(tr.seen.stages.filter((s, i, a) => a.indexOf(s) === i), [0, 1, 2, 3]);
  for (const ph of ['countdown', 'race', 'cloud', 'results']) assert.ok(tr.seen.phases.includes(ph), `went through ${ph}: ${tr.seen.phases.join(' ')}`);
  assert.equal(tr.seen.phases.filter((p) => p === 'cloud').length, 3, 'one cloud between each pair of stages');
  assert.deepEqual(g.results.map((p) => p.place).sort(), [1, 2]);
  assert.ok(g.results.every((p) => p.finished && Number.isFinite(p.time)));
  assert.ok(g.players.every((p) => p.finished));
  assert.ok(tr.seen.maxFps >= 30, `fps up to ${tr.seen.maxFps}`);
  // the results screen, in Italian, with both drops on the podium
  assert.equal(await page.evaluate(() => document.querySelector('.sd-ui').dataset.screen), 'results');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.results .res').length), 2);
  assert.equal(await page.textContent('.results h1'), 'Fine della gara');
  await page.close();
});

test('two phones: the race runs on their inputs, fx and hud reach them, a phone drops out and comes back', { skip, timeout: 240000 }, async (t) => {
  const { srv, browser, wsBase } = await setup(t);
  const pre = [await connectPad(wsBase, 'scripted-pad-0'), await connectPad(wsBase, 'scripted-pad-1')];
  const { page, errors } = await openHost(browser, `${srv.base}/?autostart&stage=3&speed=2&lang=en`);
  const pads = await scriptedPads(page, wsBase, { pads: pre });
  t.after(() => pads.stop());
  let g = await until(page, "g.phase === 'race' && g.t > 6");
  assert.deepEqual(g.bots, [false, false], 'both slots are phones');
  assert.deepEqual(g.layout, [0, 1]);
  assert.ok(g.players.every((p) => p.status !== 'finished'));
  // the GO buzz and the hud with place and mass
  for (const s of [0, 1]) {
    const box = pads.pads[s].inbox;
    assert.ok(box.some((m) => m.t === 'fx' && m.kind === 'buzz'), `pad ${s} buzzed at GO`);
    const hud = box.filter((m) => m.t === 'hud');
    assert.ok(hud.length >= 2 && hud.every((m) => m.slot === s && Number.isFinite(m.mass) && [1, 2].includes(m.place)), `pad ${s} hud`);
  }
  // the drops move on the phones' inputs
  const p0 = g.players[0].pos;
  await page.waitForTimeout(1000);
  g = await game(page);
  assert.ok(Math.hypot(g.players[0].pos.x - p0.x, g.players[0].pos.z - p0.z) > 10, 'drop 0 rolls downhill');
  // pink's phone goes away: its drop waits, its half says so; it comes back and the drop goes on
  await pads.drop(1);
  g = await until(page, 'g.players[1].connected === false');
  assert.equal(await page.evaluate(() => document.querySelector('.half[data-slot="1"] .waiting').classList.contains('hide')), false);
  assert.match(await page.textContent('.half[data-slot="1"] .waiting b'), /pink drop/);
  await page.waitForTimeout(800);
  const parked = (await game(page)).players[1].pos;
  await page.waitForTimeout(800);
  const still = (await game(page)).players[1].pos;
  assert.ok(Math.hypot(still.x - parked.x, still.z - parked.z) < 3, 'the drop of the missing phone stays put');
  await pads.rejoin(1);
  await until(page, 'g.players[1].connected === true');
  assert.equal(await page.evaluate(() => document.querySelector('.half[data-slot="1"] .waiting').classList.contains('hide')), true);
  // to the valley floor: the finish fx with the place
  g = await until(page, "g.phase === 'results'", 200000);
  assert.deepEqual(errors, []);
  const fin = [0, 1].map((s) => pads.pads[s].inbox.find((m) => m.t === 'fx' && m.kind === 'finish'));
  const done = g.results.filter((p) => p.finished);
  assert.ok(done.length >= 1);
  for (const p of done) assert.equal(fin[p.slot]?.place, p.place, `pad ${p.slot} got its place`);
  // the last hud of each phone is the podium's place (0, no place card, for a drop that did not finish)
  for (const r of g.results) assert.equal(pads.pads[r.slot].inbox.filter((m) => m.t === 'hud').at(-1)?.place, r.place ?? 0, `pad ${r.slot} place card`);
  for (const s of [0, 1]) {
    const phases = pads.pads[s].inbox.filter((m) => m.t === 'phase').map((m) => m.phase);
    assert.deepEqual(phases.slice(-2), ['race', 'results'], `pad ${s} phases ${phases.join(' ')}`);
  }
  // BOOST on a phone from the results: ignored for the lockout, then a rematch with the same two phones
  pads.halt();
  pads.pads[0].send({ t: 'in', x: 0, y: 0, b: 1, seq: 1e6 - 2 });
  pads.pads[0].send({ t: 'in', x: 0, y: 0, b: 0, seq: 1e6 - 1 });
  await page.waitForTimeout(400);
  assert.equal((await game(page)).phase, 'results', 'a tap right after the results is ignored');
  await until(page, 'g.rematchOpen', 10000);
  // one phone's tap: it is ready, the TV and that phone say the other one is waited for, and nothing starts
  pads.pads[0].send({ t: 'in', x: 0, y: 0, b: 1, seq: 1e6 });
  pads.pads[0].send({ t: 'in', x: 0, y: 0, b: 0, seq: 1e6 + 1 });
  g = await until(page, "g.pads[0] === 'rematch' && g.pads[1] === 'results'", 5000);
  assert.deepEqual(g.rematchReady, [true, false]);
  await page.waitForTimeout(600);
  assert.equal((await game(page)).phase, 'results', 'one tap of two phones does not start the rematch');
  pads.pads[1].send({ t: 'in', x: 0, y: 0, b: 1, seq: 1e6 + 2 });
  pads.pads[1].send({ t: 'in', x: 0, y: 0, b: 0, seq: 1e6 + 3 });
  g = await until(page, "g.phase === 'countdown'", 10000);
  assert.deepEqual(g.bots, [false, false]);
  assert.equal(g.stage, 3, 'the rematch starts where this race started (?stage=3)');
  assert.equal(await page.evaluate(() => document.querySelector('.sd-ui').dataset.screen), 'countdown');
  await page.close();
});

// a phone held down on BOOST for `ms`, sending at 10 Hz like a thumb resting on the button
async function holdBoost(pad, ms, seq) {
  for (let t = 0; t < ms; t += 100) { pad.send({ t: 'in', x: 0, y: 0, b: 1, seq: seq++ }); await new Promise((r) => setTimeout(r, 100)); }
  pad.send({ t: 'in', x: 0, y: 0, b: 0, seq: seq++ });
  return seq;
}
const tap = (pad, seq) => { pad.send({ t: 'in', x: 0, y: 0, b: 1, seq }); pad.send({ t: 'in', x: 0, y: 0, b: 0, seq: seq + 1 }); return seq + 2; };
const phases = (pad) => pad.inbox.filter((m) => m.t === 'phase').map((m) => m.phase);

test('lobby: a BOOST tap only makes a phone ready; two ready phones start, no bot', { skip, timeout: 120000 }, async (t) => {
  const { srv, browser, wsBase } = await setup(t);
  const { page, errors } = await openHost(browser, `${srv.base}/?lang=it`);
  await until(page, "g.phase === 'lobby'");
  assert.equal(await page.evaluate(() => document.querySelector('.lobby .start').disabled), true);
  const a = await connectPad(wsBase, 'lobby-pad-a');
  t.after(() => a.close());
  await page.waitForFunction(() => document.querySelector('.slot[data-slot="0"]').classList.contains('on'));
  await until(page, "g.pads[0] === 'lobby'");
  assert.match(await page.textContent('.slot[data-slot="0"] .st'), /Premi SCATTO/);
  // one curious tap: ready, the phone is told to hold BOOST for a bot, and nothing starts
  tap(a, 1);
  await until(page, "g.pads[0] === 'solo'");
  await page.waitForTimeout(2500);
  assert.equal((await game(page)).phase, 'lobby', 'a tap does not start a race against a bot');
  assert.match(await page.textContent('.lobby .start span'), /tieni premuto SCATTO/);
  assert.equal(await page.textContent('.slot[data-slot="0"] .st'), 'Pronta a scendere');
  // the second phone joins and has to press too
  const b = await connectPad(wsBase, 'lobby-pad-b');
  t.after(() => b.close());
  await until(page, "g.pads[0] === 'ready' && g.pads[1] === 'lobby'");
  assert.equal((await game(page)).phase, 'lobby');
  tap(b, 1);
  const g = await until(page, "g.phase === 'countdown' || g.phase === 'race'", 10000);
  assert.deepEqual(g.bots, [false, false]);
  assert.deepEqual(g.layout, [0, 1]);
  assert.deepEqual(phases(a).slice(-1), ['race']);
  assert.deepEqual(errors, []);
  await page.close();
});

test('lobby: a held BOOST races a bot; a late phone in its slot plays from the next race; a held BOOST on the results goes back to the lobby', { skip, timeout: 240000 }, async (t) => {
  const { srv, browser, wsBase } = await setup(t);
  const { page, errors } = await openHost(browser, `${srv.base}/?lang=en&stage=3&speed=8`);
  await until(page, "g.phase === 'lobby'");
  const solo = await connectPad(wsBase, 'solo-pad');
  t.after(() => solo.close());
  await until(page, "g.pads[0] === 'lobby'");
  let seq = await holdBoost(solo, 2200, 1);
  let g = await until(page, "g.phase === 'countdown' || g.phase === 'race'", 10000);
  assert.deepEqual(g.bots, [false, true], 'a bot races the solo phone');
  assert.deepEqual(g.layout, [0], 'the solo view takes the whole screen');
  assert.ok(await page.evaluate(() => document.querySelector('.sd-ui').classList.contains('solo')));
  // a second phone scans the QR mid race: it lands in the bot's slot and is told so, on the phone and on the TV
  await until(page, "g.phase === 'race'", 20000);
  const late = await connectPad(wsBase, 'late-pad');
  t.after(() => late.close());
  await until(page, "g.pads[1] === 'next'");
  assert.equal(await page.evaluate(() => !document.querySelector('.notice').classList.contains('hide')), true);
  assert.equal(await page.textContent('.notice b'), 'Pink phone connected');
  await until(page, "g.phase === 'results'", 200000);
  assert.deepEqual(phases(late), ['next', 'results']);
  assert.deepEqual(late.inbox.filter((m) => m.t === 'fx' || m.t === 'hud'), [], 'no buzz or hud for the bot\'s drop');
  // a held BOOST once the lockout is over: back to the lobby, the QR and both phones there
  await until(page, 'g.rematchOpen', 10000);
  seq = await holdBoost(solo, 2200, seq);
  g = await until(page, "g.phase === 'lobby'", 10000);
  assert.equal(await page.evaluate(() => document.querySelector('.sd-ui').dataset.screen), 'lobby');
  assert.equal(await page.evaluate(() => document.querySelectorAll('.lobby .slot.on').length), 2);
  assert.ok(await page.evaluate(() => !!document.querySelector('.lobby .qr img').getAttribute('src')));
  await until(page, "g.pads[0] === 'lobby' && g.pads[1] === 'lobby'");
  assert.deepEqual(errors, []);
  await page.close();
});

test('a stage that does not load: the cloud holds, the TV says so, and the race goes on once it loads', { skip, timeout: 180000 }, async (t) => {
  const { srv, browser } = await setup(t);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-US' });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  let blocked = true, fetches = 0; // the last stage's grid: the network is down until the test lets it through
  await page.route('**/stage-3.bin', (route) => { fetches++; return blocked ? route.abort('internetdisconnected') : route.continue(); });
  await page.goto(`${srv.base}/?bots=2&autostart&stage=2&speed=8&lang=en`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__game.stalled !== null, null, { timeout: 120000, polling: 100 });
  let g = await game(page);
  assert.equal(g.phase, 'cloud');
  assert.equal(g.stage, 2);
  assert.equal(g.stalled.stage, 3);
  assert.match(g.error, /stage 4 does not load/);
  assert.equal(await page.evaluate(() => !document.querySelector('.notice').classList.contains('hide')), true);
  assert.equal(await page.textContent('.notice b'), 'The next stage will not load');
  const before = fetches;
  assert.ok(before >= 3, `${before} fetches: the boot prefetch and the retries`);
  blocked = false;
  await page.waitForFunction(() => window.__game.stage === 3, null, { timeout: 60000, polling: 100 });
  g = await game(page);
  assert.equal(g.error, null, 'the error clears once the stage is in');
  assert.equal(g.stalled, null);
  assert.equal(await page.evaluate(() => document.querySelector('.notice').classList.contains('hide')), true);
  g = await until(page, "g.phase === 'results'", 120000);
  assert.ok(g.results.some((p) => p.finished));
  assert.deepEqual(pageErrors, []);
  await page.close();
});
