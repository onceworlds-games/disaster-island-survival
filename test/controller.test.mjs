import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, map, nav, miniWorld, box, run, standing, walkTo, DT } from './helpers.mjs';
import { makeBody, stepBody, BODY } from '../src/sim/collision.js';

test('a body on the plaza stands still on the ground', () => {
  const b = standing(0, 5);
  run(world, b, { mx: 0, mz: 0 }, 1);
  assert.equal(b.y, 0);
  assert.ok(b.onGround);
  assert.ok(Math.abs(b.x) < 1e-6 && Math.abs(b.z - 5) < 1e-6);
});

test('walking is 7 m/s, sprinting 11, and the stamina lasts about 4 s then refills', () => {
  const w = miniWorld([]);
  let b = standing(0, 0);
  run(w, b, { mx: 1, mz: 0 }, 0.5);
  assert.ok(Math.abs(b.vx - BODY.walk) < 0.05, `walk ${b.vx}`);
  b = standing(0, 0);
  run(w, b, { mx: 1, mz: 0, sprint: true }, 1);
  assert.ok(Math.abs(b.vx - BODY.sprint) < 0.05, `sprint ${b.vx}`);
  // hold sprint until it runs out
  b = standing(0, 0);
  let t = 0;
  while (b.sprinting || t < 0.2) {
    stepBody(w, b, { mx: 1, mz: 0, sprint: true }, DT);
    t += DT;
    if (t > 8) break;
  }
  assert.ok(t > 3.7 && t < 4.4, `stamina lasted ${t.toFixed(2)} s`);
  assert.ok(b.exhausted);
  run(w, b, { mx: 1, mz: 0, sprint: true }, 0.5);
  assert.ok(Math.abs(b.vx - BODY.walk) < 0.1, 'walks while exhausted');
  run(w, b, { mx: 0, mz: 0 }, 4.5);
  assert.ok(b.stamina > 0.95 && !b.exhausted, 'refilled');
});

test('a jump rises about 1.5 m, comes down, and only starts from the ground', () => {
  const w = miniWorld([]);
  const b = standing(0, 0);
  let peak = 0;
  run(w, b, (i) => ({ mx: 0, mz: 0, jump: i === 0 }), 1.2);
  const b2 = standing(0, 0);
  for (let i = 0; i < 90; i++) {
    stepBody(w, b2, { mx: 0, mz: 0, jump: i === 0 }, DT);
    peak = Math.max(peak, b2.y);
  }
  assert.ok(peak > 1.4 && peak < 1.65, `peak ${peak}`);
  assert.equal(b2.y, 0);
  assert.ok(b2.onGround);
  // pressing jump in the air does nothing until it lands
  const b3 = standing(0, 0);
  let jumps = 0;
  for (let i = 0; i < 20; i++) {
    stepBody(w, b3, { mx: 0, mz: 0, jump: i % 2 === 0 }, DT);
    if (b3.jumped) jumps++;
  }
  assert.equal(jumps, 1);
});

test('walls stop the body, and it slides along them', () => {
  const w = miniWorld([box(5, 0, -10, 5.4, 4, 10)]);
  const b = standing(0, 0);
  run(w, b, { mx: 1, mz: 0.5 }, 3);
  assert.ok(b.x <= 5 - BODY.r + 1e-6, `x ${b.x}`);
  assert.ok(b.z > 2, 'slid along the wall');
});

test('nothing tunnels through a thin wall, even pushed at 40 m/s', () => {
  const w = miniWorld([box(5, 0, -10, 5.4, 4, 10)]);
  const b = standing(0, 0);
  b.ex = 40;
  run(w, b, { mx: 0, mz: 0 }, 0.6);
  assert.ok(b.x < 5, `x ${b.x}`);
  const c = standing(0, 0);
  for (let i = 0; i < 60; i++) {
    c.ex = 60;
    stepBody(w, c, { mx: 1, mz: 0, sprint: true }, DT);
  }
  assert.ok(c.x < 5);
});

test('steps of 0.3 m are walked over and 0.5 m ones are not', () => {
  const w = miniWorld([box(3, 0, -5, 6, 0.3, 5), box(9, 0, -5, 12, 0.5, 5)]);
  const b = standing(0, 0);
  run(w, b, { mx: 1, mz: 0 }, 0.65);
  assert.ok(b.x > 4 && b.x < 6 && Math.abs(b.y - 0.3) < 1e-6, `on the low step: x ${b.x} y ${b.y}`);
  run(w, b, { mx: 1, mz: 0 }, 0.5);
  assert.ok(b.x > 6 && b.y === 0, 'and down the other side');
  b.x = 6.5;
  run(w, b, { mx: 1, mz: 0 }, 1.2);
  assert.ok(b.x <= 9 - BODY.r + 0.01, `stopped at the tall step: ${b.x}`);
  assert.ok(Math.abs(b.y - 0.3) < 1e-6 || b.y === 0);
});

test('a jump gets onto a 1.2 m box and the body stands on it', () => {
  const w = miniWorld([box(2, 0, -2, 5, 1.2, 2)]);
  const b = standing(0, 0);
  for (let i = 0; i < 120 && !(b.onGround && b.y > 1); i++) stepBody(w, b, { mx: 1, mz: 0, jump: i > 5 && b.x > 0.3 }, DT);
  assert.ok(Math.abs(b.y - 1.2) < 1e-6 && b.onGround, `y ${b.y}`);
  assert.ok(b.x > 2 && b.x < 5);
});

