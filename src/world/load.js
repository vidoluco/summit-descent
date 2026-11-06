// Loads a baked world (docs/world-format.md): { json, backdrop, stages: [{ json, height }] }, grids as
// Float32Array (little endian on disk). Each stages[k] is ready for createSim(stage, ...).
// Browser: loadWorld('dolomiti') fetches data/worlds/dolomiti/ relative to the page (or pass a base URL).
// Node: loadWorld('dolomiti', { dir: 'data/worlds' }) reads from disk.
// opts.stages: false loads no stage grid (fetch them later with loadStage), or an array of indices.
export { bilinear, makeSampler, makeGround, toGlobal, toLocal } from './sample.js';

function toFloat32(buf, expect, name) {
  if (buf.byteLength !== expect * 4) throw new Error(`${name}: ${buf.byteLength} bytes, expected ${expect * 4}`);
  const out = new Float32Array(expect);
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  for (let i = 0; i < expect; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

function reader(id, opts) {
  const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
  if (isNode && !opts.base) {
    const dir = `${opts.dir || 'data/worlds'}/${id}`;
    const fs = (async () => {
      const fsModule = 'node:fs/promises'; // not a literal, so browser bundles leave it out
      return import(fsModule);
    })();
    return {
      json: async (f) => JSON.parse(await (await fs).readFile(`${dir}/${f}`, 'utf8')),
      bin: async (f) => (await fs).readFile(`${dir}/${f}`),
    };
  }
  const base = `${opts.base || 'data/worlds'}/${id}`;
  const get = async (f) => {
    const res = await fetch(`${base}/${f}`);
    if (!res.ok) throw new Error(`${base}/${f}: HTTP ${res.status}`);
    return res;
  };
  return { json: async (f) => (await get(f)).json(), bin: async (f) => new Uint8Array(await (await get(f)).arrayBuffer()) };
}

// One stage: { json: the stage object of world.json, height: Float32Array }.
export async function loadStage(id, worldJson, k, opts = {}) {
  const st = worldJson.stages?.[k];
  if (!st) throw new Error(`${id}: no stage ${k}`);
  const r = opts.reader || reader(id, opts);
  return { json: st, height: toFloat32(await r.bin(st.height.file), st.height.w * st.height.h, st.height.file) };
}

export async function loadWorld(id, opts = {}) {
  const r = reader(id, opts);
  const json = await r.json('world.json');
  if (!Array.isArray(json.stages) || !json.stages.length) throw new Error(`${id}/world.json: no stages`);
  const want = opts.stages === false ? [] : Array.isArray(opts.stages) ? opts.stages : json.stages.map((_, k) => k);
  const [bb, ...grids] = await Promise.all([
    json.backdrop ? r.bin(json.backdrop.file) : null,
    ...want.map((k) => loadStage(id, json, k, { reader: r })),
  ]);
  const stages = json.stages.map(() => null);
  want.forEach((k, n) => (stages[k] = grids[n]));
  const backdrop = bb ? toFloat32(bb, json.backdrop.w * json.backdrop.h, json.backdrop.file) : null;
  return { json, backdrop, stages };
}
