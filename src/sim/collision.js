// Collision world and character controller. Pure: boxes and ramps, a capsule-ish body, 60 Hz steps, no allocation in the hot path.
//
// The body is a vertical column (radius 0.4, height 1.8). Every solid is a prism with a plan rectangle and a top surface (a box's
// top is flat; a ramp's slopes along one axis). A solid blocks the body when its vertical extent overlaps the body's span above the
// step-up height (0.4); a solid whose top is within step-up of the feet is walked onto instead. Resolve per axis, so the body
// slides along walls; split long moves into sub-steps so nothing tunnels.

import { clamp } from './rng.js';

export const BODY = {
  r: 0.4,
  h: 1.8,
  step: 0.4,
  walk: 7,
  sprint: 11,
  jump: 8.5,
  gravity: 24,
  climb: 4,
  swimGravity: 12,
  swimStroke: 5.2,
  stamina: 4, // seconds of sprint
  refill: 0.32, // per second
};

const RAMP_R = 0.12; // a ramp's footprint radius (they are walked on, not bumped into)
const SUPPORT_R = 0.28; // how far past a box's edge the feet still stand on it
const EPS = 1e-4;
const NEG = -1e9;
const EMPTY = [];

export function topAt(s, x, z) {
  if (s.k === 0) return s.y1;
  const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
  return s.ya + (s.yb - s.ya) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

export function bottomAt(s, x, z) {
  if (s.k === 0) return s.y0;
  return s.thick >= 50 ? NEG : topAt(s, x, z) - s.thick;
}

/** Whether the circle (x, z, r) touches the solid's plan rectangle. */
function overlaps(s, x, z, r) {
  const dx = x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0;
  const dz = z < s.z0 ? s.z0 - z : z > s.z1 ? z - s.z1 : 0;
  return dx * dx + dz * dz < r * r;
}

export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class World {
  constructor(map) {
    this.map = map;
    this.solids = map.solids;
    this.ladders = map.ladders;
    this.inBounds = map.inBounds;
    this.cell = 4;
    this.gx0 = -64;
    this.gz0 = -56;
    this.gnx = 32;
    this.gnz = 28;
    this.grid = Array.from({ length: this.gnx * this.gnz }, () => []);
    for (const s of this.solids) {
      const i0 = Math.floor((s.x0 - 0.7 - this.gx0) / this.cell), i1 = Math.floor((s.x1 + 0.7 - this.gx0) / this.cell);
      const j0 = Math.floor((s.z0 - 0.7 - this.gz0) / this.cell), j1 = Math.floor((s.z1 + 0.7 - this.gz0) / this.cell);
      for (let j = Math.max(0, j0); j <= Math.min(this.gnz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(this.gnx - 1, i1); i++) this.grid[j * this.gnx + i].push(s);
      }
    }
  }

  /** The solids registered around a point (within 0.7 of their plan). */
  near(x, z) {
    const i = Math.floor((x - this.gx0) / this.cell), j = Math.floor((z - this.gz0) / this.cell);
    if (i < 0 || j < 0 || i >= this.gnx || j >= this.gnz) return EMPTY;
    return this.grid[j * this.gnx + i];
  }

  /** The body at (x, z) with its feet at `feet` would overlap a wall, a high solid or the sea. */
  blocked(x, z, feet) {
    if (!this.inBounds(x, z)) return true;
    const lo = feet + BODY.step, hi = feet + BODY.h;
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!overlaps(s, x, z, s.k === 0 ? BODY.r : RAMP_R)) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x, cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      if (topAt(s, cx, cz) > lo + EPS && bottomAt(s, cx, cz) < hi) return true;
    }
    return false;
  }

  /** The highest surface at (x, z) the feet can stand on: at most one step above `feet`. -Infinity where there is none. */
  groundAt(x, z, feet) {
    let g = this.inBounds(x, z) ? 0 : -Infinity;
    const lim = feet + BODY.step + EPS;
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!overlaps(s, x, z, s.k === 0 ? SUPPORT_R : RAMP_R)) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x, cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      const t = topAt(s, cx, cz);
      if (t <= lim && t > g) g = t;
    }
    return g;
  }

  /** The lowest underside above the head at (x, z) (Infinity when open sky). */
  ceilingAt(x, z, feet) {
    let c = Infinity;
    const min = feet + BODY.h - 0.06;
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!overlaps(s, x, z, s.k === 0 ? BODY.r : RAMP_R)) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x, cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      const b = bottomAt(s, cx, cz);
      if (b >= min && b < c) c = b;
    }
    return c;
  }

  /** The highest solid surface exactly over a point (a meteor explodes on the roof it hits); 0 on open ground. */
  topAtPoint(x, z) {
    let t = 0;
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const v = topAt(s, x, z);
      if (v > t) t = v;
    }
    return t;
  }

  /** There is a roof, canopy or floor above a standing body at (x, feet, z): rain and meteors don't reach it. */
  covered(x, feet, z) {
    const head = feet + BODY.h - 0.1;
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const b = bottomAt(s, x, z);
      if (b > NEG / 2 && b >= head) return true;
    }
    return false;
  }

  /** A point (with margin) lies inside a solid: for the camera. */
  solidAt(x, y, z, m) {
    const list = this.near(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (x < s.x0 - m || x > s.x1 + m || z < s.z0 - m || z > s.z1 + m) continue;
      const cx = x < s.x0 ? s.x0 : x > s.x1 ? s.x1 : x, cz = z < s.z0 ? s.z0 : z > s.z1 ? s.z1 : z;
      if (y <= topAt(s, cx, cz) + m && y >= bottomAt(s, cx, cz) - m) return true;
    }
    return false;
  }

  /** How far (0..1) along a segment the camera can go before it would be inside something, with a margin. */
  clearFraction(ox, oy, oz, tx, ty, tz, m) {
    const len = Math.hypot(tx - ox, ty - oy, tz - oz);
    if (len < 1e-6) return 1;
    const n = Math.max(2, Math.ceil(len / 0.25));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = ox + (tx - ox) * f, y = oy + (ty - oy) * f, z = oz + (tz - oz) * f;
      if (this.solidAt(x, y, z, m) || y < 0.25) return Math.max(0, (i - 1) / n);
    }
    return 1;
  }

  /** A ladder the body at (x, feet, z) can grab while pushing (mx, mz): into the wall from below, or outward from the top. */
  ladderFor(x, z, feet, mx, mz) {
    for (let i = 0; i < this.ladders.length; i++) {
      const L = this.ladders[i];
      const dx = x - L.x, dz = z - L.z;
      const dn = dx * L.nx + dz * L.nz;
      const dl = -dx * L.nz + dz * L.nx;
      if (Math.abs(dl) > L.hw + 0.15) continue;
      const into = mx * -L.nx + mz * -L.nz;
      if (feet >= L.y0 - 0.3 && feet <= L.y1 - 0.6 && dn >= 0.2 && dn <= 1.0 && into > 0.4) return L;
      // from the top, stepping outward at the ladder's head
      if (feet >= L.y1 - 0.25 && feet <= L.y1 + 0.3 && dn >= -0.8 && dn <= 0.25 && -into > 0.4) return L;
    }
    return null;
  }

  /** Lifts or pushes a body that is inside something to the nearest free place. */
  unstick(b) {
    for (let dy = 0; dy <= 24; dy += 0.5) {
      const f = this.freeSpot(b.x, b.z, b.y + dy);
      if (!this.blocked(f.x, f.z, b.y + dy)) {
        b.x = f.x;
        b.z = f.z;
        if (dy > 0) {
          b.y += dy;
          b.vy = 0;
        }
        return true;
      }
    }
    return false;
  }

  /** The nearest spot where a body stands free, searching outward from (x, z) at about height y. */
  freeSpot(x, z, y = 0) {
    if (!this.blocked(x, z, y)) return { x, z };
    for (let r = 0.5; r <= 4; r += 0.5) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!this.blocked(px, pz, y)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }
}

