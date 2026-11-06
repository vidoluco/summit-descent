// Plays the real game in headless Chromium on the Mac's GPU, served by the real server from dist/, and saves
// screenshots of the flow: docs/screens/game-<name>.png.
//   node src/game/tools/shoot.mjs                 lobby, then a ?bots=2 race to the valley floor at speed 4:
//                                                 countdown, each stage, the cloud (evaporate, flight, swap, rain), finish, results
//   node src/game/tools/shoot.mjs --pads          two scripted phones over WebSocket: lobby with both slots, an animal drinking
//   node src/game/tools/shoot.mjs 'stage=2&speed=2'   extra URL params for the race
// Build first (node build.mjs). OUT=dir overrides docs/screens.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from '../../../server/index.js';
import { chromiumPath, GPU_ARGS } from '../../render/debug/shoot.mjs';
import { connectPad, scriptedPads } from './pads.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = process.env.OUT || join(ROOT, 'docs/screens');
const args = process.argv.slice(2);
const extra = args.find((a) => !a.startsWith('--')) || '';

export async function startGame({ distDir = join(ROOT, 'dist') } = {}) {
  const srv = createServer({ port: 0, host: '127.0.0.1', distDir });
  await srv.listen();
  srv.base = `http://127.0.0.1:${srv.port}`;
  return srv;
}

export async function openHost(browser, url, { log = () => {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-US' });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); log(`pageerror: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { log(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); } });
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.ready || window.__game?.error, null, { timeout: 120000 });
  return { page, errors };
}

export const game = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game)));

// waits until pred(window.__game) is true; pred is a string of JS over `g`
export async function until(page, pred, timeout = 240000) {
  await page.waitForFunction(`(() => { const g = window.__game; return !!g && (g.error || (${pred})); })()`, null, { timeout, polling: 50 });
  const g = await game(page);
  if (g.error) throw new Error(`game error: ${g.error}`);
  return g;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const srv = await startGame();
  const browser = await chromium.launch({ executablePath: chromiumPath() || undefined, args: GPU_ARGS });
  const log = (m) => console.log(m);
  const shot = async (page, name) => { const f = join(OUT, `game-${name}.png`); await page.screenshot({ path: f }); const g = await game(page); console.log(`${f}  phase ${g.phase} stage ${g.stage} t ${g.t.toFixed(1)} fps ${g.fps} cpu ${g.frameMs} ms`); };
  try {
    // lobby
    const lobby = await openHost(browser, `${srv.base}/`, { log });
    await lobby.page.waitForTimeout(2500);
    await shot(lobby.page, 'lobby');
    await lobby.page.close();
    if (args.includes('--pads')) {
      // two scripted phones: the lobby with both slots lit, then the pink one dawdles by an animal until it drinks
      const wsBase = `ws://127.0.0.1:${srv.port}/ws`;
      const pre = [await connectPad(wsBase, 'scripted-pad-0'), await connectPad(wsBase, 'scripted-pad-1')];
      const ready = await openHost(browser, `${srv.base}/`, { log });
      await ready.page.waitForTimeout(2500);
      await shot(ready.page, 'lobby-ready');
      await ready.page.close();
      // whether an animal comes to drink depends on how the phones' timing plays out, so up to three races
      let page = null, pads = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        ({ page } = await openHost(browser, `${srv.base}/?autostart&speed=2&seed=${attempt}&${extra}`, { log }));
        pads = await scriptedPads(page, wsBase, { pads: pre, dawdle: [1], drinks: 3 });
        const ok = await until(page, "(g.events.drink || 0) >= 1 || g.phase === 'results'", 200000).then((g) => g.events.drink >= 1, () => false);
        if (ok) break;
        console.log(`race ${attempt}: no animal drank, another race`);
        pads.halt();
        await page.close();
        if (attempt === 3) throw new Error('no animal drank in three races');
      }
      // the moment the drinking animal stands well inside its drop's view, near enough to read (it can also
      // stand beside the chase camera or under the HUD)
      await page.waitForFunction(() => {
        const g = window.__game, v = g.view;
        return v.animals.animals.some((a) => {
          if (a.mode !== 'drink') return false;
          const s = g.animals.find((b) => Math.hypot(b.x - a.x, b.z - a.z) < 0.5)?.target ?? 1;
          const cam = v.renderer.cameras[s], q = cam.position.clone().set(a.x, a.y + 0.4, a.z).project(cam);
          const d = Math.hypot(cam.position.x - a.x, cam.position.z - a.z);
          return Math.abs(q.x) < 0.8 && q.y > -0.7 && q.y < 0.7 && q.z < 1 && d < 16;
        });
      }, null, { timeout: 20000, polling: 50 }).catch(() => console.log('no drinking animal well in view, shooting anyway'));
      await shot(page, 'drink');
      console.log(`pad 1 got fx: ${pads.pads[1].inbox.filter((m) => m.t === 'fx').map((m) => m.kind).join(' ')}`);
      pads.stop();
    } else {
      // a bot race to the valley floor
      const speed = Number(new URLSearchParams(extra).get('speed') || 4);
      const { page } = await openHost(browser, `${srv.base}/?bots=2&autostart&speed=${speed}&${extra}`, { log });
      await until(page, "g.phase === 'countdown' && g.t > 1.2");
      await shot(page, 'countdown');
      const n = (await game(page)).stages;
      const first = (await game(page)).stage;
      for (let k = first; k < n; k++) {
        await until(page, `g.phase === 'race' && g.stage === ${k} && g.players.every((p) => p.status === 'rolling') && g.t > ${k === first ? 12 : 0}`);
        await page.waitForTimeout(2500);
        await shot(page, `stage${k + 1}`);
        if (k === n - 1) break;
        // real time around the cloud, so every moment of it is on screen when the shot is taken
        await until(page, 'g.players.some((p) => p.status === "finished")');
        await page.evaluate(() => window.__game.setSpeed(1));
        await until(page, "g.phase === 'cloud' && g.cloud.t > -0.6");
        await shot(page, `cloud${k + 1}-evaporate`);
        await until(page, "g.phase === 'cloud' && g.cloud.t > 0.8");
        await shot(page, `cloud${k + 1}-flight`);
        await until(page, "g.phase === 'cloud' && g.cloud.swapped && g.cloud.t > 2.6");
        await shot(page, `cloud${k + 1}-descent`);
        await until(page, `g.phase === 'race' && g.stage === ${k + 1}`);
        await page.waitForTimeout(400);
        await shot(page, `cloud${k + 1}-rain`);
        await page.evaluate((v) => window.__game.setSpeed(v), speed);
      }
      await until(page, "g.players.some((p) => p.finished)");
      await page.waitForTimeout(400);
      await shot(page, 'finish');
      await until(page, "g.phase === 'results'");
      await page.waitForTimeout(800);
      await shot(page, 'results');
      console.log(JSON.stringify((await game(page)).results));
    }
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
    await srv.close();
  }
  process.exit(0);
}
