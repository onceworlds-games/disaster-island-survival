import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, map, nav, standing, run } from './helpers.mjs';
import { buildMap, SHORE } from '../src/sim/map.js';
import { World, BODY } from '../src/sim/collision.js';
import { field } from '../src/sim/nav.js';

test('the map is the same every time it is built', () => {
  const again = buildMap();
  assert.equal(again.solids.length, map.solids.length);
  assert.deepEqual(again.solids.slice(0, 40), map.solids.slice(0, 40));
  assert.deepEqual(again.trees, map.trees);
});

test('every solid is well formed and inside the world grid', () => {
  for (const s of map.solids) {
    for (const k of ['x0', 'x1', 'z0', 'z1']) assert.ok(Number.isFinite(s[k]), `${s.tag} ${k}`);
    assert.ok(s.x1 > s.x0 && s.z1 > s.z0, `${s.tag} plan`);
    if (s.k === 0) assert.ok(s.y1 > s.y0, `${s.tag} height`);
    else {
      assert.ok(Number.isFinite(s.ya) && Number.isFinite(s.yb) && s.thick > 0, `${s.tag} ramp`);
      assert.ok(s.axis === 'x' || s.axis === 'z');
    }
    assert.ok(s.x0 > -60 && s.x1 < 60 && s.z0 > -50 && s.z1 < 52, `${s.tag} inside the grid`);
  }
});

test('the island is a 90 by 70 ellipse', () => {
  assert.ok(Math.abs(SHORE.a * 2 - 90) < 4 && Math.abs(SHORE.b * 2 - 70) < 4);
  assert.ok(map.inBounds(0, 0) && !map.inBounds(60, 0) && !map.inBounds(0, 40) && map.inBounds(-6, 40));
});

test('sixteen distinct spawn slots stand on the plaza, free and grounded', () => {
  assert.equal(map.spawns.length, 16);
  for (const [i, s] of map.spawns.entries()) {
    assert.ok(Math.hypot(s.x, s.z) < 9 && Math.hypot(s.x, s.z) > 3, `slot ${i} radius`);
    assert.ok(!world.blocked(s.x, s.z, 0), `slot ${i} is inside something`);
    assert.equal(world.groundAt(s.x, s.z, 0), 0);
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(s.x - map.spawns[j].x, s.z - map.spawns[j].z) > 1.5, `slots ${i} and ${j} overlap`);
    assert.ok(!world.covered(s.x, 0, s.z), 'the plaza is open sky');
  }
});

test('every building can be entered and every roof reached from the plaza', () => {
  const start = nav.nearest(0, 5, 0);
  const seen = new Uint8Array(nav.N);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const u = q.pop();
    for (const e of nav.adj[u]) if (!seen[e[0]]) {
      seen[e[0]] = 1;
      q.push(e[0]);
    }
  }
  const reach = (x, z, y, tol = 1.2) => {
    const n = nav.nearest(x, z, y, tol);
    return n >= 0 && seen[n] === 1;
  };
  // inside each house (ground), on each roof ridge, the shop's two floors and roof, the gas canopy, the kiosk, the hill and both towers
  for (const b of map.buildings.filter((x) => x.kind === 'house' && x.id.startsWith('h'))) {
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    assert.ok(reach(cx, cz + 1.0, 0, 0.5), `${b.id}: inside`);
    assert.ok(reach(cx, cz, 5.6, 0.45), `${b.id}: ridge`);
  }
  assert.ok(reach(-16, -8, 0, 0.5), 'shop ground floor');
  assert.ok(reach(-20, -6, 4.4, 0.5), 'shop second floor');
  assert.ok(reach(-20, -8, 8.6, 0.5), 'shop roof');
  assert.ok(reach(28, -2.5, 4.8, 0.5), 'gas station canopy');
  assert.ok(reach(36, -3.5, 0, 0.5), 'kiosk');
  assert.ok(reach(21, 12, 15.4, 0.5), 'hill lookout');
  assert.ok(reach(21, 12, 10, 0.5) || reach(16, 12, 10, 0.5), 'hill second terrace');
  assert.ok(reach(0, -15, 18, 1), 'clock tower top');
  assert.ok(reach(21.5, -18, 16.6, 1), 'water tower catwalk');
  assert.ok(reach(-6, 42, 0, 0.5), 'pier end');
});

