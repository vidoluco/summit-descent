// The animals of Everest, K2 and Kerinci (src/render/animals/species-asia.js): every Asian species has a free
// model on disk, credited in assets/CREDITS.md with its licence, a palette, a rig and a real size; each world
// loads exactly the species its bake spawns, each spawned inside its config band and that band inside what the
// species really lives at in that place; no species from another continent or another altitude; and in headless
// Chromium the lineup of each world builds every model into a smooth, outlined, instanced animal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { SPECIES, WORLDS, SCALE, speciesOf } from '../src/render/animals/registry.js';
import * as ASIA from '../src/render/animals/species-asia.js';

const IDS = ['everest', 'k2', 'indonesia'];
// Where each species really lives on these mountains, in metres (sources in docs/mountains/<id>.md): a config
// band must sit inside it, so a spawn can never land where the species is not found.
const REAL = {
  everest: {
    chough: [3500, 8200], // follows climbers to 8200 m, nests at 6500 m
    yak: [3000, 5400], // herded on the Khumbu summer pastures, yak trains to Gorak Shep (5164 m)
    'snow-leopard': [3000, 5100], // Sagarmatha NP: grazing land and shrubland (Ale et al. 2007)
    'himalayan-tahr': [3000, 4400], // 3685-4380 m in the park (Shrestha 2007)
    'red-panda': [2200, 3700], // the lower forests
    danphe: [2400, 4100], // pine forest, 3250-4021 m in the park
  },
  k2: {
    chough: [3500, 8200],
    lammergeier: [300, 7500], // seen at 7300-7500 m in the Himalaya
    'siberian-ibex': [2000, 5000], // CKNP 3000-5000 m, 2000-5000 m in summer
    'snow-leopard': [3000, 5000], // every drainage of CKNP
    'himalayan-brown-bear': [3000, 4600], // alpine meadows above 3500 m, Deosai and upper Hushe
    pika: [2300, 6130], // large-eared pika, talus and scree
  },
  indonesia: {
    'sumatran-tiger': [0, 3200], // mountain forest to 3200 m; out to the farms of Kayu Aro
    'malayan-tapir': [0, 2020], // tracks to 2020 m in the Gunung Tujuh forest
    'sumatran-striped-rabbit': [600, 2300], // camera-trapped at 2300 m in Kerinci Seblat
    'salvadoris-pheasant': [600, 2200], // montane forest
    'wreathed-hornbill': [0, 2560], // recorded to 2560 m, heard at 2100 m on Kerinci
  },
};
// Species that must never show up in a world: other continents, other islands, other altitudes.
const NEVER = {
  everest: ['sumatran-tiger', 'malayan-tapir', 'siberian-ibex', 'ibex', 'marmot', 'cow', 'eagle', 'orangutan'],
  k2: ['yak', 'sumatran-tiger', 'ibex', 'marmot', 'chamois', 'orangutan', 'pika'], // pika: no talus on the snow and ice of the course
  indonesia: ['snow-leopard', 'yak', 'chough', 'lammergeier', 'eagle', 'orangutan', 'siamang'],
};
const spawned = (id) => {
  const path = `data/worlds/${id}/world.json`;
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

test('every Asian species has a model, a credit with licence, colours, a rig and a real size', () => {
  const credits = readFileSync('assets/CREDITS.md', 'utf8');
  for (const id of Object.keys(ASIA.SPECIES)) {
    const s = SPECIES[id];
    assert.ok(s, `${id} in the registry`);
    assert.ok(existsSync(`assets/vendor/animals/${s.file}`), `${id}: ${s.file}`);
    assert.match(s.credit, /\((CC0 1\.0|CC-BY 3\.0)\), poly\.pizza\/m\/[\w-]+/, id);
    const url = s.credit.match(/poly\.pizza\/m\/[\w-]+/)[0];
    assert.ok(credits.includes(`https://${url}`) && credits.includes(`vendor/animals/${s.file}`), `${id} credited`);
    for (const [k, hex] of Object.entries(s.colors)) assert.match(hex, /^#[0-9a-f]{6}$/, `${id}.${k}`);
    assert.ok(s.rig && s.motion, `${id} rig and motion`);
    assert.ok(Object.values(s.size).every((v) => v > 0.1 && v < 3), `${id} size in metres`);
    assert.ok((SCALE[id] ?? 1) >= 1 && (SCALE[id] ?? 1) <= 3.5, `${id}: readability scale`);
  }
  assert.ok(SPECIES['wreathed-hornbill'].flying && SPECIES.lammergeier.flying, 'the hornbill and the lammergeier fly');
  assert.ok(['yak', 'snow-leopard', 'pika', 'malayan-tapir', 'salvadoris-pheasant'].every((k) => !SPECIES[k].flying));
});

test('each Asian world loads exactly the species its bake spawns, and only those of its place', () => {
  for (const id of IDS) {
    assert.deepEqual(speciesOf(id).sort(), [...WORLDS[id]].sort(), `${id}: speciesOf`);
    for (const k of WORLDS[id]) assert.ok(SPECIES[k], `${id}: ${k} has a model`);
    for (const k of NEVER[id]) assert.ok(!WORLDS[id].includes(k), `${id}: no ${k}`);
    const cfg = JSON.parse(readFileSync(`tools/bake/worlds/${id}.json`, 'utf8'));
    for (const k of WORLDS[id]) assert.ok(cfg.animals.kinds[k], `${id}: ${k} is a kind of the bake config`);
    for (const k of Object.keys(cfg.animals.kinds)) assert.ok(REAL[id][k], `${id}: ${k} has a real band here`);
    const W = spawned(id);
    if (!W) continue;
    const seen = new Set(W.stages.flatMap((s) => s.spawns.animals.map((a) => a.kind)));
    assert.deepEqual([...seen].sort(), [...WORLDS[id]].sort(), `${id}: the species list is what the bake spawns`);
  }
});

test('Asian config bands sit inside the real altitude of each species, and every baked spawn inside its band', () => {
  for (const id of IDS) {
    const cfg = JSON.parse(readFileSync(`tools/bake/worlds/${id}.json`, 'utf8'));
    for (const [kind, g] of Object.entries(cfg.animals.kinds)) {
      const [lo, hi] = REAL[id][kind];
      assert.ok(g.alt[0] >= lo && g.alt[1] <= hi, `${id} ${kind}: band ${g.alt} outside the real ${lo}-${hi} m`);
    }
    const W = spawned(id);
    if (!W) continue;
    for (const s of W.stages) {
      for (const a of s.spawns.animals) {
        const band = cfg.animals.kinds[a.kind].alt, alt = a.y + s.offset.y;
        // the band is checked on the bed; a walker stands a few metres up the bank
        assert.ok(alt >= band[0] - 150 && alt <= band[1] + 150, `${id} ${s.id}: ${a.kind} at ${alt.toFixed(0)} m, band ${band}`);
        assert.equal(!!a.flying, !!SPECIES[a.kind].flying, `${id} ${a.kind}: flying`);
      }
    }
  }
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

test('in the browser the lineup of each Asian world builds every model: smooth, outlined, two draw calls per species', { skip: !exe && 'no chromium', timeout: 600000 }, async (t) => {
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
  // every species of the file, the ones no current stage spawns too (a re-bake may bring them in)
  const lineups = { ...Object.fromEntries(IDS.map((id) => [id, WORLDS[id]])), all: Object.keys(ASIA.SPECIES) };
  for (const [id, fauna] of Object.entries(lineups)) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors = [], logs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
    const q = id === 'all' ? `kinds=${fauna.join(',')}` : `world=${id}`;
    await page.goto(`http://127.0.0.1:${server.address().port}/src/render/animals/preview-asia/index.html?scene=lineup&${q}&w=640&h=360`);
    await page.waitForFunction(() => window.__ready === true || window.__error, null, { timeout: 300000 });
    assert.deepEqual(errors, [], id);
    const line = logs.find((l) => l.startsWith('stats: '));
    const stats = JSON.parse(line.slice(7, line.indexOf(' calls ')));
    assert.deepEqual(Object.keys(stats).sort(), [...fauna].sort(), id);
    for (const [k, s] of Object.entries(stats)) {
      assert.equal(s.instances, 1, `${id} ${k}`);
      assert.ok(s.faces > 4000 && s.faces < 50000, `${id} ${k}: ${s.faces} faces`);
      const want = SPECIES[k].size, got = { length: s.size[2], height: s.size[1], span: s.size[0] };
      for (const [dim, v] of Object.entries(want)) assert.ok(got[dim] > v * 0.6 && got[dim] < v * 1.6, `${id} ${k}: ${dim} ${got[dim].toFixed(2)} m for ${v} m`);
    }
    const calls = +line.match(/calls (\d+)/)[1];
    assert.ok(calls <= 3 * fauna.length + 2, `${id}: ${calls} draw calls`);
    await page.close();
  }
});
