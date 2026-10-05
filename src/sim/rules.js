// The match record and its rules, as pure functions. The host's page writes the record (`g`) into room state; every page derives the
// phase from it and the shared match clock. Nothing here touches the room, the DOM or three.js, so node tests run whole matches.
//
// g = { mid, by, rounds, n, rid, plan, roster, t0, runAt, endAt, nextAt, scores, surv, outs, res, fin, finAt }
//   roster: [{ id, b: 1 for a bot, n: bot name, c: colour index }]    plan: [{ k: [kinds], s: seed }]
//   scores: id -> survivals    surv: id -> total survival ms    outs: id -> [run ms when knocked out, cause code] (this round)
//   res: { n, ok: [ids who survived round n] } once the round is settled.

import { WARN_MS, RUN_MS, CAUSES, causeCode, buildPlan, cleanEntry } from './disasters.js';
import { BOT_NAMES } from './bots.js';
import { mulberry32, mixSeed } from './rng.js';

export const RESULT_MS = 4500;
export const FINAL_MS = 9000;
export const TABLE = 8;
export const MAX_PLAYERS = 16;
export const PLAYER_COLORS = [
  0xe63946, 0xff9f1c, 0xffd23f, 0x2ec4b6, 0x3a86ff, 0x8338ec, 0xff4d9d, 0x80ed99,
  0x00b4d8, 0xf15bb5, 0xff6b35, 0x4cc9f0, 0xb5e48c, 0xc77dff, 0xe9edc9, 0x9bf6ff,
];

