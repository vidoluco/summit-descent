// The species tables and the real models: every species has a free model on disk, credited in
// assets/CREDITS.md with its licence, a palette and a rig; each Alpine and Carpathian world lists exactly the
// species its bake spawns, each spawned inside its config band and that band inside what the species really
// lives at; the module bundles for the browser; and in headless Chromium every model of those worlds loads and
// builds into a smooth, outlined, instanced animal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { extname, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { SPECIES, WORLDS, speciesOf } from '../src/render/animals/registry.js';
import * as ALPS from '../src/render/animals/species.js';
import * as CARPATHIANS from '../src/render/animals/species-carpazi.js';

// The worlds of species.js and species-carpazi.js, with the species each must show: the spec list of the
// place, corrected where the place says otherwise (no ibex colony on the Peralba; the Hérens is the cow of the
// Valais alps).
const FAUNA = {
  dolomiti: ['marmot', 'chamois', 'hare', 'chough', 'eagle', 'cow'],
  antelao: ['ibex', 'marmot', 'chamois', 'hare', 'chough', 'eagle', 'red-deer'],
  svizzera: ['ibex', 'chamois', 'marmot', 'lammergeier', 'ptarmigan', 'chough', 'herens'],
  carpazi: ['carpathian-chamois', 'brown-bear', 'lynx', 'wolf', 'red-deer', 'sheep', 'sheepdog', 'eagle'],
};
// Where each species really lives in these mountains in summer, in metres (the sources are in
// docs/mountains/<id>.md): a config band must sit inside it.
const REAL = {
  marmot: [1200, 3000], // alpine meadows above the forest; Zermatt 1600-2800
  ibex: [1500, 3500], // rock and alpine grass; Zermatt 1600-3000, the Antelao colony up to the summit rocks
  chamois: [800, 3000], // steep forest in the valleys up to the alpine rock
  hare: [1200, 3000], // the mountain hare lives above about 1300 m in the Alps
  chough: [1200, 4500], // breeds 1260-2880 m, follows climbers to the summits
  eagle: [500, 3500], // soaring, nests on cliffs from the valleys up
  lammergeier: [1000, 5000], // soaring over the whole mountain
  ptarmigan: [1800, 3200], // alpine heath and boulder fields
  cow: [800, 2400], // summer alps
  herens: [1000, 2600],
  'red-deer': [300, 2000], // forest and its edge
  'carpathian-chamois': [1300, 2550], // above the Făgăraș forest, to the summits
  'brown-bear': [300, 2300], // forest, up to the Bâlea cirque and the Transfăgărășan
  lynx: [300, 1900], // forest
  wolf: [300, 2400],
  sheep: [1200, 2300], // the summer pastures of the stâna
  sheepdog: [1200, 2300],
};