test('a low ceiling stops a jump', () => {
  const w = miniWorld([box(-5, 2.2, -5, 5, 2.6, 5)]);
  const b = standing(0, 0);
  let peak = 0;
  for (let i = 0; i < 40; i++) {
    stepBody(w, b, { mx: 0, mz: 0, jump: i === 0 }, DT);
    peak = Math.max(peak, b.y + BODY.h);
  }
  assert.ok(peak <= 2.2 + 1e-6, `head peak ${peak}`);
});

test('ramps are walked up and down without leaving the ground', () => {
  const b = standing(11, 21.1);
  let guard = 0;
  while (b.x < 28.4 && guard++ < 1200) stepBody(world, b, { mx: 1, mz: 0 }, DT);
  assert.ok(b.y > 4.6 && b.onGround, `top of the first ramp y ${b.y}`);
  // walk back down: stays glued to the slope the whole way
  let air = 0;
  guard = 0;
  while (b.x > 14 && guard++ < 1200) {
    stepBody(world, b, { mx: -1, mz: 0 }, DT);
    if (!b.onGround) air++;
  }
  assert.equal(air, 0, 'no air time walking down');
  assert.ok(b.y < 1);
});

test('the bots path from the plaza reaches the lookout on the hill', async () => {
  const b = standing(0, 5);
  const goal = nav.nearest(21, 12, 15.4);
  const r = await walkTo(world, nav, b, goal, 40);
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(Math.abs(b.y - 15.4) < 0.05);
});

test('ladders climb to the top of the clock tower and the water tower, and back down', async () => {
  for (const [id, y, name] of [[0, 18, 'clock'], [1, 16.6, 'water']]) {
    const L = world.ladders[id];
    const b = standing(L.x + L.nx * 0.7, L.z + L.nz * 0.7);
    let guard = 0;
    while (b.y < y - 0.05 && guard++ < 60 * 12) stepBody(world, b, { mx: -L.nx, mz: -L.nz }, DT);
    // over the top and standing on the platform
    run(world, b, { mx: 0, mz: 0 }, 0.6);
    assert.ok(Math.abs(b.y - y) < 0.05 && b.onGround, `${name}: standing at ${b.y}`);
    assert.ok(!b.climbing);
    assert.ok(guard < 60 * 8, `${name}: climbed in ${(guard / 60).toFixed(1)} s`);
    // back down: push outward at the ladder's head
    guard = 0;
    while ((b.y > 0.1 || b.climbing) && guard++ < 60 * 12) {
      stepBody(world, b, { mx: L.nx, mz: L.nz }, DT);
    }
    assert.ok(b.y < 0.2, `${name}: came down to ${b.y}`);
  }
});

test('walking off a roof edge falls and lands with an impact', () => {
  const b = standing(0, -15, 18);
  b.onGround = true;
  let landed = 0;
  for (let i = 0; i < 240 && !(landed > 0); i++) {
    stepBody(world, b, { mx: -1, mz: 0 }, DT);
    landed = b.landed;
  }
  assert.ok(landed > 10, `impact ${landed}`);
  assert.ok(b.y < 0.01);
});

test('in the sea level the body wades slowly and a jump is a swim stroke', () => {
  const w = miniWorld([]);
  const b = standing(0, 0);
  run(w, b, { mx: 1, mz: 0 }, 0.6, { water: 3 });
  assert.ok(b.wet);
  assert.ok(b.vx < BODY.walk * 0.6, `wading ${b.vx}`);
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    stepBody(w, b, { mx: 0, mz: 0, jump: i === 0 }, DT, { water: 3 });
    peak = Math.max(peak, b.y);
  }
  assert.ok(peak > 0.8, `stroke ${peak}`);
});

test('walking to every edge of the island never leaves it', () => {
  const edges = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) edges.push([Math.cos(a), Math.sin(a)]);
  for (const [dx, dz] of edges) {
    const b = standing(0, 5);
    for (let i = 0; i < 60 * 14; i++) {
      stepBody(world, b, { mx: dx, mz: dz, sprint: i % 300 < 200 }, DT);
      if (i % 30 === 0) assert.ok(map.inBounds(b.x, b.z), `out at ${b.x.toFixed(1)},${b.z.toFixed(1)}`);
    }
    assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z));
  }
});

test('the pier is walkable to its end', () => {
  const b = standing(-6, 26);
  run(world, b, { mx: 0, mz: 1 }, 4);
  assert.ok(b.z > 44, `z ${b.z}`);
  assert.ok(Math.abs(b.y) < 1e-6);
});

test('a body spawned inside a wall is lifted or pushed out, never stays stuck', () => {
  const w = miniWorld([box(-2, 0, -2, 2, 3, 2)]);
  const b = makeBody(0, 0, 0);
  run(w, b, { mx: 0, mz: 0 }, 0.2);
  assert.ok(!w.blocked(b.x, b.z, b.y), `still inside at ${b.x},${b.y},${b.z}`);
});

test('a house roof is climbed by the outside stairs, crossed over the ridge and left on the far side', () => {
  const h = map.buildings.find((x) => x.id === 'h3'); // x -12..-4, z 15..21; stairs on the south at x = -6
  const b = standing(-6, 28);
  let guard = 0;
  while (b.z > 20.6 && guard++ < 60 * 10) stepBody(world, b, { mx: 0, mz: -1 }, DT);
  assert.ok(b.y > 2.4, `at the eave y ${b.y}`);
  while (b.z > 18.1 && guard++ < 60 * 14) stepBody(world, b, { mx: 0, mz: -1 }, DT);
  assert.ok(Math.abs(b.y - 5.6) < 0.25, `at the ridge y ${b.y} z ${b.z}`);
  while (b.z > h.z0 - 0.3 && guard++ < 60 * 20) stepBody(world, b, { mx: 0, mz: -1 }, DT);
  assert.ok(b.y < 3.6 && b.y > 2.4, `the north eave y ${b.y} z ${b.z}`);
});
