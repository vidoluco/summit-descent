// Renders the animals preview in headless Chromium (GPU through ANGLE Metal when the headless shell is
// installed, SwiftShader otherwise) and saves the screenshots.
// Usage (from the repo root): node src/render/animals/preview/shoot.mjs [lineup] [drink] ...
//   a view can carry extra query parameters: "drink&t=12", "lineup&world=carpazi", "turn&kind=wolf";
//   it is saved as docs/screens/animals-<scene>.png, a lineup of a world as animals-<world>.png, a view of
//   one kind as animals-<scene>-<kind>.png; OUT=path overrides the output of a single view, OUT_DIR the
//   folder, PORT the server port (default any free one).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { chromiumPath, GPU_ARGS, SOFT_ARGS } from '../../debug/shoot.mjs';

const ROOT = process.cwd();
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(+(process.env.PORT || 0), '127.0.0.1', r));
const port = server.address().port;
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe || undefined, args: exe ? GPU_ARGS : SOFT_ARGS });
const views = process.argv.slice(2).length ? process.argv.slice(2) : ['lineup', 'drink'];
let failed = 0;
for (const view of views) {
  const vq = new URLSearchParams(view), scene = view.split('&')[0];
  const name = scene === 'lineup' && vq.get('world') ? vq.get('world') : vq.get('kind') ? `${scene}-${vq.get('kind')}` : scene;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => { if (!/GPU stall/.test(m.text())) console.log(`[${name}] ${m.text()}`); });
  let err = null;
  page.on('pageerror', (e) => { err = e; });
  await page.goto(`http://127.0.0.1:${port}/src/render/animals/preview/index.html?scene=${view}&w=1920&h=1080`);
  try {
    await Promise.race([page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 }),
      new Promise((_, rej) => { const t = setInterval(() => { if (err) { clearInterval(t); rej(err); } }, 200); })]);
    const out = views.length === 1 && process.env.OUT ? process.env.OUT : `${process.env.OUT_DIR || 'docs/screens'}/animals-${name}.png`;
    await page.screenshot({ path: out });
    console.log(`${out} written`);
  } catch (e) { console.log(`[${name}] failed: ${e.message}`); failed++; }
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
process.exit(failed ? 1 : 0);
