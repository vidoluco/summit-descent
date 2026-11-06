// The renderer in headless Chromium on the Mac's GPU (ANGLE Metal): the debug page plays a stage with the real
// sim and two bots, then the split frame is checked on a thumbnail (pink sky on top, the dark divider in the
// middle, each view with its own drop). Skips when no playwright chromium is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleDebug, serve, chromiumPath, GPU_ARGS } from '../src/render/debug/shoot.mjs';

const exe = chromiumPath();

test('render debug page: split screen of a stage with two drops, then a stage swap, no errors', { skip: !exe && 'no chromium', timeout: 120000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const dir = mkdtempSync(join(tmpdir(), 'summit-render-test-'));
  await bundleDebug(dir);
  const server = await serve(dir);
  const browser = await chromium.launch({ executablePath: exe, args: GPU_ARGS });
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || /THREE\.WebGLProgram|Shader Error/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/debug.html?stage=2&view=split&t=10&seed=4&next=1`);
  await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 90000 });
  assert.deepEqual(errors, []);
  const [px, stats] = await page.evaluate(() => [window.__thumb, window.__stats]);
  const W = 192, H = 108, at = (x, y) => px.slice((y * W + x) * 4, (y * W + x) * 4 + 3);
  assert.equal(stats.views, 2);
  assert.ok(stats.treesDrawn.reduce((a, b) => a + b, 0) > 500, 'trees drawn');
  // divider: the middle columns are dark top to bottom, the ones 8 px away are not
  const mid = await page.evaluate(() => window.__mid);
  const lm = (x, y) => mid[(y * 16 + x) * 4] + mid[(y * 16 + x) * 4 + 1] + mid[(y * 16 + x) * 4 + 2];
  let dark = 0;
  for (let y = 0; y < H; y++) if (lm(7, y) < 90 && lm(8, y) < 90 && Math.max(lm(0, y), lm(15, y)) > 150) dark++;
  assert.ok(dark > H * 0.9, `divider ${dark}/${H}`);
  // each half has the pink-lavender sky at the top somewhere and is not a flat colour
  for (const x0 of [0, W / 2]) {
    let sky = 0, lo = 765, hi = 0;
    for (let y = 0; y < H; y++) for (let x = x0 + 3; x < x0 + W / 2 - 3; x++) {
      const [r, g, b] = at(x, y), s = r + g + b;
      lo = Math.min(lo, s); hi = Math.max(hi, s);
      if (y < 10 && r > 200 && r > g + 15 && b > g) sky++;
    }
    assert.ok(sky > 20, `sky pixels in the half at ${x0}: ${sky}`);
    assert.ok(hi - lo > 300, 'a real picture, not a cleared buffer');
  }
  // the right view follows the pink drop
  let pink = 0;
  for (let y = H / 2; y < H; y++) for (let x = W / 2 + 3; x < W; x++) { const [r, g, b] = at(x, y); if (r > 200 && g < 170 && b > 150 && r - g > 70) pink++; }
  assert.ok(pink > 8, `pink drop pixels ${pink}`);
  // then the next stage replaces this one in place (setStage), with the race carried over
  const swapped = await page.waitForFunction(() => window.__swapped, null, { timeout: 60000 }).then((h) => h.jsonValue());
  assert.equal(swapped.stage, 3);
  assert.ok(swapped.stats.trees > 1000 && swapped.stats.tris > 10000);
  // built beforehand in idle slices of a few ms, so the swap itself (under the cloud) is only a swap: it used to
  // build the stage there and then, a 1.5 s freeze in the middle of every cloud
  assert.ok(swapped.slices > 10, `${swapped.slices} idle slices`);
  assert.ok(swapped.sliceMax < 40, `longest idle slice ${swapped.sliceMax.toFixed(1)} ms`);
  assert.ok(swapped.swapMs < 50, `setStage took ${swapped.swapMs.toFixed(1)} ms`);
  assert.deepEqual(errors, []);
});