/** Humans in the order the room gave them, then bots up to the table size. */
export function buildRoster(humanIds, seed) {
  const rng = mulberry32(mixSeed(seed >>> 0, 0x5eed));
  const roster = [];
  const off = Math.floor(rng() * PLAYER_COLORS.length);
  const names = [...BOT_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  humanIds.slice(0, MAX_PLAYERS).forEach((id) => roster.push({ id, b: 0, c: (roster.length + off) % PLAYER_COLORS.length }));
  const bots = Math.max(0, TABLE - roster.length);
  for (let i = 0; i < bots; i++) roster.push({ id: `bot${i + 1}`, b: 1, n: names[i % names.length], c: (roster.length + off) % PLAYER_COLORS.length });
  return roster;
}

export function newMatch({ mid, by, seed, rounds, roster }) {
  const scores = {}, surv = {};
  for (const r of roster) {
    scores[r.id] = 0;
    surv[r.id] = 0;
  }
  return {
    mid, by, rounds, n: 0, rid: '', plan: buildPlan(seed, rounds), roster,
    t0: 0, runAt: 0, endAt: 0, nextAt: 0, scores, surv, outs: {}, res: null, fin: 0, finAt: 0,
  };
}

/** Round n (1-based) begins at match time `startMs`: the warning, the run, then the result. */
export function startRound(g, n, startMs) {
  const runAt = startMs + WARN_MS;
  const endAt = runAt + RUN_MS;
  return { ...g, n, rid: `${g.mid}.${n}`, t0: startMs, runAt, endAt, nextAt: endAt + RESULT_MS, outs: {}, res: null };
}

/** 'warn' | 'run' | 'result' | 'final' | 'none': what the record says is going on at match time `now`. */
export function phaseAt(g, now) {
  if (!g || !g.rid) return 'none';
  if (g.fin) return 'final';
  if (now < g.runAt) return 'warn';
  if (now < g.endAt) return 'run';
  return 'result';
}

export function roundEntry(g) {
  return g && g.plan ? cleanEntry(g.plan[g.n - 1]) : null;
}

const CAUSE_KIND = { drown: ['flood'], meteor: ['meteor'], flung: ['tornado'], acid: ['acid'], debris: ['quake'], lava: ['quake', 'volcano'], left: null };

/** Records a knockout at run time `tRun` (ms), after checking it could have happened. Returns the new record, or null if refused. */
export function applyOut(g, id, tRun, cause, now) {
  if (!g || g.fin || !g.rid) return null;
  if (!g.roster.some((r) => r.id === id) || g.outs[id]) return null;
  if (g.res && g.res.n === g.n) return null; // the round is settled already
  if (typeof cause !== 'string' || !CAUSES.includes(cause) || cause === '') return null;
  const t = Number(tRun);
  if (!Number.isFinite(t)) return null;
  const since = now - g.runAt;
  if (since < -300 || now > g.endAt + 1500) return null; // nothing happens before the run, and a late message after it doesn't count
  const entry = roundEntry(g);
  const allowed = CAUSE_KIND[cause];
  if (allowed && (!entry || !allowed.some((k) => entry.k.includes(k)))) return null;
  const at = Math.max(0, Math.min(Math.round(t), Math.max(0, Math.round(since) + 400), RUN_MS));
  return { ...g, outs: { ...g.outs, [id]: [at, causeCode(cause)] } };
}

/** Closes the round: +1 for everyone still standing, survival time for the tie-break. */
export function settleRound(g) {
  const scores = { ...g.scores }, surv = { ...g.surv };
  const ok = [];
  const run = Math.max(0, Math.min(RUN_MS, g.endAt - g.runAt));
  for (const r of g.roster) {
    const out = g.outs[r.id];
    if (!out) {
      scores[r.id] = (scores[r.id] ?? 0) + 1;
      surv[r.id] = (surv[r.id] ?? 0) + run;
      ok.push(r.id);
    } else surv[r.id] = (surv[r.id] ?? 0) + Math.min(out[0], run);
  }
  return { ...g, scores, surv, res: { n: g.n, ok } };
}

/**
 * What the host's ticker does at match time `now`: returns the record to write, or null for nothing.
 * ctx.aliveCount: roster members not knocked out this round (the run ends early when nobody is left).
 */
export function hostStep(g, now, ctx) {
  if (!g || !g.rid || g.fin) return null;
  const ph = phaseAt(g, now);
  if (ph === 'run' && ctx.aliveCount === 0 && g.endAt - now > 1800) {
    return { ...g, endAt: Math.round(now + 1800), nextAt: Math.round(now + 1800) + RESULT_MS };
  }
  const settled = g.res && g.res.n === g.n;
  if (now >= g.endAt && !settled) return settleRound(g);
  if (settled && now >= g.nextAt) {
    if (g.n >= g.rounds) return { ...g, fin: 1, finAt: Math.round(now) + FINAL_MS };
    return startRound(g, g.n + 1, Math.round(Math.max(now, g.nextAt)));
  }
  return null;
}

/** Everyone ranked: most survivals, then the longest total survival time, then roster order. */
export function ranking(g) {
  const order = g.roster.map((r, i) => ({ id: r.id, i, score: g.scores[r.id] ?? 0, surv: g.surv[r.id] ?? 0 }));
  order.sort((a, b) => b.score - a.score || b.surv - a.surv || a.i - b.i);
  let place = 0;
  return order.map((o, k) => {
    if (k === 0 || o.score !== order[k - 1].score || o.surv !== order[k - 1].surv) place = k + 1;
    return { id: o.id, place, score: o.score, surv: o.surv };
  });
}

/** Validates a match record that came from the room (another page wrote it): returns it, or null if it isn't usable. */
export function cleanRecord(g) {
  if (!g || typeof g !== 'object' || typeof g.mid !== 'string' || !Array.isArray(g.roster) || g.roster.length < 1 || g.roster.length > 24) return null;
  if (typeof g.rid !== 'string' || !Number.isFinite(g.runAt) || !Number.isFinite(g.endAt) || !Number.isFinite(g.nextAt) || !Number.isFinite(g.t0)) return null;
  if (!g.scores || typeof g.scores !== 'object' || !g.outs || typeof g.outs !== 'object' || !Array.isArray(g.plan)) return null;
  if (!Number.isFinite(g.n) || !Number.isFinite(g.rounds) || g.rounds < 1 || g.rounds > 12) return null;
  for (const r of g.roster) if (!r || typeof r.id !== 'string') return null;
  return g;
}
