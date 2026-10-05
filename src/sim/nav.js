// A walking graph of the island, built from the very same collision world the characters use, so a path the bots plan is one a body
// can walk: one node per standable surface height in each 1 m cell (ground, roofs, stairs, terraces), edges between neighbouring
// cells that a body can cross (slopes, small steps, short drops), and the ladders as one-way edges up.
// Distance fields from goal sets (Dijkstra over reversed edges) let a bot follow the gradient to the nearest safe place.

import { topAt } from './collision.js';

const X0 = -46, X1 = 46, Z0 = -36, Z1 = 48;
const CELL = 1;
const NX = Math.ceil((X1 - X0) / CELL), NZ = Math.ceil((Z1 - Z0) / CELL);
const MAX_SLOPE = 0.85; // rise per metre a body walks up
const MAX_DROP = 2.5;

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Whether a body can walk from A to B: simulated the way the controller moves, following the surface under its feet. */
function walkable(world, ax, az, ay, bx, bz, by, drop) {
  const dist = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(dist / 0.25));
  let feet = ay;
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const x = ax + (bx - ax) * f, z = az + (bz - az) * f;
    if (world.blocked(x, z, feet)) return false;
    if (!drop) {
      const g = world.groundAt(x, z, feet);
      if (g < feet - 0.65) return false; // a gap
      feet = g;
    }
  }
  return drop ? true : Math.abs(feet - by) < 0.2;
}

export function buildNav(world) {
  const nodeX = [], nodeY = [], nodeZ = [], nodeCov = [];
  const cellStart = new Int32Array(NX * NZ + 1);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      cellStart[iz * NX + ix] = nodeX.length;
      const cx = X0 + (ix + 0.5) * CELL, cz = Z0 + (iz + 0.5) * CELL;
      if (!world.inBounds(cx, cz)) continue;
      const hs = [0];
      for (const s of world.near(cx, cz)) {
        if (cx < s.x0 - 0.3 || cx > s.x1 + 0.3 || cz < s.z0 - 0.3 || cz > s.z1 + 0.3) continue;
        const px = cx < s.x0 ? s.x0 : cx > s.x1 ? s.x1 : cx, pz = cz < s.z0 ? s.z0 : cz > s.z1 ? s.z1 : cz;
        hs.push(topAt(s, px, pz));
      }
      hs.sort((a, b) => a - b);
      let last = -99;
      for (const h of hs) {
        if (h - last < 0.05) continue;
        last = h;
        if (world.blocked(cx, cz, h)) continue;
        if (Math.abs(world.groundAt(cx, cz, h) - h) > 0.03) continue;
        nodeX.push(cx);
        nodeY.push(h);
        nodeZ.push(cz);
        nodeCov.push(world.covered(cx, h, cz) ? 1 : 0);
      }
    }
  }
  cellStart[NX * NZ] = nodeX.length;
  const N = nodeX.length;

  const nav = {
    N,
    x: Float32Array.from(nodeX),
    y: Float32Array.from(nodeY),
    z: Float32Array.from(nodeZ),
    cov: Uint8Array.from(nodeCov),
    cellStart,
    adj: new Array(N),
    radj: new Array(N),
    ladderEdges: [],
    fields: new Map(),
    world,
  };
  nav.nearest = (x, z, y, maxDy) => nearestNode(nav, x, z, y, maxDy);

  const cellOf = (x, z) => {
    const ix = Math.floor((x - X0) / CELL), iz = Math.floor((z - Z0) / CELL);
    return ix < 0 || iz < 0 || ix >= NX || iz >= NZ ? -1 : iz * NX + ix;
  };
  nav.cellOf = cellOf;

  // edges: [to, cost, kind (0 walk, 1 drop, 2 ladder), ladderIndex]
  for (let i = 0; i < N; i++) nav.adj[i] = [];
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const c = iz * NX + ix;
      for (let a = cellStart[c]; a < cellStart[c + 1]; a++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= NX || jz >= NZ) continue;
            const c2 = jz * NX + jx;
            for (let b = cellStart[c2]; b < cellStart[c2 + 1]; b++) {
              const dy = nav.y[b] - nav.y[a];
              const dist = Math.hypot(dx, dz) * CELL;
              if (Math.abs(dy) <= MAX_SLOPE * dist + 0.05) {
                if (walkable(world, nav.x[a], nav.z[a], nav.y[a], nav.x[b], nav.z[b], nav.y[b], false)) {
                  nav.adj[a].push([b, dist * (1 + Math.max(0, dy) * 0.3), 0, -1]);
                }
              } else if (dy < -0.45 && dy >= -MAX_DROP) {
                if (walkable(world, nav.x[a], nav.z[a], nav.y[a], nav.x[b], nav.z[b], nav.y[b], true)) {
                  nav.adj[a].push([b, dist + 2.5, 1, -1]);
                }
              }
            }
          }
        }
      }
    }
  }

  // ladders: from a node in front of the ladder's foot to a node on the platform above
  world.ladders.forEach((L, li) => {
    const foot = nav.nearest(L.x + L.nx * 0.7, L.z + L.nz * 0.7, L.y0 + 0.01, 1.2);
    const top = nav.nearest(L.x - L.nx * 1.1, L.z - L.nz * 1.1, L.y1, 1.0);
    if (foot < 0 || top < 0) return;
    nav.adj[foot].push([top, (L.y1 - L.y0) / 3 + 3, 2, li]);
    nav.ladderEdges.push({ ladder: li, foot, top });
  });

  for (let i = 0; i < N; i++) nav.radj[i] = [];
  for (let a = 0; a < N; a++) for (const e of nav.adj[a]) nav.radj[e[0]].push([a, e[1]]);
  return nav;
}

