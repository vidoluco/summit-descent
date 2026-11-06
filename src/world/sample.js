// Grid sampling shared by the bake (node) and the game (browser). Same interpolation as
// web-swing/tools/dem-lib.mjs: bilinear between the four nodes around the point, clamped at the edges.
// meta = { w, h, x0, z0, step }, data = Float32Array of w*h heights, row by row (z rows, x columns).

export function bilinear({ w, h, x0, z0, step }, data, x, z) {
  const u = Math.min(Math.max((x - x0) / step, 0), w - 1), v = Math.min(Math.max((z - z0) / step, 0), h - 1);
  const i = Math.min(Math.floor(u), w - 2), j = Math.min(Math.floor(v), h - 2);
  const fu = u - i, fv = v - j, k = j * w + i;
  return data[k] * (1 - fu) * (1 - fv) + data[k + 1] * fu * (1 - fv) + data[k + w] * (1 - fu) * fv + data[k + w + 1] * fu * fv;
}

// Returns heightAt(x, z), plus a flag telling whether the point falls inside the grid.
export function makeSampler(meta, data) {
  const x1 = meta.x0 + (meta.w - 1) * meta.step, z1 = meta.z0 + (meta.h - 1) * meta.step;
  return {
    heightAt: (x, z) => bilinear(meta, data, x, z),
    inside: (x, z) => x >= meta.x0 && x <= x1 && z >= meta.z0 && z <= z1,
  };
}

// Stage local frame <-> world (global) frame: a pure translation by stage.offset (1:1, no rotation).
export const toGlobal = (stage, p) => ({ x: p.x + stage.offset.x, y: (p.y ?? 0) + stage.offset.y, z: p.z + stage.offset.z });
export const toLocal = (stage, p) => ({ x: p.x - stage.offset.x, y: (p.y ?? 0) - stage.offset.y, z: p.z - stage.offset.z });

// Ground height of stage k in its local frame, for gameplay and rendering: the fine stage grid where
// it covers the point, the coarse global backdrop (shifted into the stage frame) elsewhere.
// world = loadWorld() result, with stage k loaded.
export function makeGround(world, k) {
  const st = world.stages[k];
  if (!st) throw new Error(`makeGround: stage ${k} not loaded`);
  const fine = makeSampler(st.json.height, st.height), o = st.json.offset;
  const coarse = world.backdrop ? makeSampler(world.json.backdrop, world.backdrop) : null;
  return (x, z) => (fine.inside(x, z) || !coarse ? fine.heightAt(x, z) : coarse.heightAt(x + o.x, z + o.z) - o.y);
}
