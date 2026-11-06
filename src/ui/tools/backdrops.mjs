// Renders clean game backdrops for the UI screenshots: the cartoon mockup (read only, never written) with its
// own HUD hidden, saved as JPEG into src/ui/tools/backdrops/. Stand-ins for the real canvas until src/render exists.
// Usage: node src/ui/tools/backdrops.mjs [mockups/cartoon]   (SwiftShader WebGL, takes a minute or two)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = process.cwd();
const MOCKUP = process.argv[2] || 'mockups/cartoon';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
for (const view of ['hero', 'split']) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(`[${view}] pageerror: ${e.message}`));
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/${MOCKUP}/dist/index.html?view=${view}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.addStyleTag({ content: '#hud, #boot { display: none !important; }' });
  await page.waitForTimeout(300);
  const out = `src/ui/tools/backdrops/${view}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 84 });
  console.log(`${out} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.close();
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
process.exit(0);
