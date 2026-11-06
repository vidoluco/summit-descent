// Copernicus DEM tiles from data/raw/dem/, read whole and sampled bilinearly in lon/lat.
// GLO-30 tiles are PixelIsPoint: sample (i, j) sits at lon0 + i * rx, lat0 - j * ry.
// Tiles are named by their south-west corner: N45_E011 covers lat 45..46, lon 11..12; S09_E116 covers
// lat -9..-8; N36_W119 covers lon -119..-118. ensureTiles() downloads missing ones from the public S3
// buckets (GLO-30, falling back to GLO-90 where GLO-30 has no tile); loadDem() fills void cells.
import { readdirSync, existsSync, mkdirSync, createWriteStream, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromFile } from 'geotiff';
import { bilinear } from '../../src/world/sample.js';

const pad = (n, w) => String(n).padStart(w, '0');
// Short tile name (N45_E011) of the tile holding (lat, lon). A point on a tile edge belongs to the tile
// north and east of it, as in the Copernicus grid.
export function tileOf(lat, lon) {
  const a = Math.floor(lat), o = Math.floor(lon);
  return `${a < 0 ? 'S' : 'N'}${pad(Math.abs(a), 2)}_${o < 0 ? 'W' : 'E'}${pad(Math.abs(o), 3)}`;
}
// Short names of every tile a lat/lon box touches: [south, west, north, east].
export function tilesForBox([s, w, n, e]) {
  const out = [];
  for (let a = Math.floor(s); a <= Math.floor(n); a++) for (let o = Math.floor(w); o <= Math.floor(e); o++) out.push(tileOf(a, o));
  return out;
}
// GLO-30 is product 10 (1 arc second), GLO-90 product 30 (3 arc seconds).
export function tileFile(short, res = 30) {
  const [la, lo] = short.split('_');
  return `Copernicus_DSM_COG_${res === 90 ? 30 : 10}_${la}_00_${lo}_00_DEM.tif`;
}
export const tileUrl = (short, res = 30) => {
  const f = tileFile(short, res);
  return `https://copernicus-dem-${res}m.s3.amazonaws.com/${f.slice(0, -4)}/${f}`;
};

