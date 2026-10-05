// Bots: simulated by the host with the same controller and hazard rules as a player. They think a few times a second, follow
// distance fields over the walking graph (stairs, ladders), step out of target rings, and sometimes choose badly: slow
// reactions and about one bot in five picks the wrong place on purpose, so not all of them survive.

import { makeBody, stepBody } from './collision.js';
import { field, stepToward, findPath } from './nav.js';
import { makeHazard, resetHazard, stepHazards, inCrack, inFlow } from './hazards.js';
import {
  waterLevel, tornadoAt, causeCode, CAUSES, WARN_MS,
  METEOR_TELEGRAPH, BALL_TELEGRAPH, DEBRIS_FALL, TORNADO,
} from './disasters.js';
import { mulberry32, mixSeed, hashStr, clamp } from './rng.js';
import { SEA } from './map.js';

export const BOT_NAMES = ['Nova', 'Echo', 'Blaze', 'Pixel', 'Rook', 'Vex', 'Kai', 'Juno', 'Orbit', 'Zed', 'Mika', 'Rio', 'Ace', 'Sol'];

const PRIORITY = ['flood', 'tornado', 'acid', 'volcano', 'meteor', 'quake'];

export class BotSim {
  constructor(world, nav) {
    this.world = world;
    this.nav = nav;
    this.map = world.map;
    this.round = null;
    this.bots = [];
    this.byId = new Map();
    this.clockT = 0;
    this.tmp = { x: 0, z: 0, dist: 0 };
    const clearance = this.buildClearance();
    this.clearance = clearance;
  }

  /** For each node, the distance to the nearest building (the quake bots look for wide open ground). */
  buildClearance() {
    const nav = this.nav;
    const out = new Float32Array(nav.N);
    const blds = this.map.buildings;
    for (let i = 0; i < nav.N; i++) {
      let best = 99;
      for (const b of blds) {
        const dx = nav.x[i] < b.x0 ? b.x0 - nav.x[i] : nav.x[i] > b.x1 ? nav.x[i] - b.x1 : 0;
        const dz = nav.z[i] < b.z0 ? b.z0 - nav.z[i] : nav.z[i] > b.z1 ? nav.z[i] - b.z1 : 0;
        const d = Math.hypot(dx, dz);
        if (d < best) best = d;
      }
      out[i] = best;
    }
    return out;
  }

  /** Starts a round (or calm wandering when `round` is null): the bots stand in their spawn slots. entries: [{ id, slot }]. */
  setRound(round, entries) {
    this.round = round;
    this.bots = [];
    this.byId.clear();
    for (const e of entries) {
      const sp = this.map.spawns[e.slot % this.map.spawns.length];
      const body = makeBody(sp.x, 0, sp.z, sp.yaw);
      const rng = mulberry32(mixSeed(round ? round.seed : 7, hashStr(e.id)));
      const foolish = round ? rng() < 0.2 : false;
      const bot = {
        id: e.id,
        slot: e.slot,
        body,
        hs: makeHazard(),
        out: null,
        lastT: -WARN_MS,
        rng,
        mind: {
          foolish,
          react: 0.25 + rng() * 0.55,
          start: foolish ? 1.5 + rng() * 2.5 : 0.3 + rng() * 2.0,
          shelter: rng() < 0.42,
          thinkT: rng() * 0.3,
          path: null,
          pathI: 0,
          hold: false,
          sprint: false,
          mx: 0,
          mz: 0,
          px: sp.x,
          pz: sp.z,
          still: 0,
          unstuck: 0,
          waitT: 0,
          fleeUntil: 0,
          wanderLeft: 0,
          target: null,
          high: pickHigh(this, body, rng),
          dodge: null,
          blind: new Map(),
        },
      };
      this.bots.push(bot);
      this.byId.set(bot.id, bot);
    }
  }

  alive() {
    return this.bots.filter((b) => !b.out);
  }

