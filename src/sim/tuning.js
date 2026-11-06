// Every gameplay constant of the sim. Units: meters, seconds, mass in "drop units" (start = 1).
// Rates written as 1/s are exponential: a term k * v removes about k of v per second.
// createSim(world, { tuning }) deep-merges overrides on top of this object.
export const TUNING = {
  dt: 1 / 60, // s, fixed step
  gravity: 9.81, // m/s^2
  countdown: 3, // s before the race starts; the snowflake melts during it
  grace: 30, // s the others have after the first finisher

  mass: {
    start: 1,
    max: 4,
    evaporate: 0.25, // below this the drop evaporates
    respawn: 1, // mass after an evaporation respawn
  },
  radius: 0.55, // m at mass 1, scales with cbrt(mass)

  speed: {
    // Top speed in the bed: vmaxBase + vmaxPerMass * mass + vmaxSlope * sqrt(min(grade, slopeMax)), grade
    // being the course drop per meter over +/-50 m (world-access GRADE_SPAN). Mass 1: about 28 m/s on a 5 %
    // valley stream, 39 m/s at 40 %, 46 m/s on a 70 % snowfield, so the real slope sets the pace.
    vmaxBase: 20, // m/s on the flat at mass 0
    vmaxPerMass: 1.0, // m/s per unit of mass (mass 4 is +3 m/s over mass 1, not a runaway leader)
    vmaxSlope: 30, // m/s at grade 1 (sqrt law)
    slopeMax: 0.8, // grade beyond this adds nothing (waterfalls, cliffs)
    cruiseFrac: 0.8, // the current pushes toward this fraction of top speed
    overDamp: 2.0, // 1/s, pulls speed back to the cap when above it
    drag: 0.0003, // 1/m, quadratic air drag
    maxVy: 60, // m/s clamp on the vertical speed derived from the ground
  },
  // Rubber band: a drop behind the leader of the stage gets its top speed and cruise speed raised by
  // min(max, gap / per) m/s, gap in meters along the course. Humans and bots alike. Weak on purpose (playtest r1,
  // 28/10/2026: at 6 m/s per 40 m a player who crashed twice finished 0.7 s behind a clean one): it keeps the
  // trailer inside the 30 s grace, it does not erase a better line.
  catchup: {
    per: 80, // m of gap per m/s
    max: 2.5, // m/s
  },
  bed: {
    edge: 3, // m of soft transition between bed and bank
    current: 0.12, // 1/s, pull of the river current toward cruise speed along the tangent
    friction: 0.03, // 1/s
    grip: 3.0, // 1/s, decay of sideways velocity relative to the course tangent
    // The carved banks hold the flow through a bend like a bobsled wall: from bankFrom of the half width
    // out to the bed edge a push toward the center grows to `bank`, plus bankDamp on the outward speed.
    // A stick held toward the bank lowers it, from nothing at liftFrom to all of it at liftFull, so leaving
    // the bed takes a deliberate steer, not just a bend taken at speed.
    bank: 24, // m/s^2 at the bed edge
    liftFrom: 0.3, // stick toward the bank where it starts to give way
    liftFull: 0.8, // stick toward the bank that climbs right over it
    bankFrom: 0.6, // fraction of the half width where the bank starts
    bankDamp: 4, // 1/s on the outward sideways speed on the bank
    // Past the bed edge the bank is a wall: a drop not steering out on purpose stops there, losing the
    // speed it had across the bed (a hairpin taken flat out costs speed, not a respawn).
    wall: 1, // m beyond the half width
    wallStick: 0.5, // stick toward the bank beyond this goes over the wall
    wallBounce: 0.2, // fraction of the speed into the wall that bounces back
    wallBump: 4, // m/s onto the bank (past the bed edge) for a bump event
    wallLip: 0.3, // s of flight within which a drop launched off the lip of the bank still hits the wall
    // A bump onto the bank costs up to wallBleed of the speed and wallLoss of mass, growing from wallBump m/s in to
    // wallHard m/s in.
    wallHard: 14, // m/s
    wallBleed: 0.35,
    wallLoss: 0.05, // mass
    // The current is fastest in the middle of the bed: top and cruise speed fall by edgeSlow * (lateral / hw)^2,
    // about 1 % on a bot's lane (0.3 of the half width), 12 % riding the bank.
    edgeSlow: 0.12,
  },
  offBed: {
    friction: 1.2, // 1/s, rocks and grass slow the drop a lot
    grip: 1.5, // 1/s
    steer: 0.7, // factor on steering away from the bed
  },
  steer: {
    lateral: 16, // m/s^2 at full stick sideways (relative to the course tangent)
    forward: 2, // m/s^2 at full stick forward
    brake: 12, // m/s^2 at full stick back
    massFactor: 0.15, // steering is divided by (1 - massFactor + massFactor * mass)
    air: 0.25, // factor on steering while airborne
  },
  air: {
    launchGap: 0.25, // m: ground falling away faster than this per step launches the drop
    landingKeep: 0.9, // fraction of horizontal speed kept on landing
    splashMinAir: 0.2, // s of flight needed for a splash event
    hardImpact: 12, // m/s vertical impact above which the landing sprays mass away
    splashLoss: 0.04, // mass lost per 10 m/s of impact above hardImpact
    splashLossMax: 0.08,
    grip: 2.5, // 1/s, decay of the speed across the course in the air (not on a shortcut)
    pull: 10, // m/s^2 back toward the bed in the air, from the bank on (not on a shortcut)
  },
  boost: {
    impulse: 7, // m/s added instantly
    accel: 6, // m/s^2 extra push while active
    extraCap: 8, // m/s added to the top speed while active
    time: 0.9, // s active
    cooldown: 3, // s
    // mass: five sips. Boosting on every cooldown drains the drop (the beds are narrow, so the water drops on the
    // line are all taken anyway), a boost timed through a water drop pays for itself (pickup.boostBonus).
    cost: 0.2,
    homing: 8, // m/s^2 of sideways pull toward the other drop while boosting at it
    homingAhead: 6, // m: the other drop is 0..this far ahead
    homingSide: 4, // m: and at most this far to the side
    minMass: 0.4, // no boost below this mass (it would evaporate you)
    fullMass: 1.2, // below this mass the kick, push and extra top speed scale with mass / fullMass
  },
  evap: {
    base: 0.0015, // mass/s at mass 1, scaled by mass^(2/3) (surface)
    sun: 0.012, // extra mass/s in sun zones
    rock: 0.05, // extra mass/s while touching a rock
    offBed: 0.004, // extra mass/s on dry ground
  },
  respawn: {
    delay: 2, // s spent evaporated before reappearing
    speed: 18, // m/s along the course after a respawn
    offCourseTime: 3, // s far from the course before a respawn
    offCourseMargin: 10, // m beyond the bed half width that counts as "far"
    spacing: 4, // m between drops respawning at the same checkpoint
    every: 300, // m: besides the baked checkpoints a drop respawns at the last multiple of this it passed
  },
  // Freeze builds up only on a slow drop (spec: "accumula freeze se va piano"): a stall, a bank crash.
  ice: {
    base: 0.02, // freeze/s in an ice zone below baseSpeed
    baseSpeed: 20, // m/s, at or above this nothing freezes
    slow: 0.5, // extra freeze/s when stopped, fading to 0 at slowSpeed
    slowSpeed: 18, // m/s
    startGrace: 3, // s after the start signal without freezing
    thaw: 0.5, // freeze/s lost outside ice zones
    presses: 5, // boost presses that break the cube
    grip: 0.5, // 1/s sideways grip on ice (slippery)
    cubeFriction: 0.05, // 1/s while frozen
    immune: 4, // s without freezing after breaking free or a respawn
    pop: 4, // m/s forward when the cube breaks
  },
  pickup: {
    water: 0.2, // mass from a water drop
    rain: 0.15, // mass from a rain drop
    boostBonus: 2, // factor on a pickup taken while boosting: twice the water, 0.4 against a boost's 0.2
    reach: 2.0, // m added to the drop radius
    waterRespawn: 4, // s before a water drop reappears (the drop behind finds it again)
    rainInterval: 0.7, // s between rain drops per rain zone
    rainLife: 10, // s a rain drop stays on the ground
    rainMax: 14, // active rain drops per zone
  },
  // The animals live on the bank, a few meters past the bed edge (the bake puts them there). A drop riding
  // the edge goes by within their sense radius, one holding the middle of the bed does not.
  animal: {
    // Slow and fast are fractions of the drop's top speed on its stretch (vmaxFor with the local grade):
    // a drop riding with the current goes at about 1.0-1.1 of it, a boost at 1.2-1.4.
    sense: 12, // m, a slow drop inside this radius attracts the animal
    edgeFrac: 0.5, // and only one on the animal's half of the bed, past this fraction of the half width from the center
    slowFrac: 1.1, // below this fraction of its top speed a drop is "slow"
    // A drop that stops (under callFrac of its top speed, or braking with the stick back past callStick, for
    // callAfter s) is looking around: an animal comes for it from `call` m, from its bank out to the middle of
    // the bed (playtest r1: braking by a yak or a tiger in mid bed drew nobody).
    callFrac: 0.5,
    callStick: 0.5,
    callAfter: 0.5, // s
    call: 30, // m, more than the bed half width plus the 1-7 m the bake puts the animals past the edge
    fastFrac: 1.25, // above this fraction a pass scares the animal (keep it above slowFrac)
    scareRadius: 6, // m for a fast pass
    boostScare: 12, // m, a boost this close scares the animal
    wanderRadius: 15, // m around home
    wanderSpeed: 1.2, // m/s
    bank: 1.5, // m past the bed edge: the wander goals stay on the animal's own bank, out of the water
    wade: 3, // m into the bed from its own edge, at most, to reach a drop: the middle of the bed is safe
    approachSpeed: 12, // m/s
    leash: 40, // m from home before it gives up
    reach: 2.5, // m beyond the drop radius to start drinking
    sipInterval: 0.6, // s
    sip: 0.04, // mass per sip
    holdDrag: 3, // 1/s on the drop being drunk
    startled: 4, // s running away and ignoring drops
    fleeSpeed: 6, // m/s
  },
  collide: {
    restitution: 0.5,
    steal: 0.25, // mass taken by a boosting drop on impact
    stealReach: 1.5, // m beyond touching that still counts as contact for a boosting drop's steal
    stealMinRel: 3, // m/s closing speed needed for a steal
    bumpEvent: 1.5, // m/s closing speed needed for a bump event (contact below that is silent)
    minMassLeft: 0.35, // a steal never leaves the victim below this
  },
  fork: {
    stick: 0.45, // stick toward a branch side beyond this follows the branch at a fork (a deliberate steer)
    offset: 0.7, // or already sitting this fraction of the half width on the branch side
  },
  rock: {
    restitution: 0.3,
    touch: 0.5, // m beyond contact that still counts as touching (hot rock)
    slide: 0.5, // fraction of the impact speed turned into sideways slide around the rock
  },
};

export function mergeTuning(base, over) {
  if (!over) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over)) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? mergeTuning(base[k], v) : v;
  }
  return out;
}

export const vmaxFor = (T, mass, grade = 0) =>
  T.speed.vmaxBase + T.speed.vmaxPerMass * mass + T.speed.vmaxSlope * Math.sqrt(Math.min(Math.max(grade, 0), T.speed.slopeMax));
export const catchupFor = (T, gap) => (gap > 0 ? Math.min(T.catchup.max, gap / T.catchup.per) : 0);
export const radiusFor = (T, mass) => T.radius * Math.cbrt(Math.max(mass, 0.01));