async function download(url, out) {
  const res = await fetch(url, { headers: { 'User-Agent': 'summit-descent/0.1 (personal hobby game)' } });
  if (res.status === 404 || res.status === 403) return false; // the bucket answers 403 for a missing key
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // a private part file, so parallel bakes never read half a tile
  const part = `${out}.${process.pid}.${Date.now()}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    renameSync(part, out);
  } finally {
    rmSync(part, { force: true });
  }
  return true;
}

// Makes sure every tile is on disk. Returns [{ tile, file, res }] with res 30 or 90, or
// { tile, file: null, res: null } for a tile neither product has (open sea: elevation 0).
export async function ensureTiles(tiles, dir = 'data/raw/dem', { log = () => {}, offline = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const tile of tiles) {
    let got = null;
    for (const res of [30, 90]) {
      const f = tileFile(tile, res);
      if (existsSync(`${dir}/${f}`)) { got = { tile, file: f, res }; break; }
    }
    for (const res of offline || got ? [] : [30, 90]) {
      const f = tileFile(tile, res);
      log(`downloading ${tileUrl(tile, res)}`);
      if (await download(tileUrl(tile, res), `${dir}/${f}`)) { got = { tile, file: f, res }; break; }
      log(`${tile}: no GLO-${res} tile`);
    }
    if (!got && offline) throw new Error(`DEM tile ${tile} is not in ${dir} (offline)`);
    out.push(got || { tile, file: null, res: null });
  }
  return out;
}

const isVoid = (v, nodata) => !Number.isFinite(v) || v === nodata || v < -1000;

// Fills void cells in place: first from `fallback(lon, lat)` (the GLO-90 tile) when given, then by
// averaging valid neighbours ring by ring. Returns the number of cells filled.
export function fillVoids(t, nodata, fallback) {
  const { w, h, data } = t;
  let holes = [];
  for (let k = 0; k < data.length; k++) if (isVoid(data[k], nodata)) holes.push(k);
  const n = holes.length;
  if (!n) return 0;
  if (fallback) {
    holes = holes.filter((k) => {
      const i = k % w, j = (k / w) | 0, v = fallback(t.lon0 + (i + t.off) * t.rx, t.lat0 - (j + t.off) * t.ry);
      if (v == null || isVoid(v, nodata)) return true;
      data[k] = v;
      return false;
    });
  }
  while (holes.length) {
    const next = [], vals = [];
    for (const k of holes) {
      const i = k % w, j = (k / w) | 0;
      let s = 0, c = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if ((di || dj) && ni >= 0 && nj >= 0 && ni < w && nj < h && !isVoid(data[nj * w + ni], nodata)) { s += data[nj * w + ni]; c++; }
      }
      if (c) vals.push([k, s / c]); else next.push(k);
    }
    if (!vals.length) break;
    for (const [k, v] of vals) data[k] = v; // a ring at a time, so the fill does not depend on scan order
    holes = next;
  }
  for (const k of holes) data[k] = 0; // a tile with no valid cell at all
  return n;
}

async function readTile(path, f) {
  const img = await (await fromFile(path)).getImage();
  const [lon0, lat0] = img.getOrigin(), [rx, ry] = img.getResolution();
  const off = img.getGeoKeys().GTRasterTypeGeoKey === 2 ? 0 : 0.5;
  const w = img.getWidth(), h = img.getHeight();
  const data = Float32Array.from((await img.readRasters({ interleave: false }))[0]);
  return { f, lon0, lat0, rx, ry: -ry, off, w, h, data, nodata: img.getGDALNoData(), meta: { w, h, x0: 0, z0: 0, step: 1 } };
}

const hit = (t, lon, lat) => {
  const u = (lon - t.lon0) / t.rx - t.off, v = (t.lat0 - lat) / t.ry - t.off;
  return u >= -0.5 && v >= -0.5 && u <= t.w - 0.5 && v <= t.h - 0.5 ? [u, v] : null;
};

// only(filename): optional filter, so a test can read just the tile it needs.
// files: explicit file names in dir (a world's tiles); sea: short names of tiles no product has
// (elevation 0). A GLO-30 tile with voids is filled from its GLO-90 twin when that is on disk.
export async function loadDem(dir = 'data/raw/dem', { only, files: list, sea = [], log = () => {} } = {}) {
  const files = (list ? list.slice() : readdirSync(dir).filter((f) => f.endsWith('.tif') && (!only || only(f)))).sort();
  if (!files.length && !sea.length) throw new Error(`no DEM tiles in ${dir}`);
  const tiles = [], voids = {};
  for (const f of files) {
    const t = await readTile(`${dir}/${f}`, f);
    let fallback = null;
    const twin = f.replace('_COG_10_', '_COG_30_');
    if (twin !== f && existsSync(`${dir}/${twin}`) && t.data.some((v) => isVoid(v, t.nodata))) {
      const g = await readTile(`${dir}/${twin}`, twin);
      fallback = (lon, lat) => { const uv = hit(g, lon, lat); return uv ? bilinear(g.meta, g.data, uv[0], uv[1]) : null; };
    }
    const n = fillVoids(t, t.nodata, fallback);
    if (n) {
      voids[f] = { cells: n, filledFrom: fallback ? 'GLO-90, then neighbours' : 'neighbours' };
      log(`${f}: ${n} void cells filled from ${voids[f].filledFrom}`);
    }
    tiles.push(t);
  }
  let last = tiles[0];
  function elevation(lon, lat) {
    let uv = last && hit(last, lon, lat);
    if (!uv) {
      for (const t of tiles) if ((uv = hit(t, lon, lat))) { last = t; break; }
      if (!uv) {
        if (sea.includes(tileOf(lat, lon))) return 0;
        throw new Error(`no DEM tile covers lon ${lon} lat ${lat}: add "${tileOf(lat, lon)}" to dem.tiles of the world config`);
      }
    }
    return bilinear(last.meta, last.data, uv[0], uv[1]);
  }
  return { tiles: tiles.map((t) => t.f), voids, elevation };
}

// Local equirectangular frame around (lat0, lon0): x east, z south, metres.
export function localFrame(lat0, lon0) {
  const p = (lat0 * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  return {
    lat0, lon0,
    toXZ: (lon, lat) => [(lon - lon0) * mLon, -(lat - lat0) * mLat],
    toLonLat: (x, z) => [lon0 + x / mLon, lat0 - z / mLat],
  };
}

// Metres between two lon/lat points (equirectangular at their mean latitude, measured from point 1).
export function geoDist(lon1, lat1, lon2, lat2) {
  const f = localFrame((lat1 + lat2) / 2, lon1);
  const [x, z] = f.toXZ(lon2, lat2), [, z1] = f.toXZ(lon1, lat1);
  return Math.hypot(x, z - z1);
}
