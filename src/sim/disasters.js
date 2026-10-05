// The six disasters as pure functions of (round seed, time). Nothing here is sent over the network: every page derives the same
// meteors, tornado path, cracks and lava from the seed the host wrote in the match record, and from the shared match clock.
//
// Times are milliseconds since the run began (negative during the warning).

import { mulberry32, mixSeed, hashStr, clamp } from './rng.js';
import { SHORE, SEA } from './map.js';

export const KINDS = ['flood', 'meteor', 'tornado', 'acid', 'quake', 'volcano'];
export const WARN_MS = 6000;
export const RUN_MS = 50000;

export const INFO = {
  flood: { name: 'FLOOD', hint: 'GET HIGH' },
  meteor: { name: 'METEORS', hint: 'DODGE THE RINGS' },
  tornado: { name: 'TORNADO', hint: 'RUN AWAY' },
  acid: { name: 'ACID RAIN', hint: 'GET COVER' },
  quake: { name: 'EARTHQUAKE', hint: 'STAY CLEAR' },
  volcano: { name: 'VOLCANO', hint: 'AVOID LAVA' },
};

export const CAUSES = ['', 'drown', 'meteor', 'flung', 'acid', 'debris', 'lava', 'left'];
export const CAUSE_LABEL = { drown: 'DROWNED', meteor: 'METEOR', flung: 'FLUNG', acid: 'ACID', debris: 'CRUSHED', lava: 'LAVA', left: 'LEFT' };
export const causeCode = (c) => Math.max(0, CAUSES.indexOf(c));

// ---- numbers every page agrees on
export const FLOOD_MAX = 14;
export const FLOOD_RISE_MS = 30000;
export const METEOR_R = 3;
export const METEOR_TELEGRAPH = 1500;
export const BALL_R = 2.6;
export const BALL_FLIGHT = 2000;
export const BALL_TELEGRAPH = 1600;
export const TORNADO = { speed: 6, kill: 5, pull: 12, height: 32 };
export const DEBRIS_FALL = 1400;
export const CRACK_WARN = 3000; // cracks show this long before the lava opens
export const ACID_DPS = 20;
export const ACID_REGEN = 25;
export const BREATH_SECONDS = 4;

/** The sea level (y) during a flood run at time t (ms since the run began). */
export function floodLevel(t) {
  if (t <= 0) return SEA;
  const x = Math.min(1, t / FLOOD_RISE_MS);
  return SEA + (FLOOD_MAX - SEA) * Math.pow(x, 1.5);
}

/** The sea level for a prepared round at time t (a flood run raises it; otherwise it stays at sea level). */
export function waterLevel(round, t) {
  return round && round.has.flood ? floodLevel(t) : SEA;
}

// ------------------------------------------------------------------------------------------------ the plan of a match

/** Which disasters a match goes through. The host writes this once; `s` seeds everything in that round. */
export function buildPlan(matchSeed, rounds) {
  const rng = mulberry32(mixSeed(matchSeed >>> 0, 0xd15a57e2));
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  const plan = [];
  let bag = [];
  let last = '';
  for (let i = 0; i < rounds; i++) {
    if (i === 0) {
      // the first disaster is one whose goal explains itself
      const k = rng() < 0.5 ? 'flood' : 'meteor';
      plan.push({ k: [k], s: Math.floor(rng() * 2147483647) + 1 });
      last = k;
      bag = shuffle(KINDS.filter((x) => x !== k));
      continue;
    }
    if (bag.length === 0) bag = shuffle(KINDS.filter((x) => x !== last));
    let k = bag.pop();
    if (k === last && bag.length) {
      const other = bag.pop();
      bag.push(k);
      k = other;
    }
    const kinds = [k];
    if (i >= 3 && rng() < 0.3) {
      const others = KINDS.filter((x) => x !== k && compatible(k, x));
      kinds.push(others[Math.floor(rng() * others.length)]);
    }
    plan.push({ k: kinds, s: Math.floor(rng() * 2147483647) + 1 });
    last = k;
  }
  return plan;
}