  /** Advances every bot by dt seconds at run time t (ms; negative while the warning runs). Returns knockouts: [{ id, cause, t }]. */
  step(dt, t) {
    const events = [];
    const round = this.round;
    const water = round ? waterLevel(round, t) : SEA;
    for (const bot of this.bots) {
      if (bot.out) continue;
      const m = bot.mind;
      m.thinkT -= dt;
      if (m.thinkT <= 0) {
        this.think(bot, t);
        m.thinkT = 0.22 + bot.rng() * 0.16;
      }
      const inp = this.act(bot, t, dt);
      stepBody(this.world, bot.body, inp, dt, { water });
      if (round) {
        const cause = stepHazards(bot.hs, round, bot.lastT, t, bot.body, dt, this.world);
        if (cause) {
          const b = bot.body;
          bot.out = { cause, at: Math.max(0, Math.round(t)), x: b.x, y: b.y, z: b.z, kx: b.vx + b.ex, kz: b.vz + b.ez };
          events.push({ id: bot.id, cause, t: bot.out.at });
        }
      }
      bot.lastT = t;
    }
    return events;
  }

  // ------------------------------------------------------------------------------------------------ deciding

  think(bot, t) {
    const m = bot.mind, b = bot.body, round = this.round;
    // am I stuck? (wanting to move and not getting anywhere)
    if (!m.hold && Math.hypot(b.x - m.px, b.z - m.pz) < 0.25 && !b.climbing) m.still += 0.3;
    else m.still = 0;
    m.px = b.x;
    m.pz = b.z;
    if (m.still > 1.2) {
      m.unstuck = 0.9;
      m.still = 0;
      m.path = null;
    }
    m.dodge = null;
    m.sprint = false;
    m.hold = false;
    if (!round) return this.thinkCalm(bot, t);

    const tr = t + WARN_MS; // seconds since the warning began (ms)
    if (tr < m.start * 1000) {
      m.hold = true;
      return;
    }
    // 1. ring dodging: anything about to land on me
    const flee = this.threatEscape(bot, t);
    if (flee) {
      m.dodge = flee;
      m.sprint = true;
      return;
    }
    // 2. the plan for this kind of disaster
    const has = round.has;
    const kind = PRIORITY.find((k) => has[k]);
    const cover = () => field(this.nav, 'cover', (i) => this.nav.cov[i] === 1 && this.nav.y[i] < 9);
    switch (kind) {
      case 'flood':
        if (m.foolish) return this.follow(bot, field(this.nav, 'mid', (i) => this.nav.y[i] >= 4.5 && this.nav.y[i] <= 9.5), false);
        return this.follow(bot, this.highField(m.high), true);
      case 'tornado':
        return this.fleeTornado(bot, t);
      case 'acid':
        if (m.foolish) return this.thinkCalm(bot, t);
        return this.follow(bot, cover(), false);
      case 'volcano':
        if (m.foolish) return this.thinkCalm(bot, t);
        if (has.acid) return this.follow(bot, cover(), false);
        return this.follow(bot, this.farField(round), true);
      case 'meteor':
        if (m.foolish || !m.shelter) return this.thinkCalm(bot, t);
        return this.follow(bot, cover(), false);
      case 'quake':
        if (m.foolish) return this.follow(bot, field(this.nav, 'walls', (i) => this.nav.y[i] < 0.1 && this.clearance[i] > 0.8 && this.clearance[i] < 3), false);
        return this.follow(bot, this.openField(), false);
      default:
        return this.thinkCalm(bot, t);
    }
  }

  nodeOf(bot) {
    const b = bot.body;
    return this.nav.nearest(b.x, b.z, b.y, 1.3);
  }

  highField(which) {
    const nav = this.nav;
    if (which === 'clock') return field(nav, 'high-clock', (i) => nav.y[i] >= 19.5);
    if (which === 'water') return field(nav, 'high-water', (i) => nav.y[i] >= 16 && nav.y[i] < 19 && nav.x[i] > 19);
    return field(nav, 'high-hill', (i) => nav.y[i] >= 15 && nav.y[i] < 16 && nav.x[i] > 15 && nav.x[i] < 30);
  }

  farField(round) {
    const hill = this.map.hill;
    return field(this.nav, `far:${round.seed}`, (i) => {
      const nav = this.nav;
      if (nav.y[i] > 0.1) return false;
      if (Math.hypot(nav.x[i] - hill.x, nav.z[i] - hill.z) < 32) return false;
      for (const f of round.flows) {
        // keep clear of where the flows will run
        const rx = nav.x[i] - f.ox, rz = nav.z[i] - f.oz;
        const along = rx * f.dx + rz * f.dz, across = Math.abs(-rx * f.dz + rz * f.dx);
        if (along > -4 && along < f.maxLen + 4 && across < f.w / 2 + 4) return false;
      }
      return true;
    });
  }

