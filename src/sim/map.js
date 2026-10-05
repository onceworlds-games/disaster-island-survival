// The island: a flat ground plane with a town made only of boxes and ramps, so the character controller stays exact.
// Pure data (no three.js, no DOM): collision solids, ladders, decoration for the renderer, spawn points and building info.
//
// Axes: x east, z south, y up. The ground is y = 0 inside the shore; the sea starts at SEA (below it).
//
// A solid is either
//   box:  { k: 0, x0, x1, z0, z1, y0, y1 }
//   ramp: { k: 1, axis: 'x' | 'z', x0, x1, z0, z1, ya, yb, thick }  top height runs along `axis` from ya (low coordinate) to yb;
//         thick >= 50 is a wedge (solid down to the ground), otherwise a slab `thick` thick (a roof).
// Ladders are zones in front of a wall face: { x, z, nx, nz, y0, y1, hw }.

import { mulberry32 } from './rng.js';

export const SEA = -0.6;
export const SHORE = { a: 43.4, b: 33.4 }; // walkable ellipse (half axes)
export const ISLAND_VIS = { a: 44.5, b: 34.5 }; // the grass edge drawn
export const PIER = { x0: -7.6, x1: -4.4, z0: 28, z1: 45.6 };

export function inBounds(x, z) {
  if ((x * x) / (SHORE.a * SHORE.a) + (z * z) / (SHORE.b * SHORE.b) <= 1) return true;
  return x >= PIER.x0 && x <= PIER.x1 && z > PIER.z0 && z <= PIER.z1;
}

const T = 0.4; // wall thickness
export const COLORS = {
  grass: 0x6fae4c,
  grassDark: 0x5c9a41,
  sand: 0xe3cd98,
  sandWet: 0xc8b07a,
  seabed: 0x2b6f8a,
  road: 0x6d7076,
  plaza: 0xd8cdb4,
  rock: 0x7f7a75,
  rockTop: 0x9a948c,
  trunk: 0x6b4a2f,
  wood: 0xa97c50,
  woodDark: 0x7a5636,
  glass: 0x24384f,
  steel: 0x7e8d9c,
  steelDark: 0x4d5a68,
  rail: 0xffb02a,
  rung: 0xf1e7cf,
};

