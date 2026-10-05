// The island's static scenery as one vertex-coloured, flat-shaded triangle soup (no three.js here, so node can build and check it):
// ground and beach, the buildings from the map's solids and decoration, trees, rocks. One draw call for all of it.

import { MeshBuilder, shade } from '../sim/meshbuilder.js';
import { mulberry32 } from '../sim/rng.js';
import { COLORS, ISLAND_VIS } from '../sim/map.js';

function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** The ground: a grass lawn, a sand ring, a beach sloping into the sea, then the sea floor. */
function ground(mb) {
  const A = ISLAND_VIS.a, B = ISLAND_VIS.b;
  const SEG = 96;
  // rings: [scale, height, colour]
  const rings = [
    [0.0, 0, COLORS.grass],
    [0.28, 0, COLORS.grass],
    [0.56, 0, COLORS.grass],
    [0.8, 0, COLORS.grass],
    [0.9, 0, COLORS.sand],
    [0.985, 0, COLORS.sand],
    [1.03, -0.5, COLORS.sandWet],
    [1.1, -1.4, COLORS.sandWet],
    [1.35, -2.6, 0x8d8f7c],
    [1.7, -3.0, COLORS.seabed],
  ];
  const rnd = mulberry32(4242);
  const wob = Array.from({ length: SEG }, () => (rnd() - 0.5) * 0.045);
  const pt = (i, a) => {
    const s = rings[i][0] === 0 ? 0 : rings[i][0] + (i >= 3 && i <= 5 ? wob[a % SEG] : 0);
    const ang = ((a % SEG) / SEG) * Math.PI * 2;
    return [Math.cos(ang) * s * A, rings[i][1], Math.sin(ang) * s * B];
  };
  const col = (i, a, j) => {
    // a little patchiness in the lawn, none on the sea floor
    const n = Math.sin(a * 12.9898 + j * 78.233) * 43758.5453;
    const f = n - Math.floor(n);
    const base = rings[Math.min(i, rings.length - 1)][2];
    return i <= 3 ? mix(base, COLORS.grassDark, f * 0.5) : shade(base, 0.94 + f * 0.1);
  };
  for (let i = 0; i < rings.length - 1; i++) {
    for (let a = 0; a < SEG; a++) {
      const p00 = pt(i, a), p01 = pt(i, a + 1), p10 = pt(i + 1, a), p11 = pt(i + 1, a + 1);
      const c = col(i, a, i);
      if (i === 0) mb.tri(p00[0], p00[1], p00[2], p11[0], p11[1], p11[2], p10[0], p10[1], p10[2], c);
      else {
        mb.tri(p00[0], p00[1], p00[2], p01[0], p01[1], p01[2], p11[0], p11[1], p11[2], c);
        mb.tri(p00[0], p00[1], p00[2], p11[0], p11[1], p11[2], p10[0], p10[1], p10[2], col(i, a, i + 7));
      }
    }
  }
  // the open sea floor beyond
  mb.disc(0, -3.0, 0, 1.69 * A, 520, 40, COLORS.seabed);
}

