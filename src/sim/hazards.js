// What each disaster does to a body. One step per body per frame, from (previous time, time): returns the cause of a knockout or null.
// Used by every page for its own player and by the host for bots and for players who are away, so all of them are judged alike.

import {
  floodLevel, tornadoAt, flowLength, debrisY, BALL_R,
  TORNADO, ACID_DPS, ACID_REGEN, BREATH_SECONDS,
} from './disasters.js';

export function makeHazard() {
  return { breath: BREATH_SECONDS, health: 100, tp: { x: 0, z: 0, dist: 0 } };
}

export function resetHazard(hs) {
  hs.breath = BREATH_SECONDS;
  hs.health = 100;
}

/** An impact (meteor, lava ball) at its landing moment: inside the blast, and not under a roof. */
export function impactHits(m, body, world) {
  const dx = body.x - m.x, dz = body.z - m.z;
  if (dx * dx + dz * dz >= m.r * m.r) return false;
  if (body.y < m.y - 2.4 || body.y > m.y + m.r + 0.6) return false;
  return !world.covered(body.x, body.y, body.z);
}

/** Whether a point is inside a crack's strip (centre, direction angle th, length, width), with a margin. */
export function inCrack(c, x, z, margin = 0) {
  const cs = Math.cos(c.th), sn = Math.sin(c.th);
  const u = (x - c.x) * cs + (z - c.z) * sn;
  const v = -(x - c.x) * sn + (z - c.z) * cs;
  return Math.abs(u) < c.len / 2 + margin && Math.abs(v) < c.w / 2 + margin;
}

/** Whether a point is on a lava flow at time t, with a margin. */
export function inFlow(f, t, x, z, margin = 0) {
  const len = flowLength(f, t);
  if (len <= 0) return false;
  const rx = x - f.ox, rz = z - f.oz;
  const along = rx * f.dx + rz * f.dz;
  const across = Math.abs(-rx * f.dz + rz * f.dx);
  return along > -margin && along < len + margin && across < f.w / 2 + margin;
}

/**
 * tPrev, t: run time in ms (negative during the warning: nothing happens). dt: seconds. `body` needs x, y, z and ex, ez
 * (the tornado pulls by adding to them). Returns 'drown' | 'meteor' | 'flung' | 'acid' | 'debris' | 'lava' | null.
 */
export function stepHazards(hs, round, tPrev, t, body, dt, world) {
  if (t < 0) {
    hs.breath = BREATH_SECONDS;
    hs.health = 100;
    return null;
  }
  const has = round.has;
  const x = body.x, z = body.z, y = body.y;

  if (has.meteor) {
    const list = round.meteors;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.at <= tPrev) continue;
      if (m.at > t) break;
      if (impactHits(m, body, world)) return 'meteor';
    }
  }
  if (has.volcano) {
    const list = round.balls;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.at <= tPrev) continue;
      if (m.at > t) break;
      if (impactHits(m, body, world)) return 'lava';
    }
    if (y < 0.6) {
      for (const f of round.flows) if (inFlow(f, t, x, z, 0.2)) return 'lava';
    }
  }
  if (has.quake) {
    const list = round.debris;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.at < t - 100) continue;
      if (d.at - 1500 > t) break;
      const cy = debrisY(d, t);
      if (cy === null) continue;
      const hh = d.size / 2;
      if (Math.abs(x - d.x) < hh + 0.4 && Math.abs(z - d.z) < hh + 0.4 && cy + hh > y && cy - hh < y + 1.8) return 'debris';
    }
    if (y < 0.5) {
      for (const c of round.cracks) if (t >= c.openAt && inCrack(c, x, z, 0.15)) return 'lava';
    }
  }
  if (has.tornado) {
    const tp = tornadoAt(round, t, hs.tp);
    const dx = x - tp.x, dz = z - tp.z;
    const d = Math.hypot(dx, dz);
    if (d < TORNADO.kill) return 'flung';
    if (d < TORNADO.pull) {
      const k = 1 - (d - TORNADO.kill) / (TORNADO.pull - TORNADO.kill);
      const a = 34 * k * dt;
      body.ex += (-dx / d) * a - (-dz / d) * a * 0.35;
      body.ez += (-dz / d) * a - (dx / d) * a * 0.35;
      const s = Math.hypot(body.ex, body.ez);
      if (s > 18) {
        body.ex *= 18 / s;
        body.ez *= 18 / s;
      }
    }
  }
  if (has.acid) {
    if (world.covered(x, y, z)) hs.health = Math.min(100, hs.health + ACID_REGEN * dt);
    else {
      hs.health -= ACID_DPS * dt;
      if (hs.health <= 0) return 'acid';
    }
  }
  if (has.flood) {
    const wet = floodLevel(t) > y + 0.9;
    if (wet) {
      hs.breath -= dt;
      if (hs.breath <= 0) return 'drown';
    } else hs.breath = Math.min(BREATH_SECONDS, hs.breath + dt * 2);
  }
  return null;
}

export { BALL_R };
