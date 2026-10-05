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

/** Projects a world point through a look-at camera: pixel x, y (y down) and depth (positive in front). Pure, for staging and tests. */
export function projectPoint(cam, w, h, x, y, z) {
  const [cx, cy, cz] = cam.pos, [tx, ty, tz] = cam.target;
  let fx = tx - cx, fy = ty - cy, fz = tz - cz;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward x up
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up = right x forward
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  const depth = dx * fx + dy * fy + dz * fz;
  const t = Math.tan((cam.fov * Math.PI) / 360);
  const nx = dx * rx + dy * ry + dz * rz;
  const ny = dx * ux + dy * uy + dz * uz;
  return { x: (0.5 + nx / (depth * t * (w / h)) / 2) * w, y: (0.5 - ny / (depth * t) / 2) * h, depth };
}

/**
 * The share of the frame (a grid of rays through it) that is blocked by something solid within `reach` metres of the camera:
 * a camera inside or right behind a building fills the picture with a wall. 0 is open air. Ground is not counted.
 */
export function nearOcclusion(world, cam, w, h, reach = 6) {
  const [cx, cy, cz] = cam.pos, [tx, ty, tz] = cam.target;
  let fx = tx - cx, fy = ty - cy, fz = tz - cz;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl; rz /= rl;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const t = Math.tan((cam.fov * Math.PI) / 360);
  let hit = 0, n = 0;
  for (let j = 0; j < 7; j++) {
    for (let i = 0; i < 11; i++) {
      const sx = ((i + 0.5) / 11 * 2 - 1) * t * (w / h), sy = ((j + 0.5) / 7 * 2 - 1) * t;
      let dx = fx + rx * sx + ux * sy, dy = fy + uy * sy, dz = fz + rz * sx + uz * sy;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      n++;
      for (let d = 0.2; d <= reach; d += 0.3) {
        if (world.solidAt(cx + dx * d, cy + dy * d, cz + dz * d, 0)) {
          hit++;
          break;
        }
      }
    }
  }
  return hit / n;
}

/** The meteor moment of the cover: rocks in the air in frame (below the title), an impact a few hundredths of a second old. */
function pickMeteorTime(round, cam, w, h, world) {
  const seen = (p) => world.clearFraction(cam.pos[0], cam.pos[1], cam.pos[2], p[0], p[1], p[2], 0.25) >= 0.99;
  let best = 20000, bs = -1;
  for (let t = 12000; t < 47000; t += 100) {
    let air = 0, boom = 0;
    for (const m of round.meteors) {
      const d = m.at - t;
      if (d > 0 && d < METEOR_TELEGRAPH) {
        const k = d / METEOR_TELEGRAPH;
        const p = [m.x - 28 * k, m.y + 66 * k, m.z - 15 * k];
        const rock = projectPoint(cam, w, h, p[0], p[1], p[2]);
        if (rock.depth > 0 && rock.x > 60 && rock.x < w - 60 && rock.y > h * 0.2 && rock.y < h * 0.75 && seen(p)) air++;
      }
      if (d <= 0 && d > -260) {
        const b = projectPoint(cam, w, h, m.x, m.y, m.z);
        if (b.depth > 5 && b.x > 200 && b.x < w - 200 && b.y > h * 0.5 && b.y < h * 0.9 && seen([m.x, m.y + 0.5, m.z])) boom += 3 - Math.abs(d + 130) / 130;
      }
    }
    const sc = air + boom * 2;
    if (sc > bs) {
      bs = sc;
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
    // from open air just off the south shore, looking up the road: the clock tower at its end, houses either side, rocks falling
    const kinds = ['meteor'];
    const round = prepareRound(kinds, 4242, world);
    const camera = { pos: [-2, 8, 38], target: [0, 7, 14], fov: 62 };
    const t = pickMeteorTime(round, camera, size.w, size.h, world);
    return {
      ...base, kinds, seed: 4242, t, sky: kinds, title: true,
      camera,
      chars: [
        runner(0.4, 19, 0.1, 0), runner(-0.9, 22.5, -0.2, 1), runner(1.0, 15, 0.3, 2), runner(-0.2, 12, 0.0, 3), runner(1.1, 25.2, 0.2, 4),
        runner(-3.2, 6, 0.5, 5), runner(2.6, 7.5, -0.4, 6), runner(-3.6, 3.5, 0.8, 7),
        { x: 5, y: 5.55, z: 20.2, yaw: 0.4, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[8] },
        { x: -8, y: 5.55, z: 18.2, yaw: -0.3, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[9] },
      ],
    };
  }
  if (name === 'action') {
    // from the plaza looking north: the tornado beside the clock tower, people running, one being flung
    const kinds = ['tornado'];
    const t = 27000;
    return {
      ...base, kinds, seed: 7781, t, sky: kinds,
      camera: { pos: [-1.4, 2.5, 12.9], target: [-8.7, 11, -14.2], fov: 66 },
      chars: [
        { x: -9.7, y: 0, z: -4.6, yaw: 0.9, speed: 0, phase: 0, out: 0.7, cause: 'flung', color: PLAYER_COLORS[3], key: 'a' },
        { x: -1.4, y: 0, z: -2.7, yaw: 0.2, speed: 10, phase: 1.1, sprint: true, color: PLAYER_COLORS[0] },
        { x: -10.6, y: 0, z: 1.9, yaw: -0.3, speed: 10, phase: 2.4, sprint: true, color: PLAYER_COLORS[4] },
        { x: 1.9, y: 0, z: -5.6, yaw: 0.5, speed: 9, phase: 0.2, sprint: true, color: PLAYER_COLORS[5] },
      ],
    };
  }
  if (name === 'win') {
    const kinds = ['flood'];
    const cx = 0, cz = -15;
    return {
      ...base, kinds, seed: 99, t: 40000, sky: ['sunset'], water: FLOOD_MAX, sunDir: [-0.62, 0.17, -0.77],
      camera: { pos: [7.2, 22.1, -7.2], target: [0, 21.2, -15], fov: 62 },
      chars: [
        { x: cx - 1.3, y: 20, z: cz - 0.3, yaw: 0.5, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[0] },
        { x: cx + 0.2, y: 20, z: cz + 0.2, yaw: 0.2, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[4] },
        { x: cx + 1.5, y: 20, z: cz - 0.7, yaw: -0.4, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[2] },
        { x: cx - 0.5, y: 20, z: cz - 1.8, yaw: 0.9, speed: 0, phase: 0, color: PLAYER_COLORS[6] },
        { x: cx + 1.0, y: 20, z: cz - 1.9, yaw: -0.8, speed: 0, phase: 0, air: true, color: PLAYER_COLORS[3] },
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
      camera: { pos: [tp.x + 4, 17, 96], target: [tp.x, 15.5, tp.z], fov: 42 },
      chars: [],
    };
  }
  return { ...base, badge: name.slice(6), camera: null };
}

export { WARN_MS, floodLevel };
