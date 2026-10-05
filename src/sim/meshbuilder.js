// Builds flat-shaded, vertex-coloured triangle soup without three.js, so geometry can be made and checked in node.
// Colours are given as sRGB hex and stored linear (what three's colour management expects for vertex colours).

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  return [lin(((hex >> 16) & 255) / 255), lin(((hex >> 8) & 255) / 255), lin((hex & 255) / 255)];
}
function shade(hex, f) {
  const r = Math.max(0, Math.min(255, Math.round(((hex >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((hex >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((hex & 255) * f)));
  return (r << 16) | (g << 8) | b;
}
export { shade };

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  get triangles() {
    return this.pos.length / 9;
  }

  /** One triangle with a flat normal from its winding (counter-clockwise seen from outside). */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, hex) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const [r, g, b] = hexToLinear(hex);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.nor.push(nx, ny, nz);
      this.col.push(r, g, b);
    }
  }

  /** A quad a-b-c-d (counter-clockwise from outside). */
  quad(a, b, c, d, hex) {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], hex);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], hex);
  }

  /** An axis-aligned box. `top` colours the upper face; the bottom face is skipped when `noBottom`. */
  box(x0, y0, z0, x1, y1, z1, side, top = side, noBottom = false) {
    const f = (k) => shade(side, k);
    // +x
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], f(0.92));
    // -x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], f(0.8));
    // +y
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top);
    // -y
    if (!noBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], f(0.6));
    // +z
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], f(1.0));
    // -z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], f(0.86));
  }

  /**
   * A sloped slab or wedge over the plan x0..x1, z0..z1. Its top height runs along `axis` from `ya` (at the low coordinate)
   * to `yb`. The underside is `thick` below the top, or the ground (0) for a solid wedge (thick >= 50).
   */
  ramp(axis, x0, z0, x1, z1, ya, yb, thick, side, top = side) {
    const solid = thick >= 50;
    const f = (k) => shade(side, k);
    const hx = (x, z) => (axis === 'x' ? (x === x0 ? ya : yb) : z === z0 ? ya : yb);
    const bottom = (x, z) => (solid ? 0 : hx(x, z) - thick);
    const P = (x, z) => [x, hx(x, z), z];
    const B = (x, z) => [x, bottom(x, z), z];
    // top face
    this.quad(P(x0, z1), P(x1, z1), P(x1, z0), P(x0, z0), top);
    // underside (only a slab has one)
    if (!solid) this.quad(B(x0, z0), B(x1, z0), B(x1, z1), B(x0, z1), f(0.55));
    // +x side, -x side, +z side, -z side (quads from bottom to top edge; degenerate triangles are harmless)
    this.quad(B(x1, z1), B(x1, z0), P(x1, z0), P(x1, z1), f(0.9));
    this.quad(B(x0, z0), B(x0, z1), P(x0, z1), P(x0, z0), f(0.78));
    this.quad(B(x0, z1), B(x1, z1), P(x1, z1), P(x0, z1), f(1.0));
    this.quad(B(x1, z0), B(x0, z0), P(x0, z0), P(x1, z0), f(0.85));
  }

  /** A vertical cylinder or truncated cone. */
  cyl(cx, y0, cz, y1, r0, r1, seg, hex, topHex = hex, capBottom = false) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const k = 0.78 + 0.22 * Math.cos((a0 + a1) * 0.5 - 0.9);
      const col = shade(hex, k);
      const b0 = [cx + c0 * r0, y0, cz + s0 * r0], b1 = [cx + c1 * r0, y0, cz + s1 * r0];
      const t0 = [cx + c0 * r1, y1, cz + s0 * r1], t1 = [cx + c1 * r1, y1, cz + s1 * r1];
      this.quad(b1, b0, t0, t1, col);
      if (r1 > 0.001) this.tri(cx, y1, cz, t1[0], t1[1], t1[2], t0[0], t0[1], t0[2], topHex);
      if (capBottom && r0 > 0.001) this.tri(cx, y0, cz, b0[0], b0[1], b0[2], b1[0], b1[1], b1[2], shade(hex, 0.5));
    }
  }

  /** A gable-end triangle in a vertical plane: a plane of constant x (`along` 'z') with base z0..z1 and apex at zc. */
  gableX(x0, x1, z0, z1, yb, ya, hex) {
    const zc = (z0 + z1) / 2;
    const f = (k) => shade(hex, k);
    // -x face, +x face
    this.tri(x0, yb, z0, x0, yb, z1, x0, ya, zc, f(0.8));
    this.tri(x1, yb, z1, x1, yb, z0, x1, ya, zc, f(0.92));
    // the two sloped edges and the bottom are hidden inside the roof and walls
  }

  /** An icosahedron-like blob (low-poly sphere) of radii (rx, ry, rz). */
  blob(cx, cy, cz, rx, ry, rz, hex, jitter = 0, seed = 1) {
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    let s = seed >>> 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const pts = v.map((p) => {
      const l = Math.hypot(p[0], p[1], p[2]);
      const j = 1 + (rnd() - 0.5) * jitter;
      return [cx + (p[0] / l) * rx * j, cy + (p[1] / l) * ry * j, cz + (p[2] / l) * rz * j];
    });
    for (const [a, b, c] of F) {
      const k = 0.82 + 0.3 * ((pts[a][1] + pts[b][1] + pts[c][1]) / 3 - cy + ry) / (2 * ry || 1);
      this.tri(pts[a][0], pts[a][1], pts[a][2], pts[b][0], pts[b][1], pts[b][2], pts[c][0], pts[c][1], pts[c][2], shade(hex, k));
    }
  }

  /** A flat horizontal disc or ring at height y. */
  disc(cx, y, cz, rIn, rOut, seg, hex) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const o0 = [cx + Math.cos(a0) * rOut, y, cz + Math.sin(a0) * rOut], o1 = [cx + Math.cos(a1) * rOut, y, cz + Math.sin(a1) * rOut];
      if (rIn <= 0.001) {
        this.tri(cx, y, cz, o1[0], y, o1[2], o0[0], y, o0[2], hex);
      } else {
        const i0 = [cx + Math.cos(a0) * rIn, y, cz + Math.sin(a0) * rIn], i1 = [cx + Math.cos(a1) * rIn, y, cz + Math.sin(a1) * rIn];
        this.quad(i0, i1, o1, o0, hex);
      }
    }
  }

  /** Typed arrays ready for a BufferGeometry. */
  arrays() {
    return { position: new Float32Array(this.pos), normal: new Float32Array(this.nor), color: new Float32Array(this.col) };
  }
}