test('every species has a model, a credit with licence, colours, a rig and a real size', () => {
  const credits = readFileSync('assets/CREDITS.md', 'utf8');
  for (const id of Object.keys({ ...ALPS.SPECIES, ...CARPATHIANS.SPECIES })) {
    const s = SPECIES[id];
    assert.ok(s, `${id} in the registry`);
    assert.ok(existsSync(`assets/vendor/animals/${s.file}`), `${id}: ${s.file}`);
    assert.match(s.credit, /\((CC0 1\.0|CC-BY 3\.0)\), poly\.pizza\/m\/\w+/, id);
    const url = s.credit.match(/poly\.pizza\/m\/[\w-]+/)[0];
    assert.ok(credits.includes(`https://${url}`) && credits.includes(`vendor/animals/${s.file}`), `${id} credited`);
    for (const [k, hex] of Object.entries(s.colors)) assert.match(hex, /^#[0-9a-f]{6}$/, `${id}.${k}`);
    assert.ok(s.rig && s.motion, `${id} rig and motion`);
    assert.ok(Object.values(s.size).every((v) => v > 0.1 && v < 3), `${id} size in metres`);
  }
  assert.ok(SPECIES.eagle.flying && SPECIES.lammergeier.flying && !SPECIES.marmot.flying && !SPECIES.chough.flying);
});

test('each world loads exactly the species its bake spawns, and only those of its place', () => {
  for (const [id, fauna] of Object.entries(FAUNA)) {
    assert.deepEqual([...WORLDS[id]].sort(), [...fauna].sort(), `${id}: registry`);
    assert.deepEqual(speciesOf(id).sort(), [...fauna].sort(), `${id}: speciesOf`);
    const cfg = JSON.parse(readFileSync(`tools/bake/worlds/${id}.json`, 'utf8'));
    assert.deepEqual(Object.keys(cfg.animals.kinds).sort(), [...fauna].sort(), `${id}: bake config kinds`);
  }
  assert.ok(!FAUNA.dolomiti.includes('ibex'), 'no ibex colony on the Peralba');
  assert.ok(!FAUNA.carpazi.some((k) => ['ibex', 'marmot', 'cow'].includes(k)), 'no Alpine species in the Făgăraș');
});

test('config bands sit inside the real altitude of each species, and every baked spawn inside its band', () => {
  for (const id of Object.keys(FAUNA)) {
    const cfg = JSON.parse(readFileSync(`tools/bake/worlds/${id}.json`, 'utf8'));
    for (const [kind, g] of Object.entries(cfg.animals.kinds)) {
      const [lo, hi] = REAL[kind];
      assert.ok(g.alt[0] >= lo && g.alt[1] <= hi, `${id} ${kind}: band ${g.alt} outside the real ${lo}-${hi} m`);
    }
    const path = `data/worlds/${id}/world.json`;
    if (!existsSync(path)) continue;
    const W = JSON.parse(readFileSync(path, 'utf8'));
    const seen = new Set();
    for (const s of W.stages) {
      for (const a of s.spawns.animals) {
        const band = cfg.animals.kinds[a.kind]?.alt;
        assert.ok(band, `${id} ${s.id}: ${a.kind} is not in the config`);
        // the band is checked on the bed; a walker stands a few metres up the bank
        const alt = a.y + s.offset.y;
        assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${id} ${s.id}: ${a.kind} at ${alt.toFixed(0)} m, band ${band}`);
        assert.equal(!!a.flying, !!SPECIES[a.kind].flying, `${id} ${a.kind}: flying`);
        seen.add(a.kind);
      }
    }
    assert.deepEqual([...seen].sort(), [...FAUNA[id]].sort(), `${id}: every species spawns somewhere`);
  }
});

test('the animals module bundles for the browser (three and its addons resolve)', async () => {
  const r = await build({ entryPoints: ['src/render/animals/index.js'], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  assert.ok(r.outputFiles[0].text.includes('createAnimals'));
});

function chromiumPath() {
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => n.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const exe = join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}
const exe = chromiumPath();

test('in the browser every model of each world builds: smooth (subdivided), outlined, two draw calls per species', { skip: !exe && 'no chromium', timeout: 600000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary' };
  const server = createServer(async (req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try { const b = await readFile(join(process.cwd(), p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  t.after(async () => { await browser.close(); server.close(); });
  for (const [id, fauna] of Object.entries(FAUNA)) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [], logs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/src/render/animals/preview/index.html?scene=lineup&world=${id}&w=640&h=360`);
    await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 300000 });
    assert.deepEqual(errors, [], id);
    const line = logs.find((l) => l.startsWith('stats: '));
    const stats = JSON.parse(line.slice(7, line.indexOf(' calls ')));
    assert.deepEqual(Object.keys(stats).sort(), [...fauna].sort(), id);
    for (const [k, s] of Object.entries(stats)) {
      assert.equal(s.instances, 1, `${id} ${k}`);
      assert.ok(s.faces > 4000 && s.faces < 25000, `${id} ${k}: ${s.faces} faces`);
    }
    // per species: the toon mesh, its outline hull and its shadow (plus sky and ground)
    const calls = +line.match(/calls (\d+)/)[1];
    assert.ok(calls <= 3 * fauna.length + 2, `${id}: ${calls} draw calls`);
    await page.close();
  }
});

// Playtest r1: the Svizzera course is late October (gold larches), so its chamois wears the dark winter coat
// and its ptarmigan is turning white; the summer Alps keep their summer coats. Same body and motion, the sim
// and the bake keep the plain kind.
test('a world draws the coat of its season: the late-October Svizzera chamois and ptarmigan', async () => {
  const { drawnAs, VARIANTS } = await import('../src/render/animals/registry.js');
  assert.equal(drawnAs('svizzera', 'chamois'), 'chamois-winter');
  assert.equal(drawnAs('svizzera', 'ptarmigan'), 'ptarmigan-autumn');
  assert.equal(drawnAs('svizzera', 'ibex'), 'ibex');
  assert.equal(drawnAs('dolomiti', 'chamois'), 'chamois');
  assert.equal(drawnAs(undefined, 'chamois'), 'chamois');
  const luma = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
  for (const [world, map] of Object.entries(VARIANTS)) {
    for (const [kind, as] of Object.entries(map)) {
      assert.ok(SPECIES[as], `${world}: ${as} is a species`);
      assert.equal(SPECIES[as].file, SPECIES[kind].file, `${as} keeps the body of ${kind}`);
      assert.deepEqual(SPECIES[as].motion, SPECIES[kind].motion);
    }
  }
  assert.ok(luma(SPECIES['chamois-winter'].colors.coat) < luma(SPECIES.chamois.colors.coat) * 0.6, 'the winter coat is much darker');
  assert.ok(luma(SPECIES['ptarmigan-autumn'].colors.back) > 200, 'the ptarmigan back is turning white');
});
