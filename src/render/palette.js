// Ground albedo of the cartoon style, by real altitude, slope and distance from the stream, from the bands of the
// world's theme (themes/): meadow yellow-green to green, darker under the forest, scree above `alpine`, bare rock on
// the steep ground above `rockFrom`, grey moraine rubble in `moraineBand`, glacier ice above `iceAbove`, snow on the
// gentle high ground, warm earth banks and a wet bed along the stream, and where the theme has farmland
// (terrain.fields) a patchwork of crop plots below its altitude. Linear RGB (vertex colours).
// The pink-salmon of the lit rock and the mauve of its shade come from the lights, not from here.
import { linear, lerp, smooth, fbm, clamp, hash3 } from './math.js';

const mix = (o, c, t) => { o[0] = lerp(o[0], c[0], t); o[1] = lerp(o[1], c[1], t); o[2] = lerp(o[2], c[2], t); };
const KEYS = ['meadowY', 'meadow', 'meadowF', 'meadowD', 'forest', 'scree', 'screeD', 'rock', 'rockB', 'snow', 'ice', 'iceD', 'moraine', 'moraineD', 'bank', 'bankD', 'bankWet', 'bed'];

export function createPalette(theme) {
  const T = theme.terrain;
  const C = Object.fromEntries(KEYS.map((k) => [k, linear(T[k] || '#808080')]));
  const [ns1, ns2] = T.noiseScale;
  const treeline = T.treeline, alpine = T.alpine, rockFrom = T.rockFrom ?? 1500;
  const ice = Number.isFinite(T.iceAbove) ? T.iceAbove : Infinity, mor = T.moraineBand;
  // farmland: { below (m), size: [along, across] m of a plot, angle (deg of the plot rows), share of the plots under
  // a crop (the rest stays meadow), colors of the crops and the tilled earth, edge: m of grassy bund round a plot,
  // maxSlope: deg, steeper than this (plus 10) no plot }
  const F = T.fields || null, FC = F ? F.colors.map(linear) : null;
  const fa = F ? (F.angle || 0) * Math.PI / 180 : 0, fca = Math.cos(fa), fsa = Math.sin(fa);
  const plot = [0, 0, 0];
  // ground tints by altitude band: [{ alt: [from, to], color, amount, vary }] (the ash between the scrub, a moor);
  // vary (0..1, default 0.5): how much the colour noise thins the tint in patches
  const TI = (T.tints || []).map((t) => ({ ...t, c: linear(t.color) }));
  const HG = T.highGrass, highGrass = HG ? linear(HG.color) : null;

  // the sunny side (terrain.sunnySide { azimuth, lift, rubble }): ground facing that way keeps its grass and loses
  // its snow `lift` m higher than ground facing away (south-facing alpine pasture, north-facing scree), and carries
  // `rubble` less of the moraine rubble
  const SS = T.sunnySide, sx = SS ? Math.sin(SS.azimuth * Math.PI / 180) : 0, sz = SS ? -Math.cos(SS.azimuth * Math.PI / 180) : 0;

  // out: [r, g, b]; g: { alt, slope (deg), x, z (any frame, for noise), nx, nz (optional: the ground normal's
  //   horizontal part, for the sunny side), relief (optional: m above the surroundings, terrain.js reliefGrid), forest 0..1,
  //   stream: null or { r: lateral distance / hw, above: m above the water, side: -1 | 1 } }
  // cover: optional [rock, snow, ice] that receives the weights of the three covers instead of mixing them into out
  // (the shader draws them with crisp painted edges: materials.js CARTOON_COVER).
  // Returns the bare ground weight (0..1: rock, scree, ice, snow), also used to keep trees off it.
  function ground(out, g, cover = null) {
    const { alt, slope, x, z } = g;
    const n1 = fbm(x / ns1, z / ns1, 3), n2 = fbm(x / ns2, z / ns2, 5);
    // the altitude the scree, rubble and snow bands read: lower on the sunny side, higher facing away from it
    const sun = SS && Number.isFinite(g.nx) ? clamp((g.nx * sx + g.nz * sz) / 0.35, -1, 1) : 0, ba = alt - (SS ? SS.lift * sun : 0);
    out[0] = C.meadow[0]; out[1] = C.meadow[1]; out[2] = C.meadow[2];
    mix(out, C.meadowY, clamp(0.5 + 0.7 * n1, 0, 1) * 0.75);
    mix(out, C.meadowF, clamp(n2, 0, 1) * 0.55);
    mix(out, C.meadowD, smooth(16, 32, slope) * 0.6 + smooth(treeline - 400, treeline - 100, alt) * 0.2);
    for (const t of TI) mix(out, t.c, t.amount * smooth(t.alt[0] - 60, t.alt[0] + 60, alt + 40 * n1) * (1 - smooth(t.alt[1] - 60, t.alt[1] + 60, alt + 40 * n1)) * clamp(1 - 0.5 * (t.vary ?? 0.5) + (t.vary ?? 0.5) * n2, 0, 1));
    if (F && alt < F.below + 60) {
      // plots in rows (each row shifted), a crop or fallow meadow each, a bund of meadow round them; not on the
      // steep ground nor under the forest, and fading out up to the field line
      const u = x * fca + z * fsa, v = -x * fsa + z * fca, j = Math.floor(v / F.size[1]);
      const uu = u / F.size[0] + hash3(j, 3, 71), i = Math.floor(uu), fu = (uu - i) * F.size[0], fv = v - j * F.size[1];
      const pick = hash3(i, j, 72);
      if (pick < F.share) {
        const c = FC[Math.floor(hash3(i, j, 73) * FC.length)];
        plot[0] = c[0]; plot[1] = c[1]; plot[2] = c[2];
        const e = F.edge ?? 1.5, inner = smooth(0, e, Math.min(fu, F.size[0] - fu, fv, F.size[1] - fv));
        const w = (1 - smooth(F.below - 60, F.below + 60, alt + 40 * n1)) * (1 - smooth(F.maxSlope ?? 30, (F.maxSlope ?? 30) + 10, slope)) * (1 - (g.forest || 0)) * inner;
        mix(out, plot, w);
      }
    }
    if (g.forest) mix(out, C.forest, g.forest * T.forestTint);
    // the short dry grass of the alpine zone (tawny on limestone), in from the treeline, patchy at its lower edge
    if (highGrass) mix(out, highGrass, smooth(HG.from, HG.to, alt + 90 * n1) * HG.amount * (1 - 0.35 * clamp(n2, 0, 1)));
    // alpine: the meadow thins into scree above the treeline; the gentle ground keeps some pasture, except above
    // terrain.bareAbove (m), where nothing grows (bare rock and scree up to the summit)
    const bare = Number.isFinite(T.bareAbove) ? smooth(T.bareAbove - 100, T.bareAbove + 100, ba + 60 * n1) : 0;
    const scree = smooth(alpine - 120, alpine + 160, ba + 60 * n1) * (0.55 + 0.45 * Math.max(smooth(12, 26, slope), bare));
    mix(out, C.scree, scree);
    mix(out, C.screeD, scree * clamp(0.5 + n2, 0, 1) * 0.4);
    // moraine rubble: grey, in broken patches, on the gentle and middling ground of its band
    let rubble = 0;
    if (mor) {
      rubble = smooth(mor[0] - 60, mor[0] + 60, ba + 40 * n1) * (1 - smooth(mor[1] - 80, mor[1] + 40, ba + 40 * n1)) * (1 - smooth(40, 52, slope));
      rubble *= smooth(-0.45, 0.05, n2 + 0.25) * (1 - (SS?.rubble ?? 0) * Math.max(sun, 0)); // forefields lie in the shade and on the valley floor
      mix(out, C.moraine, rubble);
      mix(out, C.moraineD, rubble * clamp(0.5 - n2, 0, 1) * 0.6);
    }
    // ribs and gullies (terrain.ridges { depth m, shift deg, alt m }, g.relief: m the ground stands above its
    // surroundings): on a rib the rock comes out and the snow slides off `shift` deg gentler and starts `alt` m higher,
    // in a gully the snow holds that much steeper and reaches that much lower (tongues down the couloirs)
    const R = T.ridges, ribK = R && Number.isFinite(g.relief) ? clamp(g.relief / R.depth, -1, 1) : 0, rib = R ? ribK * R.shift : 0;
    // rock on the steep ground, from lower slopes the higher it gets
    const drop = 22 * smooth(alpine - 350, alpine + 250, alt);
    let rock = smooth(T.rockSlope[0] - drop, T.rockSlope[1] - drop, slope + rib + 4 * n2) * smooth(rockFrom - 400, rockFrom, alt + 200);
    // a stratum that forms a cliff band (terrain.rockBand.slope): bare from gentler slopes, the snow does not hold on it
    const RB = T.rockBand, stratum = RB?.slope ? smooth(RB.alt[0] - 30, RB.alt[0] + 30, alt + 30 * n1) * (1 - smooth(RB.alt[1] - 30, RB.alt[1] + 30, alt + 30 * n1)) * smooth(RB.slope[0], RB.slope[1], slope + 6 * n2) : 0;
    rock = Math.max(rock, stratum);
    if (!cover) { mix(out, C.rock, rock); mix(out, C.rockB, rock * clamp(0.5 + n1, 0, 1) * 0.6); }
    // glacier ice on the gentle ground above its line, with the blue of the crevassed and shaded ice in streaks;
    // terrain.iceSlope (deg, default snowSlope): steeper than this no bare ice, a steep face is snow and rock
    const iceSlope = T.iceSlope ?? T.snowSlope;
    const glacier = ice < Infinity ? smooth(ice - 80, ice + 40, alt + 50 * n1) * (1 - smooth(iceSlope - 2, iceSlope + 8, slope)) : 0;
    if (!cover) { mix(out, C.ice, glacier); mix(out, C.iceD, glacier * clamp(0.3 - n2 * 0.8, 0, 1)); }
    // snow on the gentle high ground, patches lower down (terrain.snowNoise: m the noise moves the snowline, default 260)
    const snow = smooth(T.snowAbove - 250, T.snowAbove + 80, ba + (T.snowNoise ?? 260) * n1 - ribK * (R?.alt ?? 0)) * (1 - smooth(T.snowSlope - 6, T.snowSlope + 4, slope + rib)) * (1 - stratum);
    if (!cover) mix(out, C.snow, snow);
    const s = g.stream;
    let wet = 0; // how much of the spot is bank or bed: no cover there
    if (s) {
      // the bank: warm earth on the rise from the water to the meadow, darker on the right side, wet at the waterline
      const [b0, b1] = T.bankWidth;
      const band = smooth(b0 - 0.12, b0, s.r) * (1 - smooth(b1 - 0.25, b1, s.r)) * (1 - smooth(T.bankHeight * 0.6, T.bankHeight, s.above));
      const bank = s.side > 0 ? C.bankD : C.bank;
      mix(out, bank, band * (0.15 + 0.1 * n2)); // a soft tint: the crisp earth is the draped bank strip (water.js)
      mix(out, C.bankWet, band * (1 - smooth(0.05, 0.6, s.above)) * 0.7);
      // the wet bed only under the water: past the end of the stream the carved trench keeps the bank colours
      const bed = (1 - smooth(-0.1, 0.15, s.above)) * (1 - smooth(1, 8, s.past || 0));
      mix(out, C.bed, bed);
      wet = Math.max(band, bed);
    }
    if (cover) { cover[0] = rock * (1 - wet); cover[1] = snow * (1 - wet); cover[2] = glacier * (1 - wet); }
    return Math.max(rock, scree * 0.6, snow, glacier, rubble * 0.7);
  }
  return { ground, colors: C };
}
