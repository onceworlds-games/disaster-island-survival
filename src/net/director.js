// The host's half of a match: it writes the match record, simulates the bots, judges players who are away, records knockouts the
// players report, closes rounds and ends the match. No DOM and no three.js: it talks to a `room` (the SDK's, or a fake in tests).
//
// Everything the host knows is in room state (`g`, the bots' snapshot `b`), so a new host calls adopt() and carries on.

import { BotSim } from '../sim/bots.js';
import { AwaySim } from '../sim/away.js';
import { getNav } from '../sim/nav.js';
import { buildRoster, newMatch, startRound, phaseAt, applyOut, hostStep, roundEntry, cleanRecord, MAX_PLAYERS } from '../sim/rules.js';
import { prepareRound, WARN_MS, CAUSES } from '../sim/disasters.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

export class Director {
  constructor(room, world) {
    this.room = room;
    this.world = world;
    this.sim = null;
    this.away = new AwaySim(world);
    this.rid = null;
    this.round = null;
    this.lastT = -WARN_MS;
    this.rulesAcc = 0;
    this.lastSnap = -1e9;
    this.leftSeen = new Set();
    this.endedFor = '';
    this.retry = 0;
  }

  /** The match record, if it belongs to the match in progress. */
  record() {
    const g = this.room.state.g;
    if (!g || g.mid !== this.room.match.id) return null;
    return cleanRecord(g);
  }

  write(g) {
    this.room.setState('g', g);
  }

  /** Carry on as the host: start the record if there isn't one, or take it over from the host before. Safe to call again and again. */
  adopt() {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    const g = this.record();
    if (!g) {
      this.begin();
      return;
    }
    if (g.by !== room.me.id) {
      this.write({ ...g, by: room.me.id });
      this.rid = null; // the bots start again from the last snapshot
    }
  }

  begin() {
    const room = this.room;
    const m = room.match;
    const ids = (m.participants || []).filter((id) => typeof id === 'string').slice(0, MAX_PLAYERS);
    if (!ids.length) return;
    const roster = buildRoster(ids, Number(m.seed) >>> 0);
    const rounds = Math.max(1, Math.min(12, Number(room.settings.rounds) || 5));
    let g = newMatch({ mid: m.id, by: room.me.id, seed: Number(m.seed) >>> 0, rounds, roster });
    g = startRound(g, 1, Math.round(room.matchNow()));
    this.rid = null;
    this.endedFor = '';
    this.write(g);
  }

  ensureSim() {
    if (!this.sim) this.sim = new BotSim(this.world, getNav(this.world));
    return this.sim;
  }

  setupRound(g, now) {
    const entry = roundEntry(g);
    if (!entry) return;
    const round = prepareRound(entry.k, entry.s, this.world);
    const sim = this.ensureSim();
    const bots = [];
    g.roster.forEach((r, i) => {
      if (r.b) bots.push({ id: r.id, slot: i });
    });
    sim.setRound(round, bots);
    this.away.setRound(round);
    this.round = round;
    this.rid = g.rid;
    this.leftSeen.clear();
    const t = now - g.runAt;
    this.lastT = Math.max(-WARN_MS, t);
    // a new host continues from the old one's last snapshot
    const snap = this.room.state.b;
    if (snap && snap.rid === g.rid && t > -WARN_MS + 300) {
      sim.restore(snap);
      for (const b of sim.bots) b.lastT = t;
    }
    this.rulesAcc = 0;
  }

  /** A knockout from a player's page (or the host's own player): checked and recorded. */
  applyLocalOut(id, cause, tr) {
    const room = this.room;
    const g = this.record();
    if (!g || g.by !== room.me.id) return false;
    const ng = applyOut(g, id, tr, cause, room.matchNow());
    if (!ng) return false;
    this.write(ng);
    return true;
  }

  /** room.on('message'): { t: 'out', rid, cause, tr } from a player about themselves. */
  onMessage(d, from) {
    const room = this.room;
    if (!room.isHost || !room.running || !d || d.t !== 'out' || !from) return;
    const g = this.record();
    if (!g || g.by !== room.me.id || d.rid !== g.rid) return;
    const r = g.roster.find((x) => x.id === from.id);
    if (!r || r.b) return;
    if (typeof d.cause !== 'string' || !CAUSES.includes(d.cause) || d.cause === 'left') return;
    this.applyLocalOut(from.id, d.cause, Number(d.tr));
  }

  /** One fixed step (dt seconds). Cheap when this page isn't the host. */
  tick(dt) {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    let g = this.record();
    if (!g) {
      // a safety net for a missed event: try again about once a second
      this.retry += dt;
      if (this.retry > 1) {
        this.retry = 0;
        this.adopt();
      }
      return;
    }
    if (g.by !== room.me.id) {
      this.adopt();
      return;
    }
    const now = room.matchNow();
    if (g.rid !== this.rid) this.setupRound(g, now);
    const ph = phaseAt(g, now);
    if (ph === 'warn' || ph === 'run') {
      const t = now - g.runAt;
      const events = this.sim.step(dt, t);
      // humans: judged here only while they're away or gone; a connected page judges itself
      const away = [];
      g.roster.forEach((r, i) => {
        if (r.b || g.outs[r.id]) return;
        const p = room.players.get(r.id);
        if (!p) {
          // gone from the room: out as the disaster begins (nothing counts during the warning)
          if (t >= 0 && !this.leftSeen.has(r.id)) {
            this.leftSeen.add(r.id);
            away.push({ id: r.id, cause: 'left', t });
          }
          return;
        }
        if (p.connected === false) {
          const pr = p.presence;
          const sp = this.world.map.spawns[i % this.world.map.spawns.length];
          const pos = pr && finite(pr.x) && finite(pr.y) && finite(pr.z) ? { x: pr.x, y: pr.y, z: pr.z } : { x: sp.x, y: 0, z: sp.z };
          const cause = this.away.step(r.id, pos, dt, this.lastT, t);
          if (cause) away.push({ id: r.id, cause, t });
        } else {
          this.away.forget(r.id);
          // a page's own knockout also rides in its presence, so a lost message costs nothing
          const pr = p.presence;
          if (pr && pr.q === g.rid && pr.o > 0 && CAUSES[pr.o] && pr.o !== 7 && finite(pr.ot)) away.push({ id: r.id, cause: CAUSES[pr.o], t: pr.ot });
        }
      });
      this.lastT = t;
      for (const e of [...events, ...away]) {
        const cur = this.record();
        if (!cur) break;
        const ng = applyOut(cur, e.id, e.t, e.cause, now);
        if (ng) this.write(ng);
      }
      if (now - this.lastSnap >= 80) {
        this.lastSnap = now;
        room.setState('b', { rid: g.rid, ...this.sim.snapshot(now) });
      }
    } else if (ph === 'result' && now - this.lastSnap >= 400) {
      this.lastSnap = now;
      room.setState('b', { rid: g.rid, ...this.sim.snapshot(now) });
    }
    this.rulesAcc += dt;
    if (this.rulesAcc >= 0.1) {
      this.rulesAcc = 0;
      g = this.record();
      if (!g) return;
      const alive = g.roster.filter((r) => !g.outs[r.id]).length;
      const ng = hostStep(g, now, { aliveCount: alive });
      if (ng) this.write(ng);
      const cur = ng || g;
      if (cur.fin && now >= cur.finAt && this.endedFor !== cur.mid) {
        this.endedFor = cur.mid;
        room.endMatch();
      }
    }
  }
}