function tree(mb, t) {
  const rnd = mulberry32(t.seed);
  const s = t.s;
  if (t.kind === 'pine') {
    const g = [0x2f7a3d, 0x3a8a45, 0x276a35, 0x42954a][Math.floor(rnd() * 4)];
    mb.cyl(t.x, 0, t.z, 1.6 * s, 0.26 * s, 0.2 * s, 6, COLORS.trunk);
    mb.cyl(t.x, 1.0 * s, t.z, 3.0 * s, 1.55 * s, 0.1, 7, g);
    mb.cyl(t.x, 2.1 * s, t.z, 4.3 * s, 1.2 * s, 0.1, 7, shade(g, 1.08));
    mb.cyl(t.x, 3.2 * s, t.z, 5.5 * s, 0.82 * s, 0.05, 7, shade(g, 1.16));
  } else {
    // a palm leaning over the beach
    const lean = t.lean ?? 0;
    const lx = Math.cos(lean) * 0.5, lz = Math.sin(lean) * 0.5;
    let px = t.x, pz = t.z;
    const segs = 4;
    for (let k = 0; k < segs; k++) {
      const y0 = (k * 1.3) * s, y1 = ((k + 1) * 1.3) * s;
      const nx = px + lx * s * (0.6 + k * 0.25), nz = pz + lz * s * (0.6 + k * 0.25);
      mb.tri(px - 0.17 * s, y0, pz, nx - 0.14 * s, y1, nz, nx + 0.14 * s, y1, nz, shade(0x8a6a46, 1 - k * 0.04));
      mb.tri(px - 0.17 * s, y0, pz, nx + 0.14 * s, y1, nz, px + 0.17 * s, y0, pz, shade(0x8a6a46, 1 - k * 0.04));
      mb.tri(px, y0, pz - 0.17 * s, nx, y1, nz + 0.14 * s, nx, y1, nz - 0.14 * s, shade(0x7a5c3c, 1 - k * 0.04));
      mb.tri(px, y0, pz - 0.17 * s, nx, y1, nz - 0.14 * s, px, y0, pz + 0.17 * s, shade(0x7a5c3c, 1 - k * 0.04));
      px = nx;
      pz = nz;
    }
    const topY = segs * 1.3 * s;
    for (let f = 0; f < 7; f++) {
      const a = (f / 7) * Math.PI * 2 + rnd() * 0.4;
      const len = (1.9 + rnd() * 0.5) * s;
      const ex = px + Math.cos(a) * len, ez = pz + Math.sin(a) * len, ey = topY - 0.7 * s;
      const mx = px + Math.cos(a) * len * 0.5, mz = pz + Math.sin(a) * len * 0.5, my = topY + 0.28 * s;
      const sx = -Math.sin(a) * 0.34 * s, sz = Math.cos(a) * 0.34 * s;
      const g = [0x3c9a4a, 0x2f8a41, 0x4aa653][f % 3];
      mb.tri(px, topY, pz, mx + sx, my, mz + sz, ex, ey, ez, g);
      mb.tri(px, topY, pz, ex, ey, ez, mx - sx, my, mz - sz, shade(g, 0.85));
      mb.tri(px, topY, pz, ex, ey, ez, mx + sx, my, mz + sz, shade(g, 0.8));
      mb.tri(px, topY, pz, mx - sx, my, mz - sz, ex, ey, ez, shade(g, 0.72));
    }
    mb.blob(px, topY - 0.15 * s, pz, 0.28 * s, 0.24 * s, 0.28 * s, 0x6b4a2f, 0.1, t.seed);
  }
}

/** Builds every static piece of the island into a MeshBuilder. */
export function buildWorldGeometry(map) {
  const mb = new MeshBuilder();
  ground(mb);
  for (const s of map.solids) {
    if (s.tag === 'trunk') continue;
    if (s.tag === 'rock') {
      const w = s.x1 - s.x0, d = s.z1 - s.z0, h = s.y1 - s.y0;
      mb.blob((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2, (w / 2) * 1.12, (h / 2) * 1.25, (d / 2) * 1.12, s.color, 0.35, Math.floor(s.x0 * 31 + s.z0 * 17));
      continue;
    }
    if (s.k === 0) mb.box(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, s.color, s.top ?? s.color, s.y0 <= 0.001);
    else mb.ramp(s.axis, s.x0, s.z0, s.x1, s.z1, s.ya, s.yb, s.thick, s.color, s.top ?? s.color);
  }
  for (const d of map.deco) {
    if (d.t === 'box') mb.box(d.x0, d.y0, d.z0, d.x1, d.y1, d.z1, d.c, d.ct ?? d.c, d.y0 <= 0.001);
    else if (d.t === 'cyl') mb.cyl(d.x, d.y0, d.z, d.y1, d.r0, d.r1, d.seg, d.c, d.ct ?? d.c);
    else if (d.t === 'blob') mb.blob(d.x, d.y, d.z, d.rx, d.ry, d.rz, d.c, d.j ?? 0, d.seed ?? 1);
    else if (d.t === 'gable') mb.gableX(d.x0, d.x1, d.z0, d.z1, d.yb, d.ya, d.c);
    else if (d.t === 'disc') mb.disc(d.x, d.y, d.z, d.ri, d.ro, d.seg, d.c);
  }
  for (const t of map.trees) tree(mb, t);
  return mb;
}
