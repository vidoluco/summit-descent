// OpenStreetMap through Overpass, cached per world in data/raw/osm/<id>/ (river.json, places.json,
// glaciers.json, features.json). The queries are built from the world config (tools/bake/config.mjs).
// Answers are untrusted data: they are parsed as JSON and read as coordinates and names, never run.
import { writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { downloadExtract, riverFromPbf, writeRiverJson } from './osm-geofabrik.mjs';

export const osmDir = (id, root = 'data/raw/osm') => `${root}/${id}`;
const bb = (b) => b.join(',');
const esc = (s) => s.replace(/[\\"]/g, '\\$&');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&').replace(/"/g, '\\"');

// The Overpass query of each cache file the config needs: { 'river.json': q, ... }.
export function queries(cfg) {
  const d = cfg.descent, out = {};
  if (d.kind === 'osm-relation') {
    const sel = Number.isInteger(d.relation) ? `relation(${d.relation})` : `relation["waterway"="river"]["name"="${esc(d.name)}"](${bb(d.bbox)})`;
    out['river.json'] = `[out:json][timeout:300];\n${sel}->.r;\n.r out body;\nway(r.r)(${bb(d.bbox)});\nout geom;`;
  } else if (d.kind === 'osm-ways') {
    out['river.json'] = `[out:json][timeout:120];\nway(id:${d.ways.join(',')});\nout geom;`;
  } else if (d.kind === 'osm-network') {
    out['river.json'] = `[out:json][timeout:300];\nway["waterway"~"^(river|stream)$"](${bb(d.bbox)});\nout geom;`;
  }
  const o = cfg.osm, kinds = o.placeKinds || ['city', 'town', 'village', 'hamlet', 'suburb'];
  const named = o.places?.length ? `["name"~"^(${o.places.map(reEsc).join('|')})$"]` : '';
  const extra = (o.extraNodes || []).map((n) => `  ${n}(${bb(o.bbox)});\n`).join('');
  out['places.json'] = `[out:json][timeout:120];\n(\n  node["place"~"^(${kinds.join('|')})$"]${named}(${bb(o.bbox)});\n${extra});\nout body;`;
  // what people built and the lakes along the way (tools/bake/features.mjs): buildings, roads, cable cars, lakes,
  // in osm.featuresBbox, the box of the played stages (osm.bbox can hold whole towns down the valley)
  const fb = o.featuresBbox && bb(o.featuresBbox);
  if (fb) out['features.json'] = `[out:json][timeout:300];\n(\n  way["natural"="water"](${fb});\n  relation["natural"="water"](${fb});\n  way["building"](${fb});\n  way["aerialway"](${fb});\n  way["highway"~"^(primary|secondary|tertiary)$"](${fb});\n);\nout geom;`;
  if (o.glaciers) out['glaciers.json'] = `[out:json][timeout:300];\n(\n  way["natural"="glacier"](${bb(o.bbox)});\n  relation["natural"="glacier"](${bb(o.bbox)});\n);\nout geom;`;
  return out;
}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export async function overpass(q, { log = console.log, rounds = 4, allowEmpty = false, timeout = 240 } = {}) {
  for (let round = 0; round < rounds; round++) {
    if (round) await new Promise((r) => setTimeout(r, 10000 * 2 ** (round - 1)));
    for (const ep of ENDPOINTS) {
      try {
        const t0 = Date.now();
        const res = await fetch(ep, {
          method: 'POST',
          headers: { 'User-Agent': 'summit-descent/0.1 (personal hobby game)', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal: AbortSignal.timeout(timeout * 1000), // a busy mirror can hold the request open
        });
        if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
        const txt = await res.text(), j = JSON.parse(txt);
        if (!Array.isArray(j.elements)) throw new Error('no elements');
        if (!j.elements.length && !allowEmpty) throw new Error('empty result');
        log(`${j.elements.length} elements, ${(txt.length / 1e6).toFixed(2)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s via ${ep}`);
        return txt;
      } catch (err) {
        log(`${ep} failed: ${err.message}${err.cause ? ' (' + err.cause.code + ')' : ''}`);
      }
    }
  }
  return null;
}

// Fetches every missing cache file of a world. Returns the names that could not be fetched.
// Glaciers may legitimately be empty (no glacier in the box).
export async function fetchOsm(cfg, { root = 'data/raw/osm', force = false, log = console.log } = {}) {
  const dir = osmDir(cfg.id, root), failed = [];
  mkdirSync(dir, { recursive: true });
  for (const [file, q] of Object.entries(queries(cfg))) {
    const out = `${dir}/${file}`;
    if (existsSync(out) && !force) continue;
    log(`${out}: querying Overpass`);
    // the descent line is worth waiting for; places and glaciers have fallbacks (config list, altitude), features
    // are optional (none drawn)
    let txt = await overpass(q, { log: (m) => log(`  ${m}`), allowEmpty: file === 'glaciers.json' || file === 'features.json', rounds: file === 'river.json' ? 4 : 2, timeout: file === 'places.json' ? 120 : 240 });
    if (!txt && file === 'river.json' && cfg.osm.geofabrik && cfg.descent.kind === 'osm-relation') {
      try {
        log('Overpass down: falling back to the Geofabrik extract');
        const pbf = await downloadExtract(`${root}/geofabrik`, cfg.osm.geofabrik);
        const n = writeRiverJson(riverFromPbf(pbf, `${dir}/geofabrik`, cfg.descent.name), out);
        log(`${out}: ${n} elements from ${pbf}`);
        continue;
      } catch (err) {
        log(`Geofabrik fallback failed: ${err.message}`);
      }
    }
    if (!txt) { failed.push(file); continue; }
    const part = `${out}.${process.pid}.part`;
    writeFileSync(part, txt);
    renameSync(part, out);
  }
  return failed;
}
