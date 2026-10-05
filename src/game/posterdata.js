// Store art, staged as data: where the camera stands, which disaster is frozen at which moment, who stands where. Pure (no three.js,
// no DOM) so the tests can check that what the posters promise is really in frame.

import { prepareRound, tornadoAt, WARN_MS, floodLevel, FLOOD_MAX, METEOR_TELEGRAPH } from '../sim/disasters.js';
import { PLAYER_COLORS } from '../sim/rules.js';

export const POSTERS = {
  cover: { w: 1280, h: 720 },
  action: { w: 1280, h: 720 },
  win: { w: 1280, h: 720 },
  icon: { w: 512, h: 512 },
  'badge-survivor': { w: 256, h: 256 },
  'badge-untouchable': { w: 256, h: 256 },
  'badge-storm-chaser': { w: 256, h: 256 },
  'badge-first-win': { w: 256, h: 256 },
};

const runner = (x, z, yaw, i, extra = {}) => ({ x, y: 0, z, yaw, speed: 9, phase: i * 1.7 + 0.6, sprint: true, color: PLAYER_COLORS[i % PLAYER_COLORS.length], ...extra });

/** The meteor moment of the cover: several rocks in the air, rings on the ground and an impact a few hundredths of a second old. */
function pickMeteorTime(round, fx, fz) {
  let best = 20000, bs = -1;
  for (let t = 14000; t < 46000; t += 50) {
    let air = 0, boom = 0;
    for (const m of round.meteors) {
      const d = m.at - t;
      if (d > 0 && d < METEOR_TELEGRAPH) {
        const dist = Math.hypot(m.x - fx, m.z - fz);
        if (dist < 34) air++;
      }
      if (d <= 0 && d > -260) {
        const dist = Math.hypot(m.x - fx, m.z - fz);
        if (dist < 26 && dist > 6) boom += 3 - Math.abs(d + 130) / 130;
      }
    }
    const s = air + boom * 2;
    if (s > bs) {
      bs = s;
      best = t;
    }
  }
  return best;
}

function pickTornadoTime(round, tx, tz) {
  let best = 20000, bd = Infinity;
  const out = { x: 0, z: 0, dist: 0 };
  for (let t = 6000; t < 46000; t += 100) {
    tornadoAt(round, t, out);
    const d = Math.hypot(out.x - tx, out.z - tz);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/**
 * The staging for a poster name, or null for an unknown one. Returns { w, h, camera: { pos, target, fov }, kinds, seed, t (run ms),
 * sky: kinds to blend, water (sea level), sunDir, chars: [...], title }.
 */
export function stagePoster(name, world) {
  const size = POSTERS[name];
  if (!size) return null;
  const base = { w: size.w, h: size.h, chars: [], title: false, water: -0.6, sky: [], sunDir: null, kinds: [], seed: 1, t: 0 };
  if (name === 'cover') {
    const kinds = ['meteor'];
    const round = prepareRound(kinds, 4242, world);
    const t = pickMeteorTime(round, -4, 2);
    return {
      ...base, kinds, seed: 4242, t, sky: kinds, title: true,
      camera: { pos: [17, 7.5, 30], target: [-3, 8.5, -7], fov: 60 },
      chars: [
        runner(4, 6, 0.4, 0), runner(-5, 4, 3.5, 1), runner(1, -3, 2.6, 2), runner(7, 1, -0.6, 3), runner(-9, 9, 0.2, 4), runner(-2, 11, 5.6, 5),
        runner(10, 7, 0.9, 6), runner(-12, 1, 2.2, 7),
        { x: -20, y: 8.6, z: -7, yaw: 0.6, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[8] },
        { x: -8, y: 5.55, z: 18.2, yaw: 2.9, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[9] },
      ],
    };
  }
  if (name === 'action') {
    const kinds = ['tornado'];
    const round = prepareRound(kinds, 7781, world);
    const t = pickTornadoTime(round, 4, -2);
    const tp = tornadoAt(round, t);
    return {
      ...base, kinds, seed: 7781, t, sky: kinds,
      camera: { pos: [tp.x - 9, 4.6, tp.z + 29], target: [tp.x, 12, tp.z], fov: 64 },
      chars: [
        { x: tp.x + 5.5, y: 0, z: tp.z + 3.5, yaw: 1.2, speed: 0, phase: 0, out: 0.55, cause: 'flung', color: PLAYER_COLORS[3], key: 'a' },
        { x: tp.x + 12, y: 0, z: tp.z + 10, yaw: 0.2, speed: 10, phase: 1.1, sprint: true, color: PLAYER_COLORS[0] },
        runner(tp.x - 5, tp.z + 18, 0.3, 4),
        runner(tp.x - 11, tp.z + 21, -0.2, 5),
      ],
    };
  }
  if (name === 'win') {
    const kinds = ['flood'];
    const cx = 0, cz = -15;
    return {
      ...base, kinds, seed: 99, t: 40000, sky: ['sunset'], water: FLOOD_MAX, sunDir: [-0.62, 0.17, -0.77],
      camera: { pos: [7.2, 20.1, -7.2], target: [0, 19.2, -15], fov: 62 },
      chars: [
        { x: cx - 1.3, y: 18, z: cz - 0.3, yaw: 0.5, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[0] },
        { x: cx + 0.2, y: 18, z: cz + 0.2, yaw: 0.2, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[4] },
        { x: cx + 1.5, y: 18, z: cz - 0.7, yaw: -0.4, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[2] },
        { x: cx - 0.5, y: 18, z: cz - 1.8, yaw: 0.9, speed: 0, phase: 0, color: PLAYER_COLORS[6] },
        { x: cx + 1.0, y: 18, z: cz - 1.9, yaw: -0.8, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[3] },
      ],
    };
  }
  if (name === 'icon') {
    const kinds = ['tornado'];
    const round = prepareRound(kinds, 7781, world);
    const t = pickTornadoTime(round, 0, 0);
    const tp = tornadoAt(round, t);
    return {
      ...base, kinds, seed: 7781, t, sky: kinds,
      camera: { pos: [tp.x * 0.5 + 6, 14, 64], target: [tp.x * 0.6, 12.5, tp.z * 0.6], fov: 46 },
      chars: [],
    };
  }
  return { ...base, badge: name.slice(6), camera: null };
}

export { WARN_MS, floodLevel };
