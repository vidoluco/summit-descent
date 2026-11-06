// Fallback when Overpass is down (spec "Errori"): the Geofabrik nord-est extract filtered with osmium,
// written in the Overpass `out geom` shape that river.mjs reads. Needs osmium on PATH.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const GEOFABRIK_URL = 'https://download.geofabrik.de/europe/italy/nord-est-latest.osm.pbf';

function osmium(args) {
  const r = spawnSync('osmium', args, { encoding: 'utf8' });
  if (r.error) throw new Error(`osmium not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`osmium ${args[0]} failed: ${r.stderr}`);
}

// OPL escapes: %xx% with the code point in hex.
const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const tagsOf = (s) => Object.fromEntries((s ? s.split(',') : []).map((kv) => kv.split('=').map(unesc)));

// Parses OPL with way locations into Overpass-like elements.
export function oplToOverpass(text) {
  const elements = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = Object.fromEntries(line.split(' ').slice(1).map((t) => [t[0], t.slice(1)]));
    const id = Number(line.slice(1, line.indexOf(' ') > 0 ? line.indexOf(' ') : undefined));
    if (line[0] === 'r') {
      const members = (f.M ? f.M.split(',') : []).map((m) => {
        const at = m.indexOf('@');
        return { type: { n: 'node', w: 'way', r: 'relation' }[m[0]], ref: Number(m.slice(1, at)), role: unesc(m.slice(at + 1)) };
      });
      elements.push({ type: 'relation', id, tags: tagsOf(f.T), members });
    } else if (line[0] === 'w') {
      const geometry = (f.N ? f.N.split(',') : []).map((n) => {
        const m = /x(-?[\d.]+)y(-?[\d.]+)/.exec(n);
        if (!m) throw new Error(`way ${id}: node without location (${n})`);
        return { lat: Number(m[2]), lon: Number(m[1]) };
      });
      elements.push({ type: 'way', id, tags: tagsOf(f.T), geometry });
    }
  }
  return { elements };
}

// Piave relation and its ways from a pbf, as the Overpass answer of osm-fetch.mjs.
export function riverFromPbf(pbf, workDir, name = 'Piave') {
  mkdirSync(workDir, { recursive: true });
  const cut = `${workDir}/river.osm.pbf`, opl = `${workDir}/river.opl`;
  osmium(['tags-filter', pbf, `r/name=${name}`, '-o', cut, '--overwrite']);
  osmium(['add-locations-to-ways', cut, '-f', 'opl', '-o', opl, '--overwrite']);
  const j = oplToOverpass(readFileSync(opl, 'utf8'));
  j.elements = j.elements.filter((e) => e.type === 'way' || (e.tags?.waterway === 'river' && e.tags?.name === name));
  if (!j.elements.some((e) => e.type === 'relation')) throw new Error(`${pbf}: no river relation named ${name}`);
  return j;
}

export async function downloadExtract(dir, url = GEOFABRIK_URL) {
  mkdirSync(dir, { recursive: true });
  const out = `${dir}/${url.split('/').pop()}`;
  if (existsSync(out)) return out;
  const res = await fetch(url, { headers: { 'User-Agent': 'summit-descent/0.1 (personal hobby game)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${out}.part`));
  renameSync(`${out}.part`, out);
  return out;
}

export function writeRiverJson(j, file) {
  writeFileSync(file, JSON.stringify(j));
  return j.elements.length;
}
