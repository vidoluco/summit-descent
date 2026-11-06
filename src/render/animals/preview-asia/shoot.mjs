// Renders the Asian animals preview in headless Chromium (SwiftShader WebGL) and saves the screenshots.
// Usage (from the repo root): node src/render/animals/preview-asia/shoot.mjs 'lineup&world=everest' ...
//   each view is the query string of main.js; OUT=path overrides the output of a single view, PORT the port.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(+(process.env.PORT || 0), '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const views = process.argv.slice(2).length ? process.argv.slice(2) : ['lineup&world=everest', 'lineup&world=k2', 'lineup&world=indonesia'];
let failed = 0;
for (const view of views) {
  const qs = new URLSearchParams(view.replace(/^([a-z]+)(&|$)/, 'scene=$1$2'));
  const name = [qs.get('scene'), qs.get('world') || qs.get('kind') || qs.get('kinds')?.replace(/,/g, '+') || qs.get('file')?.replace(/\W+/g, '-')].filter(Boolean).join('-');
  const w = +(qs.get('w') || 1920), h = +(qs.get('h') || 1080);
  qs.set('w', w); qs.set('h', h);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (!/GPU stall/.test(m.text())) console.log(`[${name}] ${m.text()}`); });
  let err = null;
  page.on('pageerror', (e) => { err = e; });
  await page.goto(`http://127.0.0.1:${port}/src/render/animals/preview-asia/index.html?${qs}`);
  try {
    await Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 }),
      new Promise((_, rej) => { const t = setInterval(() => { if (err) { clearInterval(t); rej(err); } }, 200); })]);
    const out = views.length === 1 && process.env.OUT ? process.env.OUT : `docs/screens/animals-${name}.png`;
    await page.screenshot({ path: out });
    console.log(`${out} written`);
  } catch (e) { console.log(`[${name}] failed: ${e.message}`); failed++; }
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
process.exit(failed ? 1 : 0);