test('there are high places above the flood (14 m) to stand on', () => {
  const high = field(nav, 'test-high', (i) => nav.y[i] >= 15);
  const start = nav.nearest(0, 5, 0);
  assert.ok(isFinite(high[start]));
  for (const hp of map.highPoints) assert.ok(hp.y > 14.9, hp.id);
  // the three of them are reachable from every spawn slot within a quarter minute of walking
  for (const s of map.spawns) {
    const n = nav.nearest(s.x, s.z, 0);
    assert.ok(high[n] / BODY.walk < 15, `slot at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}: ${high[n]}`);
  }
});

test('the ladders are on solid walls and reach the platforms', () => {
  assert.equal(world.ladders.length, 2);
  for (const L of world.ladders) {
    const y = L.y1 - 0.5;
    // the wall is right behind the ladder at the top and mid-way
    assert.ok(world.blocked(L.x - L.nx * 0.45, L.z - L.nz * 0.45, y - 0.5), `${L.id}: wall behind the rungs`);
    // and the platform is just beyond it
    assert.ok(Math.abs(world.groundAt(L.x - L.nx * 0.5, L.z - L.nz * 0.5, L.y1) - L.y1) < 1e-6, `${L.id}: platform`);
  }
});

test('roofs and canopies shelter, the open does not', () => {
  const h = map.buildings.find((b) => b.id === 'h3');
  const cx = (h.x0 + h.x1) / 2, cz = (h.z0 + h.z1) / 2;
  assert.ok(world.covered(cx, 0, cz - 0.5), 'inside a house');
  assert.ok(!world.covered(cx, 5.6, cz), 'standing on its roof');
  assert.ok(world.covered(28, 0, -2.5), 'under the gas station canopy');
  assert.ok(!world.covered(28, 4.8, -2.5), 'on the canopy');
  assert.ok(world.covered(24, 0, -18), 'under the water tower');
  assert.ok(world.covered(-20, 0, -8), 'in the shop');
  assert.ok(!world.covered(0, 0, 5), 'the plaza');
  assert.ok(!world.covered(21, 15.4, 12), 'the lookout');
});

test('meteors land on the highest surface over a point', () => {
  assert.equal(world.topAtPoint(0, 5), 0);
  assert.ok(Math.abs(world.topAtPoint(-20, -8) - 8.6) < 1e-6);
  assert.ok(Math.abs(world.topAtPoint(21, 12) - 15.4) < 1e-6);
});

test('trees and rocks stay off buildings and the plaza', () => {
  assert.ok(map.trees.length >= 30);
  for (const t of map.trees) {
    assert.ok(Math.hypot(t.x, t.z) > 11, 'plaza');
    assert.ok(map.inBounds(t.x, t.z));
    for (const b of map.buildings) assert.ok(!(t.x > b.x0 - 1 && t.x < b.x1 + 1 && t.z > b.z0 - 1 && t.z < b.z1 + 1), `a tree inside ${b.id}`);
  }
});

test('the nav graph has no stray island: the plaza reaches almost everything walkable', () => {
  const start = nav.nearest(0, 5, 0);
  const seen = new Uint8Array(nav.N);
  const q = [start];
  seen[start] = 1;
  while (q.length) {
    const u = q.pop();
    for (const e of nav.adj[u]) if (!seen[e[0]]) {
      seen[e[0]] = 1;
      q.push(e[0]);
    }
  }
  let ground = 0, cut = 0;
  for (let i = 0; i < nav.N; i++) {
    if (nav.y[i] > 0.05) continue; // tops of rocks, trunks and pumps aren't walked to
    ground++;
    if (!seen[i]) cut++;
  }
  assert.ok(cut / ground < 0.01, `${cut} of ${ground} ground cells are cut off`);
  assert.ok(nav.N > 3000);
});

test('a world made from the map never lets a walker out, even around the buildings', () => {
  const b = standing(-20, 0);
  run(world, b, { mx: -1, mz: -0.4, sprint: true }, 12);
  assert.ok(map.inBounds(b.x, b.z));
  assert.ok(world instanceof World);
});
