import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, map, nav } from './helpers.mjs';
import { simulateMatch } from '../src/sim/engine.js';
import {
  buildRoster, newMatch, startRound, phaseAt, applyOut, hostStep, settleRound, ranking, cleanRecord,
  RESULT_MS, FINAL_MS, TABLE, PLAYER_COLORS,
} from '../src/sim/rules.js';
import { WARN_MS, RUN_MS, causeCode } from '../src/sim/disasters.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 37);

test('a whole match with only bots ends, ranks everyone, and nobody ever leaves the island (20 seeds, 3 / 5 / 8 disasters)', () => {
  for (const seed of SEEDS) {
    for (const rounds of [3, 5, 8]) {
      if (rounds === 8 && seed % 3 !== 0) continue; // keep the run short: 8 disasters for a third of the seeds
      let checked = 0;
      const phases = [];
      const res = simulateMatch(world, nav, {
        seed, rounds,
        onFrame: ({ g, now, sim }) => {
          const ph = phaseAt(g, now);
          if (phases[phases.length - 1] !== `${g.n}:${ph}`) phases.push(`${g.n}:${ph}`);
          if (checked++ % 20) return;
          for (const bot of sim.bots) {
            const b = bot.body;
            assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z), `NaN at seed ${seed}`);
            if (!bot.out) assert.ok(map.inBounds(b.x, b.z), `seed ${seed}: ${bot.id} out of bounds at ${b.x},${b.z}`);
          }
        },
      });
      const g = res.g;
      assert.ok(g.fin, `seed ${seed}/${rounds}: the match never finished`);
      assert.equal(g.n, rounds);
      assert.equal(res.ranking.length, TABLE, 'everyone is ranked');
      assert.deepEqual(new Set(res.ranking.map((r) => r.id)).size, TABLE);
      // places: starts at 1, never decreases, ties share a place
      assert.equal(res.ranking[0].place, 1);
      res.ranking.forEach((r, i) => {
        if (i) assert.ok(r.place >= res.ranking[i - 1].place && r.place <= i + 1);
        assert.ok(r.score >= 0 && r.score <= rounds, `score ${r.score}`);
        assert.ok(Number.isFinite(r.surv) && r.surv >= 0 && r.surv <= rounds * RUN_MS, `surv ${r.surv}`);
        if (i) {
          const p = res.ranking[i - 1];
          assert.ok(p.score > r.score || (p.score === r.score && p.surv >= r.surv), 'sorted by survivals then survival time');
        }
      });
      // every round went warn -> run -> result, in order
      for (let n = 1; n <= rounds; n++) {
        const seq = phases.filter((p) => p.startsWith(`${n}:`)).map((p) => p.split(':')[1]);
        assert.ok(seq.join() === 'warn,run,result' || seq.join() === 'warn,run,result,final', `round ${n}: ${seq}`);
      }
      // the log and the scores agree
      const survivals = {};
      for (let n = 1; n <= rounds; n++) {
        const out = new Set(res.log.filter((l) => l.n === n).map((l) => l.id));
        for (const r of g.roster) if (!out.has(r.id)) survivals[r.id] = (survivals[r.id] ?? 0) + 1;
      }
      for (const r of g.roster) assert.equal(g.scores[r.id], survivals[r.id] ?? 0, `${r.id} score matches its survivals`);
      // timing: warn + 50 s + a short result, per disaster
      const minMs = rounds * (WARN_MS + 1800 + RESULT_MS) + FINAL_MS;
      const maxMs = rounds * (WARN_MS + RUN_MS + RESULT_MS) + FINAL_MS + 2000;
      assert.ok(res.now >= minMs && res.now <= maxMs, `took ${res.now} ms`);
    }
  }
});

test('stand-in humans who never move are judged like away players and the match still ends', () => {
  for (const seed of [11, 12, 13]) {
    const res = simulateMatch(world, nav, { seed, rounds: 5, humans: 2 });
    assert.ok(res.g.fin);
    assert.equal(res.ranking.length, TABLE);
    const humans = res.ranking.filter((r) => r.id.startsWith('human'));
    assert.equal(humans.length, 2);
    // two sitting ducks lose to the bots over five disasters
    const best = res.ranking[0];
    assert.ok(humans.every((h) => h.score <= best.score));
  }
});

test('rounds end early when nobody is left standing', () => {
  const roster = buildRoster(['a', 'b'], 1);
  let g = startRound(newMatch({ mid: 'm', by: 'a', seed: 3, rounds: 3, roster }), 1, 0);
  const alive = roster.length;
  assert.equal(hostStep(g, 8000, { aliveCount: alive }), null);
  const early = hostStep(g, 20000, { aliveCount: 0 });
  assert.ok(early && early.endAt === 21800 && early.nextAt === 21800 + RESULT_MS);
});

