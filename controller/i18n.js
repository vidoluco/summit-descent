// The pad's strings live in the game's single dictionary, src/i18n/ (pad.* keys). This file only re-exports it
// for older imports; controller/pad.js imports src/i18n directly.
export { LANGS, en, it, pickLang, translator, ordinal, locale } from '../src/i18n/index.js';
