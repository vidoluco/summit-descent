// One bilingual dictionary for the whole game: host screens, place and animal names, the phone pad.
// en.js and it.js have the same keys; no visible string lives in the code (spec, "Vincoli").
import { en } from './en.js';
import { it } from './it.js';

export { en, it };
export const LANGS = ['en', 'it'];
export const DICTS = { en, it };
export const LANG_KEY = 'summit-descent.lang';

// Stored choice first, then the browser language: it* -> Italian, anything else -> English.
export function pickLang(stored, navLang) {
  if (LANGS.includes(stored)) return stored;
  return /^it\b/i.test(navLang || '') ? 'it' : 'en';
}

// Browser start language: the choice saved under LANG_KEY, else navigator.language.
export function detectLang(storage = globalThis.localStorage, nav = globalThis.navigator) {
  let stored = null;
  try { stored = storage?.getItem(LANG_KEY) ?? null; } catch {}
  return pickLang(stored, nav?.language);
}

export function saveLang(lang, storage = globalThis.localStorage) {
  try { storage?.setItem(LANG_KEY, lang); } catch {}
}

export function nextLang(lang) {
  return LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];
}

export function translator(lang) {
  const d = DICTS[lang] || en;
  return (key, vars) => {
    let s = d[key] ?? en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

// 1° / 2° in Italian, 1st / 2nd in English. Returns [number, suffix] so the page can superscript it.
export function ordinal(lang, n) {
  if (lang === 'it') return [String(n), '°'];
  const s = { one: 'st', two: 'nd', few: 'rd', other: 'th' }[new Intl.PluralRules('en', { type: 'ordinal' }).select(n)];
  return [String(n), s];
}

export function locale(lang) {
  return lang === 'it' ? 'it-IT' : 'en-GB';
}

// Whole metres with the locale's grouping: 2,431 in English, 2.431 in Italian.
const altitudeFormats = new Map(); // one formatter per language: the HUD formats the altitude several times a second
export function formatAltitude(lang, metres) {
  const l = locale(lang);
  if (!altitudeFormats.has(l)) altitudeFormats.set(l, new Intl.NumberFormat(l, { maximumFractionDigits: 0, useGrouping: 'always' }));
  return altitudeFormats.get(l).format(Math.round(metres));
}

// Race time as m:ss.cc (m:ss,cc in Italian). Negative or missing times return ''.
export function formatTime(lang, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const cs = Math.round(seconds * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const sep = lang === 'it' ? ',' : '.';
  return `${m}:${String(s).padStart(2, '0')}${sep}${String(c).padStart(2, '0')}`;
}

// A label baked into world data as {en, it} (stage names) or a plain string.
export function pickLabel(lang, label) {
  if (label && typeof label === 'object') return label[lang] ?? label.en ?? Object.values(label)[0] ?? '';
  return label == null ? '' : String(label);
}
