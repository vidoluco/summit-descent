// End to end, the way two players play: `node build.mjs`, then `node server/index.js` as its own process
// on a free port; the TV is the host page at 1920x1080 in headless Chromium on the Mac's GPU; the two phones are
// the real controller pages (controller/pad.html, landscape, touch emulation), each in its own browser context.
// Their thumbs are driven by the host's bot advisor (window.__game.botInput) through CDP touch events: the stick
// held and moved, BOOST tapped. A BOOST tap on each phone starts the race from the lobby, and the short race is
// played through every stage and every cloud to the valley floor and the results. Once in Italian, once in
// English: every visible string on the TV and on both phones must come from that language's dictionary.
// The Italian race saves docs/screens/e2e-stage-<n>.png, e2e-transition.png and e2e-results.png (OUT=dir moves
// them). Skips without the playwright chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DICTS, translator } from '../src/i18n/index.js';
import { TUNING } from '../src/sim/tuning.js';
import { readFileSync } from 'node:fs';
import { summitLabels } from '../src/game/mountains.js';
import {
  ROOT, buildDist, startServerProcess, launch, headlessShell, gpuInfo, openHost, openPad, drivePads, tapBoost,
  game, until, nonFinite, visibleTexts, foreignStrings, finishProblems,
} from '../tools/perf/harness.mjs';

const skip = !headlessShell() && 'no chromium';
const OUT = process.env.OUT || join(ROOT, 'docs/screens');
const SPEED = 3; // game clock x3: a full race in about 90 s; the phones still steer at 20 Hz of real time

const world = JSON.parse(await (await import('node:fs/promises')).readFile(join(ROOT, 'data/worlds/dolomiti/world.json'), 'utf8'));
const stageLabels = (lang) => world.stages.map((s) => s.labels?.[lang] ?? s.name);
// the summit names on the mountain vote's cards are world data too (data/worlds/index.json)
const voteLabels = (lang) => summitLabels(JSON.parse(readFileSync(join(ROOT, 'data/worlds/index.json'), 'utf8')), lang);

let browser = null;
before(async () => {
  if (skip) return;
  await buildDist();
  browser = await launch('metal');
});
after(async () => { if (browser) await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]); });

// Samples the host (phase, stage, NaN, fps) every 100 ms and the visible text of the TV and the phones every 400 ms.
// Its timer is unref'd: a race that fails before stop() must fail the file, not keep the process (and npm test) alive.
function monitor(host, pads) {
  const seen = { phases: [], stages: [], nan: [], fps: [], frameMs: [], host: new Set(), pads: pads.map(() => new Set()) };
  let on = true, n = 0;
  const sample = async () => {
    const g = await host.evaluate(() => ({ phase: window.__game.phase, stage: window.__game.stage, fps: window.__game.fps, frameMs: window.__game.frameMs }));
    if (seen.phases.at(-1) !== g.phase) seen.phases.push(g.phase);
    if (seen.stages.at(-1) !== g.stage) seen.stages.push(g.stage);
    if (['race', 'cloud', 'finish'].includes(g.phase) && g.fps > 0) { seen.fps.push(g.fps); seen.frameMs.push(g.frameMs); }
    for (const b of await nonFinite(host)) if (!seen.nan.includes(b)) seen.nan.push(b);
    if (n++ % 4 === 0) {
      for (const x of await visibleTexts(host, '.sd-ui')) seen.host.add(x.text);
      await Promise.all(pads.map(async (p, i) => { for (const x of await visibleTexts(p.page)) seen.pads[i].add(x.text); }));
    }
  };
  const done = (async () => {
    while (on) {
      try { await sample(); } catch { if (!on) break; }
      await new Promise((r) => setTimeout(r, 100).unref());
    }
  })();
  let stopped = null;
  return { seen, stop: () => (stopped ||= (async () => { on = false; await done; await sample().catch(() => {}); })()) };
}