  openField() {
    return field(this.nav, 'open', (i) => {
      return this.nav.y[i] <= 0.1 && this.clearance[i] >= 8;
    });
  }

  /** Rings, shadows and lava the bot should step out of: returns a point to run to, or null when it's safe where it stands. */
  threatEscape(bot, t) {
    const round = this.round, m = bot.mind, b = bot.body;
    if (!round || t < 0) return null;
    const world = this.world;
    const circles = this.circles || (this.circles = []);
    circles.length = 0;
    let crackEscape = null;
    const noticeAfter = m.react * 1000 * (m.foolish ? 2.2 : 1);
    const missChance = m.foolish ? 0.35 : 0.1;
    // circles: x, z, radius, id (an impact's time): ones this bot missed seeing stay missed
    const add = (x, z, r, id) => {
      let blind = m.blind.get(id);
      if (blind === undefined) {
        blind = bot.rng() < missChance;
        m.blind.set(id, blind);
      }
      if (!blind) circles.push(x, z, r, id);
    };
    if (round.has.meteor) {
      for (const k of round.meteors) {
        if (k.at < t) continue;
        if (k.at - t > METEOR_TELEGRAPH - noticeAfter) break;
        add(k.x, k.z, k.r + 1.0, k.at);
      }
    }
    if (round.has.volcano) {
      for (const k of round.balls) {
        if (k.at < t) continue;
        if (k.at - t > BALL_TELEGRAPH - noticeAfter) break;
        add(k.x, k.z, k.r + 1.0, 100000 + k.at);
      }
    }
    if (round.has.quake) {
      for (const d of round.debris) {
        if (d.at < t) continue;
        if (d.at - t > DEBRIS_FALL - noticeAfter * 0.5) break;
        add(d.x, d.z, d.size / 2 + 1.6, 200000 + d.at);
      }
      round.cracks.forEach((c, ci) => {
        if (t >= c.crackAt && inCrack(c, b.x, b.z, 1.6)) {
          let blind = m.blind.get(300000 + ci);
          if (blind === undefined) {
            blind = bot.rng() < missChance * 0.5;
            m.blind.set(300000 + ci, blind);
          }
          if (blind) return;
          // step off the crack, across it
          const cs = Math.cos(c.th), sn = Math.sin(c.th);
          const v = -(b.x - c.x) * sn + (b.z - c.z) * cs;
          const side = v >= 0 ? 1 : -1;
          crackEscape = this.escapePoint(bot, b.x + -sn * side * 4, b.z + cs * side * 4);
        }
      });
      if (crackEscape) return crackEscape;
    }
    if (round.has.volcano) {
      for (const f of round.flows) {
        if (inFlow(f, t + 1500, b.x, b.z, 2.2)) {
          const rx = b.x - f.ox, rz = b.z - f.oz;
          const across = -rx * f.dz + rz * f.dx;
          const side = across >= 0 ? 1 : -1;
          return this.escapePoint(bot, b.x - f.dz * side * 5, b.z + f.dx * side * 5);
        }
      }
    }
    if (circles.length === 0) return null;
    if (world.covered(b.x, b.y, b.z)) return null; // under a roof: nothing in a ring reaches me
    let threatened = false;
    let cx = 0, cz = 0, cr = 0;
    for (let i = 0; i < circles.length; i += 4) {
      const dx = b.x - circles[i], dz = b.z - circles[i + 1];
      const d = Math.hypot(dx, dz);
      if (d < circles[i + 2]) {
        threatened = true;
        if (circles[i + 2] - d > cr) {
          cr = circles[i + 2] - d;
          cx = circles[i];
          cz = circles[i + 1];
        }
      }
    }
    if (!threatened) return null;
    // run away from the centre of the worst ring, to a spot outside every ring
    let ax = b.x - cx, az = b.z - cz;
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    let best = null, bs = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = Math.atan2(az, ax) + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
      const px = b.x + Math.cos(a) * 5.5, pz = b.z + Math.sin(a) * 5.5;
      if (!this.pathClear(b.x, b.z, b.y, px, pz)) continue;
      let score = 0;
      for (let i = 0; i < circles.length; i += 4) {
        const d = Math.hypot(px - circles[i], pz - circles[i + 1]) - circles[i + 2];
        score += d < 0 ? d * 3 : Math.min(d, 2) * 0.2;
      }
      score -= Math.abs(k) * 0.05;
      if (score > bs) {
        bs = score;
        best = [px, pz];
      }
    }
    return best ? { x: best[0], z: best[1] } : { x: b.x + ax * 5, z: b.z + az * 5 };
  }

  escapePoint(bot, x, z) {
    const b = bot.body;
    if (this.pathClear(b.x, b.z, b.y, x, z)) return { x, z };
    return { x: b.x + (b.x - x) * 0.5, z: b.z + (b.z - z) * 0.5 };
  }

  /** A straight walk from (x, z) to (px, pz) at feet height y is open (no wall, no edge). */
  pathClear(x, z, y, px, pz) {
    const w = this.world;
    const n = Math.max(2, Math.ceil(Math.hypot(px - x, pz - z) / 0.5));
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const sx = x + (px - x) * f, sz = z + (pz - z) * f;
      if (w.blocked(sx, sz, y)) return false;
      const g = w.groundAt(sx, sz, y);
      if (g < y - 0.65) return false;
    }
    return true;
  }

  /** Follow a distance field downhill; hold when at a goal. */
  follow(bot, dist, sprintOk) {
    const m = bot.mind, nav = this.nav, b = bot.body;
    if (b.climbing) return;
    const n = this.nodeOf(bot);
    if (n < 0 || !isFinite(dist[n])) {
      m.target = null;
      return this.pickWanderTarget(bot);
    }
    const e = stepToward(nav, dist, n);
    if (!e) {
      m.hold = true;
      m.target = null;
      return;
    }
    m.sprint = sprintOk;
    if (e[2] === 2) {
      const L = this.world.ladders[e[3]];
      m.target = { ladder: L, x: L.x + L.nx * 0.65, z: L.z + L.nz * 0.65 };
    } else {
      // aim a node ahead along the field while the way is straight, to cut corners
      let tx = nav.x[e[0]], tz = nav.z[e[0]], cur = e[0];
      for (let k = 0; k < 2; k++) {
        const e2 = stepToward(nav, dist, cur);
        if (!e2 || e2[2] === 2) break;
        const nx2 = nav.x[e2[0]], nz2 = nav.z[e2[0]];
        if (Math.abs(nav.y[e2[0]] - b.y) > 0.9 || !this.pathClear(b.x, b.z, b.y, nx2, nz2)) break;
        tx = nx2;
        tz = nz2;
        cur = e2[0];
      }
      m.target = { x: tx, z: tz };
    }
  }

  fleeTornado(bot, t) {
    const m = bot.mind, b = bot.body, round = this.round, nav = this.nav;
    if (b.climbing) return;
    m.sprint = true;
    const slow = m.foolish ? 2.6 : 1;
    const tp = tornadoAt(round, t, this.tmp);
    const tx = tp.x, tz = tp.z;
    const dNow = Math.hypot(b.x - tx, b.z - tz);
    if (m.foolish && dNow > 16 / slow) {
      m.hold = true;
      return;
    }
    const f1 = tornadoAt(round, t + 2500, { x: 0, z: 0, dist: 0 });
    const f2 = tornadoAt(round, t + 5000, { x: 0, z: 0, dist: 0 });
    const f3 = tornadoAt(round, t + 8000, { x: 0, z: 0, dist: 0 });
    // keep going to the place already chosen while it stays safe
    if (m.path && m.pathI < m.path.length && t < m.fleeUntil) {
      const g = m.path[m.path.length - 1];
      const gd = Math.min(Math.hypot(nav.x[g] - tx, nav.z[g] - tz), Math.hypot(nav.x[g] - f1.x, nav.z[g] - f1.z), Math.hypot(nav.x[g] - f2.x, nav.z[g] - f2.z));
      if (gd > TORNADO.pull + 4) {
        this.followPath(bot);
        return;
      }
    }
    if (dNow > TORNADO.pull + 16 && m.path && m.pathI < m.path.length) {
      this.followPath(bot);
      return;
    }
    const from = this.nodeOf(bot);
    const wantCover = !!round.has.acid; // acid rain on top: the place to run to has a roof
    const list = wantCover ? this.coverList() : null;
    let best = -1, bs = -Infinity;
    for (let k = 0; k < 22; k++) {
      let n;
      if (list) n = list[Math.floor(bot.rng() * list.length)];
      else {
        const a = bot.rng() * Math.PI * 2, r = 10 + bot.rng() * 24;
        const px = b.x + Math.cos(a) * r, pz = b.z + Math.sin(a) * r;
        if (!this.world.inBounds(px, pz)) continue;
        n = nav.nearest(px, pz, 0, 0.5);
      }
      if (n === undefined || n < 0) continue;
      const dd = Math.min(Math.hypot(nav.x[n] - tx, nav.z[n] - tz), Math.hypot(nav.x[n] - f1.x, nav.z[n] - f1.z), Math.hypot(nav.x[n] - f2.x, nav.z[n] - f2.z), Math.hypot(nav.x[n] - f3.x, nav.z[n] - f3.z));
      // the way there shouldn't pass the twister: distance from its position to the straight line
      const sx = nav.x[n] - b.x, sz = nav.z[n] - b.z;
      const sl = Math.hypot(sx, sz) || 1;
      const u = clamp(((tx - b.x) * sx + (tz - b.z) * sz) / (sl * sl), 0, 1);
      const pass = Math.hypot(b.x + sx * u - tx, b.z + sz * u - tz);
      const score = dd - 0.3 * sl + (pass < TORNADO.pull ? -30 : 0);
      if (score > bs) {
        bs = score;
        best = n;
      }
    }
    if (best < 0 || from < 0) return this.pickWanderTarget(bot);
    const path = findPath(nav, from, best, 5000);
    if (!path) return this.pickWanderTarget(bot);
    m.path = path;
    m.pathI = 1;
    m.fleeUntil = t + 1800;
    this.followPath(bot);
  }

  /** Nodes with a roof over them, low enough to walk to (shelter from rain). */
  coverList() {
    if (!this._cover) {
      this._cover = [];
      for (let i = 0; i < this.nav.N; i++) if (this.nav.cov[i] === 1 && this.nav.y[i] < 9) this._cover.push(i);
    }
    return this._cover;
  }

  followPath(bot) {
    const m = bot.mind, nav = this.nav, b = bot.body;
    while (m.pathI < m.path.length && Math.hypot(nav.x[m.path[m.pathI]] - b.x, nav.z[m.path[m.pathI]] - b.z) < 0.6) m.pathI++;
    if (m.pathI >= m.path.length) {
      m.path = null;
      m.hold = true;
      m.target = null;
      return;
    }
    const n = m.path[m.pathI];
    const prev = m.path[m.pathI - 1];
    const edge = nav.adj[prev].find((e) => e[0] === n);
    if (edge && edge[2] === 2) {
      const L = this.world.ladders[edge[3]];
      m.target = { ladder: L, x: L.x + L.nx * 0.65, z: L.z + L.nz * 0.65 };
    } else m.target = { x: nav.x[n], z: nav.z[n] };
  }

  /** Calm: walk to a random place nearby, wait a moment, repeat. */
  thinkCalm(bot) {
    const m = bot.mind, b = bot.body;
    m.sprint = false;
    if (m.waitT > 0) {
      m.waitT -= 0.3;
      m.hold = true;
      return;
    }
    if (m.target && !m.target.ladder && Math.hypot(b.x - m.target.x, b.z - m.target.z) > 0.9 && m.wanderLeft-- > 0) return;
    if (m.target) {
      m.target = null;
      m.waitT = 0.4 + bot.rng() * 2.4;
      m.hold = true;
      return;
    }
    this.pickWanderTarget(bot);
  }

  pickWanderTarget(bot) {
    const m = bot.mind, b = bot.body;
    m.sprint = false;
    for (let tries = 0; tries < 8; tries++) {
      const a = bot.rng() * Math.PI * 2, r = 4 + bot.rng() * 12;
      const px = b.x + Math.cos(a) * r, pz = b.z + Math.sin(a) * r;
      if (!this.world.inBounds(px, pz)) continue;
      if (this.pathClear(b.x, b.z, b.y, px, pz)) {
        m.target = { x: px, z: pz };
        m.wanderLeft = 20;
        return;
      }
    }
    m.target = null;
    m.hold = true;
  }

  // ------------------------------------------------------------------------------------------------ acting

  act(bot, t, dt) {
    const m = bot.mind, b = bot.body;
    let mx = 0, mz = 0, sprint = false, jump = false;
    if (m.unstuck > 0) {
      m.unstuck -= dt;
      const a = (bot.rng() - 0.5) * 0.05 + (m.unstuckA ?? (m.unstuckA = bot.rng() * Math.PI * 2));
      mx = Math.cos(a);
      mz = Math.sin(a);
      jump = true;
      if (m.unstuck <= 0) m.unstuckA = undefined;
    } else if (b.climbing) {
      const L = b.climbing;
      mx = -L.nx;
      mz = -L.nz;
    } else if (m.dodge) {
      const dx = m.dodge.x - b.x, dz = m.dodge.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        mx = dx / d;
        mz = dz / d;
      }
      sprint = true;
    } else if (!m.hold && m.target) {
      const tg = m.target;
      const dx = tg.x - b.x, dz = tg.z - b.z;
      const d = Math.hypot(dx, dz);
      if (tg.ladder && d < 0.45) {
        mx = -tg.ladder.nx;
        mz = -tg.ladder.nz;
      } else if (d > 0.12) {
        mx = dx / d;
        mz = dz / d;
      }
      sprint = m.sprint;
    }
    if (sprint && b.stamina < 0.15) sprint = false;
    return { mx, mz, jump, sprint };
  }

  // ------------------------------------------------------------------------------------------------ sharing

  /** One compact record of every bot, for the host's state key: id -> [x, y, z, yaw, speed, flags, cause, at]. */
  snapshot(matchMs) {
    const p = {};
    for (const bot of this.bots) {
      const b = bot.body;
      const flags = (b.sprinting ? 1 : 0) | (b.onGround ? 0 : 2) | (b.climbing ? 4 : 0) | (b.wet ? 8 : 0);
      const o = bot.out;
      p[bot.id] = [r2(o ? o.x : b.x), r2(o ? o.y : b.y), r2(o ? o.z : b.z), r2(b.yaw), Math.round(b.speed * 10) / 10, flags, o ? causeCode(o.cause) : 0, o ? o.at : 0];
    }
    return { t: Math.round(matchMs), p };
  }

  /** A new host carries on from the last snapshot of the old one. */
  restore(snap) {
    if (!snap || !snap.p) return;
    for (const bot of this.bots) {
      const a = snap.p[bot.id];
      if (!Array.isArray(a) || a.length < 8) continue;
      const b = bot.body;
      const [x, y, z, yaw, , , cause, at] = a;
      if (![x, y, z, yaw].every(Number.isFinite)) continue;
      b.x = x;
      b.y = y;
      b.z = z;
      b.yaw = yaw;
      b.vx = b.vz = b.vy = 0;
      b.onGround = true;
      if (cause > 0 && CAUSES[cause]) bot.out = { cause: CAUSES[cause], at, x, y, z, kx: 0, kz: 0 };
    }
  }

  reset(bot) {
    resetHazard(bot.hs);
  }
}