/**
 * Two disasters that can be survived together. Acid rain with a flood leaves no high place with a roof, and acid rain with a
 * tornado no roof that stays safe, so those pairs never come up.
 */
export function compatible(a, b) {
  const pair = (x, y) => (a === x && b === y) || (a === y && b === x);
  return !(pair('flood', 'acid') || pair('tornado', 'acid'));
}

/** Validates one plan entry from the room (it came from another page): returns clean kinds and a seed, or null. */
export function cleanEntry(e) {
  if (!e || !Array.isArray(e.k) || e.k.length < 1 || e.k.length > 2) return null;
  const kinds = [];
  for (const k of e.k) if (typeof k === 'string' && KINDS.includes(k) && !kinds.includes(k)) kinds.push(k);
  if (!kinds.length) return null;
  if (kinds.length === 2 && !compatible(kinds[0], kinds[1])) return null;
  const s = Number(e.s);
  if (!Number.isFinite(s)) return null;
  return { k: kinds, s: Math.floor(s) >>> 0 };
}

// ------------------------------------------------------------------------------------------------ one prepared round

const cache = new Map();

/** Everything seeded about a round: meteors, the tornado's path, debris, cracks, lava. Cached by kinds + seed. */
export function prepareRound(kinds, seed, world) {
  const key = `${kinds.join('+')}:${seed >>> 0}`;
  const hit = cache.get(key);
  if (hit && hit.world === world) return hit;
  const has = {};
  for (const k of kinds) has[k] = true;
  const round = { kinds: [...kinds], seed: seed >>> 0, has, world };
  const r = (name) => mulberry32(mixSeed(seed >>> 0, hashStr(name)));
  if (has.meteor) round.meteors = genMeteors(r('meteor'), world);
  if (has.tornado) round.tornado = genTornado(r('tornado'));
  if (has.quake) {
    round.debris = genDebris(r('debris'), world);
    round.cracks = genCracks(r('cracks'), world);
  }
  if (has.volcano) {
    round.balls = genBalls(r('balls'), world);
    round.flows = genFlows(r('flows'), world);
  }
  if (cache.size > 40) cache.clear();
  cache.set(key, round);
  return round;
}

function pointInIsland(rng, scale) {
  const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * scale;
  return [Math.cos(a) * d * SHORE.a, Math.sin(a) * d * SHORE.b];
}

function genMeteors(rng, world) {
  const out = [];
  let t = 2200;
  while (t < RUN_MS - 400) {
    let x, z;
    if (rng() < 0.45) {
      // a cluster around the middle of town, where players start
      const a = rng() * Math.PI * 2, d = Math.abs(gauss(rng)) * 11;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d * 0.8;
    } else [x, z] = pointInIsland(rng, 0.92);
    if (!world.inBounds(x, z) || x * x / (SHORE.a * SHORE.a) + z * z / (SHORE.b * SHORE.b) > 0.9) {
      t += 50;
      continue;
    }
    out.push({ at: Math.round(t), x: round2(x), z: round2(z), y: round2(world.topAtPoint(x, z)), r: METEOR_R });
    const rate = 0.5 + 1.6 * (t / RUN_MS); // per second: from half a meteor a second to about two
    t += (1000 / rate) * (0.65 + rng() * 0.7);
  }
  return out;
}

function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) / 0.58;
}

