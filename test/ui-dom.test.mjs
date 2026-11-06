// The host UI in headless Chromium, served by the real server (so /qr.svg is real): screens switch, slots light
// up, start, language and rematch events fire, the HUD formats per language, overlays come and go, and no screen
// shows a raw key or overflows. Skips when no playwright chromium is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromiumPath, previewServer, settle } from '../src/ui/tools/shoot.mjs';
import { SCENES, PAD_URL } from '../src/ui/tools/scenes.js';

const exe = chromiumPath();

test('host UI: screens, events, HUD, overlays, both languages', { skip: !exe && 'no chromium' }, async (t) => {
  const { chromium } = await import('playwright-core');
  const srv = await previewServer();
  const browser = await chromium.launch({ executablePath: exe });
  t.after(async () => { await browser.close(); await srv.close(); });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'it-IT' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${srv.base}/`);
  await page.evaluate(() => window.__ready);
  const txt = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
  const has = (sel, cls) => page.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
  const events = () => page.evaluate(() => window.__events.splice(0));

  // Language from navigator.language (it-IT here), no stored choice.
  assert.equal(await page.evaluate(() => window.__ui.lang), 'it');

  // Lobby with no phone: start disabled, both slots waiting.
  await page.evaluate((url) => window.__ui.show('lobby', { padUrl: url, stages: 4, slots: [{}, {}] }), PAD_URL);
  assert.equal(await page.evaluate(() => window.__ui.screen), 'lobby');
  assert.equal(await page.evaluate(() => document.querySelector('.lobby .start').disabled), true);
  assert.equal(await txt('.lobby .start b'), 'Collega un telefono per iniziare');
  assert.equal(await txt('.lobby .gname'), 'Summit Descent');
  assert.equal(await txt('.lobby .url'), '192.168.1.23:5190/pad');
  await page.click('.lobby .start', { force: true });
  assert.deepEqual(await events(), [], 'no start without phones');
  // The QR comes from the server for the exact pad URL.
  await page.waitForFunction(() => document.querySelector('.qr img').complete && document.querySelector('.qr img').naturalWidth > 0);
  assert.equal(await page.evaluate(() => new URL(document.querySelector('.qr img').src).searchParams.get('u')), PAD_URL);

  // Blue joins: its slot lights up, start becomes possible; pink went away and keeps its place.
  await page.evaluate((url) => window.__ui.show('lobby', { padUrl: url, stages: 4, slots: [{ connected: true }, { away: true }] }), PAD_URL);
  assert.ok(await has('.slot[data-slot="0"]', 'on'));
  assert.ok(await has('.slot[data-slot="0"]', 'joined'));
  assert.ok(await has('.slot[data-slot="1"]', 'away'));
  assert.equal(await txt('.slot[data-slot="0"] .st'), 'Pronta a scendere');
  assert.equal(await txt('.slot[data-slot="1"] .st'), 'Telefono scollegato');
  assert.equal(await txt('.slot[data-slot="0"] .name'), 'Goccia azzurra');
  // Real mode is shown but cannot be chosen; start sends the short mode.
  await page.click('.mode[data-mode="real"]', { force: true });
  assert.ok(await has('.mode[data-mode="short"]', 'sel'));
  assert.equal(await txt('.mode[data-mode="real"] .ribbon'), 'In arrivo');
  await page.click('.lobby .start', { force: true }); // it breathes, so it is never 'stable'
  assert.deepEqual(await events(), [['start', { mode: 'short' }]]);

  // Language toggle on the host: every string switches, the event carries the new language.
  await page.click('.langs button[data-lang="en"]');
  assert.deepEqual(await events(), [['lang', 'en']]);
  assert.equal(await page.evaluate(() => window.__ui.lang), 'en');
  assert.equal(await txt('.lobby .start b'), 'Start the race');
  assert.equal(await txt('.slot[data-slot="0"] .name'), 'Blue drop');
  assert.equal(await txt('.mode[data-mode="short"] span'), '4 steep stages, 3 to 5 minutes');
  assert.ok(await has('.langs button[data-lang="en"]', 'on'));
  await page.click('.langs button[data-lang="en"]');
  assert.deepEqual(await events(), [], 'clicking the current language is a no-op');

  // The start shot's title in both halves (the mountain, the first stage), no number yet; then the countdown.
  await page.evaluate(() => window.__ui.show('countdown', { n: 3, slots: [0, 1], title: { world: 'dolomiti', name: { en: 'Summit', it: 'Vetta' }, stage: 1, stages: 4 } }));
  assert.equal(await page.evaluate(() => window.__ui.screen), 'countdown');
  assert.deepEqual(await page.$$eval('.half:not(.off) .cd .ti b', (ns) => ns.map((n) => n.textContent)), ['Dolomites · Monte Peralba', 'Dolomites · Monte Peralba']);
  assert.equal(await txt('.half[data-slot="0"] .cd .ti span'), 'Summit');
  assert.equal(await txt('.half[data-slot="0"] .cd .ti small'), 'Stage 1 of 4');
  assert.ok(await has('.half[data-slot="0"] .cd .n', 'hide'), 'no number under the title');
  // Countdown in both halves, then the race HUD.
  await page.evaluate(() => window.__ui.show('countdown', { n: 3, slots: [0, 1] }));
  assert.ok(await has('.half[data-slot="0"] .cd .ti', 'hide'), 'the title gives way to the numbers');
  assert.equal(await page.evaluate(() => window.__ui.screen), 'countdown');
  assert.deepEqual(await page.$$eval('.half:not(.off) .cd .n', (ns) => ns.map((n) => n.textContent)), ['3', '3']);
  await page.evaluate(() => window.__ui.show('countdown', { n: 0 }));
  assert.equal(await txt('.half[data-slot="0"] .cd .n'), 'GO!');
  await page.evaluate(() => window.__ui.show('race'));
  await page.evaluate(() => window.__ui.hud(0, { place: 1, mass: 1.4, altitude: 2431.2, stage: 1, stages: 4 }));
  await page.evaluate(() => window.__ui.hud(1, { place: 2, mass: 4, altitude: 1088, stage: 3, stages: 4 }));
  assert.equal(await txt('.half[data-slot="0"] .place'), '1st');
  assert.equal(await txt('.half[data-slot="1"] .place'), '2nd');
  assert.equal(await txt('.half[data-slot="0"] .alt'), '2,431 m');
  assert.equal(await txt('.half[data-slot="1"] .stg'), 'Stage 3/4');
  const level = (s) => page.evaluate((x) => Number(document.querySelector(`.half[data-slot="${x}"] .lvl`).getAttribute('y')), s);
  assert.equal(await level(0), 44);
  assert.equal(await level(1), 4);
  // Fields merge: a mass-only update keeps the place.
  await page.evaluate(() => window.__ui.hud(0, { mass: 0.7 }));
  assert.equal(await level(0), 64);
  assert.equal(await txt('.half[data-slot="0"] .place'), '1st');
  // setLang re-renders the HUD in Italian.
  await page.evaluate(() => window.__ui.setLang('it'));
  assert.equal(await txt('.half[data-slot="0"] .place'), '1°');
  assert.equal(await txt('.half[data-slot="0"] .alt'), '2.431 m');
  assert.equal(await txt('.half[data-slot="1"] .stg'), 'Tappa 3/4');
  assert.deepEqual(await events(), [], 'setLang from code does not echo onLang');

  // One phone: the view takes the whole screen.
  await page.evaluate(() => window.__ui.show('race', { slots: [1] }));
  assert.ok(await page.evaluate(() => document.querySelector('.sd-ui').classList.contains('solo')));
  assert.ok(await has('.half[data-slot="0"]', 'off'));
  assert.equal(await page.evaluate(() => document.querySelector('.half[data-slot="1"]').getBoundingClientRect().width), 1920);
  await page.evaluate(() => window.__ui.show('race', { slots: [0, 1] }));
  assert.equal(await page.evaluate(() => document.querySelector('.half[data-slot="1"]').getBoundingClientRect().left), 960);

  // Per-half overlays: the cloud on blue only, finished on pink, then the main screen change clears them.
  await page.evaluate(() => window.__ui.show('stage', { slot: 0, stage: 2, stages: 4, name: { en: 'Upper Val Sesis', it: 'Alta Val Sesis' } }));
  assert.equal(await txt('.half[data-slot="0"] .stage .mid'), 'Ricadi in pioggia sulla tappa 2');
  assert.equal(await txt('.half[data-slot="0"] .stage .sn'), 'Alta Val Sesis');
  assert.ok(await has('.half[data-slot="1"] .stage', 'hide'));
  await page.evaluate(() => window.__ui.show('finished', { slot: 1, place: 1, time: 222.18, where: { it: 'Ghiacciaio Godwin-Austen', en: 'Godwin-Austen Glacier' } }));
  assert.match(await txt('.half[data-slot="1"] .finished'), /Traguardo!.*Ghiacciaio Godwin-Austen.*1°.*3:42,18/s, 'the finish line, where it is on the real mountain');
  // the stage and finish cards sit in the top half, clear of the drop the camera keeps in the lower half
  for (const sel of ['.half[data-slot="0"] .stage .sc', '.half[data-slot="1"] .finished .fc']) {
    const r = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), sel);
    assert.ok(r.bottom < 1080 * 0.45, `${sel} ends at ${r.bottom}`);
  }
  // the gap while the trailer is still racing is the time since the leader finished, said as such
  await page.evaluate(() => { window.__ui.show('gap', { slot: 0, s: 5.5, ahead: true, pending: true }); window.__ui.show('gap', { slot: 1, s: 5.5, pending: true }); });
  assert.equal(await txt('.half[data-slot="0"] .gap'), 'Aspettiamo la goccia rosa · 5,5 s');
  assert.equal(await txt('.half[data-slot="1"] .gap'), 'La goccia azzurra è arrivata 5,5 s fa');
  await page.evaluate(() => window.__ui.show('gap', { slot: 0, s: 8.5, ahead: true }));
  assert.equal(await txt('.half[data-slot="0"] .gap'), '+8,5 s di vantaggio');
  await page.evaluate(() => window.__ui.hide('gap'));
  await page.evaluate(() => window.__ui.hide('stage', { slot: 0 }));
  assert.ok(await has('.half[data-slot="0"] .stage', 'hide'));

  // Waiting banner for a disconnected phone, and the room-full toast that hides itself.
  await page.evaluate(() => window.__ui.show('waiting', { slot: 1 }));
  assert.equal(await txt('.half[data-slot="1"] .waiting b'), 'In attesa della goccia rosa');
  assert.ok(await has('.half[data-slot="1"]', 'paused'));
  await page.evaluate(() => window.__ui.hide('waiting', { slot: 1 }));
  assert.ok(await has('.half[data-slot="1"] .waiting', 'hide'));
  assert.ok(!(await has('.half[data-slot="1"]', 'paused')));
  await page.evaluate(() => window.__ui.show('full', { ms: 150 }));
  assert.equal(await txt('.toast b'), 'La stanza è piena');
  await page.waitForFunction(() => document.querySelector('.toast').classList.contains('hide'));

  // Results: podium order by place, animals that drank, rematch.
  await page.evaluate(() => window.__ui.show('results', { players: [
    { slot: 0, place: 2, time: 240, drank: { marmot: 2, lynx: 1 } },
    { slot: 1, place: 1, time: 230.5, drank: {} },
  ], art: 'backdrops/split.jpg' }));
  // the summit painting of the mountain behind the podium
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.results')).backgroundImage), /backdrops\/split\.jpg/);
  assert.ok(await has('.half[data-slot="1"] .finished', 'hide'), 'finished overlay cleared');
  assert.deepEqual(await page.$$eval('.res', (cs) => cs.map((c) => c.dataset.slot)), ['1', '0']);
  assert.equal(await txt('.res[data-slot="1"] .time b'), '3:50,50');
  assert.equal(await txt('.res[data-slot="1"] .nobody span'), 'Nessuno ti ha bevuto');
  assert.match(await txt('.res[data-slot="0"] .critter'), /×2\s*Marmotta alpina/);
  assert.equal(await page.$$eval('.res[data-slot="0"] .critter img.sticker', (xs) => xs.length), 1, 'a species without a drawn badge shows its sticker');
  assert.equal(await txt('.res[data-slot="0"] .time .behind'), '+0:09,50', 'behind the winner');
  assert.equal(await txt('.results .start span'), 'oppure tocca SCATTO su entrambi i telefoni', 'two phones: both tap');
  // the stages with their names and splits, the peak mass, and who tapped for the rematch
  await page.evaluate(() => window.__ui.show('results', { players: [
    { slot: 0, place: 2, time: 140.3, peak: 1.94, stageTimes: [42.6, 95.2, 140.3], drank: {} },
    { slot: 1, place: 1, time: 131.06, peak: 2.6, stageTimes: [40.1, 88.7, 131.06], drank: {} },
  ], stageNames: [{ it: 'Spalla', en: 'Shoulder' }, { it: 'Parete sud-est', en: 'South-east face' }, { it: 'Piede della parete', en: 'Foot of the face' }], ready: [false, true] }));
  assert.deepEqual(await page.$$eval('.res[data-slot="0"] .srow', (rs) => rs.map((r) => r.textContent)), ['1Spalla+2,50:42,60', '2Parete sud-est+4,00:52,60', '3Piede della parete+2,70:45,10']);
  assert.equal(await txt('.res[data-slot="1"] .peak b'), '2,6');
  assert.ok(await has('.res[data-slot="1"]', 'ready'));
  assert.ok(!(await has('.res[data-slot="0"]', 'ready')));
  assert.equal(await txt('.results .start span'), 'La goccia rosa è pronta, aspettiamo l\'azzurra');
  await page.click('.results .start', { force: true });
  assert.deepEqual(await events(), [['rematch']]);
  await page.evaluate(() => window.__ui.toggleLang());
  assert.deepEqual(await events(), [['lang', 'en']]);
  assert.equal(await txt('.results h1'), 'Race over');

  await assert.rejects(page.evaluate(() => window.__ui.show('nope')), /unknown screen nope/);
  assert.deepEqual(errors, []);
});

test('every scene in both languages: no raw keys, nothing overflows its box', { skip: !exe && 'no chromium' }, async (t) => {
  const { chromium } = await import('playwright-core');
  const srv = await previewServer();
  const browser = await chromium.launch({ executablePath: exe });
  t.after(async () => { await browser.close(); await srv.close(); });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const texts = { en: new Map(), it: new Map() };
  for (const lang of ['en', 'it']) {
    for (const scene of SCENES) {
      await page.goto(`${srv.base}/?lang=${lang}&bg=none`);
      await page.evaluate(() => window.__ready);
      await page.evaluate(`(${scene.run.toString()})(window.__ui, ${JSON.stringify(PAD_URL)})`);
      await settle(page);
      const report = await page.evaluate(() => {
        const root = document.querySelector('.sd-ui');
        const visible = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
        const text = [...root.querySelectorAll('*')].filter((e) => visible(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .map((e) => e.textContent.trim()).join(' | ');
        const boxes = ['.slot', '.join', '.mode', '.start', '.res', '.toast', '.waiting', '.langs', '.world', '.half:not(.off)'];
        const over = [];
        for (const sel of boxes) {
          for (const box of root.querySelectorAll(sel)) {
            if (!visible(box)) continue;
            const b = box.getBoundingClientRect();
            if (b.right > innerWidth + 1 || b.bottom > innerHeight + 1 || b.left < -1) over.push(`${sel} off screen`);
            for (const e of box.querySelectorAll('*')) {
              if (!visible(e) || e.closest('svg') || e.classList.contains('ribbon')) continue;
              const r = e.getBoundingClientRect();
              if (r.width && (r.right > b.right + 1 || r.left < b.left - 1 || r.bottom > b.bottom + 1)) over.push(`${sel} > ${e.className || e.tagName}: ${e.textContent.trim().slice(0, 40)}`);
            }
          }
        }
        // the vote cards' name and region line are cut with an ellipsis when too long: none may be
        for (const e of root.querySelectorAll('.mcard .nm, .mcard .rg span')) if (visible(e) && e.scrollWidth > e.clientWidth + 1) over.push(`truncated: ${e.textContent}`);
        return { text, over };
      });
      assert.doesNotMatch(report.text, /\b(ui|pad|animal|world|game)\.[a-z]/, `${scene.name} ${lang}: raw key`);
      assert.doesNotMatch(report.text, /\{\w+\}/, `${scene.name} ${lang}: unfilled placeholder`);
      assert.deepEqual(report.over, [], `${scene.name} ${lang}: overflow`);
      texts[lang].set(scene.name, report.text);
    }
  }
  for (const scene of SCENES) {
    if (scene.name === 'countdown') continue; // 3 is 3 in both
    assert.notEqual(texts.en.get(scene.name), texts.it.get(scene.name), `${scene.name} differs between languages`);
  }
  assert.deepEqual(errors, []);
});
