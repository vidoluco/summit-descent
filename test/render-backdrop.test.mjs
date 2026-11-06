// The seam between the 3D world and the painted backdrop, in headless Chromium on the Mac's GPU: nothing of the far
// 3D ground is drawn over the painting where it has turned into it (no ghost of its outline in the painted sky, the
// dashed ridge lines the playtests found), and the painting itself is there (a real picture over the course, not a
// flat colour). Skips when no playwright chromium is installed. The sky extension is checked without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { bundleDebug, serve, chromiumPath, GPU_ARGS } from '../src/render/debug/shoot.mjs';
import { extendSky } from '../src/render/paint.js';

const exe = chromiumPath();

async function withPage(t, fn) {
  const { chromium } = await import('playwright-core');
  const dir = mkdtempSync(join(tmpdir(), 'summit-backdrop-test-'));
  await bundleDebug(dir);
  const server = await serve(dir);
  const browser = await chromium.launch({ executablePath: exe, args: GPU_ARGS });
  t.after(async () => { await browser.close(); server.close(); });
  const shoot = async (query) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' || /THREE\.WebGLProgram|Shader Error/.test(m.text())) errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/debug.html?${query}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
    const png = PNG.sync.read(await page.screenshot());
    await page.close();
    assert.deepEqual(errors, [], query);
    return png;
  };
  await fn(shoot);
}

test('backdrop seam: no outline of the far 3D ground in the painted sky, and the painting is there', { skip: !exe && 'no chromium', timeout: 240000 }, async (t) => {
  await withPage(t, async (shoot) => {
    // Kerinci from its summit: the far ring of 3D ground lay over the painted horizon as a dashed dark line. With pure
    // red outlines, the top 40 % of both views (painted sky and far ranges) has next to no red pixel.
    const red = encodeURIComponent(JSON.stringify({ outline: { color: '#ff0000', strength: 1 } }));
    const a = await shoot(`world=indonesia&stage=0&t=4&view=split&theme=${red}`);
    let n = 0, all = 0;
    for (let y = 0; y < a.height * 0.4; y++) for (let x = 0; x < a.width; x++) {
      const o = (y * a.width + x) * 4, r = a.data[o], g = a.data[o + 1], b = a.data[o + 2];
      if (Math.abs(x - a.width / 2) < 8) continue; // the divider
      all++;
      if (r > 150 && r - g > 90 && r - b > 90) n++;
    }
    assert.ok(n < all * 0.0005, `red outline pixels in the painted sky: ${n} of ${all}`);
    // the Val Sesis looking down to the Creta Forata: the painting fills the top of both views with a real picture
    // (many distinct colours, rock and sky), not the gradient sky or one flat mist
    const b = await shoot('world=dolomiti&stage=2&t=20&view=split');
    for (const x0 of [0, b.width / 2 + 8]) {
      const seen = new Set();
      let lo = 765, hi = 0;
      for (let y = 0; y < b.height * 0.25; y += 2) for (let x = x0; x < x0 + b.width / 2 - 8; x += 2) {
        const o = (y * b.width + x) * 4, s = b.data[o] + b.data[o + 1] + b.data[o + 2];
        seen.add(((b.data[o] >> 4) << 8) | ((b.data[o + 1] >> 4) << 4) | (b.data[o + 2] >> 4));
        lo = Math.min(lo, s); hi = Math.max(hi, s);
      }
      assert.ok(seen.size > 120 && hi - lo > 200, `the painting at the top of the view at x ${x0}: ${seen.size} colours, range ${hi - lo}`);
    }
  });
});

test('backdrop: the sky over a wall cut by the top edge is its neighbours\' sky, without a streak, and the same in every row', () => {
  const W = 80, H = 30, px = new Uint8ClampedArray(W * H * 4), sky = (x) => [230 - x, 170, 200 + (x >> 2)], rock = [70, 60, 66];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // one narrow spire (columns 38 to 41) through the top edge, a ridge at row 14 elsewhere
    const c = (x >= 38 && x <= 41) || y >= 14 ? rock : sky(x), o = (y * W + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  const r = extendSky(px, W, H, 0.9);
  for (let x = 38; x <= 41; x++) assert.equal(r.ridge[x], 0, `column ${x}: no sky`);
  const at = (x, y, k) => r.sky[(y * W + x) * 4 + k];
  for (let x = 0; x < W; x++) {
    // the sky colour of nearby columns, never the rock (a vertical streak over the spire)
    const want = sky(x), d = Math.abs(at(x, 0, 0) - want[0]) + Math.abs(at(x, 0, 1) - want[1]) + Math.abs(at(x, 0, 2) - want[2]);
    assert.ok(d < 30, `column ${x}: sky (${at(x, 0, 0)}, ${at(x, 0, 1)}, ${at(x, 0, 2)})`);
    for (const y of [5, 20, H - 1]) for (let k = 0; k < 3; k++) assert.equal(at(x, y, k), at(x, 0, k), `column ${x} the same at row ${y}`);
  }
  // smooth across: neighbouring columns differ by a few levels at most
  for (let x = 1; x < W; x++) assert.ok(Math.abs(at(x, 0, 0) - at(x - 1, 0, 0)) <= 3, `no step between columns ${x - 1} and ${x}`);
});
