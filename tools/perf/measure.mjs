// Frame time of the real game at 1920x1080 split screen (two bots racing), per stage and across a cloud.
// Builds dist/, starts `node server/index.js` on a free port, opens the host page in Chromium from the playwright
// cache and times every frame of the game loop without touching game code: requestAnimationFrame is wrapped
// before the page loads, so each frame gives its interval (display to display) and the CPU time of the game's
// own frame() (sim steps, scene update, draw calls issued). Prints the WebGL renderer it really got.
//
//   node tools/perf/measure.mjs                       headless shell on the Mac GPU (ANGLE Metal), vsync on
//   node tools/perf/measure.mjs --uncapped            same without the 60 Hz cap: the interval shows the headroom
//   node tools/perf/measure.mjs --backend headed      Chrome for Testing in a real window (opens a window for ~1 min)
//   node tools/perf/measure.mjs --backend swiftshader the CPU rasteriser: NOT representative of a Mac, a floor only
//   node tools/perf/measure.mjs --all                 metal, metal uncapped, headed, swiftshader in turn
//   options: --world dolomiti, --seconds 6 (per stage), --stages 0,1,2,3, --no-cloud, --pr 1 (pixel ratio cap), --json
//
// The numbers to read: "interval p50/p95" is what the players see (16.7 ms = 60 fps at vsync); "cpu" is the
// main-thread cost of a frame; "long" counts frames over 25 ms (a visible hitch at 60 Hz).
import { BACKENDS, buildDist, startServerProcess, launch, gpuInfo, openHost, until } from './harness.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);
const seconds = Number(opt('seconds', 6));
const stages = opt('stages', '0,1,2,3').split(',').map(Number);
const pr = opt('pr', null);
const world = opt('world', 'dolomiti');
const runs = has('all')
  ? [['metal', false], ['metal', true], ['headed', false], ['swiftshader', false]]
  : [[opt('backend', 'metal'), has('uncapped')]];

// Runs before the page's own scripts: every requestAnimationFrame callback is timed.
const PROBE = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const perf = { on: false, ts: [], cpu: [], phase: [] };
  window.__perf = perf;
  window.requestAnimationFrame = (cb) => raf((ts) => {
    const t0 = performance.now();
    cb(ts);
    if (perf.on) { perf.ts.push(ts); perf.cpu.push(performance.now() - t0); perf.phase.push(window.__game?.phase || ''); }
  });
};

const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function summarize(perf, keep = () => true) {
  const iv = [], cpu = [];
  for (let i = 1; i < perf.ts.length; i++) if (keep(perf.phase[i])) { iv.push(perf.ts[i] - perf.ts[i - 1]); cpu.push(perf.cpu[i]); }
  const total = iv.reduce((a, b) => a + b, 0);
  return {
    frames: iv.length, fps: iv.length ? Math.round((iv.length / total) * 10000) / 10 : 0,
    interval: { p50: q(iv, 0.5), p95: q(iv, 0.95), p99: q(iv, 0.99), max: Math.max(...iv) },
    cpu: { p50: q(cpu, 0.5), p95: q(cpu, 0.95), max: Math.max(...cpu) },
    long: iv.filter((v) => v > 25).length,
  };
}
const ms = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(5) : '    -');
const line = (label, s) => `  ${label.padEnd(16)} ${String(s.fps).padStart(5)} fps  interval p50 ${ms(s.interval.p50)} p95 ${ms(s.interval.p95)} p99 ${ms(s.interval.p99)} max ${ms(s.interval.max)} ms  cpu p50 ${ms(s.cpu.p50)} p95 ${ms(s.cpu.p95)} max ${ms(s.cpu.max)} ms  long ${s.long}`;

async function measure(browser, base, query, { ms: dur, wait }) {
  const host = await openHost(browser, `${base}/?bots=2&autostart&world=${world}${pr ? `&pr=${pr}` : ''}&${query}`, { init: PROBE });
  await until(host.page, wait, 120000);
  await host.page.evaluate(() => { window.__perf.on = true; });
  await host.page.waitForTimeout(dur);
  const perf = await host.page.evaluate(() => { window.__perf.on = false; return window.__perf; });
  const info = await gpuInfo(host.page);
  await host.ctx.close();
  if (host.errors.length) console.log(`  page errors: ${host.errors.join(' | ')}`);
  return { perf, info };
}

await buildDist();
const srv = await startServerProcess();
const report = [];
try {
  for (const [backend, uncapped] of runs) {
    if (!BACKENDS[backend]) throw new Error(`--backend: one of ${Object.keys(BACKENDS).join(', ')}`);
    const browser = await launch(backend, { uncapped });
    const name = `${backend}${uncapped ? ' uncapped' : ''}`;
    try {
      const rows = [];
      let info = null;
      for (const k of stages) {
        const r = await measure(browser, srv.base, `stage=${k}`, { ms: seconds * 1000, wait: "g.phase === 'race' && g.t > 5" });
        info = r.info;
        rows.push({ label: `stage ${k + 1}`, ...summarize(r.perf, (p) => p === 'race') });
      }
      if (!has('no-cloud')) {
        // from the end of a stage through its cloud and the rain-in on the next one: the stage swap is the hitch to watch
        const k = Math.min(stages[0] ?? 0, 2);
        const r = await measure(browser, srv.base, `stage=${k}&speed=4`, { ms: 9000, wait: 'g.players.some((p) => p.status === "finished")' });
        rows.push({ label: `cloud ${k + 1}->${k + 2}`, ...summarize(r.perf, (p) => p === 'cloud') });
      }
      const soft = /swiftshader|llvmpipe|software/i.test(info?.renderer || '');
      console.log(`\n${world}, ${name}: ${info?.renderer}${soft ? '  <- software rasteriser, not representative of a real Mac' : ''}`);
      for (const r of rows) console.log(line(r.label, r));
      report.push({ backend: name, renderer: info?.renderer, software: soft, rows });
    } finally {
      await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
    }
  }
} finally {
  await srv.close();
}
if (has('json')) console.log(JSON.stringify(report, null, 2));
process.exit(0);
