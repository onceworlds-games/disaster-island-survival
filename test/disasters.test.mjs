import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, map } from './helpers.mjs';
import { makeBody } from '../src/sim/collision.js';
import { SEA, SHORE } from '../src/sim/map.js';
import {
  floodLevel, FLOOD_MAX, prepareRound, tornadoAt, buildPlan, cleanEntry, compatible, KINDS, RUN_MS, TORNADO,
  METEOR_R, ballAt, debrisY, flowLength, DEBRIS_FALL, BALL_FLIGHT, waterLevel,
} from '../src/sim/disasters.js';
import { makeHazard, stepHazards, inCrack, inFlow } from '../src/sim/hazards.js';

const round = (kinds, seed = 11) => prepareRound(kinds, seed, world);
const body = (x, y, z) => Object.assign(makeBody(x, y, z), { onGround: true });

/** Steps hazards for a body that stays put, from run time t0 to t1; returns [cause, time] or null. */
function stay(r, b, t0, t1, hs = makeHazard()) {
  let prev = t0;
  for (let t = t0 + 1000 / 60; t <= t1; t += 1000 / 60) {
    const c = stepHazards(hs, r, prev, t, b, 1 / 60, world);
    prev = t;
    if (c) return [c, t];
  }
  return null;
}

test('the flood rises from sea level to 14 m over 30 s and holds', () => {
  assert.equal(floodLevel(-3000), SEA);
  assert.equal(floodLevel(0), SEA);
  assert.ok(Math.abs(floodLevel(30000) - FLOOD_MAX) < 1e-9);
  assert.equal(floodLevel(45000), FLOOD_MAX);
  let last = -Infinity;
  for (let t = 0; t <= 50000; t += 250) {
    const v = floodLevel(t);
    assert.ok(v >= last - 1e-12, 'never falls');
    last = v;
  }
  assert.equal(waterLevel(round(['meteor']), 20000), SEA, 'only a flood raises the sea');
});

test('a flood drowns whoever stays low and spares the high places', () => {
  const r = round(['flood']);
  const g = stay(r, body(0, 0, 5), 0, RUN_MS);
  assert.ok(g && g[0] === 'drown' && g[1] > 8000 && g[1] < 12500, `ground ${g}`);
  const shop = stay(r, body(-20, 8.6, -8), 0, RUN_MS);
  assert.ok(shop && shop[0] === 'drown' && shop[1] > 22000 && shop[1] < 32000, `shop roof ${shop}`);
  assert.equal(stay(r, body(0, 18, -15), 0, RUN_MS), null, 'the clock tower is above the flood');
  assert.equal(stay(r, body(21, 15.4, 12), 0, RUN_MS), null, 'so is the hill');
  assert.equal(stay(r, body(24, 16.6, -20.5), 0, RUN_MS), null, 'and the water tower');
});

test('breath lasts four seconds and comes back on dry land', () => {
  const r = round(['flood']);
  const hs = makeHazard();
  const b = body(0, 0, 5);
  const out = stay(r, b, 0, RUN_MS, hs);
  const wetAt = ((0.9 + 0.6) / 14.6) ** (1 / 1.5) * 30000;
  assert.ok(Math.abs(out[1] - (wetAt + 4000)) < 120, `${out[1]} vs ${wetAt + 4000}`);
  const hs2 = makeHazard();
  stay(r, body(0, 18, -15), 20000, 30000, hs2);
  assert.equal(hs2.breath, 4);
});

test('meteors: more over time, about two a second at the end, all on the island, with a ring 1.5 s ahead', () => {
  const r = round(['meteor'], 5);
  assert.ok(r.meteors.length > 40 && r.meteors.length < 90, `count ${r.meteors.length}`);
  const early = r.meteors.filter((m) => m.at < 15000).length / 15, late = r.meteors.filter((m) => m.at >= 35000).length / 15;
  assert.ok(late > early * 1.6, `rate ${early.toFixed(2)} -> ${late.toFixed(2)}`);
  assert.ok(late > 1.5 && late < 2.6, `late rate ${late}`);
  let last = -1;
  for (const m of r.meteors) {
    assert.ok(m.at > last && m.at >= 2000 && m.at < RUN_MS);
    last = m.at;
    assert.ok(map.inBounds(m.x, m.z));
    assert.equal(m.r, METEOR_R);
  }
});