export function makeBody(x = 0, y = 0, z = 0, yaw = 0) {
  return {
    x, y, z, yaw,
    vx: 0, vz: 0, vy: 0, // walking velocity and vertical velocity
    ex: 0, ez: 0, // external push (wind, impacts), decays
    onGround: false,
    climbing: null,
    climbV: 0,
    wet: false,
    stamina: 1,
    exhausted: false,
    sprinting: false,
    staminaWait: 0,
    coyote: 0,
    jumpBuf: 0,
    jumpHeld: false,
    speed: 0,
    landed: 0, // impact speed on the step it landed (0 otherwise)
    jumped: false,
  };
}

function climbStep(b, L, mx, mz, dt) {
  // slide onto the rungs (never a jump), then climb
  const tx = L.x + L.nx * 0.42, tz = L.z + L.nz * 0.42;
  const gx = tx - b.x, gz = tz - b.z;
  const gd = Math.hypot(gx, gz);
  if (gd > 0.005) {
    const mv = Math.min(gd, 7 * dt);
    b.x += (gx / gd) * mv;
    b.z += (gz / gd) * mv;
  }
  const aligned = gd < 0.25;
  const push = mx * -L.nx + mz * -L.nz;
  if (b.jumpBuf > 0) {
    // let go: hop backwards off the ladder
    b.jumpBuf = 0;
    b.climbing = null;
    b.climbV = 0;
    b.vy = 5.5;
    b.vx = 0;
    b.vz = 0;
    b.ex = L.nx * 3.2;
    b.ez = L.nz * 3.2;
    b.onGround = false;
    b.jumped = true;
    b.coyote = 0;
    return;
  }
  const v = !aligned ? 0 : push > 0.25 ? BODY.climb : push < -0.25 ? -BODY.climb : 0;
  b.vy = 0;
  b.vx = 0;
  b.vz = 0;
  b.ex = 0;
  b.ez = 0;
  b.climbV = v;
  b.y += v * dt;
  b.speed = 0;
  b.onGround = false;
  if (v > 0 && b.y >= L.y1 - 0.01) {
    // over the top: a small hop onto the platform
    b.y = L.y1 + 0.02;
    b.climbing = null;
    b.climbV = 0;
    b.vy = 3.4;
    b.ex = -L.nx * 3.6;
    b.ez = -L.nz * 3.6;
    b.onGround = false;
    b.coyote = 0;
  } else if (v < 0 && b.y <= L.y0) {
    b.y = L.y0;
    b.climbing = null;
    b.climbV = 0;
    b.onGround = true;
  }
}

