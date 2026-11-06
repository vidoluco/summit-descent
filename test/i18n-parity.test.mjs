// The single bilingual dictionary: same keys in en.js and it.js, the keys the host UI and the pad use exist,
// Italian keeps its accents, the game name stays "Summit Descent", and the locale helpers format per language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  en, it, LANGS, DICTS, LANG_KEY, pickLang, detectLang, saveLang, nextLang, translator, ordinal,
  formatAltitude, formatTime, pickLabel,
} from '../src/i18n/index.js';
import * as padI18n from '../controller/i18n.js';
import { ANIMAL_KINDS } from '../src/ui/icons.js';
import { MOUNTAINS } from '../src/game/mountains.js';

test('en and it have exactly the same keys, all non-empty strings, no em dash', () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const [lang, d] of Object.entries(DICTS)) {
    for (const [k, v] of Object.entries(d)) {
      assert.ok(typeof v === 'string' && v.trim(), `${lang} ${k} empty`);
      assert.ok(!v.includes('—'), `${lang} ${k} has an em dash`);
    }
  }
  assert.deepEqual(LANGS, ['en', 'it']);
});

test('placeholders match between languages', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(en)) assert.deepEqual(vars(it[k]), vars(en[k]), k);
});

test('the game is called Summit Descent in both languages, nowhere Summit to Sea', () => {
  assert.equal(en['game.name'], 'Summit Descent');
  assert.equal(it['game.name'], 'Summit Descent');
  for (const d of [en, it]) for (const v of Object.values(d)) assert.ok(!/summit to sea/i.test(v), v);
  assert.match(en['pad.title'], /^Summit Descent/);
  assert.match(it['pad.title'], /^Summit Descent/);
});

test('Italian uses real accents, never a vowel plus apostrophe', () => {
  for (const [k, v] of Object.entries(it)) assert.doesNotMatch(v, /[aeiouAEIOU]'(?=[\s.,;:!?)]|$)/, `${k}: ${v}`);
  assert.match(it['ui.mode.title'], /Modalità/);
  assert.match(it['ui.full.title'], /è piena/);
  assert.match(it['ui.full.text'], /già/);
});

test('Italian is actually translated: only symbols and proper names are shared', () => {
  const same = Object.keys(en).filter((k) => en[k] === it[k]).sort();
  // the species and the countries whose name is the same word in both languages
  const names = ['animal.pika', 'animal.yak', 'country.ID', 'country.NP', 'country.PK', 'country.RO', 'region.indonesia', 'region.k2', 'ui.vote.about', 'ui.vote.where'];
  assert.deepEqual(same, ['game.name', 'pad.brand', 'pad.title', 'ui.hud.altitude', 'ui.lang.en', 'ui.lang.it', 'ui.results.behind', 'ui.results.times', ...names].sort());
});

test('every key the host UI uses exists, including the computed ones', () => {
  const src = readFileSync('src/ui/index.js', 'utf8');
  const literal = [...src.matchAll(/\btr\('([a-z][\w.]*)'/g)].map((m) => m[1]);
  const ternary = [...src.matchAll(/tr\([^)]*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)].flatMap((m) => [m[1], m[2]]);
  const nested = [...src.matchAll(/:\s*info\.away\s*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)].flatMap((m) => [m[1], m[2]]);
  const computed = [0, 1].flatMap((s) => [`ui.slot.name${s}`, `ui.waiting${s}`])
    .concat(LANGS.map((l) => `ui.lang.${l}`), ANIMAL_KINDS.map((a) => `animal.${a}`), ['world.dolomiti', 'world.dolomiti.sub']);
  const used = new Set([...literal, ...ternary, ...nested, ...computed]);
  assert.ok(used.size > 40, `found ${used.size} keys`);
  for (const k of used) assert.ok(k in en, `missing ${k}`);
});

test('every animal the Dolomiti world can spawn has a name and an icon', () => {
  const world = JSON.parse(readFileSync('data/worlds/dolomiti/world.json', 'utf8'));
  const kinds = new Set(world.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)));
  for (const k of ['ibex', 'marmot', 'hare', 'chough', 'chamois', 'eagle', 'cow']) kinds.add(k); // docs/world-format.md list
  for (const k of kinds) {
    assert.ok(ANIMAL_KINDS.includes(k), `icon for ${k}`);
    assert.ok(en[`animal.${k}`] && it[`animal.${k}`], `name for ${k}`);
  }
});

test('the pad reads the same dictionary: controller/i18n.js re-exports src/i18n, pad.js imports it', () => {
  assert.equal(padI18n.en, en);
  assert.equal(padI18n.it, it);
  assert.equal(padI18n.translator, translator);
  assert.match(readFileSync('controller/pad.js', 'utf8'), /from '\.\.\/src\/i18n\/index\.js'/);
});

