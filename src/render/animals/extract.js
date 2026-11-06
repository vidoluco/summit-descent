// glTF scene -> one welded triangle soup with a flat colour per face, in the model's own frame (all node
// transforms applied). A face takes its material colour times the texture sampled at its centroid UV,
// so palette-atlas and painted sources alike end up as plain face colours for the shared toon material.
// Skinned sources are posed first (clip name and time), so a Quaternius rig can be baked in any frame.
import * as THREE from 'three';

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Texture -> { w, h, data } (sRGB bytes), read once per image through a canvas.
function texels(tex, cache) {
  const img = tex?.image;
  if (!img) return null;
  if (cache.has(img)) return cache.get(img);
  const w = img.width, h = img.height;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const out = { w, h, data: ctx.getImageData(0, 0, w, h).data, flipY: tex.flipY };
  cache.set(img, out);
  return out;
}

function sample(t, u, v, out) {
  // glTF textures are not flipped (flipY false): v = 0 is the top row of the image
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(t.w - 1, Math.floor(u * t.w)), y = Math.min(t.h - 1, Math.floor((t.flipY ? 1 - v : v) * t.h));
  const i = (y * t.w + x) * 4;
  out[0] = toLin(t.data[i] / 255); out[1] = toLin(t.data[i + 1] / 255); out[2] = toLin(t.data[i + 2] / 255);
  return out;
}

export function extract(root, { clip = null, time = 0, animations = [] } = {}) {
  if (clip) {
    const c = animations.find((a) => a.name === clip || a.name.endsWith(`|${clip}`));
    if (c) { const mixer = new THREE.AnimationMixer(root); mixer.clipAction(c).play(); mixer.setTime(time); }
  }
  root.updateMatrixWorld(true);
  const pos = [], col = [], cache = new Map(), v = new THREE.Vector3(), rgb = [0, 0, 0];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    const g = o.geometry, P = g.attributes.position, UV = g.attributes.uv, I = g.index;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
    if (o.isSkinnedMesh) o.skeleton.update();
    const world = (i) => {
      v.fromBufferAttribute(P, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      return v.applyMatrix4(o.matrixWorld);
    };
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      const base = m.color || new THREE.Color(1, 1, 1), tex = m.map ? texels(m.map, cache) : null;
      for (let k = gr.start; k + 2 < gr.start + gr.count; k += 3) {
        const ids = [0, 1, 2].map((j) => (I ? I.getX(k + j) : k + j));
        for (const i of ids) { const w = world(i); pos.push(w.x, w.y, w.z); }
        let r = base.r, gg = base.g, b = base.b;
        if (tex && UV) {
          const u = (UV.getX(ids[0]) + UV.getX(ids[1]) + UV.getX(ids[2])) / 3, vv = (UV.getY(ids[0]) + UV.getY(ids[1]) + UV.getY(ids[2])) / 3;
          sample(tex, u, vv, rgb); r *= rgb[0]; gg *= rgb[1]; b *= rgb[2];
        }
        col.push(r, gg, b);
      }
    }
  });
  return { positions: new Float32Array(pos), colors: new Float32Array(col) };
}