/** Builds the whole map. Deterministic: no randomness outside the seeded generators below. */
export function buildMap() {
  const solids = [];
  const deco = [];
  const ladders = [];
  const buildings = [];
  const exclusions = []; // plan rectangles trees and rocks stay out of: [x0, z0, x1, z1]

  const ordered = (a, b) => (a < b ? [a, b] : [b, a]);
  const box = (x0, y0, z0, x1, y1, z1, color, top = color, tag = '') => {
    [x0, x1] = ordered(x0, x1);
    [y0, y1] = ordered(y0, y1);
    [z0, z1] = ordered(z0, z1);
    solids.push({ k: 0, x0, x1, z0, z1, y0, y1, color, top, tag });
  };
  const ramp = (axis, x0, z0, x1, z1, ya, yb, thick, color, top = color, tag = '') => {
    [x0, x1] = ordered(x0, x1);
    [z0, z1] = ordered(z0, z1);
    solids.push({ k: 1, axis, x0, x1, z0, z1, ya, yb, thick, color, top, tag });
  };
  const dbox = (x0, y0, z0, x1, y1, z1, color, top = color) => {
    [x0, x1] = ordered(x0, x1);
    [y0, y1] = ordered(y0, y1);
    [z0, z1] = ordered(z0, z1);
    deco.push({ t: 'box', x0, y0, z0, x1, y1, z1, c: color, ct: top });
  };
  const excl = (x0, z0, x1, z1) => exclusions.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);

  /** A wall band along an axis with door gaps: solid parts, and a lintel over each gap. */
  function band(axis, lo, hi, bandLo, bandHi, gaps, y0, y1, color) {
    const sorted = [...gaps].sort((a, b) => a.at - b.at);
    let cursor = lo;
    const put = (s, e, ya, yb) => {
      if (e - s < 0.01) return;
      if (axis === 'x') box(s, ya, bandLo, e, yb, bandHi, color);
      else box(bandLo, ya, s, bandHi, yb, e, color);
    };
    for (const g of sorted) {
      const gs = g.at - g.w / 2, ge = g.at + g.w / 2;
      put(cursor, gs, y0, y1);
      put(gs, ge, y0 + g.h, y1);
      cursor = ge;
    }
    put(cursor, hi, y0, y1);
  }

  /** Four walls with doors: doors = [{ side: 'N'|'S'|'E'|'W', at, w, h }]. */
  function walls(x0, z0, x1, z1, y0, y1, color, doors) {
    const on = (side) => doors.filter((d) => d.side === side).map((d) => ({ at: d.at, w: d.w ?? 2.4, h: d.h ?? 2.9 }));
    band('x', x0, x1, z0, z0 + T, on('N'), y0, y1, color);
    band('x', x0, x1, z1 - T, z1, on('S'), y0, y1, color);
    band('z', z0 + T, z1 - T, x0, x0 + T, on('W'), y0, y1, color);
    band('z', z0 + T, z1 - T, x1 - T, x1, on('E'), y0, y1, color);
  }

  /** Dark window panes on a building's walls (decoration only). */
  function windows(x0, z0, x1, z1, rows, doors, skipSides = []) {
    const nearDoor = (side, c) => doors.some((d) => d.side === side && Math.abs(d.at - c) < (d.w ?? 2.4) / 2 + 0.9);
    for (const [wy0, wy1] of rows) {
      for (const side of ['N', 'S', 'E', 'W']) {
        if (skipSides.includes(side)) continue;
        const horizontal = side === 'N' || side === 'S';
        const lo = horizontal ? x0 : z0, hi = horizontal ? x1 : z1;
        const run = hi - lo - 2.4;
        const n = Math.max(1, Math.floor(run / 3));
        for (let i = 0; i < n; i++) {
          const c = lo + 1.2 + (run * (i + 0.5)) / n;
          if (nearDoor(side, c)) continue;
          const hw = 0.65;
          if (side === 'N') dbox(c - hw, wy0, z0 - 0.06, c + hw, wy1, z0 + 0.02, COLORS.glass);
          if (side === 'S') dbox(c - hw, wy0, z1 - 0.02, c + hw, wy1, z1 + 0.06, COLORS.glass);
          if (side === 'W') dbox(x0 - 0.06, wy0, c - hw, x0 + 0.02, wy1, c + hw, COLORS.glass);
          if (side === 'E') dbox(x1 - 0.02, wy0, c - hw, x1 + 0.06, wy1, c + hw, COLORS.glass);
        }
      }
    }
  }

  /** A door slab (decoration) in the doorway frame. */
  function doorFrame(side, x0, z0, x1, z1, at, w, h, color) {
    const hw = w / 2;
    const f = 0.12;
    if (side === 'N') {
      dbox(at - hw - f, 0, z0 - 0.05, at - hw, h + f, z0 + T + 0.02, color);
      dbox(at + hw, 0, z0 - 0.05, at + hw + f, h + f, z0 + T + 0.02, color);
    } else if (side === 'S') {
      dbox(at - hw - f, 0, z1 - T - 0.02, at - hw, h + f, z1 + 0.05, color);
      dbox(at + hw, 0, z1 - T - 0.02, at + hw + f, h + f, z1 + 0.05, color);
    } else if (side === 'W') {
      dbox(x0 - 0.05, 0, at - hw - f, x0 + T + 0.02, h + f, at - hw, color);
      dbox(x0 - 0.05, 0, at + hw, x0 + T + 0.02, h + f, at + hw + f, color);
    } else {
      dbox(x1 - T - 0.02, 0, at - hw - f, x1 + 0.05, h + f, at - hw, color);
      dbox(x1 - T - 0.02, 0, at + hw, x1 + 0.05, h + f, at + hw + f, color);
    }
  }

  // ---------------------------------------------------------------- ground, plaza and roads (decoration only)
  deco.push({ t: 'disc', x: 0, y: 0.03, z: 0, ri: 0, ro: 9.5, seg: 40, c: COLORS.plaza });
  deco.push({ t: 'disc', x: 0, y: 0.04, z: 0, ri: 9.5, ro: 10.1, seg: 40, c: 0x9d9382 });
  const roads = [
    [-34, -1.8, -9, 1.8],
    [9, -1.8, 36, 1.8],
    [-1.8, 9, 1.8, 28],
    [-1.8, -28, 1.8, -9],
  ];
  for (const [x0, z0, x1, z1] of roads) dbox(x0, 0, z0, x1, 0.035, z1, COLORS.road);

  // fountain in the middle of the plaza
  box(-1.8, 0, -1.8, 1.8, 0.7, 1.8, 0xb7b2a6, 0xc9c4b8, 'fountain');
  dbox(-1.4, 0.7, -1.4, 1.4, 0.78, 1.4, 0x3d86b5);
  deco.push({ t: 'cyl', x: 0, z: 0, y0: 0.7, y1: 2.0, r0: 0.28, r1: 0.2, seg: 8, c: 0xb7b2a6, ct: 0xc9c4b8 });
  deco.push({ t: 'cyl', x: 0, z: 0, y0: 2.0, y1: 2.15, r0: 0.9, r1: 0.9, seg: 12, c: 0x59a0cf, ct: 0x7fc0e6 });

  // ---------------------------------------------------------------- houses (gable roofs, climbable)
  const HOUSES = [
    { id: 'h1', x0: -37, z0: 3, door: { side: 'E', at: 6 }, stairs: { side: 'S', at: -33 }, wall: 0xe9dcc3, roof: 0xb5473a },
    { id: 'h2', x0: -26, z0: 11, door: { side: 'E', at: 14 }, stairs: { side: 'S', at: -22 }, wall: 0xcfd8df, roof: 0x3f5f73 },
    { id: 'h3', x0: -12, z0: 15, door: { side: 'N', at: -8 }, stairs: { side: 'S', at: -6 }, wall: 0xe3c7a4, roof: 0x8a3b32 },
    { id: 'h4', x0: 2, z0: 17, door: { side: 'N', at: 6 }, stairs: { side: 'S', at: 8 }, wall: 0xd9d4c7, roof: 0x4b5b6b },
    { id: 'h5', x0: -34, z0: -23, door: { side: 'E', at: -20 }, stairs: { side: 'S', at: -31 }, wall: 0xdcc9ad, roof: 0x9a4a35 },
    { id: 'h6', x0: 6, z0: -27, door: { side: 'S', at: 7.5 }, stairs: { side: 'S', at: 12 }, wall: 0xe6d9bd, roof: 0x3b6a63 },
  ];
  const WALL_H = 3.2;
  const EAVE = 2.9;
  const RIDGE = 5.6;
  for (const h of HOUSES) {
    const x0 = h.x0, z0 = h.z0, x1 = x0 + 8, z1 = z0 + 6, zc = (z0 + z1) / 2;
    const doors = [{ side: h.door.side, at: h.door.at, w: 2.4, h: 2.8 }];
    walls(x0, z0, x1, z1, 0, WALL_H, h.wall, doors);
    windows(x0, z0, x1, z1, [[1.3, 2.5]], doors);
    doorFrame(h.door.side, x0, z0, x1, z1, h.door.at, 2.4, 2.8, 0x5a3f2a);
    dbox(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.35, z1 + 0.05, 0x8b8379); // plinth
    dbox(x0 + T, 0.03, z0 + T, x1 - T, 0.04, z1 - T, COLORS.wood); // floor
    // gable roof: two sloped slabs meeting at the ridge, overhanging the walls
    ramp('z', x0 - 0.5, z0 - 0.5, x1 + 0.5, zc, EAVE, RIDGE, 0.35, h.roof, h.roof, 'roof');
    ramp('z', x0 - 0.5, zc, x1 + 0.5, z1 + 0.5, RIDGE, EAVE, 0.35, h.roof, h.roof, 'roof');
    deco.push({ t: 'gable', x0, x1: x0 + T, z0, z1, yb: WALL_H, ya: RIDGE - 0.32, c: h.wall });
    deco.push({ t: 'gable', x0: x1 - T, x1, z0, z1, yb: WALL_H, ya: RIDGE - 0.32, c: h.wall });
    dbox(x0 - 0.5, RIDGE - 0.12, zc - 0.12, x1 + 0.5, RIDGE + 0.06, zc + 0.12, 0x3a2b26); // ridge cap
    // outside stairs up to the eave
    const sx = h.stairs.at;
    if (h.stairs.side === 'S') {
      ramp('z', sx - 1, z1 + 0.5, sx + 1, z1 + 6.5, EAVE, 0, 99, 0xb59468, 0xc2a577, 'stairs');
      excl(sx - 1.5, z1 + 0.3, sx + 1.5, z1 + 7);
    } else {
      ramp('z', sx - 1, z0 - 6.5, sx + 1, z0 - 0.5, 0, EAVE, 99, 0xb59468, 0xc2a577, 'stairs');
      excl(sx - 1.5, z0 - 7, sx + 1.5, z0 - 0.3);
    }
    buildings.push({ id: h.id, kind: 'house', x0, x1, z0, z1, top: RIDGE, debris: true });
    excl(x0 - 2.5, z0 - 2.5, x1 + 2.5, z1 + 2.5);
  }

  // ---------------------------------------------------------------- the shop: two floors, stairs inside, a flat roof you climb outside
  {
    const x0 = -27, x1 = -13, z0 = -12.5, z1 = -3.5;
    const FL = 4.4; // second floor top
    const SL = 4.0; // its underside
    const RT = 8.6; // roof top
    const doors = [{ side: 'E', at: -8, w: 2.6, h: 3.2 }];
    walls(x0, z0, x1, z1, 0, RT - 0.4, 0xc6ccd4, doors);
    windows(x0, z0, x1, z1, [[1.3, 2.7], [5.2, 6.6]], doors);
    doorFrame('E', x0, z0, x1, z1, -8, 2.6, 3.2, 0x2c5f6f);
    dbox(x0 - 0.05, 0, z0 - 0.05, x1 + 0.05, 0.4, z1 + 0.05, 0x7d8590);
    dbox(x0 - 0.15, RT - 0.4, z0 - 0.15, x1 + 0.15, RT + 0.45, z0 + 0.15, 0x2c5f6f); // roof rim (decoration)
    dbox(x0 - 0.15, RT - 0.4, z1 - 0.15, x1 + 0.15, RT + 0.45, z1 + 0.15, 0x2c5f6f);
    dbox(x0 - 0.15, RT - 0.4, z0, x0 + 0.15, RT + 0.45, z1, 0x2c5f6f);
    dbox(x1 - 0.15, RT - 0.4, z0, x1 + 0.15, RT + 0.45, z1, 0x2c5f6f);
    dbox(x0 + T, 0.03, z0 + T, x1 - T, 0.04, z1 - T, 0x9a8f80); // floor
    // awning over the door
    dbox(x1 - 0.1, 3.4, -10.2, x1 + 1.7, 3.6, -5.8, 0xd0413c);
    // upper floor with a hole for the stairs (x -25.4..-17.4, z -12.1..-9.1)
    box(x0, SL, z0, -25.4, FL, z1, 0xb9bec6, 0xa9a095, 'floor2');
    box(-17.4, SL, z0, x1, FL, z1, 0xb9bec6, 0xa9a095, 'floor2');
    box(-25.4, SL, -9.1, -17.4, FL, z1, 0xb9bec6, 0xa9a095, 'floor2');
    ramp('x', -25.4, -12.1, -17.4, -9.1, FL, 0, 99, 0x8d8272, 0xb7a58a, 'stairs');
    box(x0, RT - 0.4, z0, x1, RT, z1, 0x9ca3ad, 0x8e949c, 'roof');
    // outside ramp to the roof along the south wall
    ramp('x', -27.6, -3.5, -12, -1.3, RT, 0, 99, 0xb59468, 0xc2a577, 'stairs');
    buildings.push({ id: 'shop', kind: 'shop', x0, x1, z0, z1, top: RT, debris: true });
    excl(x0 - 3, z0 - 3, x1 + 3, z1 + 3);
  }

  // ---------------------------------------------------------------- clock tower: a shaft with a ladder on its south face
  {
    const cx = 0, cz = -15, hw = 2.2, TOP = 20;
    box(cx - hw, 0, cz - hw, cx + hw, TOP, cz + hw, 0xb06a45, 0xc9c0b0, 'clock');
    dbox(cx - hw - 0.4, TOP - 1.8, cz - hw - 0.4, cx + hw + 0.4, TOP - 1.0, cz + hw + 0.4, 0xe6dccb); // cornice
    dbox(cx - hw - 0.3, TOP - 1.0, cz - hw - 0.3, cx + hw + 0.3, TOP - 0.5, cz - hw + 0.1, 0xe6dccb); // parapet bits (visual)
    dbox(cx - hw - 0.3, TOP - 1.0, cz + hw - 0.1, cx + hw + 0.3, TOP - 0.5, cz + hw + 0.3, 0xe6dccb);
    dbox(cx - hw - 0.3, TOP - 1.0, cz - hw, cx - hw + 0.1, TOP - 0.5, cz + hw, 0xe6dccb);
    dbox(cx + hw - 0.1, TOP - 1.0, cz - hw, cx + hw + 0.3, TOP - 0.5, cz + hw, 0xe6dccb);
    dbox(cx - hw - 0.1, 0, cz - hw - 0.1, cx + hw + 0.1, 0.8, cz + hw + 0.1, 0x7b5236);
    // clock faces on the four sides
    const face = (x, z, nx, nz) => {
      const o = 0.06, y0 = TOP - 7.8, y1 = TOP - 5.2;
      if (nx === 0) dbox(x - 1.3, y0, z + nz * o - 0.04, x + 1.3, y1, z + nz * o + 0.04, 0xf1ead8);
      else dbox(x + nx * o - 0.04, y0, z - 1.3, x + nx * o + 0.04, y1, z + 1.3, 0xf1ead8);
      const ym = (y0 + y1) / 2;
      if (nx === 0) {
        dbox(x - 0.1, ym, z + nz * (o + 0.05) - 0.03, x + 0.1, ym + 1.0, z + nz * (o + 0.05) + 0.03, 0x2a2a2a);
        dbox(x - 0.1, ym - 0.1, z + nz * (o + 0.05) - 0.03, x + 0.8, ym + 0.1, z + nz * (o + 0.05) + 0.03, 0x2a2a2a);
      } else {
        dbox(x + nx * (o + 0.05) - 0.03, ym, z - 0.1, x + nx * (o + 0.05) + 0.03, ym + 1.0, z + 0.1, 0x2a2a2a);
        dbox(x + nx * (o + 0.05) - 0.03, ym - 0.1, z - 0.1, x + nx * (o + 0.05) + 0.03, ym + 0.1, z + 0.8, 0x2a2a2a);
      }
    };
    face(cx, cz + hw, 0, 1);
    face(cx, cz - hw, 0, -1);
    face(cx + hw, cz, 1, 0);
    face(cx - hw, cz, -1, 0);
    // flag pole on the deck
    deco.push({ t: 'cyl', x: cx + 1.6, z: cz - 1.6, y0: TOP, y1: TOP + 3.5, r0: 0.07, r1: 0.05, seg: 5, c: 0xd9d9d9 });
    dbox(cx + 1.6, TOP + 2.2, cz - 1.6 - 0.03, cx + 3.0, TOP + 3.4, cz - 1.6 + 0.03, 0xe0412f);
    // the ladder: rails and rungs on the south face
    const faceZ = cz + hw;
    ladders.push({ id: 'clock', x: cx, z: faceZ, nx: 0, nz: 1, y0: 0, y1: TOP, hw: 0.55 });
    dbox(cx - 0.55, 0, faceZ, cx - 0.47, TOP, faceZ + 0.1, COLORS.rail);
    dbox(cx + 0.47, 0, faceZ, cx + 0.55, TOP, faceZ + 0.1, COLORS.rail);
    for (let y = 0.5; y < TOP; y += 0.5) dbox(cx - 0.5, y, faceZ, cx + 0.5, y + 0.07, faceZ + 0.09, COLORS.rung);
    buildings.push({ id: 'clock', kind: 'tower', x0: cx - hw, x1: cx + hw, z0: cz - hw, z1: cz + hw, top: TOP, debris: true });
    excl(cx - 4, cz - 4, cx + 4, cz + 5);
  }

  // ---------------------------------------------------------------- water tower on legs with a ladder up its south edge
  {
    const cx = 24, cz = -18;
    const dx0 = cx - 3.5, dx1 = cx + 3.5, dz0 = cz - 3.5, dz1 = cz + 3.5;
    for (const [lx, lz] of [[cx - 2.8, cz - 2.8], [cx + 2.8, cz - 2.8], [cx - 2.8, cz + 2.8], [cx + 2.8, cz + 2.8]]) {
      box(lx - 0.35, 0, lz - 0.35, lx + 0.35, 16, lz + 0.35, 0x8a97a4, 0x8a97a4, 'leg');
    }
    // cross bracing between the legs (decoration)
    for (const y of [4, 9, 13.5]) {
      dbox(cx - 2.8, y, cz + 2.8 - 0.06, cx + 2.8, y + 0.14, cz + 2.8 + 0.06, 0x6f7c89);
      dbox(cx - 2.8, y, cz - 2.8 - 0.06, cx + 2.8, y + 0.14, cz - 2.8 + 0.06, 0x6f7c89);
      dbox(cx - 2.8 - 0.06, y, cz - 2.8, cx - 2.8 + 0.06, y + 0.14, cz + 2.8, 0x6f7c89);
      dbox(cx + 2.8 - 0.06, y, cz - 2.8, cx + 2.8 + 0.06, y + 0.14, cz + 2.8, 0x6f7c89);
    }
    box(dx0, 16, dz0, dx1, 16.6, dz1, 0x6d7a87, 0x8d9aa7, 'deck');
    // the tank (collides as a box; drawn round)
    box(cx - 2.2, 16.6, cz - 2.2, cx + 2.2, 20.6, cz + 2.2, 0xb5382c, 0xb5382c, 'tank');
    deco.push({ t: 'cyl', x: cx, z: cz, y0: 16.6, y1: 20.2, r0: 2.55, r1: 2.55, seg: 14, c: 0xb5382c, ct: 0xb5382c });
    deco.push({ t: 'cyl', x: cx, z: cz, y0: 20.2, y1: 22.2, r0: 2.7, r1: 0.2, seg: 14, c: 0x7a2a22, ct: 0x7a2a22 });
    for (const y of [17.8, 19.2]) deco.push({ t: 'cyl', x: cx, z: cz, y0: y, y1: y + 0.14, r0: 2.62, r1: 2.62, seg: 14, c: 0x3f4852, ct: 0x3f4852 });
    // the ladder spine on the south edge (flush with the deck top)
    const sz0 = dz1, sz1 = dz1 + 0.3;
    box(cx - 0.6, 0, sz0, cx + 0.6, 16.6, sz1, 0x5b6773, 0x8d9aa7, 'spine');
    ladders.push({ id: 'water', x: cx, z: sz1, nx: 0, nz: 1, y0: 0, y1: 16.6, hw: 0.55 });
    dbox(cx - 0.55, 0, sz1, cx - 0.47, 16.6, sz1 + 0.1, COLORS.rail);
    dbox(cx + 0.47, 0, sz1, cx + 0.55, 16.6, sz1 + 0.1, COLORS.rail);
    for (let y = 0.5; y < 16.6; y += 0.5) dbox(cx - 0.5, y, sz1, cx + 0.5, y + 0.07, sz1 + 0.09, COLORS.rung);
    buildings.push({ id: 'water', kind: 'tower', x0: dx0, x1: dx1, z0: dz0, z1: dz1, top: 20.6, debris: true });
    excl(dx0 - 2, dz0 - 2, dx1 + 2, dz1 + 3);
  }

  // ---------------------------------------------------------------- gas station: a canopy on pillars, pumps, a kiosk, a ramp up to the canopy
  {
    const x0 = 22, x1 = 34, z0 = -6, z1 = 1;
    box(x0, 4.4, z0, x1, 4.8, z1, 0xe9e9e9, 0xdadada, 'canopy');
    dbox(x0 - 0.05, 4.0, z0 - 0.05, x1 + 0.05, 4.4, z0 + 0.1, 0xd7263d);
    dbox(x0 - 0.05, 4.0, z1 - 0.1, x1 + 0.05, 4.4, z1 + 0.05, 0xd7263d);
    dbox(x0 - 0.05, 4.0, z0, x0 + 0.1, 4.4, z1, 0xd7263d);
    dbox(x1 - 0.1, 4.0, z0, x1 + 0.05, 4.4, z1, 0xd7263d);
    for (const [px, pz] of [[23, -5], [33, -5], [23, 0], [33, 0]]) box(px - 0.4, 0, pz - 0.4, px + 0.4, 4.4, pz + 0.4, 0xc9ccd1, 0xc9ccd1, 'pillar');
    for (const [px0, px1] of [[25.4, 26.6], [29.4, 30.6]]) {
      box(px0, 0, -3.3, px1, 1.35, -2.1, 0xd7263d, 0xf3f3f3, 'pump');
      dbox(px0 + 0.1, 0.8, -2.14, px1 - 0.1, 1.2, -2.08, 0x24384f);
    }
    dbox(26.8, 0, -3.4, 29.2, 0.03, -1.9, 0x4b4f55);
    dbox(21, 0, -6.5, 35, 0.03, 1.5, 0x55595f); // forecourt
    // kiosk with a flat roof
    const kx0 = 34.4, kx1 = 38.4, kz0 = -5.5, kz1 = -1.5;
    const kd = [{ side: 'W', at: -3.5, w: 2.2, h: 2.8 }];
    walls(kx0, kz0, kx1, kz1, 0, 3.0, 0xe9e5da, kd);
    box(kx0 - 0.2, 3.0, kz0 - 0.2, kx1 + 0.2, 3.4, kz1 + 0.2, 0xd7263d, 0xb7222f, 'roof');
    windows(kx0, kz0, kx1, kz1, [[1.0, 2.2]], kd);
    // ramp up to the canopy from the west
    ramp('x', 12.6, -4.2, 22, -2, 0, 4.8, 99, 0xb59468, 0xc2a577, 'stairs');
    buildings.push({ id: 'gas', kind: 'canopy', x0, x1, z0, z1, top: 4.8, debris: false });
    buildings.push({ id: 'kiosk', kind: 'house', x0: kx0, x1: kx1, z0: kz0, z1: kz1, top: 3.4, debris: true });
    excl(12, -7, 40, 2.5);
  }

  // ---------------------------------------------------------------- the hill: three terraces joined by ramps, a lookout on top
  const hill = { x: 21, z: 12, top: 15.4 };
  {
    const R = 0x8a7a68, G = 0x6aa84f;
    box(13, 0, 4, 29, 5, 20, R, G, 'hill1');
    box(15.5, 0, 6.5, 26.5, 10, 17.5, 0x7f705f, G, 'hill2');
    box(18, 0, 9, 24, 15.4, 15, 0x756757, 0x8d7c64, 'hill3');
    ramp('x', 13, 20, 29, 22.2, 0, 5, 99, 0xa88a5f, 0xc2a577, 'path'); // A: ground to the first terrace
    ramp('z', 26.65, 6.5, 28.85, 20, 10, 5, 99, 0xa88a5f, 0xc2a577, 'path'); // B: along the second terrace's east wall
    ramp('x', 18, 6.65, 26.5, 8.85, 15.4, 10, 99, 0xa88a5f, 0xc2a577, 'path'); // C: along the lookout's north wall
    // lookout: railing posts and a beacon (decoration)
    for (const [px, pz] of [[18.2, 9.2], [23.8, 9.2], [18.2, 14.8], [23.8, 14.8]]) dbox(px - 0.08, 15.4, pz - 0.08, px + 0.08, 16.4, pz + 0.08, 0xd9d9d9);
    dbox(18.1, 16.3, 9.1, 23.9, 16.4, 9.3, 0xd9d9d9);
    dbox(18.1, 16.3, 14.7, 23.9, 16.4, 14.9, 0xd9d9d9);
    dbox(18.1, 16.3, 9.1, 18.3, 16.4, 14.9, 0xd9d9d9);
    dbox(23.7, 16.3, 9.1, 23.9, 16.4, 14.9, 0xd9d9d9);
    deco.push({ t: 'cyl', x: 21, z: 12, y0: 15.4, y1: 19.4, r0: 0.12, r1: 0.08, seg: 5, c: 0xd9d9d9 });
    dbox(21, 18.4, 11.97, 22.9, 19.3, 12.03, 0xf2b21c);
    // a few boulders on the slopes
    deco.push({ t: 'blob', x: 14.2, y: 5.2, z: 6, rx: 1.2, ry: 0.9, rz: 1.2, c: 0x8b857c, j: 0.4, seed: 5 });
    deco.push({ t: 'blob', x: 27.5, y: 5.2, z: 5.5, rx: 1.1, ry: 0.8, rz: 1.0, c: 0x948e84, j: 0.4, seed: 8 });
    deco.push({ t: 'blob', x: 16.5, y: 10.2, z: 16.4, rx: 1.0, ry: 0.8, rz: 1.0, c: 0x8b857c, j: 0.4, seed: 2 });
    buildings.push({ id: 'hill', kind: 'hill', x0: 13, x1: 29, z0: 4, z1: 22.2, top: 15.4, debris: false });
    excl(12, 3, 30.5, 24);
  }

  // ---------------------------------------------------------------- pier
  {
    box(-8, -0.4, 28.5, -4, 0, 46, COLORS.woodDark, COLORS.wood, 'pier');
    // The planks are at ground height: the box top is y = 0 (a box that starts below keeps the pier supported over the shore).
    for (let z = 29; z < 46; z += 1.0) dbox(-8, 0, z, -4, 0.03, z + 0.08, COLORS.woodDark);
    for (let z = 30; z < 46; z += 4) {
      dbox(-8.1, -2.5, z, -7.8, -0.0, z + 0.3, 0x5d4129);
      dbox(-4.2, -2.5, z, -3.9, 0.0, z + 0.3, 0x5d4129);
    }
    dbox(-8.1, 0, 45.6, -7.8, 1.1, 45.9, 0x5d4129);
    dbox(-4.2, 0, 45.6, -3.9, 1.1, 45.9, 0x5d4129);
    excl(-9, 27, -3, 47);
  }

  // ---------------------------------------------------------------- trees and rocks (seeded, kept off buildings, ramps and the plaza)
  const rng = mulberry32(0x1d15a57e);
  const free = (x, z, margin) => {
    if (x * x + z * z < 11.5 * 11.5) return false;
    for (const [ax, az, bx, bz] of exclusions) if (x > ax - margin && x < bx + margin && z > az - margin && z < bz + margin) return false;
    for (const [rx, rz] of rocksAt) if ((x - rx) * (x - rx) + (z - rz) * (z - rz) < (margin + 2) * (margin + 2)) return false;
    return true;
  };
  const rocksAt = [];
  const trees = [];
  for (let i = 0, tries = 0; i < 9 && tries < 400; tries++) {
    const a = rng() * Math.PI * 2, r = 0.25 + rng() * 0.62;
    const x = Math.cos(a) * r * SHORE.a, z = Math.sin(a) * r * SHORE.b;
    if (!free(x, z, 2.2)) continue;
    rocksAt.push([x, z]);
    const w = 1.8 + rng() * 1.0, d = 1.5 + rng() * 0.9, h = 0.7 + rng() * 0.55;
    box(x - w / 2, 0, z - d / 2, x + w / 2, h, z + d / 2, COLORS.rock, COLORS.rockTop, 'rock');
    box(x - w * 0.3, h, z - d * 0.3, x + w * 0.25, h + 0.5, z + d * 0.28, COLORS.rock, COLORS.rockTop, 'rock');
    excl(x - w / 2 - 0.5, z - d / 2 - 0.5, x + w / 2 + 0.5, z + d / 2 + 0.5);
  }
  for (let i = 0, tries = 0; i < 40 && tries < 5000; tries++) {
    const a = rng() * Math.PI * 2, r = 0.2 + rng() * 0.64;
    const x = Math.cos(a) * r * SHORE.a, z = Math.sin(a) * r * SHORE.b;
    if (!free(x, z, 1.2)) continue;
    if (trees.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 12)) continue;
    i++;
    const s = 0.85 + rng() * 0.55;
    trees.push({ x, z, kind: 'pine', s, seed: Math.floor(rng() * 1e6) });
  }
  for (let i = 0, tries = 0; i < 16 && tries < 1500; tries++) {
    const a = rng() * Math.PI * 2, r = 0.86 + rng() * 0.09;
    const x = Math.cos(a) * r * SHORE.a, z = Math.sin(a) * r * SHORE.b;
    if (!free(x, z, 1.2)) continue;
    if (trees.some((t) => (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 20)) continue;
    i++;
    trees.push({ x, z, kind: 'palm', s: 0.9 + rng() * 0.4, seed: Math.floor(rng() * 1e6), lean: rng() * Math.PI * 2 });
  }
  for (const t of trees) {
    const hw = t.kind === 'pine' ? 0.28 * t.s : 0.22 * t.s;
    box(t.x - hw, 0, t.z - hw, t.x + hw, 2.6 * t.s, t.z + hw, COLORS.trunk, COLORS.trunk, 'trunk');
  }

  // ---------------------------------------------------------------- spawn slots on the plaza (two rings), highest safe spots, bounds
  const spawns = [];
  for (let i = 0; i < 16; i++) {
    const ring = i < 8 ? 0 : 1;
    const n = 8;
    const a = ((i % n) / n) * Math.PI * 2 + (ring ? Math.PI / n : 0.2);
    const r = ring ? 7.6 : 5.0;
    spawns.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: Math.atan2(Math.cos(a), Math.sin(a)) });
  }
  const highPoints = [
    { id: 'hill', x: 21, z: 12, y: 15.4 },
    { id: 'clock', x: 0, z: -15, y: 20 },
    { id: 'water', x: 24, z: -15.2, y: 16.6 },
  ];

  return { solids, deco, ladders, buildings, trees, spawns, highPoints, hill, inBounds, exclusions };
}