test('start language: stored choice, else navigator.language it* -> Italian, else English', () => {
  const mem = (v) => { const m = new Map(v ? [[LANG_KEY, v]] : []); return { getItem: (k) => m.get(k) ?? null, setItem: (k, x) => m.set(k, x) }; };
  assert.equal(detectLang(mem(null), { language: 'it-IT' }), 'it');
  assert.equal(detectLang(mem(null), { language: 'en-US' }), 'en');
  assert.equal(detectLang(mem(null), { language: 'ro-RO' }), 'en');
  assert.equal(detectLang(mem('en'), { language: 'it-IT' }), 'en');
  assert.equal(detectLang(mem('de'), { language: 'it' }), 'it');
  assert.equal(detectLang({ getItem() { throw new Error('blocked'); } }, { language: 'it-CH' }), 'it');
  assert.equal(detectLang(undefined, undefined), 'en');
  const s = mem(null);
  saveLang('it', s);
  assert.equal(detectLang(s, { language: 'en' }), 'it');
  assert.doesNotThrow(() => saveLang('it', { setItem() { throw new Error('quota'); } }));
  assert.equal(pickLang(null, 'IT-it'), 'it');
  assert.equal(nextLang('en'), 'it');
  assert.equal(nextLang('it'), 'en');
});

test('translator fills placeholders and falls back to English, then to the key', () => {
  assert.equal(translator('it')('ui.stage.rain', { n: 2 }), 'Ricadi in pioggia sulla tappa 2');
  assert.equal(translator('en')('ui.stage.rain', { n: 2 }), 'Raining down on stage 2');
  assert.equal(translator('it')('ui.hud.stage', { n: 1, total: 4 }), 'Tappa 1/4');
  assert.equal(translator('xx')('ui.go'), 'GO!');
  assert.equal(translator('it')('ui.go'), 'VIA!');
  assert.equal(translator('en')('nope.key'), 'nope.key');
  assert.equal(translator('en')('ui.player', {}), 'Player {n}');
});

test('numbers, times and ordinals follow the language', () => {
  assert.equal(formatAltitude('en', 2431.4), '2,431');
  assert.equal(formatAltitude('it', 2431.4), '2.431');
  assert.equal(formatAltitude('it', 926), '926');
  assert.equal(formatTime('en', 222.18), '3:42.18');
  assert.equal(formatTime('it', 222.18), '3:42,18');
  assert.equal(formatTime('en', 59.999), '1:00.00');
  assert.equal(formatTime('en', 5.05), '0:05.05');
  assert.equal(formatTime('en', -1), '');
  assert.equal(formatTime('en', NaN), '');
  assert.deepEqual(ordinal('en', 1), ['1', 'st']);
  assert.deepEqual(ordinal('en', 2), ['2', 'nd']);
  assert.deepEqual(ordinal('it', 1), ['1', '°']);
  assert.equal(pickLabel('it', { it: 'Alta Val Sesis', en: 'Upper Val Sesis' }), 'Alta Val Sesis');
  assert.equal(pickLabel('en', { it: 'Alta Val Sesis', en: 'Upper Val Sesis' }), 'Upper Val Sesis');
  assert.equal(pickLabel('en', { it: 'Solo italiano' }), 'Solo italiano');
  assert.equal(pickLabel('en', 'Monte Peralba'), 'Monte Peralba');
  assert.equal(pickLabel('en', null), '');
});

test('the phone and the TV say the same thing about holding BOOST on the results: another mountain', () => {
  for (const d of [en, it]) {
    const back = d['ui.back'].toLowerCase();
    assert.ok(d['pad.results'].toLowerCase().endsWith(back), `${d['pad.results']} / ${d['ui.back']}`);
  }
});

test('each mountain has a name for sentences, with the article Italian puts before it', () => {
  for (const id of MOUNTAINS) {
    assert.ok(en[`mountain.${id}`] && it[`mountain.${id}`], id);
    assert.match(it[`mountain.${id}`], /^(il |l'|lo |la )/, `${id}: ${it[`mountain.${id}`]}`);
  }
  assert.equal(translator('it')('ui.vote.agree', { name: it['mountain.svizzera'] }), 'Avete scelto entrambi il Cervino!');
  assert.equal(translator('it')('ui.vote.agree', { name: it['mountain.antelao'] }), 'Avete scelto entrambi l\'Antelao!');
  assert.equal(translator('en')('ui.vote.won', { name: en['mountain.svizzera'] }), 'The coin picked the Matterhorn!');
});