test('the record: phases follow the clock and the round settles once', () => {
  const roster = buildRoster(['a'], 5);
  let g = newMatch({ mid: 'm1', by: 'a', seed: 9, rounds: 2, roster });
  assert.equal(phaseAt(g, 0), 'none');
  g = startRound(g, 1, 1000);
  assert.equal(g.rid, 'm1.1');
  assert.equal(phaseAt(g, 1000), 'warn');
  assert.equal(phaseAt(g, 1000 + WARN_MS), 'run');
  assert.equal(phaseAt(g, g.endAt), 'result');
  // not settled before the end
  assert.equal(hostStep(g, g.runAt + 1000, { aliveCount: 3 }), null);
  const settled = hostStep(g, g.endAt + 10, { aliveCount: 3 });
  assert.deepEqual(settled.res.ok.length, roster.length);
  assert.equal(settled.scores.a, 1);
  assert.equal(hostStep(settled, settled.endAt + 20, { aliveCount: 3 }), null, 'settles once');
  const next = hostStep(settled, settled.nextAt + 5, { aliveCount: 3 });
  assert.equal(next.n, 2);
  assert.equal(next.rid, 'm1.2');
  assert.notEqual(next.rid, g.rid);
  assert.deepEqual(next.outs, {});
  const s2 = hostStep(next, next.endAt + 1, { aliveCount: 1 });
  const fin = hostStep(s2, s2.nextAt + 1, { aliveCount: 1 });
  assert.equal(fin.fin, 1);
  assert.ok(fin.finAt > s2.nextAt);
  assert.equal(hostStep(fin, fin.finAt + 1, { aliveCount: 1 }), null);
  assert.equal(phaseAt(fin, 0), 'final');
});

test('knockouts are checked: unknown players, repeats, wrong causes, times from the future', () => {
  const roster = buildRoster(['a', 'b'], 2);
  let g = newMatch({ mid: 'm', by: 'a', seed: 21, rounds: 3, roster });
  g = startRound(g, 1, 0);
  const kinds = g.plan[0].k;
  const cause = kinds[0] === 'flood' ? 'drown' : 'meteor';
  const wrong = kinds[0] === 'flood' ? 'flung' : 'drown';
  const now = g.runAt + 12000;
  assert.equal(applyOut(g, 'nobody', 5000, cause, now), null);
  assert.equal(applyOut(g, 'a', 5000, wrong, now), null, 'a cause this round cannot have');
  assert.equal(applyOut(g, 'a', 5000, 'banana', now), null);
  assert.equal(applyOut(g, 'a', NaN, cause, now), null);
  assert.equal(applyOut(g, 'a', 5000, 'drown'.length ? cause : '', g.runAt - 3000), null, 'before the run');
  const g2 = applyOut(g, 'a', 5000, cause, now);
  assert.deepEqual(g2.outs.a, [5000, causeCode(cause)]);
  assert.equal(applyOut(g2, 'a', 6000, cause, now), null, 'only once');
  const g3 = applyOut(g, 'b', 49000, cause, now);
  assert.ok(g3.outs.b[0] <= 12400, 'cannot claim a time later than the clock');
  assert.equal(applyOut(settleRound(g), 'b', 100, cause, now), null, 'not after the round is settled');
  assert.equal(applyOut(g, 'b', 100, 'left', now).outs.b[1], causeCode('left'));
});

test('ranking breaks ties by survival time and shares a place only when both are equal', () => {
  const roster = [{ id: 'a', b: 0, c: 0 }, { id: 'b', b: 0, c: 1 }, { id: 'c', b: 0, c: 2 }, { id: 'd', b: 0, c: 3 }];
  const g = { roster, scores: { a: 3, b: 3, c: 2, d: 2 }, surv: { a: 100, b: 200, c: 50, d: 50 } };
  const r = ranking(g);
  assert.deepEqual(r.map((x) => x.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(r.map((x) => x.place), [1, 2, 3, 3]);
});

test('the roster: humans first, bots fill to eight, colours and names are unique', () => {
  for (const humans of [1, 3, 8, 12, 16]) {
    const ids = Array.from({ length: humans }, (_, i) => `p${i}`);
    const roster = buildRoster(ids, 77 + humans);
    assert.equal(roster.length, Math.max(TABLE, humans));
    assert.deepEqual(roster.slice(0, humans).map((r) => r.id), ids);
    assert.equal(new Set(roster.map((r) => r.c)).size, roster.length, 'a colour each');
    const bots = roster.filter((r) => r.b);
    assert.equal(bots.length, Math.max(0, TABLE - humans));
    assert.equal(new Set(bots.map((r) => r.n)).size, bots.length);
    assert.ok(roster.every((r) => r.c >= 0 && r.c < PLAYER_COLORS.length));
  }
});

test('a record from the room is validated before use', () => {
  const roster = buildRoster(['a'], 1);
  const g = startRound(newMatch({ mid: 'm', by: 'a', seed: 1, rounds: 3, roster }), 1, 0);
  assert.ok(cleanRecord(g));
  assert.equal(cleanRecord(null), null);
  assert.equal(cleanRecord({ ...g, roster: 'x' }), null);
  assert.equal(cleanRecord({ ...g, runAt: 'soon' }), null);
  assert.equal(cleanRecord({ ...g, rounds: 99 }), null);
  assert.equal(cleanRecord({ ...g, roster: [null] }), null);
});

test('every disaster kind shows up across matches, and each can be survived by someone', () => {
  const seen = {};
  for (const seed of SEEDS) {
    const res = simulateMatch(world, nav, { seed, rounds: 5 });
    res.g.plan.forEach((p, i) => {
      for (const k of p.k) {
        const s = (seen[k] ??= { rounds: 0, survivorsTotal: 0 });
        s.rounds++;
        const out = res.log.filter((l) => l.n === i + 1).length;
        s.survivorsTotal += TABLE - out;
      }
    });
  }
  for (const k of ['flood', 'meteor', 'tornado', 'acid', 'quake', 'volcano']) {
    assert.ok(seen[k] && seen[k].rounds > 5, `${k} never came up`);
    assert.ok(seen[k].survivorsTotal / seen[k].rounds > 1.5, `${k}: only ${(seen[k].survivorsTotal / seen[k].rounds).toFixed(1)} survive on average`);
  }
});
