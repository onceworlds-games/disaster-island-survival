import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, map, nav } from './helpers.mjs';
import { BotSim, BOT_NAMES } from '../src/sim/bots.js';
import { prepareRound, KINDS, WARN_MS, RUN_MS } from '../src/sim/disasters.js';
import { BODY } from '../src/sim/collision.js';

const entries = (n) => Array.from({ length: n }, (_, i) => ({ id: `bot${i + 1}`, slot: i }));

/** Runs a round for the bots and checks every legal-move rule each frame. Returns { sim, outs }. */
function playRound(kinds, seed, n = 8, secs = (WARN_MS + RUN_MS) / 1000 + 1) {
  const round = prepareRound(kinds, seed, world);
  const sim = new BotSim(world, nav);
  sim.setRound(round, entries(n));
  const outs = [];
  const dt = 1 / 60;
  const prev = new Map(sim.bots.map((b) => [b.id, [b.body.x, b.body.y, b.body.z]]));
  for (let t = -WARN_MS; t < secs * 1000 - WARN_MS; t += 1000 / 60) {
    outs.push(...sim.step(dt, t));
    for (const bot of sim.bots) {
      const b = bot.body;
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z) && Number.isFinite(b.yaw), `${bot.id} not finite`);
      if (bot.out) continue;
      assert.ok(map.inBounds(b.x, b.z), `${bot.id} left the island at ${b.x.toFixed(1)},${b.z.toFixed(1)} (${kinds})`);
      assert.ok(b.y > -0.01 && b.y < 21, `${bot.id} height ${b.y}`);
      const p = prev.get(bot.id);
      const step = Math.hypot(b.x - p[0], b.z - p[2]);
      assert.ok(step < (BODY.sprint + 20) * dt + 0.05, `${bot.id} jumped ${step.toFixed(2)} m in a frame`);
      prev.set(bot.id, [b.x, b.y, b.z]);
      if (Math.round(t) % 500 === 0) assert.ok(!world.blocked(b.x, b.z, b.y), `${bot.id} is inside a wall at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`);
    }
  }
  return { sim, outs };
}

test('bots keep to legal moves through every disaster', () => {
  for (const kind of KINDS) {
    for (const seed of [1, 2, 3]) playRound([kind], seed * 101);
  }
  for (const kinds of [['flood', 'meteor'], ['meteor', 'acid'], ['quake', 'volcano'], ['tornado', 'volcano'], ['flood', 'tornado']]) playRound(kinds, 77);
});

test('in a flood most bots climb to a high place and survive, and the ones that stay low drown', () => {
  let survived = 0, total = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { sim, outs } = playRound(['flood'], seed * 31);
    total += sim.bots.length;
    survived += sim.bots.filter((b) => !b.out).length;
    for (const bot of sim.bots) if (!bot.out) assert.ok(bot.body.y > 4.5, `${bot.id} survived at ${bot.body.y}`);
    for (const o of outs) assert.equal(o.cause, 'drown');
  }
  assert.ok(survived / total > 0.55, `survival ${(survived / total).toFixed(2)}`);
  assert.ok(survived / total < 0.98, 'not all of them are perfect');
});

test('in acid rain bots go under a roof', () => {
  let under = 0, alive = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const { sim } = playRound(['acid'], seed * 17);
    for (const bot of sim.bots) {
      if (bot.out) continue;
      alive++;
      if (world.covered(bot.body.x, bot.body.y, bot.body.z)) under++;
    }
  }
  assert.ok(alive > 30 && under === alive, `${under} of ${alive} survivors were under a roof`);
});

test('some bots die in every kind of disaster across seeds, and not all of them', () => {
  for (const kind of KINDS) {
    let dead = 0, total = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const { sim } = playRound([kind], seed * 53);
      total += sim.bots.length;
      dead += sim.bots.filter((b) => b.out).length;
    }
    assert.ok(dead > 0, `${kind}: nobody ever died`);
    assert.ok(dead / total < 0.75, `${kind}: ${(dead / total).toFixed(2)} died`);
  }
});

test('bots do not stand still for the whole warning: they head for safety', () => {
  const round = prepareRound(['flood'], 5, world);
  const sim = new BotSim(world, nav);
  sim.setRound(round, entries(8));
  const start = sim.bots.map((b) => [b.body.x, b.body.z]);
  for (let t = -WARN_MS; t < 0; t += 1000 / 60) sim.step(1 / 60, t);
  const moved = sim.bots.filter((b, i) => Math.hypot(b.body.x - start[i][0], b.body.z - start[i][1]) > 3).length;
  assert.ok(moved >= 5, `${moved} bots moved during the warning`);
});

test('the snapshot is compact and a new host restores from it', () => {
  const { sim } = playRound(['tornado'], 9, 8, 30);
  const snap = sim.snapshot(12345);
  assert.equal(snap.t, 12345);
  assert.equal(Object.keys(snap.p).length, 8);
  assert.ok(JSON.stringify(snap).length < 900, `snapshot is ${JSON.stringify(snap).length} bytes`);
  const fresh = new BotSim(world, nav);
  fresh.setRound(prepareRound(['tornado'], 9, world), entries(8));
  fresh.restore(JSON.parse(JSON.stringify(snap)));
  sim.bots.forEach((b, i) => {
    assert.ok(Math.abs(fresh.bots[i].body.x - Math.round(b.body.x * 100) / 100) < 1e-6);
    assert.equal(!!fresh.bots[i].out, !!b.out);
  });
});

test('bot names are short and neutral', () => {
  assert.ok(BOT_NAMES.length >= 14 && BOT_NAMES.every((n) => /^[A-Z][a-z]{2,6}$/.test(n)));
});

test('calm bots wander the island without going anywhere they should not', () => {
  const sim = new BotSim(world, nav);
  sim.setRound(null, entries(6));
  let moved = 0;
  for (let t = 0; t < 40000; t += 1000 / 60) sim.step(1 / 60, 0);
  for (const bot of sim.bots) {
    assert.ok(map.inBounds(bot.body.x, bot.body.z));
    const sp = map.spawns[bot.slot];
    if (Math.hypot(bot.body.x - sp.x, bot.body.z - sp.z) > 2) moved++;
    assert.ok(!bot.out);
  }
  assert.ok(moved >= 4, `${moved} of 6 wandered off`);
});
