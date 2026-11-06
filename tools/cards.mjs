// The lobby vote's card images: each world's summit painting (assets/backdrops/<id>-summit.jpg, else its downhill
// view <id>.jpg) reduced to WIDTH px, so seven of them load fast on the TV and over the phones' Wi-Fi (the
// paintings are 3168 px and close to 3 MB each). macOS sips does the resampling (no install); elsewhere, or if it
// fails, the painting is copied as it is. Results are cached by source size and time, so a rebuild costs nothing.
//
//   import { makeCards } from './tools/cards.mjs';
//   makeCards('assets/backdrops', 'dist/assets/backdrops/cards')   // -> ['dolomiti', ...] the worlds written
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const WIDTH = 960;
const CACHE = resolve('node_modules/.cache/summit-descent-cards');

// The painting each world's card shows: { id: file name }.
export function cardSources(dir) {
  const jpgs = readdirSync(dir).filter((f) => /\.jpg$/i.test(f));
  const ids = jpgs.map((f) => f.replace(/\.jpg$/i, '')).filter((n) => !n.endsWith('-summit'));
  return Object.fromEntries(ids.sort().map((id) => [id, jpgs.includes(`${id}-summit.jpg`) ? `${id}-summit.jpg` : `${id}.jpg`]));
}

export function makeCards(src, out, { width = WIDTH } = {}) {
  mkdirSync(out, { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  const done = [];
  for (const [id, file] of Object.entries(cardSources(src))) {
    const from = join(src, file);
    const st = statSync(from);
    const cached = join(CACHE, `${file.replace(/\.jpg$/i, '')}-${width}-${st.size}-${Math.round(st.mtimeMs)}.jpg`);
    if (!existsSync(cached)) {
      try {
        execFileSync('sips', ['--resampleWidth', String(width), '-s', 'format', 'jpeg', '-s', 'formatOptions', '74', from, '--out', cached], { stdio: 'ignore' });
      } catch {
        copyFileSync(from, cached);
      }
    }
    copyFileSync(cached, join(out, `${id}.jpg`));
    done.push(id);
  }
  return done;
}
