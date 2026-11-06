// The thumbs the end to end race drives (tools/perf/harness.mjs drivePads) on the real pad page, without the game:
// a scripted plan stands in for the host's bot advisor. CDP touch has a trap the driver must step around: a
// touchEnd lifts exactly the points it lists (an empty list lifts every finger), and a touchMove that leaves a
// point out does not lift it. So a BOOST tap must lift BOOST alone while the stick stays held where the plan
// steers; get it wrong and BOOST stays down forever (the drops freeze on the ice) or the stick drops to zero.
// Skips without the playwright chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { startServer, host, sleep } from '../server/testing.js';
import { ROOT, headlessShell, openPad, drivePads, tapBoost } from '../tools/perf/harness.mjs';

const exe = headlessShell();

test('drivePads: the stick follows the plan, a BOOST tap lifts BOOST alone, stop() lifts every finger', { skip: !exe && 'no chromium' }, async (t) => {
  const { chromium } = await import('playwright-core');
  const dist = mkdtempSync(join(tmpdir(), 'summit-descent-drive-'));
  copyFileSync(join(ROOT, 'controller/pad.html'), join(dist, 'pad.html'));
  await build({ entryPoints: [join(ROOT, 'controller/pad.js')], bundle: true, format: 'esm', outfile: join(dist, 'pad.js'), logLevel: 'warning' });
  const srv = await startServer({ distDir: dist });
  const browser = await chromium.launch({ executablePath: exe });
  t.after(async () => { await browser.close(); await srv.close(); });
  await host(srv);
  const p = await openPad(browser, srv.base, { label: 'pad0' });

  // what the pad page reads from the thumbs right now
  const pad = () => p.page.evaluate(() => ({ ...window.__pad.state }));
  const near = (s, x, y) => Math.abs(s.x - x) < 0.02 && Math.abs(s.y - y) < 0.02;
  const reach = (fn, arg, what) => p.page.waitForFunction(fn, arg, { timeout: 3000, polling: 20 }).catch(async () => { throw new Error(`${what}: pad ${JSON.stringify(await pad())}`); });
  const stickAt = ([x, y, b]) => { const s = window.__pad.state; return Math.abs(s.x - x) < 0.02 && Math.abs(s.y - y) < 0.02 && s.b === b; };

  let plan = { x: 0.6, y: 0.4, boost: false };
  const logs = [];
  const drive = drivePads({ evaluate: async () => [plan] }, [p], { log: (l) => logs.push(l) });
  t.after(() => drive.stop());
  await reach(stickAt, [0.6, 0.4, 0], 'the stick is held where the plan steers');

  // one BOOST tap: down on one tick, up on the next, and the stick never lets go
  plan = { ...plan, boost: true };
  await reach(stickAt, [0.6, 0.4, 1], 'BOOST goes down with the stick held');
  plan = { ...plan, boost: false };
  await reach(stickAt, [0.6, 0.4, 0], 'BOOST lifts, the stick stays');
  await sleep(300); // several ticks later nothing came loose
  let s = await pad();
  assert.ok(near(s, 0.6, 0.4) && s.b === 0, `after the tap: ${JSON.stringify(s)}`);

  // the stick still answers the plan after the tap (its finger was not lifted and put down again elsewhere)
  plan = { x: -0.5, y: 0.2, boost: false };
  await reach(stickAt, [-0.5, 0.2, 0], 'the stick follows a new plan after the tap');

  // BOOST held in the plan is tapped again and again, never stuck
  plan = { ...plan, boost: true };
  await reach(stickAt, [-0.5, 0.2, 1], 'BOOST down again');
  await reach(stickAt, [-0.5, 0.2, 0], 'and up again while the plan still boosts');
  plan = { ...plan, boost: false };
  await sleep(200);

  // stop(): every finger off the glass
  const ticks = drive.ticks;
  await drive.stop();
  await reach(() => { const q = window.__pad.state; return q.x === 0 && q.y === 0 && q.b === 0; }, null, 'stop() lifts the stick and BOOST');
  assert.ok(ticks > 10, `drive ticks ${ticks}`);

  // the lobby tap the race starts with: down, up, nothing left held
  await tapBoost(p);
  await sleep(100);
  s = await pad();
  assert.deepEqual([s.x, s.y, s.b], [0, 0, 0], 'a BOOST tap leaves nothing held');

  assert.deepEqual(logs, [], 'the driver sent every touch without a protocol error');
  assert.deepEqual(p.errors, [], 'no page or console errors');
});
