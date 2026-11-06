// The mountain vote, end to end, as two players will play it (test/helpers/phones.mjs): the real server as
// its own process, the TV in headless chromium, two phones opened from the QR the TV draws (an iPhone in landscape in
// Italian, an Android in portrait in English), real CDP touches. Once both are in, the TV shows the seven mountains
// and each phone the same cards as a carousel: a swipe browses (the TV ring follows), a tap on the card or SCATTO
// votes (the TV pin). The same mountain on both starts it; two different ones spin a coin; a phone that goes away
// mid vote undoes the verdict and gets its place back. A mountain other than the one loaded reloads the TV on it and
// the race starts there with both phones. Screens: docs/screens/lobby-*.png (TV) and pad-*.png (phones); VOTE_SHOTS=0
// skips them. Ports 8210-8212 (this unit's own tonight). Skips without the playwright chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { translator } from '../src/i18n/index.js';
import { MOUNTAINS, RANDOM } from '../src/game/mountains.js';
import { headlessShell, launch, buildGame, startGame, launchPhones, openTV, shownPadUrl, openPhone, ROOT } from './helpers/phones.mjs';

const skip = !headlessShell() && 'no chromium';
const SHOTS = process.env.VOTE_SHOTS === '0' ? null : join(ROOT, 'docs/screens');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const it = translator('it'), en = translator('en');
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); };

let dist = null, tvBrowser = null, phones = null;
before(async () => {
  if (skip) return;
  dist = await buildGame();
  assert.equal(dist.warning, null, 'the game bundles from source');
  tvBrowser = await launch('metal');
  phones = await launchPhones();
});
after(async () => {
  const close = (b) => b && Promise.race([b.close(), sleep(3000)]);
  await close(phones);
  await close(tvBrowser);
});

