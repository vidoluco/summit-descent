// Bundles the game and the phone controller as ES modules and copies the static files into dist/.
// Entries and folders that do not exist yet are skipped, so the build works while the project grows.
import { build } from 'esbuild';
import { cpSync, mkdirSync, copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { makeCards } from './tools/cards.mjs';

const dev = process.argv.includes('--dev');
const bundles = [
  ['src/main.js', 'dist/game.js'],
  ['controller/pad.js', 'dist/pad.js'],
];
const files = [
  ['index.template.html', 'dist/index.html'],
  ['controller/pad.html', 'dist/pad.html'],
];
const dirs = [
  ['public', 'dist'],
  ['data/worlds', 'dist/data/worlds'],
  ['assets/vendor/animals', 'dist/assets/vendor/animals'], // the animal models the game loads at runtime
];

mkdirSync('dist', { recursive: true });
const done = [];
for (const [entry, outfile] of bundles) {
  if (!existsSync(entry)) continue;
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    minify: !dev,
    sourcemap: dev,
    target: 'es2022',
    outfile,
    legalComments: 'none',
    logLevel: 'warning',
  });
  done.push(outfile);
}
for (const [src, dst] of files) {
  if (!existsSync(src)) continue;
  copyFileSync(src, dst);
  done.push(dst);
}
for (const [src, dst] of dirs) {
  if (!existsSync(src)) continue;
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  done.push(`${dst}/ (from ${src}/)`);
}
// the painted backdrops (only the paintings themselves, not the drafts in subfolders) and the list of them the
// renderer reads first, so a world without a summit painting loads no missing file (src/render/paint.js)
if (existsSync('assets/backdrops')) {
  const jpgs = readdirSync('assets/backdrops').filter((f) => /\.jpg$/i.test(f)).sort();
  mkdirSync('dist/assets/backdrops', { recursive: true });
  for (const f of jpgs) copyFileSync(`assets/backdrops/${f}`, `dist/assets/backdrops/${f}`);
  writeFileSync('dist/assets/backdrops/index.json', JSON.stringify({ files: jpgs }));
  done.push(`dist/assets/backdrops/ (${jpgs.length} paintings)`);
  // the lobby vote's cards: each summit painting, reduced (tools/cards.mjs)
  done.push(`dist/assets/backdrops/cards/ (${makeCards('assets/backdrops', 'dist/assets/backdrops/cards').length})`);
}
// the animal stickers of the vote's cards (src/ui/tools/stickers.mjs renders them from the game's own models)
if (existsSync('assets/ui')) {
  mkdirSync('dist/assets/ui', { recursive: true });
  cpSync('assets/ui', 'dist/assets/ui', { recursive: true });
  done.push('dist/assets/ui/');
}
console.log(`dist/ ready: ${done.join(', ') || 'nothing to build'}`);