test('the same seed gives the same disasters, another seed gives others', () => {
  const a = prepareRound(['meteor', 'volcano'], 99, world), b = prepareRound(['meteor', 'volcano'], 99, world), c = prepareRound(['meteor', 'volcano'], 100, world);
  assert.deepEqual(a.meteors, b.meteors);
  assert.deepEqual(a.balls, b.balls);
  assert.notDeepEqual(a.meteors, c.meteors);
  const t1 = prepareRound(['tornado'], 8, world), t2 = prepareRound(['tornado'], 9, world);
  assert.notEqual(t1.tornado.xs[40], t2.tornado.xs[40]);
});

test('a meteor knocks out inside its blast, not outside, and not under a roof', () => {
  const r = round(['meteor'], 21);
  const m = r.meteors[3];
  const hit = (b) => stay(r, b, m.at - 40, m.at + 40);
  assert.equal(hit(body(m.x, m.y, m.z))?.[0], 'meteor');
  assert.equal(hit(body(m.x + METEOR_R - 0.2, m.y, m.z))?.[0], 'meteor');
  assert.equal(hit(body(m.x + METEOR_R + 0.3, m.y, m.z)), null);
  // a made-up impact on a house roof: whoever stands under it is safe, whoever stands on it is not
  const roof = { at: 20000, x: -8, z: 18.3, y: 5.4, r: METEOR_R };
  const fake = { ...r, meteors: [roof], has: { meteor: true } };
  assert.equal(stay(fake, body(-8, 0, 18.3), 19960, 20040), null, 'under the roof');
  assert.equal(stay(fake, body(-8, 5.4, 18.3), 19960, 20040)?.[0], 'meteor', 'on the roof');
});

test('the tornado crosses the island at 6 m/s, pulls from 12 m and flings within 5 m', () => {
  const r = round(['tornado'], 31);
  const p0 = tornadoAt(r, 0), p1 = tornadoAt(r, 1000), p5 = tornadoAt(r, 5000);
  assert.ok(Math.abs(Math.hypot(p1.x - p0.x, p1.z - p0.z) - 6) < 0.8, 'about 6 m in a second');
  assert.ok(Math.abs(Math.hypot(p5.x - p0.x, p5.z - p0.z) - 30) < 8);
  assert.equal(tornadoAt(r, -6000).x, p0.x, 'it waits at its start during the warning');
  for (let t = 0; t <= RUN_MS; t += 500) {
    const p = tornadoAt(r, t);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
    assert.ok((p.x / SHORE.a) ** 2 + (p.z / SHORE.b) ** 2 < 1.1, 'stays over the island');
  }
  const at = tornadoAt(r, 20000);
  assert.equal(stay(r, body(at.x + 4, 0, at.z), 19990, 20010)?.[0], 'flung');
  assert.equal(stay(r, body(at.x + 4, 18, at.z), 19990, 20010)?.[0], 'flung', 'buildings and towers do not stop it');
  const b = body(at.x + 9, 0, at.z);
  assert.equal(stay(r, b, 19990, 20010), null);
  assert.ok(Math.hypot(b.ex, b.ez) > 0.2, 'pulled toward it');
  const far = body(at.x + 14, 0, at.z);
  stay(r, far, 19990, 20010);
  assert.equal(far.ex, 0);
});

test('acid rain drains 20 a second outside and nothing under a roof', () => {
  const r = round(['acid']);
  const out = stay(r, body(0, 0, 5), 0, RUN_MS);
  assert.equal(out[0], 'acid');
  assert.ok(Math.abs(out[1] - 5000) < 100, `${out[1]}`);
  assert.equal(stay(r, body(28, 0, -2.5), 0, RUN_MS), null, 'under the canopy');
  // heals under cover
  const hs = makeHazard();
  hs.health = 30;
  stay(r, body(28, 0, -2.5), 0, 2000, hs);
  assert.ok(hs.health > 70);
});

