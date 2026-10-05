import { buildMap } from '../src/sim/map.js';
import { World, makeBody, stepBody } from '../src/sim/collision.js';
import { getNav } from '../src/sim/nav.js';

export const map = buildMap();
export const world = new World(map);
export const nav = getNav(world);

/** A world made of just these solids (a flat ground everywhere in a 100 m square). */
export function miniWorld(solids, ladders = []) {
  const m = { solids, ladders, inBounds: (x, z) => Math.abs(x) < 50 && Math.abs(z) < 50, buildings: [], hill: { x: 0, z: 0, top: 10 } };
  return new World(m);
}
export const box = (x0, y0, z0, x1, y1, z1) => ({ k: 0, x0, x1, z0, z1, y0, y1 });

export const DT = 1 / 60;

/** Steps a body for `secs` seconds with a fixed or per-frame input. Returns the body. */
export function run(w, b, inp, secs, opts) {
  const n = Math.round(secs * 60);
  for (let i = 0; i < n; i++) stepBody(w, b, typeof inp === 'function' ? inp(i, b) : inp, DT, opts);
  return b;
}

export function standing(x, z, y = 0, w = world) {
  const b = makeBody(x, y, z);
  b.onGround = true;
  return b;
}

/** Walks a body along the nav graph to a node (as bots do): returns { ok, seconds }. */
export function walkTo(w, navGraph, b, goalNode, maxSeconds = 60) {
  const goal = goalNode;
  const key = `walk:${goal}`;
  // eslint-disable-next-line no-undef
  return import('../src/sim/nav.js').then(({ field, stepToward }) => {
    const dist = field(navGraph, key, (i) => i === goal);
    let t = 0;
    while (t < maxSeconds) {
      const n = navGraph.nearest(b.x, b.z, b.y, 1.3);
      if (n === goal || (n >= 0 && Math.hypot(navGraph.x[goal] - b.x, navGraph.z[goal] - b.z) < 0.6 && Math.abs(navGraph.y[goal] - b.y) < 0.5)) return { ok: true, seconds: t };
      let mx = 0, mz = 0;
      if (b.climbing) {
        mx = -b.climbing.nx;
        mz = -b.climbing.nz;
      } else if (n >= 0) {
        const e = stepToward(navGraph, dist, n);
        if (!e) return { ok: false, seconds: t, why: 'no step' };
        let tx, tz;
        if (e[2] === 2) {
          const L = w.ladders[e[3]];
          tx = L.x + L.nx * 0.65;
          tz = L.z + L.nz * 0.65;
          if (Math.hypot(tx - b.x, tz - b.z) < 0.45) {
            mx = -L.nx;
            mz = -L.nz;
          }
        } else {
          tx = navGraph.x[e[0]];
          tz = navGraph.z[e[0]];
        }
        if (mx === 0 && mz === 0) {
          const d = Math.hypot(tx - b.x, tz - b.z) || 1;
          mx = (tx - b.x) / d;
          mz = (tz - b.z) / d;
        }
      }
      stepBody(w, b, { mx, mz, sprint: false }, DT);
      t += DT;
    }
    return { ok: false, seconds: t, why: 'timeout' };
  });
}
