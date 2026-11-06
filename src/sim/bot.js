// A simple AI that produces pad-like inputs {x, y, boost} for one slot: it follows the course
// centerline with a speed-dependent lookahead, grabs pickups ahead, boosts on straights, tries a steal
// on the drop just ahead, escapes animals and mashes boost to break ice. Used by browser tests and as an
// optional opponent. The seed varies its lane, lookahead and how much mass it keeps before boosting, so
// a rival does not ride the same line every race.
import { createRng } from './rng.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createBot(sim, slot, { preferShortcut = false, skill = 0.85, seed = slot + 1, pickups = true, boost = true, steal = true, lane } = {}) {
  const W = sim.world, T = sim.tuning;
  const rng = createRng(seed * 7919 + 13);
  const style = createRng(seed * 104729 + 7);
  if (lane === undefined) lane = (slot % 2 ? 0.3 : -0.3) + (style.next() - 0.5) * 0.3;
  const look = 0.8 + style.next() * 0.2; // lookahead per m/s
  const keep = 1.3 + style.next() * 0.4; // mass it keeps before boosting on a straight, at the start of the stage
  const reserve = 0.4; // more mass kept per stage played
  const straightCos = Math.cos(0.35); // rad of turn ahead that is still a straight for a boost
  const bendGrip = 30; // m/s^2 it trusts steering and banks with through a bend (v^2 / radius)
  let frame = 0, noise = 0, lastBoost = false, lastHunt = -Infinity;
  const idle = { x: 0, y: 0, boost: false };
  const rocks = (W.json.spawns?.obstacles || []).map((o) => ({ x: o.x, z: o.z, r: o.r ?? 2 }));
  // Which side of the main course a branch leaves on (+1 right, -1 left), from a point 30 m down it.
  const sides = new Map();
  const forkSide = (b) => {
    if (!sides.has(b.id)) { const q = W.pointAt(b.id, 30); sides.set(b.id, W.nearestPath(0, { x: q.cx, z: q.cz }, b.from, 20).lateral < 0 ? -1 : 1); }
    return sides.get(b.id);
  };

  // Point `ahead` meters downstream of the drop along the path it will follow.
  function aimPoint(tr, ahead) {
    if (tr.pathId === 0) {
      if (preferShortcut) {
        for (const b of W.branches) {
          const toFork = b.sFrom - tr.s;
          if (toFork > -150 && toFork < ahead) return W.pointAt(b.id, ahead - toFork);
        }
      }
      return W.pointAt(0, tr.s + ahead);
    }
    const b = W.branches[tr.pathId - 1];
    const left = b.path.length - tr.s;
    if (ahead <= left) return W.pointAt(tr.pathId, tr.s + ahead);
    return W.pointAt(0, b.sTo + (ahead - left));
  }

  return {
    get preferShortcut() { return preferShortcut; },
    set preferShortcut(v) { preferShortcut = !!v; },
    input() {
      frame++;
      const st = sim.state, p = st.players[slot];
      if (!p || st.phase !== 'race') return idle;
      if (p.status === 'frozen') return { x: 0, y: 0, boost: frame % 6 < 3 };
      if (p.status !== 'rolling' && p.status !== 'airborne') return idle;

      const tr = sim.track(slot);
      const speed = Math.hypot(p.vel.x, p.vel.z);
      const ahead = 12 + look * speed;
      const target = aimPoint(tr, ahead);
      // Each bot keeps its own lane (fraction of the half width) so two bots do not ride glued together.
      const nearFork = !tr.pathId && W.branches.some((b) => b.sFrom - tr.s < 150 && b.sFrom - tr.s > -150);
      const off = nearFork ? 0 : lane * target.hw * (tr.pathId ? 0.4 : 1);
      let tx = target.cx - target.tangent.z * off, tz = target.cz + target.tangent.x * off;

      let aimed = null; // the pickup it steers for
      if (pickups && p.mass < 3.6 && p.status === 'rolling') {
        let best = null, bd = Infinity;
        for (const pk of st.pickups) {
          if (!pk.active) continue;
          const dx = pk.pos.x - p.pos.x, dz = pk.pos.z - p.pos.z;
          const along = dx * tr.tangent.x + dz * tr.tangent.z;
          const lat = Math.abs(dx * -tr.tangent.z + dz * tr.tangent.x);
          if (along < 6 || along > 55 || lat > Math.max(4, along * 0.35)) continue;
          if (nearFork) {
            // Only pickups on the road this bot means to take.
            const fork = W.branches.find((b) => Math.abs(b.sFrom - tr.s) < 150);
            const onMain = W.nearestPath(0, pk.pos, fork.from + 6, 20);
            const onBranch = W.nearestPath(fork.id, pk.pos, 0, 20);
            if ((onBranch.dist < onMain.dist) !== preferShortcut) continue;
            // Staying on the main course it also leaves the water on the branch side of the bed: in a narrow bed
            // steering over to it sits the drop on that side at the fork, and the flow takes it down the branch.
            if (!preferShortcut && onMain.lateral * forkSide(fork) > 0.3 * onMain.hw) continue;
          }
          if (along < bd) { bd = along; best = pk; }
        }
        if (best) { tx = best.pos.x; tz = best.pos.z; aimed = { along: bd }; }
      }

      // The other drop just ahead: aim at it and boost into it for a steal.
      let prey = null;
      // At most one try every 8 s, so two bots running together do not trade mass all the way down.
      if (steal && p.status === 'rolling' && p.mass > 0.8 && frame - lastHunt > 8 * 60) {
        for (const o of st.players) {
          if (o.slot === slot || (o.status !== 'rolling' && o.status !== 'airborne')) continue;
          const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
          const along = ox * tr.tangent.x + oz * tr.tangent.z, side = ox * -tr.tangent.z + oz * tr.tangent.x;
          if (along > 1 && along < 10 && Math.abs(side) < 5) { prey = { along }; tx = o.pos.x + tr.tangent.x * 2; tz = o.pos.z + tr.tangent.z * 2; }
        }
      }

      // Steer around the nearest rock in the way, on the side the drop already leans to unless the bed runs out
      // there. It looks further at speed (a rock hit at 40 m/s stops the drop dead), and holds the boost meanwhile.
      let rock = null;
      const aimLat = (tx - p.pos.x) * -tr.tangent.z + (tz - p.pos.z) * tr.tangent.x;
      for (const r of rocks) {
        const ax = r.x - p.pos.x, az = r.z - p.pos.z;
        const along = ax * tr.tangent.x + az * tr.tangent.z;
        if (along < 0 || along > Math.max(45, 1.5 * speed) || (rock && along > rock.along)) continue;
        const lat = ax * -tr.tangent.z + az * tr.tangent.x;
        const clear = r.r + p.radius + 2.5;
        if (Math.abs(aimLat * (along / ahead) - lat) <= clear) rock = { along, lat, clear };
      }
      const rockAhead = !!rock;
      if (rock) {
        const room = tr.hw - p.radius - 1.5; // how far from the center line the drop can pass
        let side = rock.lat > 0 ? -1 : 1;
        if (Math.abs(tr.lateral + rock.lat + side * rock.clear) > room) side = -side;
        const shift = rock.lat + side * rock.clear - aimLat * (rock.along / ahead);
        tx += -tr.tangent.z * shift * (ahead / Math.max(rock.along, 1));
        tz += tr.tangent.x * shift * (ahead / Math.max(rock.along, 1));
      }
      const dx = tx - p.pos.x, dz = tz - p.pos.z, dl = Math.hypot(dx, dz) || 1;
      const rx = -tr.tangent.z, rz = tr.tangent.x;
      const e = (dx / dl) * rx + (dz / dl) * rz;
      const vlat = p.vel.x * rx + p.vel.z * rz;
      noise = noise * 0.97 + (rng.next() - 0.5) * 0.06 * (1 - clamp(skill, 0, 1));
      const x = clamp(3 * e - 0.12 * vlat + noise, -1, 1);
      // A bend too tight for its speed (the banks of a narrow torrent take speed and water on a hit): it brakes into it.
      const bendD = 10 + 1.2 * speed, bend = aimPoint(tr, bendD);
      const turn = Math.acos(clamp(bend.tangent.x * tr.tangent.x + bend.tangent.z * tr.tangent.z, -1, 1));
      const vSafe = turn > 0.05 ? Math.sqrt(bendGrip * (bendD / turn)) : Infinity;
      const y = speed > vSafe ? -clamp((speed - vSafe) / 10, 0.2, 1) : Math.abs(e) > 0.6 ? 0.3 : 1;

      let want = false;
      if (boost && p.status === 'rolling' && p.boostCooldown <= 0) {
        const drunk = st.animals.some((a) => a.target === slot && (a.state === 'drink' || a.state === 'approach'));
        if (drunk && p.mass > 0.45) want = true;
        else if (rockAhead) want = false;
        else if (prey && prey.along < 7) { want = true; lastHunt = frame; }
        // Timed: a boost that reaches the water drop it is lined up on scoops up more than it costs (pickup.boostBonus).
        else if (aimed && Math.abs(e) < 0.25 && aimed.along < speed * T.boost.time && p.mass > T.boost.fullMass) want = true;
        // On a clear straight it spends only what it has above its reserve, and the reserve grows down the race (the
        // mass carries from stage to stage), so a good line ends the race with a big drop, not one boosted down to keep.
        // A straight is one the boost will not run off: the course turns less than straightCos over the next second.
        else if (!aimed && p.mass > keep + reserve * (st.stage + tr.sEq / W.sFinish) && Math.abs(e) < 0.2 && tr.dist < tr.hw * 0.6 + 1.5) {
          const far = aimPoint(tr, speed + 10);
          want = far.tangent.x * tr.tangent.x + far.tangent.z * tr.tangent.z > straightCos;
        }
      }
      const out = want && !lastBoost;
      lastBoost = out;
      return { x, y, boost: out };
    },
  };
}