function genTornado(rng) {
  const a0 = rng() * Math.PI * 2;
  const pts = [[Math.cos(a0) * 0.8 * SHORE.a, Math.sin(a0) * 0.8 * SHORE.b]];
  let total = 0;
  while ((total < 400 || pts.length < 5) && pts.length < 24) {
    const last = pts[pts.length - 1];
    let p = null;
    for (let tries = 0; tries < 30; tries++) {
      const [x, z] = pointInIsland(rng, 0.78);
      const d = Math.hypot(x - last[0], z - last[1]);
      if (d >= 28) {
        p = [x, z];
        break;
      }
    }
    if (!p) p = [-last[0] * 0.6, -last[1] * 0.6];
    total += Math.hypot(p[0] - last[0], p[1] - last[1]);
    pts.push(p);
  }
  // smooth with a Catmull-Rom spline, sampled about every unit
  const xs = [], zs = [], cum = [];
  let acc = 0;
  const P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let s = 0; s < steps; s++) {
      const u = s / steps, u2 = u * u, u3 = u2 * u;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3);
      const z = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
      if (xs.length) acc += Math.hypot(x - xs[xs.length - 1], z - zs[zs.length - 1]);
      xs.push(x);
      zs.push(z);
      cum.push(acc);
    }
  }
  return { xs, zs, cum, length: acc };
}

/** Where the tornado is at time t (ms since the run began): fills `out` ({ x, z, dist }). It sits at its start during the warning. */
export function tornadoAt(round, t, out = { x: 0, z: 0, dist: 0 }) {
  const path = round.tornado;
  const d = clamp(t, 0, RUN_MS) * (TORNADO.speed / 1000);
  const cum = path.cum;
  let lo = 0, hi = cum.length - 1;
  if (d >= cum[hi]) {
    out.x = path.xs[hi];
    out.z = path.zs[hi];
    out.dist = d;
    return out;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo] || 1;
  const f = (d - cum[lo]) / span;
  out.x = path.xs[lo] + (path.xs[hi] - path.xs[lo]) * f;
  out.z = path.zs[lo] + (path.zs[hi] - path.zs[lo]) * f;
  out.dist = d;
  return out;
}

function genDebris(rng, world) {
  const sources = world.map.buildings.filter((b) => b.debris);
  const weight = (b) => (b.kind === 'tower' ? 2.2 : b.kind === 'shop' ? 1.8 : 1);
  const total = sources.reduce((a, b) => a + weight(b), 0);
  const out = [];
  let t = 3000;
  while (t < RUN_MS - 200) {
    let pick = rng() * total, src = sources[0];
    for (const b of sources) {
      pick -= weight(b);
      if (pick <= 0) {
        src = b;
        break;
      }
    }
    // land beside the building, outside its walls
    const off = 0.8 + rng() * 3.8;
    const side = Math.floor(rng() * 4);
    const along = rng();
    let x, z;
    if (side === 0) { x = src.x0 + (src.x1 - src.x0) * along; z = src.z0 - off; }
    else if (side === 1) { x = src.x0 + (src.x1 - src.x0) * along; z = src.z1 + off; }
    else if (side === 2) { x = src.x0 - off; z = src.z0 + (src.z1 - src.z0) * along; }
    else { x = src.x1 + off; z = src.z0 + (src.z1 - src.z0) * along; }
    if (world.inBounds(x, z)) {
      const y = world.topAtPoint(x, z);
      out.push({ at: Math.round(t), x: round2(x), z: round2(z), y: round2(y), from: round2(Math.max(src.top, y + 8)), size: round2(1.1 + rng() * 0.7), src: src.id });
    }
    const rate = 0.8 + 1.4 * (t / RUN_MS);
    t += (1000 / rate) * (0.6 + rng() * 0.8);
  }
  return out;
}