async function waitFor(fn, what, timeout = 10000, every = 50) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out: ${what} (last ${JSON.stringify(last)})`);
}
const g = (tv) => tv.page.evaluate(() => JSON.parse(JSON.stringify(window.__game)));
const tvVote = async (tv) => (await g(tv)).vote;
const cardClass = (tv, id) => tv.page.evaluate((i) => document.querySelector(`.gallery .mcard[data-id="${i}"]`)?.className || null, id);
const padVote = (p) => p.peek(() => { const v = window.__pad.vote; return { shown: v.shown, focus: v.focus, ids: v.ids, phase: v.menu?.phase ?? null, ballot: v.menu?.ballot ?? null }; });

// A thumb on the card in front: a swipe of most of a card to the left (next) or right (back), or a tap on it.
async function swipe(p, dir) {
  const { focus } = await padVote(p);
  const r = await p.peek((id) => window.__pad.voteRect(id), focus);
  const f = await p.down(r.x, r.y);
  await p.slide(f, r.x - dir * r.w * 0.6, r.y + 4, { steps: 8, ms: 120 });
  await p.up(f);
}
async function browseTo(p, id) {
  for (let n = 0; n < 10; n++) {
    const v = await padVote(p);
    if (v.focus === id) return;
    await swipe(p, v.ids.indexOf(id) > v.ids.indexOf(v.focus) ? 1 : -1);
    await sleep(380);
  }
  throw new Error(`${p.label}: could not browse to ${id}`);
}
async function tapCard(p) {
  const { focus } = await padVote(p);
  const r = await p.peek((id) => window.__pad.voteRect(id), focus);
  const f = await p.down(r.x, r.y);
  await sleep(70);
  await p.up(f);
}

// The TV and the two phones in the lobby with the gallery up; resolves to { game, tv, blue, pink }.
async function lobby(t, port, { query = '' } = {}) {
  const game = await startGame({ port, dist, lanIp: '127.0.0.1' });
  t.after(() => game.close());
  const tv = await openTV(tvBrowser, game, { lang: 'en', query });
  t.after(() => tv.ctx.close());
  const { qr } = await shownPadUrl(tv);
  const blue = await openPhone(phones, qr, { device: 'iphone', orientation: 'landscape', locale: 'it-IT', label: 'blue', padId: `blue-${port}` });
  t.after(() => blue.close());
  const pink = await openPhone(phones, qr, { device: 'android', orientation: 'portrait', locale: 'en-US', label: 'pink', padId: `pink-${port}` });
  t.after(() => pink.close());
  assert.deepEqual([await blue.slot, await pink.slot], [0, 1]);
  await waitFor(() => tv.page.evaluate(() => document.querySelector('.lobby').classList.contains('voting') && document.querySelectorAll('.gallery .mcard').length === 8), 'the TV shows the gallery');
  await waitFor(async () => (await padVote(blue)).shown && (await padVote(pink)).shown, 'both phones show the carousel');
  return { game, tv, blue, pink };
}

test('both vote the same mountain: the TV follows the swipes, shows both pins, agrees, reloads on it and both race there', { skip, timeout: 180000 }, async (t) => {
  const { tv, blue, pink } = await lobby(t, 8210);
  // the gallery: seven real mountains and "surprise us", in gallery order, each with its numbers and three animals
  assert.deepEqual(await tv.page.$$eval('.gallery .mcard', (cs) => cs.map((c) => c.dataset.id)), [...MOUNTAINS, RANDOM]);
  assert.equal(await tv.page.textContent('.gallery .vt'), en('ui.vote.title'));
  assert.equal(await tv.page.textContent('.mcard[data-id="everest"] .nm'), 'Mount Everest');
  assert.equal(await tv.page.textContent('.mcard[data-id="everest"] .st-summit b'), '8,849 m');
  assert.equal(await tv.page.$$eval('.mcard[data-id="indonesia"] .fauna figcaption', (f) => f.map((x) => x.textContent).join(', ')), 'Sumatran tiger, Malayan tapir, Wreathed hornbill');
  assert.ok(await tv.page.evaluate(() => [...document.querySelectorAll('.gallery img')].every((i) => i.complete && i.naturalWidth > 0)), 'every painting and sticker loads');
  // each phone has the same list, in its own language, starting on the mountain on the TV
  const bv = await padVote(blue);
  assert.deepEqual(bv.ids, [...MOUNTAINS, RANDOM]);
  assert.equal(bv.focus, 'dolomiti');
  assert.equal(await blue.page.textContent('.vtop b'), it('pad.vote.title'));
  assert.equal(await pink.page.textContent('.vtop b'), en('pad.vote.title'));
  assert.equal(await blue.page.textContent('#banner'), it('pad.lobbyPress'));
  await shot(tv.page, 'lobby-vote-start');
  // blue swipes to the Antelao: the TV ring moves with it
  await swipe(blue, 1);
  await waitFor(async () => (await padVote(blue)).focus === 'antelao', 'blue browsed to the Antelao');
  await waitFor(async () => (await tvVote(tv)).focus[0] === 'antelao', 'the TV hears where blue is');
  assert.match(await cardClass(tv, 'antelao'), /\bf0\b/);
  // pink browses three cards on and back to the Antelao
  await browseTo(pink, 'carpazi');
  await waitFor(async () => /\bf1\b/.test(await cardClass(tv, 'carpazi')), 'the pink ring on the Carpathians');
  await shot(pink.page, 'pad-vote-browse-android-portrait');
  await browseTo(pink, 'antelao');
  // blue taps the card: its vote; pink presses SCATTO: its vote too
  await tapCard(blue);
  await waitFor(async () => (await tvVote(tv)).ballot[0] === 'antelao', 'blue voted the Antelao');
  assert.match(await cardClass(tv, 'antelao'), /\bb0\b/);
  await waitFor(async () => (await padVote(blue)).ballot === 'antelao', 'blue\'s phone marks its vote');
  assert.equal(await blue.page.textContent('#banner'), it('pad.lobbyReady'));
  await shot(blue.page, 'pad-vote-voted-iphone-landscape');
  await shot(tv.page, 'lobby-vote-one-voted');
  await pink.tapBoost();
  const v = await waitFor(async () => { const x = await tvVote(tv); return x.phase === 'agree' && x; }, 'they agree');
  assert.equal(v.pick, 'antelao');
  assert.equal(await tv.page.textContent('.verdict .vbig'), en('ui.vote.agree', { name: en('mountain.antelao') }));
  assert.match(await cardClass(tv, 'antelao'), /\bpicked\b/);
  await shot(tv.page, 'lobby-vote-agree');
  await waitFor(async () => /Antelao/.test(await pink.page.textContent('#verdict')), 'the phones say where they go');
  await shot(pink.page, 'pad-vote-agree-android-portrait');
  // the TV reloads on the Antelao and the race starts there with both phones, no bot
  await waitFor(() => tv.page.evaluate(() => /world=antelao/.test(location.search)).catch(() => false), 'the TV reloads on the Antelao', 15000);
  await tv.page.waitForSelector('#boot', { timeout: 5000 }).then(() => shot(tv.page, 'lobby-vote-loading')).catch(() => {}); // its summit while it loads
  const race = await waitFor(() => g(tv).then((x) => (x.phase === 'countdown' || x.phase === 'race') && x).catch(() => null), 'the race starts on the Antelao', 90000, 200);
  assert.equal(race.world, 'antelao');
  assert.deepEqual(race.bots, [false, false]);
  assert.deepEqual(race.layout, [0, 1]);
  await waitFor(async () => (await blue.state()).phase === 'race' && (await pink.state()).phase === 'race', 'both phones are racing');
  assert.equal((await padVote(blue)).shown, false, 'the carousel gives way to the stick');
  assert.deepEqual([...blue.errors, ...pink.errors, ...tv.errors], []);
});

test('two different mountains: a coin spins between the two on the TV and the phones, lands on one, and the race goes there', { skip, timeout: 180000 }, async (t) => {
  const { tv, blue, pink } = await lobby(t, 8211);
  await browseTo(blue, 'k2');
  await tapCard(blue);
  await browseTo(pink, 'everest');
  await pink.tapBoost();
  const v = await waitFor(async () => { const x = await tvVote(tv); return x.phase === 'roll' && x; }, 'the coin spins');
  assert.ok(['k2', 'everest'].includes(v.pick));
  assert.equal(await tv.page.textContent('.verdict .vbig'), en('ui.vote.roll'));
  // the spin passes over both cards and only those
  const seen = new Set();
  while (!(await tvVote(tv)).landed) {
    const s = await tv.page.evaluate(() => document.querySelector('.gallery .mcard.spin')?.dataset.id);
    if (s) seen.add(s);
    if (seen.size === 2 && !SHOTS) break;
    await sleep(40);
  }
  assert.deepEqual([...seen].sort(), ['everest', 'k2']);
  if (SHOTS) {
    await sleep(600); // the winner's card pops
    await shot(tv.page, 'lobby-vote-roll-landed');
    await shot(blue.page, 'pad-vote-roll-iphone-landscape');
  }
  const landed = await tvVote(tv);
  assert.equal(landed.spin, v.pick);
  const name = en(`mountain.${v.pick}`);
  await waitFor(async () => (await tv.page.textContent('.verdict .vbig')) === en('ui.vote.won', { name }), 'the TV says where it landed');
  assert.equal(await tv.page.textContent('.verdict .vsmall'), en(`ui.vote.won${landed.winner}`));
  const race = await waitFor(() => g(tv).then((x) => (x.phase === 'countdown' || x.phase === 'race') && x).catch(() => null), 'the race starts on the winner', 90000, 200);
  assert.equal(race.world, v.pick);
  assert.deepEqual(race.bots, [false, false]);
  assert.deepEqual([...blue.errors, ...pink.errors, ...tv.errors], []);
});

test('a phone that goes away mid vote: its vote goes, the verdict is undone, it gets its place back and votes again', { skip, timeout: 180000 }, async (t) => {
  const lob = await lobby(t, 8212);
  const { tv, blue } = lob;
  let { pink } = lob;
  await browseTo(blue, 'svizzera');
  await tapCard(blue);
  await browseTo(pink, 'indonesia');
  await pink.tapBoost();
  await waitFor(async () => (await tvVote(tv)).phase === 'roll', 'the coin spins');
  // pink's app is closed while the coin spins: the verdict is undone, blue keeps its vote
  await pink.close();
  const back = await waitFor(async () => { const x = await tvVote(tv); return x.phase === 'vote' && x; }, 'the vote reopens');
  assert.deepEqual(back.ballot, ['svizzera', null]);
  await waitFor(() => tv.page.evaluate(() => document.querySelector('.vp[data-slot="1"]').classList.contains('free')), 'the TV shows pink gone');
  assert.equal(await tv.page.textContent('.vp[data-slot="1"] span'), en('ui.vote.away'));
  assert.ok(await tv.page.evaluate(() => !document.querySelector('.vjoin').classList.contains('hide')), 'the QR comes back for the free place');
  await sleep(700); // the cards settle back from the verdict
  await shot(tv.page, 'lobby-vote-away');
  await sleep(2500);
  assert.equal((await g(tv)).phase, 'lobby', 'blue alone does not start a race by itself');
  // pink opens the controller again: same place, the carousel where it was, and this time they agree
  pink = await openPinkAgain(t, tv, 'pink-8212');
  assert.equal(await pink.slot, 1);
  await waitFor(async () => (await padVote(pink)).shown, 'pink sees the carousel again');
  assert.equal((await padVote(pink)).focus, 'indonesia', 'the card it was on when it left');
  assert.equal((await padVote(pink)).ballot, null, 'its vote went with it');
  await browseTo(pink, 'svizzera');
  await tapCard(pink);
  const v = await waitFor(async () => { const x = await tvVote(tv); return x.phase === 'agree' && x; }, 'they agree');
  assert.equal(v.pick, 'svizzera');
  const race = await waitFor(() => g(tv).then((x) => (x.phase === 'countdown' || x.phase === 'race') && x).catch(() => null), 'the race starts on the Matterhorn', 90000, 200);
  assert.equal(race.world, 'svizzera');
  assert.deepEqual(race.bots, [false, false]);
  assert.deepEqual([...blue.errors, ...tv.errors], []);
});

async function openPinkAgain(t, tv, padId) {
  const { qr } = await shownPadUrl(tv);
  const p = await openPhone(phones, qr, { device: 'android', orientation: 'portrait', locale: 'en-US', label: 'pink', padId });
  t.after(() => p.close());
  return p;
}
