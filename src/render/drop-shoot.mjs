// Captures the drop lab (drop-lab.js) in headless Chromium on the Mac's GPU, one PNG per shot, and can lay the
// shots out on a labelled contact sheet.
//   node src/render/drop-shoot.mjs name='split?mass=1,2.5&t=8' ...     docs/screens/drop-<name>.png
//   SHEET=docs/screens/drop-options.png COLS=2 node src/render/drop-shoot.mjs a='...' b='...'   also the sheet
//   PORT=8204 (default) serves the bundle and the baked worlds there; OUTDIR=dir writes the shots there instead
import { createServer } from 'node:http';
import { readFile, mkdtemp, copyFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromiumPath, GPU_ARGS } from './debug/shoot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = join(ROOT, 'src/render');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };

const dir = await mkdtemp(join(tmpdir(), 'summit-drop-'));
await build({ entryPoints: [join(HERE, 'drop-lab.js')], bundle: true, format: 'esm', outfile: join(dir, 'drop-lab.js'), target: 'es2022', logLevel: 'warning' });
await copyFile(join(HERE, 'drop-lab.html'), join(dir, 'drop-lab.html'));
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = p.startsWith('/data/') || p.startsWith('/docs/') || p.startsWith('/assets/') ? join(ROOT, p) : join(dir, p === '/' ? 'drop-lab.html' : p);
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
const port = +(process.env.PORT || 8204);
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = `http://127.0.0.1:${port}`;

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: chromiumPath() || undefined, args: GPU_ARGS });
const shots = process.argv.slice(2).map((a) => { const i = a.indexOf('='); return { name: a.slice(0, i), spec: a.slice(i + 1) }; });
const outs = [];
for (const { name, spec } of shots) {
  const [view, qs = ''] = spec.split('?');
  const query = new URLSearchParams(qs); query.set('view', view);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message}`));
  await page.goto(`${base}/drop-lab.html?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const out = process.env.OUTDIR ? join(process.env.OUTDIR, `drop-${name}.png`) : join(ROOT, `docs/screens/drop-${name}.png`);
  await page.screenshot({ path: out });
  outs.push({ name, out, spec });
  console.log(out);
  await page.close();
}
if (process.env.SHEET) {
  // LABEL_<name>=text captions a cell
  const cols = +(process.env.COLS || 2), w = 960, h = 540;
  const page = await browser.newPage({ viewport: { width: cols * w, height: Math.ceil(outs.length / cols) * (h + 34) }, deviceScaleFactor: 1 });
  await page.goto(`${base}/blank`).catch(() => {}); // a page of the same origin as the images
  const cells = outs.map((o) => `<figure><img src="${base}/docs/screens/drop-${o.name}.png"><figcaption>${process.env[`LABEL_${o.name}`] || o.name}</figcaption></figure>`).join('');
  await page.setContent(`<style>body{margin:0;background:#14121a;display:grid;grid-template-columns:repeat(${cols},${w}px)}figure{margin:0}
    img{width:${w}px;height:${h}px;display:block}figcaption{height:34px;line-height:34px;color:#f4eef0;font:600 18px system-ui;padding-left:12px}</style>${cells}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(ROOT, process.env.SHEET), fullPage: true });
  console.log(process.env.SHEET);
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
process.exit(0);
