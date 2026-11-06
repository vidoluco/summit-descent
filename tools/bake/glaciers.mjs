// Glacier outlines from the cached Overpass answer (natural=glacier ways and multipolygon relations,
// `out geom`), for the `ice` zones: a course point is on ice when it lies inside a glacier outline.
// Icefalls are part of the glacier outline in OSM (sometimes tagged glacier:type=icefall), so they are
// ice too. Rings are tested even-odd, which handles multipolygon holes.
import { readFileSync, existsSync } from 'node:fs';

const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

// Joins open ways into closed rings by shared end points; leftovers that never close are dropped.
export function joinRings(lines) {
  const rings = [], open = [];
  for (const l of lines) (l.length > 3 && key(l[0]) === key(l.at(-1)) ? rings : open).push(l.slice());
  while (open.length) {
    let cur = open.shift(), grew = true;
    while (grew && key(cur[0]) !== key(cur.at(-1))) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i], end = key(cur.at(-1));
        if (key(o[0]) === end) cur = cur.concat(o.slice(1));
        else if (key(o.at(-1)) === end) cur = cur.concat(o.slice().reverse().slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (cur.length > 3 && key(cur[0]) === key(cur.at(-1))) rings.push(cur);
  }
  return rings;
}

export function loadGlaciers(file, nameTags = ['name']) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const glaciers = [];
  for (const e of j.elements || []) {
    let lines = [];
    if (e.type === 'way' && e.geometry) lines = [e.geometry.map((p) => [p.lon, p.lat])];
    else if (e.type === 'relation') lines = (e.members || []).filter((m) => m.type === 'way' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
    const rings = joinRings(lines).map((r) => {
      let w = Infinity, s = Infinity, ea = -Infinity, n = -Infinity;
      for (const [x, y] of r) { w = Math.min(w, x); ea = Math.max(ea, x); s = Math.min(s, y); n = Math.max(n, y); }
      return { r, box: [w, s, ea, n] };
    });
    if (rings.length) glaciers.push({ id: `${e.type}/${e.id}`, name: nameTags.map((k) => e.tags?.[k]).find(Boolean) || null, icefall: e.tags?.['glacier:type'] === 'icefall', rings });
  }
  return glaciers;
}

const inRing = ({ r, box }, x, y) => {
  if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) return false;
  let c = false;
  for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
    if ((r[i][1] > y) !== (r[k][1] > y) && x < ((r[k][0] - r[i][0]) * (y - r[i][1])) / (r[k][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
};

// The glacier holding (lon, lat), or null.
export function glacierAt(glaciers, lon, lat) {
  for (const g of glaciers || []) {
    let c = false;
    for (const ring of g.rings) if (inRing(ring, lon, lat)) c = !c;
    if (c) return g;
  }
  return null;
}