function micro(world, b, dt) {
  const dx = (b.vx + b.ex) * dt, dz = (b.vz + b.ez) * dt;
  if (dx !== 0) {
    if (!world.blocked(b.x + dx, b.z, b.y)) b.x += dx;
    else {
      b.vx = 0;
      b.ex = 0;
    }
  }
  if (dz !== 0) {
    if (!world.blocked(b.x, b.z + dz, b.y)) b.z += dz;
    else {
      b.vz = 0;
      b.ez = 0;
    }
  }
  const g = world.groundAt(b.x, b.z, b.y);
  const ny = b.y + b.vy * dt;
  if (b.vy <= 0) {
    if (ny <= g + EPS) {
      if (!b.onGround && b.vy < -4) b.landed = Math.max(b.landed, -b.vy);
      b.y = g;
      b.vy = 0;
      b.onGround = true;
    } else if (b.onGround && b.y - g <= 0.6) {
      b.y = g; // walking down a slope or a step stays glued to it
    } else {
      b.y = ny;
      b.onGround = false;
    }
  } else {
    const c = world.ceilingAt(b.x, b.z, b.y);
    if (ny + BODY.h > c) {
      b.y = Math.max(b.y, c - BODY.h);
      b.vy = 0;
    } else {
      b.y = ny;
    }
    if (b.y < g) b.y = g; // stepped onto a low ledge while still rising
    b.onGround = false;
  }
}