/** The node nearest (x, y, z) within maxDy of the height, or -1. Searches the cell and its neighbours. */
export function nearestNode(nav, x, z, y, maxDy = 1.5) {
  const ix = Math.floor((x - X0) / CELL), iz = Math.floor((z - Z0) / CELL);
  let best = -1, bd = Infinity;
  for (let jz = iz - 1; jz <= iz + 1; jz++) {
    for (let jx = ix - 1; jx <= ix + 1; jx++) {
      if (jx < 0 || jz < 0 || jx >= NX || jz >= NZ) continue;
      const c = jz * NX + jx;
      for (let n = nav.cellStart[c]; n < nav.cellStart[c + 1]; n++) {
        const dy = Math.abs(nav.y[n] - y);
        if (dy > maxDy) continue;
        const dx = nav.x[n] - x, dz = nav.z[n] - z;
        const d = dx * dx + dz * dz + dy * dy * 4;
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    }
  }
  return best;
}

/** Distance (cost) from every node to the nearest goal node, walking forward edges. Cached by key. */
export function field(nav, key, isGoal) {
  const hit = nav.fields.get(key);
  if (hit) return hit;
  const dist = new Float32Array(nav.N).fill(Infinity);
  const heap = new MinHeap();
  for (let i = 0; i < nav.N; i++) {
    if (isGoal(i)) {
      dist[i] = 0;
      heap.push(0, i);
    }
  }
  while (heap.size) {
    const u = heap.pop();
    const du = dist[u];
    for (const [v, cost] of nav.radj[u]) {
      const nd = du + cost;
      if (nd < dist[v]) {
        dist[v] = nd;
        heap.push(nd, v);
      }
    }
  }
  nav.fields.set(key, dist);
  return dist;
}

/** The best neighbour of node n by cost plus the field's distance there: [edge], or null at a goal (or when there is no way). */
export function stepToward(nav, dist, n) {
  if (!(dist[n] > 0) || !isFinite(dist[n])) return null;
  let best = null, bv = Infinity;
  for (const e of nav.adj[n]) {
    const v = e[1] + dist[e[0]];
    if (v < bv) {
      bv = v;
      best = e;
    }
  }
  return best;
}

/** A* between two nodes: an array of node indices (including both ends) or null. */
export function findPath(nav, from, to, maxExpand = 7000) {
  if (from < 0 || to < 0) return null;
  if (from === to) return [from];
  const g = new Map();
  const prev = new Map();
  const heap = new MinHeap();
  g.set(from, 0);
  const h = (n) => Math.hypot(nav.x[n] - nav.x[to], nav.z[n] - nav.z[to], (nav.y[n] - nav.y[to]) * 0.5);
  heap.push(h(from), from);
  let expanded = 0;
  const closed = new Set();
  while (heap.size && expanded < maxExpand) {
    const u = heap.pop();
    if (closed.has(u)) continue;
    closed.add(u);
    expanded++;
    if (u === to) {
      const path = [u];
      let c = u;
      while (prev.has(c)) {
        c = prev.get(c);
        path.push(c);
      }
      return path.reverse();
    }
    const gu = g.get(u);
    for (const e of nav.adj[u]) {
      const v = e[0];
      const ng = gu + e[1];
      if (ng < (g.get(v) ?? Infinity)) {
        g.set(v, ng);
        prev.set(v, u);
        heap.push(ng + h(v), v);
      }
    }
  }
  return null;
}

let shared = null;
/** The island's walking graph, built once per page (by the first host that needs it). */
export function getNav(world) {
  if (!shared || shared.world !== world) shared = buildNav(world);
  return shared;
}