test('the earthquake: debris falls beside buildings and knocks out, cracks open into lava', () => {
  const r = round(['quake'], 3);
  assert.ok(r.debris.length > 40);
  assert.ok(r.cracks.length >= 5);
  for (const d of r.debris) {
    assert.ok(map.inBounds(d.x, d.z));
    const from = d.from, y = d.y;
    assert.ok(from > y);
  }
  const d = r.debris[10];
  assert.ok(debrisY(d, d.at - DEBRIS_FALL - 1) === null && debrisY(d, d.at + 1) === null);
  assert.ok(Math.abs(debrisY(d, d.at) - d.y) < 1e-9);
  assert.equal(stay(r, body(d.x, d.y, d.z), d.at - 60, d.at + 20)?.[0], 'debris');
  assert.equal(stay(r, body(d.x + 4, d.y, d.z), d.at - 60, d.at + 20), null);
  const c = r.cracks[0];
  assert.equal(stay(r, body(c.x, 0, c.z), c.crackAt, c.openAt - 50), null, 'a crack is harmless before the lava');
  assert.equal(stay(r, body(c.x, 0, c.z), c.openAt - 50, c.openAt + 100)?.[0], 'lava');
  assert.equal(stay(r, body(c.x, 1.0, c.z), c.openAt + 100, c.openAt + 600), null, 'jump it');
  assert.ok(inCrack(c, c.x, c.z) && !inCrack(c, c.x + 20, c.z));
});

test('the volcano: lava balls arc from the hill and land on a ring, two lava flows grow', () => {
  const r = round(['volcano'], 17);
  assert.ok(r.balls.length > 30 && r.flows.length === 2);
  const b = r.balls[4];
  assert.equal(ballAt(r, b, b.at - BALL_FLIGHT - 10, map.hill), null);
  const start = ballAt(r, b, b.at - BALL_FLIGHT + 1, map.hill);
  assert.ok(Math.hypot(start.x - map.hill.x, start.z - map.hill.z) < 1);
  const mid = ballAt(r, b, b.at - BALL_FLIGHT / 2, map.hill);
  assert.ok(mid.y > Math.max(b.y, map.hill.top) + 3, 'an arc');
  assert.equal(stay(r, body(b.x, b.y, b.z), b.at - 40, b.at + 40)?.[0], 'lava');
  const f = r.flows[0];
  assert.equal(flowLength(f, 0), 0);
  assert.ok(flowLength(f, 30000) > flowLength(f, 15000) && flowLength(f, 60000) === f.maxLen);
  const t = f.startAt + 12000;
  const len = flowLength(f, t);
  const px = f.ox + f.dx * (len - 1), pz = f.oz + f.dz * (len - 1);
  assert.ok(inFlow(f, t, px, pz));
  assert.ok(!inFlow(f, t, f.ox + f.dx * (len + 5), f.oz + f.dz * (len + 5)));
  assert.equal(stay(r, body(px, 0, pz), t, t + 100)?.[0], 'lava');
  assert.equal(stay(r, body(px, 1.2, pz), t, t + 100), null);
});

test('plans: 3, 5 or 8 disasters, an easy first one, never the same twice in a row, doubles only from round 4 (about 30%)', () => {
  let rounds4plus = 0, doubles = 0;
  for (let seed = 1; seed <= 300; seed++) {
    for (const n of [3, 5, 8]) {
      const plan = buildPlan(seed * 7919, n);
      assert.equal(plan.length, n);
      assert.ok(['flood', 'meteor'].includes(plan[0].k[0]));
      plan.forEach((e, i) => {
        assert.ok(cleanEntry(e), 'valid entry');
        assert.ok(e.k.every((k) => KINDS.includes(k)));
        assert.ok(e.k.length === 1 || compatible(e.k[0], e.k[1]));
        if (i > 0) assert.notEqual(e.k[0], plan[i - 1].k[0]);
        if (i < 3) assert.equal(e.k.length, 1, 'no doubles before round 4');
        else {
          rounds4plus++;
          if (e.k.length === 2) doubles++;
        }
      });
    }
  }
  assert.ok(doubles / rounds4plus > 0.2 && doubles / rounds4plus < 0.4, `${doubles}/${rounds4plus}`);
  assert.equal(cleanEntry({ k: ['nope'], s: 1 }), null);
  assert.equal(cleanEntry({ k: ['flood', 'acid'], s: 1 }), null);
  assert.deepEqual(buildPlan(77, 5), buildPlan(77, 5));
});

test('hazards before the run begin do nothing', () => {
  const r = round(['flood', 'meteor'], 4);
  assert.equal(stay(r, body(0, 0, 5), -6000, -10), null);
});

test('a double disaster applies both', () => {
  const r = round(['acid', 'meteor'], 6);
  assert.ok(r.has.acid && r.has.meteor && r.meteors.length);
  const out = stay(r, body(0, 0, 5), 0, 8000);
  assert.ok(out && (out[0] === 'acid' || out[0] === 'meteor'));
});
