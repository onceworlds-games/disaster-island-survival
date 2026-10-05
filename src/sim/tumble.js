// How a knocked-out character moves for the second or so before it disappears: a closed-form pose from the time since the knockout,
// so every page draws the same tumble from the same two numbers (when it happened, why) and nothing needs to be sent.

import { hashStr } from './rng.js';

export const TUMBLE_SECONDS = 1.7;

const smooth = (t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
};

/**
 * Fills `out` with { dx, dy, dz, rx, rz, ry, scale } for `since` seconds after a knockout. `key` seeds the direction (a player id).
 * `scale` goes to 0 as the body disappears (since >= TUMBLE_SECONDS).
 */
export function tumblePose(out, since, cause, key) {
  const h = hashStr(key);
  const a = ((h % 628) / 100);
  const dirx = Math.cos(a), dirz = Math.sin(a);
  const s = Math.max(0, since);
  out.dx = out.dy = out.dz = out.rx = out.rz = out.ry = 0;
  out.scale = 1;
  if (cause === 'flung') {
    const ang = s * 7 + a;
    const r = 0.8 + s * 4.2;
    out.dx = Math.cos(ang) * r * 0.5 + dirx * s * 6;
    out.dz = Math.sin(ang) * r * 0.5 + dirz * s * 6;
    out.dy = 1.2 + s * 9 - 3 * s * s;
    out.rx = s * 9;
    out.rz = s * 7;
    out.ry = s * 5;
    out.scale = 1 - smooth((s - 1.0) / 0.7);
  } else if (cause === 'drown') {
    out.dy = -s * 1.2;
    out.rx = Math.min(1.2, s * 1.4);
    out.dx = dirx * s * 0.6;
    out.dz = dirz * s * 0.6;
    out.scale = 1 - smooth((s - 0.9) / 0.8);
  } else if (cause === 'lava') {
    out.dy = Math.max(0, 5.2 * s - 11 * s * s);
    out.rx = s * 7;
    out.dx = dirx * s * 1.4;
    out.dz = dirz * s * 1.4;
    out.scale = 1 - smooth((s - 0.8) / 0.8);
  } else {
    // knocked back, a hop, then flat on the ground
    const slide = 1 - Math.exp(-4.5 * s);
    out.dx = dirx * 3.0 * slide;
    out.dz = dirz * 3.0 * slide;
    out.dy = Math.max(0, 5 * s - 11 * s * s);
    out.rx = -Math.min(1.5, s * 7);
    out.rz = Math.sin(s * 5) * 0.4 * (1 - smooth(s / 1.0));
    out.dy += s > 0.5 ? 0.02 : 0;
    out.scale = 1 - smooth((s - 1.15) / 0.55);
  }
  if (s >= TUMBLE_SECONDS) out.scale = 0;
  return out;
}
