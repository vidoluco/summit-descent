#!/usr/bin/env node
// docs/media/ for the README, from the raw captures of tools/shoot-readme.mjs and the game's own art. The composed
// pictures are web pages over real captures, screenshotted in headless Chromium.
// node tools/compose-readme.mjs --raw <folder> [logo] [how] [animals] [stills] [gif]   (nothing named: everything)
// CHROMIUM=<path> picks the browser. Needs ffmpeg and gifsicle for the stills and the GIF.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { chromium } from 'playwright-core';
import { ROOT } from './perf/harness.mjs';
import { dropFace } from '../src/ui/icons.js';
import { FREDOKA_WOFF2 } from '../src/ui/font-data.js';
import { en } from '../src/i18n/en.js';
import { MOUNTAINS } from '../src/game/mountains.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const rawArg = opt('raw', 'docs/shots/readme');
const RAW = isAbsolute(rawArg) ? rawArg : join(ROOT, rawArg);
const OUT = join(ROOT, 'docs/media');
mkdirSync(OUT, { recursive: true });
const want = (n) => !argv.length || argv.includes(n);
const url = (file) => `data:image/${/png$/.test(file) ? 'png' : 'jpeg'};base64,${readFileSync(file).toString('base64')}`;
const raw = (name) => url(join(RAW, name));
const INK = '#1d1f2b', PAPER = '#fffaf0';
const head = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: F; src: url(data:font/woff2;base64,${FREDOKA_WOFF2}); font-weight: 500 700; }
* { box-sizing: border-box; margin: 0; }
body { font-family: F, sans-serif; color: ${INK}; width: var(--w); height: var(--h); overflow: hidden; position: relative;
  background: linear-gradient(180deg, #c6a3cf 0%, #efbcd0 58%, #f8dcc0 100%); }
svg { display: block; overflow: visible; }
.sticker { background: ${PAPER}; border: 3px solid ${INK}; border-radius: 16px; box-shadow: 0 4px 0 ${INK}; font-weight: 600; }
</style>`;

function browserPath() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const look = [
    [join(homedir(), 'Library/Caches/ms-playwright'), /^chromium_headless_shell-/],
    [join(homedir(), '.cache/puppeteer/chrome-headless-shell'), /^mac_arm-/],
  ];
  for (const [base, re] of look) {
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base).filter((x) => re.test(x)).sort().reverse()) {
      const exe = join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error('no headless shell found: set CHROMIUM');
}
const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
async function render(name, w, h, body, { quality = 86, transparent = false } = {}) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`${head}<style>:root { --w: ${w}px; --h: ${h}px; }</style>${body}`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(OUT, name), ...(transparent ? { omitBackground: true } : { type: 'jpeg', quality }) });
  console.log(name);
}

// The title of the lobby on nothing, for a light or a dark page (src/ui/style.js .lobby .title, .ink).
if (want('logo')) await render('logo.png', 960, 150, `<style>
body { background: none; }
.title { position: absolute; left: 0; right: 0; top: 18px; display: flex; justify-content: center; align-items: center; gap: 18px; font-size: 104px; line-height: 1; font-weight: 700;
  color: #fff; -webkit-text-stroke: 11px ${INK}; paint-order: stroke fill; letter-spacing: 0.5px; }
.drop-face { width: 88px; filter: drop-shadow(0 5px 8px rgba(20, 24, 40, 0.25)); }
.drop-face + .drop-face { margin-left: -42px; transform: rotate(10deg) translateY(10px); }
</style><div class="title">${dropFace(0)}${dropFace(1)}<span>Summit Descent</span></div>`, { transparent: true });

// The TV with the vote, next to the phone browsing the mountains and the phone in the race.
if (want('how')) await render('tv-and-phone.jpg', 1280, 600, `<style>
.tv { position: absolute; left: 20px; top: 92px; width: 750px; padding: 12px 12px 16px; background: ${INK}; border-radius: 18px; box-shadow: 0 18px 40px #1d1f2b66; }
.tv img { width: 100%; display: block; border-radius: 6px; }
.foot { position: absolute; left: 305px; top: 548px; width: 180px; height: 14px; background: ${INK}; border-radius: 0 0 14px 14px; }
.phone { position: absolute; left: 786px; width: 478px; padding: 10px 14px; background: #15161f; border-radius: 26px; box-shadow: 0 14px 30px #1d1f2b80; }
.phone img { width: 100%; display: block; border-radius: 14px; }
.tag { position: absolute; padding: 5px 13px; font-size: 19px; white-space: nowrap; }
.tag b { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #ffc83d; border: 2px solid ${INK}; margin-right: 8px; font-size: 16px; }
</style>
<div class="tv"><img src="${raw('tv-vote.png')}"></div><div class="foot"></div>
<div class="phone" style="top: 66px;"><img src="${raw('pad-browse.png')}"></div>
<div class="phone" style="top: 354px;"><img src="${raw('pad-race.png')}"></div>
<div class="tag sticker" style="left: 28px; top: 34px;"><b>1</b>The TV shows the mountains</div>
<div class="tag sticker" style="left: 800px; top: 16px;"><b>2</b>Each phone swipes and votes</div>
<div class="tag sticker" style="left: 800px; top: 304px;"><b>3</b>Then it steers your drop</div>`);

// The species each course really spawns (data/worlds/<id>/world.json), with the vote's stickers of them.
if (want('animals')) {
  const TITLE = { dolomiti: 'Monte Peralba', antelao: 'Antelao', svizzera: 'Matterhorn', carpazi: 'Văiuga Peak', everest: 'Mount Everest', k2: 'K2', indonesia: 'Mount Kerinci' };
  const rows = MOUNTAINS.map((id) => {
    const w = JSON.parse(readFileSync(join(ROOT, `data/worlds/${id}/world.json`), 'utf8'));
    const kinds = [...new Set(w.stages.flatMap((s) => (s.spawns?.animals || []).map((a) => a.kind)))];
    return { id, kinds };
  });
  const tile = (k) => `<div class="a"><img src="${url(join(ROOT, `assets/ui/animals/${k}.png`))}"><span>${en[`animal.${k}`]}</span></div>`;
  const block = (r) => `<div class="m sticker"><h3>${TITLE[r.id]}</h3><div class="row">${r.kinds.map(tile).join('')}</div></div>`;
  // laid out by hand so that each line fills the width
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const lines = [['carpazi', 'k2'], ['antelao', 'everest'], ['svizzera'], ['dolomiti', 'indonesia']];
  await render('animals.jpg', 1280, 716, `<style>
.grid { position: absolute; inset: 14px 12px; display: flex; flex-direction: column; gap: 10px; }
.line { display: flex; gap: 10px; justify-content: center; }
.m { padding: 5px 10px 5px; border-radius: 16px; box-shadow: 0 3px 0 ${INK}; }
h3 { font-size: 19px; font-weight: 700; margin-bottom: 1px; }
.row { display: flex; gap: 4px; }
.a { width: 104px; text-align: center; font-size: 14px; font-weight: 600; line-height: 1.05; }
.a img { width: 88px; height: 88px; object-fit: contain; display: block; margin: 0 auto 1px; filter: drop-shadow(0 3px 3px #1d1f2b44); }
.a span { display: block; height: 30px; }
</style><div class="grid">${lines.map((l) => `<div class="line">${l.map((id) => block(by[id])).join('')}</div>`).join('')}</div>`);
}

// Plain captures, 1280 wide: [file in docs/media, file in the raw folder].
const STILLS = [
  ['mountain-peralba', 'sweep-dolomiti-025.jpg'],
  ['mountain-antelao', 'sweep-antelao-034.jpg'],
  ['mountain-matterhorn', 'sweep-svizzera-022.jpg'],
  ['mountain-vaiuga', 'sweep-carpazi-019.jpg'],
  ['mountain-everest', 'sweep-everest-025.jpg'],
  ['mountain-k2', 'sweep-k2-022.jpg'],
  ['mountain-kerinci', 'sweep-indonesia-025.jpg'],
  ['split-screen', 'split-dolomiti-018.jpg'],
  ['cloud', 'cloud-antelao-05.jpg'],
  ['frozen', 'frozen-k2-2-1.jpg'],
  ['animal-tapir', 'animal-indonesia-05.jpg'],
  ['animal-chamois', 'animal-carpazi-05.jpg'],
  ['results', 'results-antelao.jpg'],
];
if (want('stills')) for (const [out, from] of STILLS) {
  const file = join(RAW, from);
  if (!existsSync(file)) { console.log(`missing ${from}`); continue; }
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'scale=1280:-2:flags=lanczos', '-q:v', '3', join(OUT, `${out}.jpg`)]);
  console.log(`${out}.jpg`);
}

// The hero: 8 s from the 20 fps film (node tools/shoot-readme.mjs film antelao 3 0-10 --start 0 --name h-antelao).
if (want('gif')) {
  const tmp = join(tmpdir(), `summit-descent-race-${process.pid}.gif`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '20', '-pattern_type', 'glob', '-i', join(RAW, 'h-antelao/*.png'), '-filter_complex',
    '[0:v]trim=start_frame=0:end_frame=160,setpts=PTS-STARTPTS,fps=12,scale=800:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', tmp]);
  execFileSync('gifsicle', ['-O3', '--lossy=90', tmp, '-o', join(OUT, 'race.gif')]);
  rmSync(tmp, { force: true });
  console.log('race.gif');
}

await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