function pickHigh(sim, body, rng) {
  const nav = sim.nav;
  const n = nav.nearest(body.x, body.z, body.y, 1.5);
  const opts = ['clock', 'hill', 'water'];
  const round = sim.round;
  const w = opts.map((o) => {
    let v = 1;
    if (n >= 0) {
      const d = sim.highField(o)[n];
      v = isFinite(d) ? 1 / Math.pow(d + 8, 2) : 0;
    }
    if (round && round.has.tornado) {
      // a wise bot doesn't climb where the twister will pass
      const hp = sim.map.highPoints.find((h) => h.id === o);
      if (hp && tornadoPasses(round, hp.x, hp.z, 8.5)) v *= 0.04;
    }
    return v;
  });
  const total = w.reduce((a, c) => a + c, 0);
  if (total <= 0) return 'clock';
  let pick = rng() * total;
  for (let i = 0; i < opts.length; i++) {
    pick -= w[i];
    if (pick <= 0) return opts[i];
  }
  return 'clock';
}

/** The tornado comes within `r` of a point at some time in the run. */
function tornadoPasses(round, x, z, r) {
  const p = round.tornado;
  const maxD = (50000 * TORNADO.speed) / 1000;
  for (let i = 0; i < p.xs.length && p.cum[i] <= maxD; i += 2) if (Math.hypot(p.xs[i] - x, p.zs[i] - z) < r) return true;
  return false;
}

function r2(v) {
  return Math.round(v * 100) / 100;
}