function genCracks(rng, world) {
  const out = [];
  const blds = world.map.buildings;
  const clear = (x, z) => !blds.some((b) => x > b.x0 - 1.2 && x < b.x1 + 1.2 && z > b.z0 - 1.2 && z < b.z1 + 1.2);
  for (let i = 0; out.length < 8 && i < 300; i++) {
    const near = out.length < 3; // the first few open on the plaza, where everyone starts
    const a = rng() * Math.PI * 2, d = near ? 3 + rng() * 6 : 4 + rng() * 22;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d * 0.85;
    const th = rng() * Math.PI;
    const len = 11 + rng() * 4;
    let ok = world.inBounds(cx, cz);
    const c = Math.cos(th), s = Math.sin(th);
    for (let k = -2; k <= 2 && ok; k++) {
      const px = cx + c * (len / 4) * k, pz = cz + s * (len / 4) * k;
      if (!world.inBounds(px, pz) || !clear(px, pz) || world.topAtPoint(px, pz) > 0.1) ok = false;
    }
    if (!ok) continue;
    if (out.some((o) => Math.hypot(o.x - cx, o.z - cz) < 6)) continue;
    const idx = out.length;
    const openAt = 6500 + idx * 4000 + Math.floor(rng() * 1200);
    out.push({ x: round2(cx), z: round2(cz), th: round2(th), len: round2(len), w: 2.6, openAt, crackAt: openAt - CRACK_WARN });
  }
  return out;
}

function genBalls(rng, world) {
  const hx = world.map.hill.x, hz = world.map.hill.z;
  const out = [];
  let t = 3200;
  while (t < RUN_MS - 100) {
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 10 && !ok; tries++) {
      const a = rng() * Math.PI * 2, d = 5 + 33 * Math.sqrt(rng());
      x = hx + Math.cos(a) * d;
      z = hz + Math.sin(a) * d;
      ok = world.inBounds(x, z) && x * x / (SHORE.a * SHORE.a) + z * z / (SHORE.b * SHORE.b) < 0.92;
    }
    if (ok) out.push({ at: Math.round(t), x: round2(x), z: round2(z), y: round2(world.topAtPoint(x, z)), r: BALL_R, apex: round2(16 + rng() * 8) });
    const rate = 0.7 + 1.5 * (t / RUN_MS);
    t += (1000 / rate) * (0.65 + rng() * 0.7);
  }
  return out;
}

function genFlows(rng, world) {
  const hx = world.map.hill.x, hz = world.map.hill.z;
  const base = [Math.PI, Math.PI + 0.65, Math.PI - 0.65, Math.PI + 1.3, Math.PI - 1.3, Math.PI * 1.5, Math.PI * 0.5];
  const a = base.splice(Math.floor(rng() * base.length), 1)[0];
  let b = base[Math.floor(rng() * base.length)];
  for (let i = 0; i < 12 && Math.abs(b - a) < 0.6; i++) b = base[Math.floor(rng() * base.length)];
  return [a, b].map((ang, i) => ({
    ox: round2(hx + Math.cos(ang) * 11.5),
    oz: round2(hz + Math.sin(ang) * 11.5),
    dx: round2(Math.cos(ang)),
    dz: round2(Math.sin(ang)),
    w: 3.2,
    maxLen: 30,
    speed: 0.62 + 0.1 * i,
    startAt: 4000 + i * 3500,
  }));
}

/** How far a lava flow has run at time t (units). */
export function flowLength(f, t) {
  return clamp(((t - f.startAt) / 1000) * f.speed, 0, f.maxLen);
}

/** Where a falling lava ball is at time t, or null if it isn't in the air: { x, y, z, u }. */
export function ballAt(round, b, t, hill) {
  const launch = b.at - BALL_FLIGHT;
  if (t < launch || t > b.at) return null;
  const u = (t - launch) / BALL_FLIGHT;
  const sx = hill.x, sz = hill.z, sy = hill.top + 0.6;
  const x = sx + (b.x - sx) * u, z = sz + (b.z - sz) * u;
  const y = sy + (b.y - sy) * u + 4 * b.apex * u * (1 - u);
  return { x, y, z, u };
}

/** The falling debris chunk's height at time t (it lands at `at`), or null when not falling. */
export function debrisY(d, t) {
  const start = d.at - DEBRIS_FALL;
  if (t < start || t > d.at) return null;
  const u = (t - start) / DEBRIS_FALL;
  return d.y + (d.from - d.y) * (1 - u * u);
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
