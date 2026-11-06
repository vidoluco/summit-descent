// Screenshots of every host screen at 1920x1080 in both languages: docs/screens/ui-<scene>-<lang>.png.
// Builds the preview page, serves it with the real server (so /qr.svg is the real QR) and drives src/ui in
// headless Chromium. Usage: node src/ui/tools/shoot.mjs [scene ...]
import { mkdtempSync, copyFileSync, cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { startServer } from '../../../server/testing.js';
import { SCENES, PAD_URL } from './scenes.js';
import { LANGS } from '../../i18n/index.js';
import { makeCards } from '../../../tools/cards.mjs';

export function chromiumPath() {
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

// The preview page in a temporary dist, served by the game server.
export async function previewServer() {
  const dist = mkdtempSync(join(tmpdir(), 'summit-descent-ui-'));
  await build({ entryPoints: ['src/ui/tools/preview.js'], bundle: true, format: 'esm', outfile: join(dist, 'preview.js'), logLevel: 'warning' });
  copyFileSync('src/ui/tools/preview.html', join(dist, 'index.html'));
  mkdirSync(join(dist, 'backdrops'));
  cpSync('src/ui/tools/backdrops', join(dist, 'backdrops'), { recursive: true });
  // the mountain vote's cards: the baked index, the card paintings and the animal stickers
  mkdirSync(join(dist, 'data/worlds'), { recursive: true });
  copyFileSync('data/worlds/index.json', join(dist, 'data/worlds/index.json'));
  makeCards('assets/backdrops', join(dist, 'assets/backdrops/cards'));
  if (existsSync('assets/ui')) cpSync('assets/ui', join(dist, 'assets/ui'), { recursive: true });
  return startServer({ distDir: dist });
}

// Freezes animations on a readable frame: finite ones at their end (GO at its peak), loops at their start.
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const timing = a.effect.getComputedTiming();
      a.pause();
      if (a.effect.target?.classList?.contains('go')) a.currentTime = timing.duration * 0.55;
      else if (timing.iterations === Infinity) a.currentTime = 0;
      else a.currentTime = timing.endTime;
    }
  });
  await page.waitForTimeout(50);
}

async function main() {
  const only = process.argv.slice(2);
  const exe = chromiumPath();
  const srv = await previewServer();
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  mkdirSync('docs/screens', { recursive: true });
  for (const lang of LANGS) {
    for (const scene of SCENES) {
      if (only.length && !only.includes(scene.name)) continue;
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => console.log(`[${scene.name}] pageerror: ${e.message}`));
      await page.goto(`${srv.base}/?lang=${lang}&bg=${scene.bg}`);
      await page.evaluate(() => window.__ready);
      await page.evaluate(`(${scene.run.toString()})(window.__ui, ${JSON.stringify(PAD_URL)})`);
      await page.waitForLoadState('networkidle');
      await settle(page);
      const out = `docs/screens/ui-${scene.name}-${lang}.png`;
      await page.screenshot({ path: out });
      console.log(out);
      await page.close();
    }
  }
  await browser.close();
  await srv.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
