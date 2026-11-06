// Bundles the render debug page, serves it with the baked worlds and captures it in headless Chromium on the
// Mac's GPU (ANGLE Metal; --swiftshader for the software fallback).
//   node src/render/debug/shoot.mjs                      docs/screens/render-split.png and render-hero.png
//   node src/render/debug/shoot.mjs 'split?stage=2&t=20'  one capture with extra URL params (out: OUT=path)
//   node src/render/debug/shoot.mjs --perf               uncapped frame rate of the split view at 1920x1080 for 6 s
//   node src/render/debug/shoot.mjs --serve              keep serving, open the printed URL in a browser
import { createServer } from 'node:http';
import { readFile, mkdtemp, copyFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HERE = join(ROOT, 'src/render/debug');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const shots = args.filter((a) => !a.startsWith('--'));

export async function bundleDebug(dir) {
  await build({ entryPoints: [join(HERE, 'debug.js')], bundle: true, format: 'esm', outfile: join(dir, 'debug.js'), target: 'es2022', logLevel: 'warning', sourcemap: 'inline' });
  await copyFile(join(HERE, 'debug.html'), join(dir, 'debug.html'));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };
// The list of painted backdrops the renderer may load (build.mjs writes the same file into dist/).
export const backdropIndex = () => JSON.stringify({ files: readdirSync(join(ROOT, 'assets/backdrops')).filter((f) => /\.jpg$/i.test(f)).sort() });
export function serve(dir) {
  const server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/assets/backdrops/index.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(backdropIndex()); }
    const file = p.startsWith('/data/') || p.startsWith('/assets/') ? join(ROOT, p) : join(dir, p === '/' ? 'debug.html' : p);
    try { const b = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

export function chromiumPath() {
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

export const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];
export const SOFT_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = await mkdtemp(join(tmpdir(), 'summit-render-'));
  await bundleDebug(dir);
  const server = await serve(dir);
  const base = `http://127.0.0.1:${server.address().port}/debug.html`;
  if (flag('--serve')) { console.log(`${base}?stage=1&view=split&live=1`); await new Promise(() => {}); }
  const { chromium } = await import('playwright-core');
  // --perf measures without the 60 Hz cap, so the result shows the headroom left
  const uncapped = flag('--perf') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
  const browser = await chromium.launch({ executablePath: chromiumPath() || undefined, args: [...(flag('--swiftshader') ? SOFT_ARGS : GPU_ARGS), ...uncapped] });
  const list = flag('--perf') ? ['split?perf=6'] : shots.length ? shots : ['split', 'hero'];
  for (const s of list) {
    const [view, qs = ''] = s.split('?');
    const query = new URLSearchParams(qs); query.set('view', view);
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    let failed = null;
    page.on('console', (m) => console.log(`[${s}] ${m.text()}`));
    page.on('pageerror', (e) => { console.log(`[${s}] pageerror: ${e.message}`); failed = e; });
    const t0 = Date.now();
    await page.goto(`${base}?${query}`);
    await Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }),
      new Promise((_, rej) => { const t = setInterval(() => { if (failed) { clearInterval(t); rej(failed); } }, 200); })]);
    if (query.has('perf')) {
      const perf = await page.waitForFunction(() => window.__perf, null, { timeout: 120000 }).then((h) => h.jsonValue());
      console.log(`[${s}] ${perf.frames} frames, ${perf.fps.toFixed(1)} fps, p95 ${perf.p95ms.toFixed(1)} ms, render() CPU ${perf.cpuRenderMs.toFixed(2)} ms`);
    } else {
      const out = process.env.OUT || join(ROOT, `docs/screens/render-${view}.png`);
      await page.screenshot({ path: out });
      console.log(`${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    await page.close();
  }
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
  server.close();
  process.exit(0);
}
