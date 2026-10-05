// A whole match through the pure modules, with nobody at the keyboard: the host's rules and bots at 60 Hz. The tests run it for
// many seeds; it is also the reference for how the live host drives a match.

import { buildRoster, newMatch, startRound, phaseAt, applyOut, hostStep, ranking, roundEntry } from './rules.js';
import { prepareRound, WARN_MS } from './disasters.js';
import { BotSim } from './bots.js';
import { AwaySim } from './away.js';

/**
 * Runs a match of `rounds` disasters with `table` bots (and `humans` stand-in ids that never move: they are judged like away
 * players). Returns { g, ranking, steps, log } where log lists every knockout.
 */
export function simulateMatch(world, nav, { seed, rounds = 5, table = 8, humans = 0, onFrame = null }) {
  const humanIds = Array.from({ length: humans }, (_, i) => `human${i + 1}`);
  const roster = buildRoster(humanIds, seed);
  let g = newMatch({ mid: `m${seed}`, by: 'host', seed, rounds, roster });
  g = startRound(g, 1, 0);
  const sim = new BotSim(world, nav);
  const away = new AwaySim(world);
  const log = [];
  let last = -WARN_MS;
  let rid = null;
  let now = 0;
  let steps = 0;
  const frame = 1000 / 60, dt = 1 / 60;
  const limit = (WARN_MS + 50000 + 6000 + 20000) * rounds + 60000;
  while (!(g.fin && now >= g.finAt) && now < limit) {
    now += frame;
    steps++;
    if (g.rid !== rid) {
      rid = g.rid;
      const entry = roundEntry(g);
      const round = prepareRound(entry.k, entry.s, world);
      sim.setRound(round, roster.map((r, i) => ({ r, i })).filter((x) => x.r.b).map((x) => ({ id: x.r.id, slot: x.i })));
      away.setRound(round);
      last = -WARN_MS;
    }
    const ph = phaseAt(g, now);
    if (ph === 'warn' || ph === 'run') {
      const t = now - g.runAt;
      const events = sim.step(dt, t);
      // stand-in humans never move from their spawn slot: judged like players who are away
      roster.forEach((r, i) => {
        if (r.b || g.outs[r.id]) return;
        const sp = world.map.spawns[i % world.map.spawns.length];
        const cause = away.step(r.id, { x: sp.x, y: 0, z: sp.z }, dt, last, t);
        if (cause) events.push({ id: r.id, cause, t: Math.max(0, Math.round(t)) });
      });
      last = t;
      for (const e of events) {
        const ng = applyOut(g, e.id, e.t, e.cause, now);
        if (ng) {
          g = ng;
          log.push({ n: g.n, id: e.id, cause: e.cause, t: e.t });
        }
      }
    }
    const aliveCount = roster.filter((r) => !g.outs[r.id]).length;
    const ng = hostStep(g, now, { aliveCount });
    if (ng) g = ng;
    if (onFrame) onFrame({ g, now, sim, ph });
  }
  return { g, ranking: ranking(g), steps, log, sim, now };
}
