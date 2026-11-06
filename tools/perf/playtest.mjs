// Plays the real game on every world the way a judge would watch it: `node server/index.js` on a free port, the TV
// page at 1920x1080 split screen with two sim bots (?bots=2&autostart), the clock sped up, and captures of the start
// shot, every stage, each cloud transition (the evaporation, the look back up the mountain, the flight down) and the
// results. It records the finishing times, frame rate, non-finite numbers in window.__game, HTTP errors and console
// errors per world, and writes them to <out>/report.json.
//
//   node tools/perf/playtest.mjs                          every world, into $TMPDIR/summit-descent-playtest/
//   node tools/perf/playtest.mjs everest k2               some worlds
//   options: --out dir, --speed 3, --lang it|en, --intro (stop after the start shot)
//
// Its fps numbers are only indicative: tools/perf/measure.mjs is the frame-time measure.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, buildDist, startServerProcess, launch, nonFinite } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const values = new Set(['out', 'speed', 'lang'].map((k) => opt(k, null)).filter(Boolean));
const named = argv.filter((a) => !a.startsWith('--') && !values.has(a));
const worlds = named.length ? named : JSON.parse(readFileSync(join(ROOT, 'data/worlds/index.json'), 'utf8')).worlds.map((w) => w.id);
const out = opt('out', join(tmpdir(), 'summit-descent-playtest'));
const speed = Number(opt('speed', 3));
const lang = opt('lang', 'it');
const introOnly = argv.includes('--intro');
const FLIGHT = 3.6; // s, CLOUD.duration (src/game/race.js)

const quantile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };

mkdirSync(out, { recursive: true });
await buildDist();
const srv = await startServerProcess();
const browser = await launch('metal');
const report = {};
try {
  for (const w of worlds) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: lang === 'it' ? 'it-IT' : 'en-US' });
    const page = await ctx.newPage();
    const http = new Set(), errors = new Set(), nan = new Set(), taken = new Set();
    page.on('response', (r) => { if (r.status() >= 400) http.add(`${r.status()} ${r.url()}`); });
    page.on('console', (m) => { if (m.type() === 'error' || /NaN/.test(m.text())) errors.add(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.add(e.message));
    await page.goto(`${srv.base}/?world=${w}&bots=2&autostart&speed=${speed}&lang=${lang}`);
    await page.waitForFunction(() => window.__game?.ready || window.__game?.error, null, { timeout: 120000 });
    const once = async (name) => { if (taken.has(name)) return; taken.add(name); await page.screenshot({ path: join(out, `${w}-${name}.png`) }); };
    const fps = [];
    let stage = -1, stageT0 = 0, introAt = Date.now(), g = null;
    for (const end = Date.now() + 400000; Date.now() < end;) {
      g = await page.evaluate(() => { const x = window.__game; return { phase: x.phase, stage: x.stage, t: x.t, cloud: x.cloud, error: x.error, fps: x.fps, results: x.results }; });
      if (g.error) { errors.add(`__game.error ${g.error}`); break; }
      for (const x of await nonFinite(page)) nan.add(x);
      if (g.phase === 'countdown') {
        // the start shot (the hold, then the countdown's swing), in game seconds
        const s = ((Date.now() - introAt) / 1000) * speed;
        if (s > 0.6) await once('intro-a');
        if (s > 2.6) await once('intro-b');
        if (s > 4.1) await once('intro-c');
      } else introAt = Date.now();
      if (introOnly && taken.has('intro-c')) break;
      if (g.phase === 'race') {
        if (g.stage !== stage) { stage = g.stage; stageT0 = g.t; }
        if (g.t - stageT0 > 9) await once(`stage${g.stage}-a`);
        if (g.t - stageT0 > 28) await once(`stage${g.stage}-b`);
        if (g.fps > 0) fps.push(g.fps);
      }
      if (g.phase === 'cloud' && g.cloud) {
        const k = g.cloud.from;
        if (g.cloud.t < 0) await once(`cloud${k}-linger`);
        else if (g.cloud.t > 0.15 * FLIGHT && g.cloud.t < 0.3 * FLIGHT) await once(`cloud${k}-back`);
        else if (g.cloud.t > 0.62 * FLIGHT) await once(`cloud${k}-down`);
      }
      if (g.phase === 'finish') await once('finish');
      if (g.phase === 'results') { await page.waitForTimeout(1200); await once('results'); break; }
      await page.waitForTimeout(60);
    }
    report[w] = {
      phase: g?.phase,
      times: (g?.results || []).map((p) => ({ slot: p.slot, place: p.place, time: Number.isFinite(p.time) ? Math.round(p.time * 100) / 100 : null })),
      fps: quantile(fps, 0.5), nan: [...nan], http: [...http], errors: [...errors], shots: [...taken],
    };
    console.log(`${w}: ${report[w].phase}, ${report[w].times.map((p) => `slot ${p.slot} ${p.time ?? 'dnf'} s`).join(', ')}, ${report[w].shots.length} captures, ${nan.size + http.size + errors.size} problems`);
    for (const x of [...nan, ...http, ...errors]) console.log(`  ${x}`);
    await ctx.close();
  }
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
  await srv.close();
}
process.exit(0);