async function race(t, lang, { shots = false } = {}) {
  const locale = lang === 'it' ? 'it-IT' : 'en-US';
  const tr = translator(lang);
  const srvLog = [];
  const srv = await startServerProcess({ log: (l) => srvLog.push(l) });
  const ctxs = [];
  t.after(async () => { for (const c of ctxs) await c.close().catch(() => {}); await srv.close(); });
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(OUT, `e2e-${name}.png`) }); };

  // the TV first, its lobby waiting for phones, then the two phones join by opening /pad
  const host = await openHost(browser, `${srv.base}/?lang=${lang}&speed=${SPEED}`, { locale });
  ctxs.push(host.ctx);
  assert.match((await gpuInfo(host.page)).renderer, /Metal|Apple/, 'the TV renders on the Mac GPU, not SwiftShader');
  assert.equal(await host.page.evaluate(() => document.querySelector('.lobby .start').disabled), true, 'no phone, no start');
  const pads = [];
  for (const label of ['pad0', 'pad1']) { const p = await openPad(browser, srv.base, { locale, label }); ctxs.push(p.ctx); pads.push(p); }
  assert.deepEqual(pads.map((p) => p.slot).sort(), [0, 1], 'one phone per slot');
  pads.sort((a, b) => a.slot - b.slot);
  await host.page.waitForFunction(() => document.querySelectorAll('.lobby .slot.on').length === 2, null, { timeout: 10000 });
  assert.equal(await host.page.evaluate(() => document.querySelector('.lobby .start').disabled), false);
  const mon = monitor(host.page, pads);
  t.after(() => mon.stop());
  await new Promise((r) => setTimeout(r, 800)); // the lobby with both slots is sampled

  // BOOST on the blue phone makes it ready, the race starts once the pink one presses too
  await tapBoost(pads[0]);
  await new Promise((r) => setTimeout(r, 1200)); // the "ready" and "press BOOST" states are sampled
  assert.equal((await game(host.page)).phase, 'lobby', 'one phone ready: the race waits for the other');
  await tapBoost(pads[1]);
  let g = await until(host.page, "g.phase === 'countdown'", 10000);
  assert.deepEqual(g.bots, [false, false], 'both slots are phones, no bot');
  assert.deepEqual(g.layout, [0, 1], 'split screen side by side');
  const drive = drivePads(host.page, pads);
  t.after(() => drive.stop());

  await until(host.page, "g.phase === 'race'", 20000);
  for (let k = 0; k < g.stages; k++) {
    // a few seconds into each stage, both drops rolling
    g = await until(host.page, `g.stage === ${k} && g.phase === 'race' && g.players.every((p) => p.status === 'rolling') && g.t > ${k === 0 ? 8 : 0}`, 150000);
    await host.page.waitForTimeout(1500);
    await shot(host.page, `stage-${k + 1}`);
    if (k === g.stages - 1) break;
    // the first cloud in real time, so the flight is on screen when it is shot
    if (k === 0) {
      await until(host.page, 'g.players.some((p) => p.status === "finished")', 150000);
      await host.page.evaluate(() => window.__game.setSpeed(1));
      await until(host.page, "g.phase === 'cloud' && g.cloud.t > 1.0", 90000);
      await shot(host.page, 'transition');
      await host.page.evaluate((v) => window.__game.setSpeed(v), SPEED);
    }
  }
  g = await until(host.page, "g.phase === 'results'", 150000);
  await host.page.waitForTimeout(1200);
  await shot(host.page, 'results');
  await mon.stop();
  await drive.stop();

  // the flow: countdown, every stage in order with one cloud between each pair, the valley floor, results
  const stages = mon.seen.stages.filter((s, i, a) => a.indexOf(s) === i);
  assert.deepEqual(stages, [...Array(g.stages).keys()], `stages in order: ${mon.seen.stages.join(' ')}`);
  for (const ph of ['countdown', 'race', 'cloud', 'finish', 'results']) assert.ok(mon.seen.phases.includes(ph), `went through ${ph}: ${mon.seen.phases.join(' ')}`);
  assert.equal(mon.seen.phases.filter((p) => p === 'cloud').length, g.stages - 1, 'one cloud between each pair of stages');
  assert.equal(g.events.go, 1, 'one countdown, one GO');
  // both drops reached the valley floor, or the second one used up its 30 s: checked on the sim's clock, which
  // stopped with the race, never on when a poll happened to look (a slow sample under GPU load is not a bug)
  const done = g.results.filter((p) => p.finished);
  assert.ok(done.length >= 1, 'someone reached the valley floor');
  assert.deepEqual(done.map((p) => p.place).sort(), done.map((_, i) => i + 1));
  for (const p of done) assert.ok(Number.isFinite(p.time) && p.time > 60, `slot ${p.slot} time ${p.time}`);
  assert.deepEqual(finishProblems(g, TUNING), [], `the race ended on time (t ${g.t}, results ${JSON.stringify(g.results.map((p) => p.time))})`);
  assert.equal(await host.page.evaluate(() => document.querySelector('.sd-ui').dataset.screen), 'results');
  assert.equal(await host.page.evaluate(() => document.querySelectorAll('.results .res').length), 2);
  assert.equal(await host.page.textContent('.results h1'), tr('ui.results.title'));
  // the phones: their finish fx reached them with the right place, and nothing broke anywhere
  for (const p of pads) {
    const r = g.results.find((x) => x.slot === p.slot);
    if (r.finished) assert.ok(mon.seen.pads[p.slot].has(tr('pad.finish')), `phone ${p.slot} showed the finish toast`);
    assert.ok(await p.page.evaluate(() => document.getElementById('hud').classList.contains('show')), `phone ${p.slot} shows its hud`);
  }
  assert.deepEqual(mon.seen.nan, [], 'no NaN or Infinity in window.__game');
  assert.deepEqual([...host.errors, ...pads.flatMap((p) => p.errors)], [], 'no page or console errors');
  assert.ok(!srvLog.some((l) => /error/i.test(l)), `server log: ${srvLog.filter((l) => /error/i.test(l)).join(' | ')}`);

  // every visible string, on the TV and on both phones, from this language's dictionary
  const tv = foreignStrings([...mon.seen.host].map((text) => ({ text })), DICTS, lang, { labels: [...stageLabels(lang), ...voteLabels(lang)] });
  assert.deepEqual(tv, { bad: [], wrongLang: [] }, `TV strings not from the ${lang} dictionary`);
  for (const key of ['ui.vote.title', 'ui.vote.sub', 'ui.go', 'ui.stage.evaporate', 'ui.finished.title', 'ui.results.title', 'ui.rematch']) {
    assert.ok(mon.seen.host.has(tr(key)), `the TV showed ${key} "${tr(key)}"`);
  }
  assert.ok(stageLabels(lang).some((l) => mon.seen.host.has(l)), 'a stage card showed a stage name in this language');
  for (const p of pads) {
    const ph = foreignStrings([...mon.seen.pads[p.slot]].map((text) => ({ text })), DICTS, lang, { labels: voteLabels(lang) });
    assert.deepEqual(ph, { bad: [], wrongLang: [] }, `phone ${p.slot} strings not from the ${lang} dictionary`);
    for (const key of ['pad.boost', `pad.color${p.slot}`, 'pad.lobbyPress']) assert.ok(mon.seen.pads[p.slot].has(tr(key)), `phone ${p.slot} showed ${key} "${tr(key)}"`);
  }
  const fps = mon.seen.fps.sort((a, b) => a - b);
  t.diagnostic(`${lang}: ${g.results.map((p) => `slot ${p.slot} ${p.finished ? `${p.place} ${p.time.toFixed(2)} s` : 'dnf'}`).join(', ')}; fps min ${fps[0]} median ${fps[fps.length >> 1]}; drink events ${g.events.drink || 0}; drive ticks ${drive.ticks} (${(drive.ticks / (g.t - TUNING.countdown)).toFixed(1)} per s of race clock)`);
  return g;
}

test('e2e in Italian: two phone pages, BOOST to start, every stage and cloud to the valley floor, results', { skip, timeout: 360000 }, async (t) => {
  await race(t, 'it', { shots: true });
});

test('e2e in English: the same race, every visible string from the English dictionary', { skip, timeout: 360000 }, async (t) => {
  await race(t, 'en');
});
