// What people built along the course, and its lakes, from the cached Overpass answer (features.json, `out geom`,
// osm.featuresBbox): buildings as oriented boxes, roads and cable cars as lines, lakes as rings. Everything comes
// back in the bake's global frame (x east, z south, metres); the bake keeps what lies on each stage grid.
// Answers are untrusted data: read as coordinates, names and a few tags, never run.
import { readFileSync, existsSync } from 'node:fs';
import { joinRings } from './glaciers.mjs';

// The kind a building is drawn as: a mountain hut or chalet, a church (with its bell tower), a hay barn, or a house.
export function buildingKind(tags = {}) {
  if (tags.amenity === 'place_of_worship' || ['church', 'chapel', 'cathedral'].includes(tags.building)) return 'church';
  if (['alpine_hut', 'wilderness_hut', 'chalet', 'hotel', 'guest_house', 'hostel'].includes(tags.tourism) || tags.building === 'hotel') return 'hut';
  if (['barn', 'farm_auxiliary', 'shed', 'hut', 'cowshed', 'stable', 'hayloft'].includes(tags.building)) return 'barn';
  return 'house';
}

// Oriented box of a footprint ring [[x, z], ...]: centre, size along and across its longest edge, and the angle of
// that edge (rad, from +x toward +z).
export function footprintBox(ring) {
  let best = 0, rot = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const dx = ring[i + 1][0] - ring[i][0], dz = ring[i + 1][1] - ring[i][1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; rot = Math.atan2(dz, dx); }
  }
  const c = Math.cos(rot), s = Math.sin(rot);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of ring) {
    const u = x * c + z * s, v = -x * s + z * c;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  return { x: um * c - vm * s, z: um * s + vm * c, w: u1 - u0, d: v1 - v0, rot };
}

// { lakes: [{name, ring}], buildings: [{kind, name, x, z, w, d, rot, levels}], roads: [{kind, name, line}],
// cables: [{name, line}] } in the global frame, or null without the cache. toXZ(lon, lat) -> [x, z].
export function loadFeatures(file, toXZ, nameTags = ['name']) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const nameOf = (t) => nameTags.map((k) => t?.[k]).find(Boolean) || null;
  const xz = (g) => g.map((p) => toXZ(p.lon, p.lat));
  const out = { lakes: [], buildings: [], roads: [], cables: [] };
  for (const e of j.elements || []) {
    const t = e.tags || {};
    if (t.natural === 'water') {
      const lines = e.type === 'way' && e.geometry ? [e.geometry.map((p) => [p.lon, p.lat])]
        : (e.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
      for (const r of joinRings(lines)) out.lakes.push({ name: nameOf(t), ring: r.map(([lon, lat]) => toXZ(lon, lat)) });
    } else if (t.building && e.type === 'way' && e.geometry?.length >= 4) {
      const b = footprintBox(xz(e.geometry));
      if (b.w < 2 || b.d < 2 || b.w > 80) continue; // a mapping slip or a whole block
      const levels = Number.parseInt(t['building:levels'], 10);
      out.buildings.push({ kind: buildingKind(t), name: nameOf(t), ...b, levels: Number.isFinite(levels) ? Math.min(levels, 5) : null });
    } else if (t.highway && e.geometry) out.roads.push({ kind: t.highway, name: nameOf(t), line: xz(e.geometry) });
    else if (t.aerialway && e.geometry) out.cables.push({ name: nameOf(t), line: xz(e.geometry) });
  }
  return out;
}

// Even-odd point in ring test, ring [[x, z], ...].
export function inPolygon(ring, x, z) {
  let c = false;
  for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
    if ((ring[i][1] > z) !== (ring[k][1] > z) && x < ((ring[k][0] - ring[i][0]) * (z - ring[i][1])) / (ring[k][1] - ring[i][1]) + ring[i][0]) c = !c;
  }
  return c;
}