/**
 * Advance a body by `dt` seconds. input: { mx, mz (world-space direction, length <= 1), jump (held), sprint (held) }.
 * opts: { water } the sea level this step (a body wades slowly and drowns above the waist: the hazard code counts that).
 */
export function stepBody(world, b, inp, dt, opts) {
  b.landed = 0;
  b.jumped = false;
  const water = opts && typeof opts.water === 'number' ? opts.water : -99;
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const moving = ml > 0.05;

  // a body that ended up inside something (a spawn, a teleport) is lifted out first
  if (!b.climbing && world.blocked(b.x, b.z, b.y)) world.unstick(b);

  if (inp.jump && !b.jumpHeld) b.jumpBuf = 0.14;
  b.jumpHeld = !!inp.jump;
  b.jumpBuf = Math.max(0, b.jumpBuf - dt);

  if (!b.climbing && moving) {
    const L = world.ladderFor(b.x, b.z, b.y, mx, mz);
    if (L) {
      b.climbing = L;
      b.vx = 0;
      b.vz = 0;
    }
  }
  if (b.climbing) {
    climbStep(b, b.climbing, mx, mz, dt);
    if (b.climbing) {
      b.wet = false;
      return;
    }
  }

  b.wet = water > b.y + 0.9;

  // speed and stamina
  let speed = BODY.walk;
  const wantSprint = !!inp.sprint && moving && !b.exhausted && !b.wet;
  if (wantSprint && b.stamina > 0) {
    speed = BODY.sprint;
    b.sprinting = true;
    b.stamina -= dt / BODY.stamina;
    b.staminaWait = 0.6;
    if (b.stamina <= 0) {
      b.stamina = 0;
      b.exhausted = true;
    }
  } else {
    b.sprinting = false;
    if (b.staminaWait > 0) b.staminaWait -= dt;
    else {
      b.stamina = Math.min(1, b.stamina + dt * BODY.refill);
      if (b.exhausted && b.stamina >= 0.25) b.exhausted = false;
    }
  }
  if (b.wet) speed *= 0.55;

  // walking velocity moves toward the wanted one
  const tvx = mx * speed, tvz = mz * speed;
  const acc = (b.onGround ? 80 : b.wet ? 30 : 26) * dt;
  let ax = tvx - b.vx, az = tvz - b.vz;
  const al = Math.hypot(ax, az);
  if (al > acc) {
    ax = (ax / al) * acc;
    az = (az / al) * acc;
  }
  b.vx += ax;
  b.vz += az;

  // vertical
  if (b.wet) {
    b.vy -= BODY.swimGravity * dt;
    if (b.vy < -3) b.vy = -3;
    if (b.jumpBuf > 0) {
      b.vy = BODY.swimStroke;
      b.jumpBuf = 0;
      b.jumped = true;
      b.onGround = false;
    }
  } else {
    if (b.onGround) b.coyote = 0.1;
    else b.coyote = Math.max(0, b.coyote - dt);
    if (b.jumpBuf > 0 && b.coyote > 0) {
      b.vy = BODY.jump;
      b.jumpBuf = 0;
      b.coyote = 0;
      b.onGround = false;
      b.jumped = true;
    }
    if (!b.onGround) b.vy -= BODY.gravity * dt;
    if (b.vy < -45) b.vy = -45;
  }

  const hs = Math.hypot(b.vx + b.ex, b.vz + b.ez);
  const n = Math.min(16, Math.max(1, Math.ceil((Math.max(hs, Math.abs(b.vy)) * dt) / 0.22)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) micro(world, b, sdt);

  const k = Math.exp(-(b.onGround ? 2.4 : 1.0) * dt);
  b.ex *= k;
  b.ez *= k;
  if (Math.abs(b.ex) < 0.01) b.ex = 0;
  if (Math.abs(b.ez) < 0.01) b.ez = 0;
  b.speed = Math.hypot(b.vx, b.vz);

  // face where the body is going
  if (b.speed > 0.6) b.yaw += angDiff(b.yaw, Math.atan2(b.vx, b.vz)) * Math.min(1, 16 * dt);
}

/** Clamp helper re-exported for callers that steer. */
export { clamp };
