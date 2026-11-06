// Phone pad strings: same keys in both languages, every key the pad uses exists, no visible text left in pad.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en, it, pickLang, translator, ordinal } from '../controller/i18n.js';

test('pad dictionaries have the same keys and no empty values', () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const d of [en, it]) for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'string' && v.trim(), k);
  for (const d of [en, it]) for (const v of Object.values(d)) assert.ok(!v.includes('—'), 'no em dash');
});

test('every key referenced by the pad exists', () => {
  const src = readFileSync('controller/pad.js', 'utf8') + readFileSync('controller/pad.html', 'utf8');
  const used = new Set(src.match(/pad\.[a-zA-Z]+(?:\.[a-zA-Z]+\d?)?\d?/g).filter((k) => !/^pad\.(js|html|color)$/.test(k)));
  used.add('pad.color0').add('pad.color1');
  for (const k of used) assert.ok(k in en, k);
});

test('pad.html carries no hardcoded visible text', () => {
  const html = readFileSync('controller/pad.html', 'utf8');
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script'))
    .replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ');
  assert.equal(body.trim(), '');
});

test('language: stored choice, then it* -> Italian, else English', () => {
  assert.equal(pickLang(null, 'it-IT'), 'it');
  assert.equal(pickLang(null, 'it'), 'it');
  assert.equal(pickLang(null, 'en-US'), 'en');
  assert.equal(pickLang(null, 'ro-RO'), 'en');
  assert.equal(pickLang(null, undefined), 'en');
  assert.equal(pickLang('en', 'it-IT'), 'en');
  assert.equal(pickLang('xx', 'it-IT'), 'it');
  assert.equal(translator('it')('pad.player', { n: 2 }), 'Giocatore 2');
  assert.equal(translator('en')('pad.retry', { s: 3 }).startsWith('Retrying in 3 s'), true);
  assert.equal(translator('en')('pad.missing'), 'pad.missing');
  assert.deepEqual([ordinal('en', 1), ordinal('en', 2), ordinal('en', 3), ordinal('en', 11), ordinal('it', 2)],
    [['1', 'st'], ['2', 'nd'], ['3', 'rd'], ['11', 'th'], ['2', '°']]);
});
