// Renders the animal stickers of the lobby cards from the game's own models (src/ui/tools/stickers/main.js) in
// headless Chromium on the GPU, and saves them as assets/ui/animals/<kind>.png.
// Usage (from the repo root): node src/ui/tools/stickers.mjs [kind ...]   (default: every card's animals)
//   a kind may carry pose parameters for a trial: 'eagle&elev=0.8&roll=0.4&yaw=1.2&flap=0.1' (OUT_DIR=dir saves elsewhere)
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { chromiumPath, GPU_ARGS, SOFT_ARGS } from '../../render/debug/shoot.mjs';
import { HEADLINERS } from '../../game/mountains.js';

const ROOT = process.cwd();
const OUT = process.env.OUT_DIR || 'assets/ui/animals';
const ARGS = [...new Set(Object.values(HEADLINERS).flat())];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe || undefined, args: exe ? GPU_ARGS : SOFT_ARGS });
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ARGS;
await mkdir(OUT, { recursive: true });
let failed = 0;
for (const arg of kinds) {
  const kind = arg.split('&')[0];
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  let err = null;
  page.on('pageerror', (e) => { err = e; });
  await page.goto(`http://127.0.0.1:${server.address().port}/src/ui/tools/stickers/index.html?kind=${arg}`);
  try {
    await Promise.race([page.waitForFunction(() => !!window.__sticker, null, { timeout: 120000 }),
      new Promise((_, rej) => { const t = setInterval(() => { if (err) { clearInterval(t); rej(err); } }, 200); })]);
    const s = await page.evaluate(() => window.__sticker);
    const name = process.env.OUT_DIR ? arg.replace(/[&=]/g, '_') : kind;
    await writeFile(`${OUT}/${name}.png`, Buffer.from(s.png.split(',')[1], 'base64'));
    console.log(`${OUT}/${name}.png ${s.w}x${s.h}${s.touches.some(Boolean) ? ' (touches the frame: widen the shot)' : ''}`);
  } catch (e) { console.log(`[${kind}] failed: ${e.message}`); failed++; }
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
process.exit(failed ? 1 : 0);
