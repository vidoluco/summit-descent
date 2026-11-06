// How big a drop looks for its mass, and how much of its water runs behind it as a wake. Pure numbers, no
// three.js: the drop (drop.js), its wake (drop-tail.js) and the chase camera read the same curves, and node tests
// them. The sim keeps its own contact radius (cube root of the mass); the drawn body grows faster up to a size a
// drop can hold, and the water beyond that does what water does on a slope: it streams out behind the drop, a
// flat foamy wake on the surface that widens and lengthens into a little torrent of its own.
//
// The curves are set on the masses a race really sees (bot races over every world, stages carried over: mostly
// 1.2 to 2, the heaviest drop 2.5 to 2.8 at the end, 4 never), so the whole range of the look gets used:
//
//   mass   0.5   1     1.5   2     2.5   2.8+
//   body   0.57  1     1.38  1.74  1.89  1.91   x the drawn size at mass 1 (the drop of stage 4 is near twice the first)
//   wake   0     0     5.0   5.9   6.6   7      x the body radius behind it, fanning out from 1-1.2 to 2.8-3.4 radii
export const DROP_LOOK = {
  grow: {
    exp: 0.8, // body scale = mass^exp up to cap (the sim radius goes with mass^0.33: too little to see from the sofa)
    cap: 2.2, // mass where the body stops growing fast: past it the extra water is the wake's
    over: 0.06, // and grows only as (mass / cap)^over beyond it
    belly: 0.1, // a grown drop is rounder too: its width x 1 + belly per unit of growth (at most one)
    stiffness: 150, damping: 10, // spring of the drawn size toward the size of the mass
    kick: 2.6, // x radius / s pushed into the spring per 0.2 of mass gained: a pickup pops the drop ~20 % past its new size
    shrink: 1.2, // the same, inward, per 0.2 of mass lost (a sip, a boost, a steal): it wobbles smaller
    flash: 0.55, // glow (toward white) right after a pickup
    gulp: 0.55, // s of the ripple ring a pickup sends out over the water
  },
  tail: {
    from: 1.15, // mass where a wake starts to trail the drop (the first pickup)
    full: 2.8, // mass of the longest and widest one (the HUD drop is full there too: src/ui/index.js)
    length: [3.5, 7], // x the body radius, from the first wake to the full torrent (fading out over it: no long tube)
    min: 0.8, // m: shorter than this it is not drawn
    width: [1.0, 1.2], // half width where it leaves the drop, x the body radius: just wider than the body, so its
    // foam lines show at both sides of the drop from the chase camera (the rest of it lies below the view)
    spread: [2.2, 3.4], // half width at its end, x the body radius: a wake fans out behind, fast near the drop
    bend: 0.25, // at most this sideways m per m behind: it follows a curve of the path, never a kink (a rock hit)
    grow: 1.6, shrink: 7, // 1/s: it lengthens slowly as water arrives and is pulled in fast when it is spent
    wet: 5, // 1/s: it fades in on the water and out on a bank (a wake is the water's, not the ground's)
    meander: 0.06, meanderLength: 6, meanderSpeed: 1.2, // x body radius, m, 1/s: it wavers gently
    opacity: 0.22, // its middle lets the river show through; the foam lines and the rim are nearly opaque
    tint: 0.25, // share of the drop's colour in the wake's water (the rest is the river's light colour)
    rim: 0.06, // share of the width drawn in a light tone of the drop's colour at each edge (no dark ink: it is water)
    spacing: 0.35, // m between recorded points of the path behind the drop
  },
  // the chase camera (camera.js) makes room as the drop grows: back and up scaled by
  // 1 + back|up x (body scale - 1) + tailBack|tailUp x tail share; far less than the drop grows, so a bigger drop
  // fills more of the view (the wake is short and flat: it needs little room)
  camera: { back: 0.06, up: 0.1, tailBack: 0.02, tailUp: 0.06 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Drawn body scale for a mass, relative to the drop at mass 1.
export function bodyScale(mass, G = DROP_LOOK.grow) {
  const m = Math.max(mass, 0.01);
  return m <= G.cap ? Math.pow(m, G.exp) : Math.pow(G.cap, G.exp) * Math.pow(m / G.cap, G.over);
}

// Share of the tail (0 none, 1 the longest) for a mass.
export const tailShare = (mass, L = DROP_LOOK.tail) => clamp01((mass - L.from) / (L.full - L.from));

const range = (v, k) => { const [a, b] = Array.isArray(v) ? v : [v, v]; return a + (b - a) * k; };

// Length of the wake behind a drop of this mass, x its drawn body radius (0 below DROP_LOOK.tail.from).
export function tailLength(mass, L = DROP_LOOK.tail) {
  const s = tailShare(mass, L);
  return s > 0 ? range(L.length, Math.sqrt(s)) : 0;
}

// Half width of the wake where it leaves the drop, x the drawn body radius: a torrent widens as it grows.
export const tailWidth = (mass, L = DROP_LOOK.tail) => range(L.width, Math.sqrt(tailShare(mass, L)));

// Half width of the wake at its far end, x the drawn body radius: it fans out wider as the drop grows.
export const tailSpread = (mass, L = DROP_LOOK.tail) => range(L.spread, Math.sqrt(tailShare(mass, L)));

// The look of a theme: DROP_LOOK with theme.drop.look ({ grow, tail, camera } overrides; tail: false, no rivulet).
export function lookOf(theme) {
  const o = theme?.drop?.look || {};
  return { grow: { ...DROP_LOOK.grow, ...o.grow }, tail: o.tail === false ? null : { ...DROP_LOOK.tail, ...o.tail }, camera: { ...DROP_LOOK.camera, ...o.camera } };
}

// Scale of the chase camera's back and up offsets for a sim player (L: lookOf(theme)).
export function framing(p, L = DROP_LOOK) {
  const m = p.mass ?? 1, C = L.camera, b = bodyScale(m, L.grow) - 1, t = L.tail ? tailShare(m, L.tail) : 0;
  const tail = t > 0 ? Math.sqrt(t) : 0;
  return { back: 1 + C.back * b + C.tailBack * tail, up: 1 + C.up * b + C.tailUp * tail };
}

// Drawn radius of a sim player (p.radius is the contact radius, mass^(1/3) x the radius at mass 1).
export function visualRadius(p, G = DROP_LOOK.grow) {
  const m = Math.max(p.mass ?? 1, 0.01);
  return (p.radius / Math.cbrt(m)) * bodyScale(m, G);
}
