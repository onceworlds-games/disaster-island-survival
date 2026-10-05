// The client: input, your own character at a fixed 60 Hz, everyone else drawn from presence and the host's snapshots, the HUD,
// sound, and the match flow seen from this page. Rules and bots belong to the host's Director (src/net/director.js); this page
// only decides what happens to its own player and tells the host.

import * as THREE from 'three';
import { stepBody, makeBody } from '../sim/collision.js';
import { makeHazard, resetHazard, stepHazards } from '../sim/hazards.js';
import {
  CAUSES, CAUSE_LABEL, causeCode, prepareRound, waterLevel, floodLevel, WARN_MS, TORNADO, tornadoAt,
} from '../sim/disasters.js';
import { phaseAt, roundEntry, ranking, cleanRecord, PLAYER_COLORS } from '../sim/rules.js';
import { SEA } from '../sim/map.js';
import { hashStr, clamp } from '../sim/rng.js';
import { shade } from '../sim/meshbuilder.js';
import { SKIN } from '../gfx/characters.js';
import { skyMix } from '../gfx/skies.js';
import { TUMBLE_SECONDS } from '../sim/tumble.js';
import { Director } from '../net/director.js';
import { BotSim } from '../sim/bots.js';
import { getNav } from '../sim/nav.js';

const STEP = 1 / 60;
const BOT_NAMES_FALLBACK = 'Bot';
const CONTROLS = { stick: 'analog', buttons: [{ id: 'jump', label: 'Jump', key: ' ' }, { id: 'sprint', label: 'Sprint', key: 'Shift' }] };
const r2 = (v) => Math.round(v * 100) / 100;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const lerp = (a, b, t) => a + (b - a) * t;
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export class Game {
  constructor({ ow, room, stage, hud, audio, input, world, stats }) {
    this.ow = ow;
    this.room = room;
    this.stage = stage;
    this.hud = hud;
    this.audio = audio;
    this.input = input;
    this.world = world;
    this.map = world.map;
    this.stats = stats || { matches: 0, wins: 0, survived: 0, rounds: 0 };
    this.me = room.me;

    this.mode = 'title';
    this.director = null;
    this.titleSim = null;
    this.acc = 0;
    this.lastMs = 0;
    this.time = 0;
    this.errors = 0;

    // my character
    this.body = makeBody(0, 0, 5);
    this.hs = makeHazard();
    this.prev = { x: 0, y: 0, z: 5 };
    this.out = null; // { cause, at (run ms), x, y, z, yaw }
    this.slot = -1;
    this.lastT = -WARN_MS;
    this.phaseAcc = 0;
    this.stepAcc = 0;
    this.pubAcc = 0;
    this.wasWet = false;
    this.bubbleAcc = 0;
    this.dustAcc = 0;
    this.sendAcc = 0;
    this.sendTries = 0;
    this.freeze = 0;
    this.camBlend = 1;

    // the round as this page sees it
    this.g = null;
    this.rid = null;
    this.round = null;
    this.phase = 'lobby';
    this.tRun = -WARN_MS;
    this.settledRid = null;
    this.finalMid = null;
    this.savedMid = null;
    this.knownOuts = new Set();
    this.bannerGone = false;
    this.goneRun = false;
    this.cdLast = null;
    this.skyK = 0;
    this.skyKinds = [];
    this.mixObj = {};
    this.waterVis = SEA;
    this.followId = null;
    this.lastPoses = new Map();
    this.avatars = new Map();
    this.remotes = new Map();
    this.bsnaps = [];
    this.botSmooth = new Map();
    this.controlsOn = null;
    this.tmp = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.fwd = { x: 0, z: 0 };
    this.camTarget = new THREE.Vector3();
    this.titleTarget = new THREE.Vector3(0, 6, 0);
    this.perf = { sum: 0, n: 0, scale: 1, good: 0 };
    this.basePr = 1;
    this.lastHud = 0;
    this.stepClock = 0;

    this.stage.fx.onImpact = (kind, x, y, z, power) => this.onImpact(kind, x, y, z, power);
    this.wire();
    this.resize();
    this.spawnLobby();
    this.refresh();
    this.applyReduced();
  }

  // ------------------------------------------------------------------------------------------------------- wiring

  wire() {
    const room = this.room, ow = this.ow;
    room.on('starting', () => {
      this.cdLast = null;
      this.hud.hidePanel();
    });
    room.on('matchstart', () => {
      this.director?.adopt();
      this.hud.hidePanel();
      this.hud.countdown('GO');
      setTimeout(() => this.hud.countdown(null), 700);
    });
    room.on('host', () => this.director?.adopt());
    room.on('reconnect', () => this.director?.adopt());
    room.on('matchend', () => this.onMatchEnd());
    room.on('match', () => {
      if (this.mode === 'title') room.hideLobby();
      else room.hideLobby(false);
    });
    room.on('message', (d, from) => this.director?.onMessage(d, from));
    room.on('state', (key, value) => {
      if (key === 'b' && value && typeof value.rid === 'string' && value.p && typeof value.p === 'object' && finite(value.t)) this.pushSnapshot(value);
    });
    room.on('rename', () => this.stage.tags.invalidate());
    room.on('leave', (p) => this.remotes.delete(p.id));
    room.on('close', (reason) => this.onClose(reason));
    ow.settings.on('change', () => {
      this.applyReduced();
      this.stage.setQuality(ow.settings.quality);
      this.resize();
    });
    addEventListener('resize', () => this.resize());
    this.input.onKey = (code, e) => this.onKey(code, e);
    this.hud.h.onPlay = () => this.play();
    this.hud.h.onSetting = (v) => room.setSetting('rounds', v);
    this.hud.title.addEventListener('click', () => this.play());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.stage.tags.invalidate());
    room.hideLobby();
    ow.ui.setOrientation('landscape');
    ow.controls.set(null);
    // a host that joined is also the one who judges; a Director is cheap until it is needed
    this.director = new Director(room, this.world);
  }

  applyReduced() {
    const reduced = !!this.ow.settings.reducedMotion;
    this.reduced = reduced;
    this.stage.rig.shakeScale = reduced ? 0 : 1;
    this.hud.setReduced(reduced);
  }

  resize() {
    const w = innerWidth || 1280, h = innerHeight || 720;
    this.basePr = this.ow.settings.pixelRatio(2);
    this.stage.setSize(w, h, Math.max(0.5, this.basePr * this.perf.scale));
  }

  onClose(reason) {
    this.closed = reason || 'closed';
    const msg = reason === 'kicked' ? 'REMOVED' : reason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : reason === 'moved' ? 'MOVING' : 'DISCONNECTED';
    this.hud.callout(msg, '', 'bad', 60000);
  }

  // ------------------------------------------------------------------------------------------------------- title and play

  play() {
    if (this.mode !== 'title') return;
    this.audio.start();
    this.audio.click();
    this.mode = 'play';
    this.hud.showTitle(false);
    this.room.hideLobby(false);
    this.camBlend = 0;
    this.spawnLobby();
    this.applyControls();
    this.refresh();
    if (this.g && this.slot >= 0) this.newRound(this.g);
  }

  onKey(code) {
    if (this.mode === 'title') {
      if (code === 'Enter' || code === 'Space') this.play();
      return;
    }
    if (this.out || this.slot < 0 || this.room.spectating) {
      if (code === 'KeyQ') this.cycleFollow(-1);
      if (code === 'KeyE') this.cycleFollow(1);
    }
  }

  spawnLobby() {
    const id = this.me.id;
    const sp = this.map.spawns[hashStr(id) % this.map.spawns.length];
    const b = this.body;
    Object.assign(b, makeBody(sp.x, 0, sp.z, sp.yaw));
    this.prev.x = sp.x;
    this.prev.y = 0;
    this.prev.z = sp.z;
    this.stage.rig.yaw = sp.yaw + Math.PI;
    this.out = null;
    resetHazard(this.hs);
  }

  // ------------------------------------------------------------------------------------------------------- the round, derived

  recordOrNull() {
    const g = this.room.state.g;
    if (!g || g.mid !== this.room.match.id) return null;
    return cleanRecord(g);
  }

  refresh() {
    const room = this.room, m = room.match;
    const g = m.phase === 'playing' || m.phase === 'starting' ? this.recordOrNull() : null;
    this.g = g;
    const now = room.matchNow();
    if (m.phase === 'lobby') this.phase = 'lobby';
    else if (m.phase === 'starting') this.phase = 'starting';
    else if (!g || !g.rid) this.phase = 'wait';
    else this.phase = phaseAt(g, now);
    this.tRun = g ? now - g.runAt : -WARN_MS;
    if (g && g.rid && g.rid !== this.rid) this.newRound(g);
    else if (!g && this.rid) {
      this.rid = null;
      this.round = null;
      this.stage.fx.setRound(null);
    }
  }

  newRound(g) {
    const room = this.room;
    this.rid = g.rid;
    const entry = roundEntry(g);
    this.round = entry ? prepareRound(entry.k, entry.s, this.world) : null;
    this.stage.fx.setRound(this.round);
    this.out = null;
    resetHazard(this.hs);
    this.lastT = Math.max(-WARN_MS, this.tRun);
    this.bannerGone = false;
    this.goneRun = false;
    this.settledRid = null;
    this.knownOuts = new Set();
    this.bsnaps = [];
    this.botSmooth.clear();
    this.sendTries = 0;
    const b0 = room.state.b;
    if (b0 && typeof b0.rid === 'string' && b0.p && typeof b0.p === 'object' && finite(b0.t)) this.pushSnapshot(b0);
    this.slot = g.roster.findIndex((r) => r.id === this.me.id);
    const sp = this.slot >= 0 ? this.map.spawns[this.slot % this.map.spawns.length] : null;
    if (sp) {
      const pr = room.me.presence;
      const b = this.body;
      Object.assign(b, makeBody(sp.x, 0, sp.z, sp.yaw));
      // a page that reloaded mid-round carries on from where the room last saw it
      if (pr && pr.q === g.rid && finite(pr.x) && finite(pr.y) && finite(pr.z) && this.tRun > 500) {
        b.x = pr.x;
        b.y = pr.y;
        b.z = pr.z;
        b.yaw = finite(pr.r) ? pr.r : sp.yaw;
        if (pr.o > 0 && CAUSES[pr.o]) this.out = { cause: CAUSES[pr.o], at: finite(pr.ot) ? pr.ot : this.tRun, x: b.x, y: b.y, z: b.z, yaw: b.yaw };
      } else this.stage.rig.yaw = sp.yaw + Math.PI;
      this.prev.x = b.x;
      this.prev.y = b.y;
      this.prev.z = b.z;
      const o = g.outs[this.me.id];
      if (o && !this.out) this.out = { cause: CAUSES[o[1]] || 'meteor', at: o[0], x: b.x, y: b.y, z: b.z, yaw: b.yaw };
      this.stage.rig.dist = 9;
    }
    this.followId = null;
    if (this.mode === 'play') {
      this.applyControls();
      if (this.round && this.tRun < -300) {
        this.hud.clearCallout();
        this.hud.hidePanel();
        this.hud.banner(this.round.kinds);
        this.audio.siren(Math.min(6, -this.tRun / 1000));
        this.audio.whoosh(0.5);
        this.hud.flash();
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------- the loop

  frame = (ms) => {
    requestAnimationFrame(this.frame);
    if (!this.lastMs) this.lastMs = ms;
    let dt = (ms - this.lastMs) / 1000;
    this.lastMs = ms;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1;
    try {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) {
        this.step(STEP);
        this.acc -= STEP;
        n++;
      }
      if (this.acc > STEP * 6) this.acc = 0;
      this.render(dt, ms);
      this.input.endFrame();
    } catch (e) {
      // keep the loop alive, and let the platform see the error (a few times at most)
      if (this.errors++ < 3) setTimeout(() => { throw e; });
      else if (this.errors < 6) console.error(e);
    }
  };

  start() {
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------------------------------------------- one fixed step

  step(dt) {
    this.time += dt;
    const room = this.room;
    this.refresh();
    if (this.mode === 'title') {
      this.stepTitle(dt);
      return;
    }
    this.prev.x = this.body.x;
    this.prev.y = this.body.y;
    this.prev.z = this.body.z;
    this.director.tick(dt);
    const phase = this.phase;
    const matchLive = phase === 'warn' || phase === 'run';
    const paused = (matchLive || phase === 'result') && !room.running;
    if (paused) return;
    const b = this.body;
    const inLobby = phase === 'lobby' || phase === 'starting';
    const canMove = !this.out && (inLobby || (matchLive && this.slot >= 0)) && !this.closed;
    let mx = 0, mz = 0, jump = false, sprint = false;
    if (canMove) {
      this.input.move(this.tmp);
      const yaw = this.stage.rig.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      mx = rx * this.tmp.x + fx * this.tmp.y;
      mz = rz * this.tmp.x + fz * this.tmp.y;
      jump = this.input.jump();
      sprint = this.input.sprint();
    }
    if (this.out) {
      // frozen where it happened (the tumble is drawn, not simulated)
      b.x = this.out.x;
      b.y = this.out.y;
      b.z = this.out.z;
    } else {
      const water = this.round && (phase === 'warn' || phase === 'run') ? waterLevel(this.round, this.tRun) : SEA;
      stepBody(this.world, b, { mx, mz, jump, sprint }, dt, { water });
      // hazards
      if (this.round && matchLive && this.slot >= 0) {
        const cause = stepHazards(this.hs, this.round, this.lastT, this.tRun, b, dt, this.world);
        this.lastT = this.tRun;
        if (cause) this.knockOut(cause);
      }
      this.feedback(dt);
    }
    // a report that wasn't heard is sent again
    if (this.out && this.g && this.g.rid === this.rid && !this.g.outs[this.me.id] && this.slot >= 0) {
      this.sendAcc += dt;
      if (this.sendAcc > 1 && this.sendTries < 6) {
        this.sendAcc = 0;
        this.sendTries++;
        this.reportOut();
      }
    }
    this.publish(dt);
  }

  stepTitle(dt) {
    if (!this.titleSim) {
      try {
        this.titleSim = new BotSim(this.world, getNav(this.world));
        this.titleSim.setRound(null, [0, 3, 6, 9, 12, 15].map((slot, i) => ({ id: `t${i}`, slot })));
      } catch (e) {
        this.titleSim = null;
        if (this.errors++ < 3) setTimeout(() => { throw e; });
      }
    }
    if (this.titleSim) this.titleSim.step(dt, 0);
  }

  /** Footsteps, jumps, landings, splashes: what my own body does answers with sound and motion. */
  feedback(dt) {
    const b = this.body, fx = this.stage.fx, a = this.audio;
    if (b.jumped) {
      a.jump();
      fx.dustPuff(b.x, b.y, b.z, 5, 0xd9cdb0, 0.8);
    }
    if (b.landed > 0) {
      a.land(Math.min(3, b.landed / 8));
      fx.dustPuff(b.x, b.y, b.z, Math.min(14, 5 + b.landed), 0xd9cdb0, 1.1);
      if (b.landed > 22) this.stage.rig.addTrauma(0.2);
    }
    if (b.onGround && b.speed > 2 && !b.wet) {
      this.stepAcc += b.speed * dt * 0.9;
      if (this.stepAcc > Math.PI) {
        this.stepAcc -= Math.PI;
        a.step();
        if (b.sprinting) fx.dustPuff(b.x, b.y, b.z, 2, 0xd9cdb0, 0.7);
      }
    }
    if (b.wet && !this.wasWet) {
      a.splash();
      fx.splash(b.x, this.waterVis, b.z);
    }
    if (!b.wet && this.wasWet) a.splash();
    this.wasWet = b.wet;
    if (this.round && this.round.has.flood && this.hs.breath < 3.9 && this.tRun > 0) {
      this.bubbleAcc += dt;
      if (this.bubbleAcc > 0.28) {
        this.bubbleAcc = 0;
        fx.bubbles(b.x, b.y, b.z, 2);
        a.bubble();
      }
    }
    this.phaseAcc += b.speed * dt * 0.85;
  }

  knockOut(cause) {
    if (this.out) return;
    const b = this.body;
    this.out = { cause, at: Math.max(0, Math.round(this.tRun)), x: b.x, y: b.y, z: b.z, yaw: b.yaw };
    this.sendAcc = 0;
    this.reportOut();
    this.audio.ko();
    this.hud.callout('ELIMINATED', CAUSE_LABEL[cause] || '', 'bad', 1700);
    this.hud.flash();
    this.stage.rig.addTrauma(0.7);
    this.freeze = 0.07;
    try {
      navigator.vibrate?.(60);
    } catch {
      // not on every phone
    }
    this.followId = null;
    this.applyControls();
  }

  reportOut() {
    const o = this.out, g = this.g, room = this.room;
    if (!o || !g) return;
    if (room.isHost && this.director) this.director.applyLocalOut(this.me.id, o.cause, o.at);
    else room.send({ t: 'out', rid: g.rid, cause: o.cause, tr: o.at }, { to: room.host });
  }

  /** My presence, about twenty times a second: where I am, how I'm moving, and (if out) why and when. */
  publish(dt) {
    this.pubAcc += dt;
    if (this.pubAcc < 0.05) return;
    this.pubAcc = 0;
    const b = this.body, room = this.room;
    if (room.spectating || this.closed) {
      room.setPresence({ w: 1 });
      return;
    }
    const f = (b.sprinting ? 1 : 0) | (b.onGround ? 0 : 2) | (b.climbing ? 4 : 0) | (b.wet ? 8 : 0);
    const o = this.out;
    room.setPresence({
      x: r2(b.x), y: r2(b.y), z: r2(b.z), r: r2(b.yaw), s: Math.round(b.speed * 10) / 10, f,
      q: this.g ? this.g.rid : '', o: o ? causeCode(o.cause) : 0, ot: o ? o.at : 0,
    });
  }

  // ------------------------------------------------------------------------------------------------------- bots, remote players

  pushSnapshot(v) {
    if (v.rid !== this.rid) return;
    const list = this.bsnaps;
    if (list.length && v.t <= list[list.length - 1].t) {
      if (v.t < list[list.length - 1].t - 1500) list.length = 0; // time went backwards: a new host
      else return;
    }
    list.push(v);
    while (list.length > 6) list.shift();
  }

  /** A bot's pose from the host's snapshots, a little in the past and between two of them. */
  botPose(id, out) {
    const list = this.bsnaps;
    if (!list.length) return null;
    const rt = this.room.matchNow() - 130;
    let a = list[0], b = null;
    for (let i = 0; i < list.length; i++) {
      if (list[i].t <= rt) a = list[i];
      else {
        b = list[i];
        break;
      }
    }
    const pa = a.p[id];
    if (!Array.isArray(pa) || pa.length < 8) return null;
    const pb = b && Array.isArray(b.p[id]) && b.p[id].length >= 8 ? b.p[id] : null;
    let k = 0;
    if (pb && b.t > a.t) k = clamp((rt - a.t) / (b.t - a.t), 0, 1);
    const q = pb || pa;
    out.x = lerp(pa[0], q[0], k);
    out.y = lerp(pa[1], q[1], k);
    out.z = lerp(pa[2], q[2], k);
    let dy = q[3] - pa[3];
    dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    out.yaw = pa[3] + dy * k;
    out.speed = lerp(pa[4], q[4], k);
    out.flags = pa[5];
    out.cause = pa[6];
    out.at = pa[7];
    return out;
  }

  // ------------------------------------------------------------------------------------------------------- spectating

  aliveIds() {
    const g = this.g;
    if (!g) return [];
    return g.roster.filter((r) => r.id !== this.me.id && !g.outs[r.id] && this.lastPoses.has(r.id)).map((r) => r.id);
  }

  cycleFollow(dir) {
    const list = this.aliveIds();
    if (!list.length) return;
    const i = list.indexOf(this.followId);
    this.followId = list[(i < 0 ? 0 : i + dir + list.length) % list.length];
    this.audio.click();
  }

  // ------------------------------------------------------------------------------------------------------- avatars, names, colours

  avatarFor(id) {
    let a = this.avatars.get(id);
    if (a) return a;
    a = { img: null, url: null };
    this.avatars.set(id, a);
    if (id.startsWith('bot')) return a;
    Promise.resolve(this.ow.player.avatarUrl(id, 'head'))
      .then((url) => {
        if (!url || typeof url !== 'string') return;
        a.url = url;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        a.img = img;
      })
      .catch(() => {});
    return a;
  }

  colorOf(id) {
    const g = this.g;
    if (g) {
      const r = g.roster.find((x) => x.id === id);
      if (r) return PLAYER_COLORS[r.c % PLAYER_COLORS.length];
    }
    return PLAYER_COLORS[hashStr(id) % PLAYER_COLORS.length];
  }

  nameOf(id) {
    const g = this.g;
    const r = g && g.roster.find((x) => x.id === id);
    if (r && r.b) return String(r.n || BOT_NAMES_FALLBACK).slice(0, 12);
    const p = this.room.players.get(id);
    return String((p && p.name) || 'Player').slice(0, 20);
  }

  // ------------------------------------------------------------------------------------------------------- drawing

  render(dt, ms) {
    const stage = this.stage, rig = stage.rig;
    if (this.freeze > 0) {
      this.freeze -= dt;
      dt = 0;
    }
    const alpha = clamp(this.acc / STEP, 0, 1);
    this.refresh();
    stage.update(dt);
    this.input.takeLook(this.look);
    if (this.mode === 'title') {
      this.input.takeTap();
      return this.renderTitle(dt, ms);
    }
    const g = this.g, phase = this.phase;
    const b = this.body;
    // where my body is drawn: between the last two steps
    const px = lerp(this.prev.x, b.x, alpha), py = lerp(this.prev.y, b.y, alpha), pz = lerp(this.prev.z, b.z, alpha);

    // camera
    const sens = 0.0052;
    rig.turn(-this.look.x * sens, this.look.y * sens * 0.8 * 1);
    const tk = this.input.turnKeys();
    if (tk) rig.turn(-tk * 1.8 * dt, 0);
    const spectating = this.out || this.slot < 0 && (phase === 'warn' || phase === 'run' || phase === 'result' || phase === 'wait' || phase === 'final') && !!g;
    let target = { x: px, y: py, z: pz };
    let follow = null;
    if (spectating && (phase === 'warn' || phase === 'run' || phase === 'result' || phase === 'wait')) {
      if (this.input.takeTap()) this.cycleFollow(1);
      const alive = this.aliveIds();
      if (!this.followId || !alive.includes(this.followId)) this.followId = alive[0] ?? null;
      follow = this.followId ? this.lastPoses.get(this.followId) : null;
      if (follow) target = follow;
      else target = { x: 0, y: 3, z: 0 };
    } else this.input.takeTap();
    rig.update(dt, target, false);
    if (this.camBlend < 1) {
      this.camBlend = Math.min(1, this.camBlend + dt / 1.3);
      const e = this.camBlend * this.camBlend * (3 - 2 * this.camBlend);
      const a = this.titlePose(this.time);
      stage.camera.position.lerp(this.camTarget.set(a.x, a.y, a.z), 1 - e);
      stage.camera.lookAt(lerp(this.titleTarget.x, rig.pivot.x, e), lerp(this.titleTarget.y, rig.pivot.y, e), lerp(this.titleTarget.z, rig.pivot.z, e));
    }
    stage.follow(target.x, target.y, target.z);
    if (this.round && this.round.has.quake && !this.reduced && (phase === 'run' || phase === 'warn') && this.tRun > -500) rig.trauma = Math.max(rig.trauma, 0.2 * clamp((this.tRun + 500) / 1500, 0, 1));

    // the scene
    this.collect(dt, px, py, pz);
    const cam = stage.camera.position;
    const covered = this.world.covered(px, py, pz);
    stage.fx.update(dt, this.round && (phase === 'warn' || phase === 'run' || phase === 'result') ? this.tRun : NaN, cam, covered);
    this.updateSky(dt);
    stage.render();
    this.updateHud(dt, ms, covered);
    this.audioMix(dt, cam);
    this.perfGovernor(dt);
  }

  titlePose(t) {
    const a = t * 0.07;
    return { x: Math.cos(a) * 56, y: 25 + Math.sin(t * 0.13) * 3, z: Math.sin(a) * 44 };
  }

  renderTitle(dt) {
    const stage = this.stage;
    const p = this.titlePose(this.time);
    stage.camera.position.set(p.x, p.y, p.z);
    stage.camera.lookAt(this.titleTarget);
    stage.follow(0, 0, 0);
    stage.chars.begin();
    stage.tags.begin();
    if (this.titleSim) {
      for (const bot of this.titleSim.bots) this.pushBody(bot.id, bot.body, null, { name: '', tag: false, color: PLAYER_COLORS[(hashStr(bot.id) >> 3) % PLAYER_COLORS.length] }, dt);
    }
    stage.chars.end();
    stage.tags.end();
    stage.fx.update(dt, NaN, stage.camera.position, false);
    this.skyK += (0 - this.skyK) * Math.min(1, dt * 3);
    stage.applySky(skyMix([], 0, this.mixObj));
    stage.setWater(SEA, 0.6);
    stage.setUnderwater(false);
    stage.render();
    this.hud.showTitle(true);
    this.hud.setTop(false, {});
    this.hud.setLobby(false);
    this.hud.hideStat();
    this.hud.countdown(null);
    this.audio.setLevel(0);
    this.audio.weather(0, 0, 0, 0.5);
  }

  /** Draws everyone: me, the other players from presence, the bots. Fills lastPoses for the spectating camera. */
  collect(dt, px, py, pz) {
    const stage = this.stage, room = this.room, g = this.g, tags = stage.tags, chars = stage.chars;
    chars.begin();
    tags.begin();
    this.lastPoses.clear();
    const inMatch = !!g && this.phase !== 'lobby' && this.phase !== 'starting';
    const tRun = this.tRun;
    // me
    const drawMe = this.mode === 'play' && (!inMatch || this.slot >= 0) && !room.spectating;
    if (drawMe) {
      const b = this.body;
      const out = this.out ? (tRun - this.out.at) / 1000 : -1;
      this.pushChar(this.me.id, {
        x: px, y: py, z: pz, yaw: b.yaw, speed: b.speed, flags: (b.sprinting ? 1 : 0) | (b.onGround ? 0 : 2) | (b.climbing ? 4 : 0) | (b.wet ? 8 : 0),
        out, cause: this.out ? this.out.cause : '', me: true, ph: this.phaseAcc,
      }, dt);
      this.lastPoses.set(this.me.id, { x: px, y: py, z: pz, yaw: b.yaw });
    }
    // other players
    for (const p of room.players.values()) {
      if (p.id === this.me.id) continue;
      if (inMatch && !g.roster.some((r) => r.id === p.id)) continue;
      const pa = room.presenceAt(p.id, { angles: ['r'], snap: 6 });
      if (!pa || !finite(pa.x) || !finite(pa.y) || !finite(pa.z)) continue;
      const raw = p.presence;
      let out = -1, cause = '';
      if (inMatch && raw && raw.q === g.rid && raw.o > 0 && CAUSES[raw.o]) {
        out = (tRun - (finite(raw.ot) ? raw.ot : tRun)) / 1000;
        cause = CAUSES[raw.o];
      } else if (inMatch && g.outs[p.id]) {
        out = (tRun - g.outs[p.id][0]) / 1000;
        cause = CAUSES[g.outs[p.id][1]] || 'meteor';
      }
      this.pushChar(p.id, { x: pa.x, y: pa.y, z: pa.z, yaw: finite(pa.r) ? pa.r : 0, speed: finite(pa.s) ? pa.s : 0, flags: finite(pa.f) ? Math.round(pa.f) : 0, out, cause, away: p.connected === false }, dt);
      if (out < 0) this.lastPoses.set(p.id, { x: pa.x, y: pa.y, z: pa.z, yaw: pa.r || 0 });
    }
    // bots
    if (inMatch) {
      if (this.director && room.isHost && this.director.sim && this.director.rid === this.rid) {
        for (const bot of this.director.sim.bots) {
          const o = bot.out;
          this.pushBody(bot.id, bot.body, o, { name: this.nameOf(bot.id), tag: true, color: this.colorOf(bot.id), out: o ? (tRun - o.at) / 1000 : -1 }, dt);
          if (!o) this.lastPoses.set(bot.id, { x: bot.body.x, y: bot.body.y, z: bot.body.z, yaw: bot.body.yaw });
        }
      } else {
        const tmp = this.botTmp || (this.botTmp = {});
        for (const r of g.roster) {
          if (!r.b) continue;
          const pose = this.botPose(r.id, tmp);
          if (!pose) continue;
          const o = pose.cause > 0 ? (tRun - pose.at) / 1000 : g.outs[r.id] ? (tRun - g.outs[r.id][0]) / 1000 : -1;
          const cause = pose.cause > 0 ? CAUSES[pose.cause] : g.outs[r.id] ? CAUSES[g.outs[r.id][1]] : '';
          this.pushChar(r.id, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, speed: pose.speed, flags: pose.flags, out: o, cause }, dt);
          if (o < 0) this.lastPoses.set(r.id, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
        }
      }
    }
    chars.end();
    tags.end();
  }

  /** Converts a simulation body (host bots, title bots) into a drawn character. */
  pushBody(id, body, out, opt, dt) {
    let s = this.botSmooth.get(id);
    if (!s) {
      s = { x: body.x, y: body.y, z: body.z };
      this.botSmooth.set(id, s);
    }
    const k = 1 - Math.exp(-dt * 40);
    s.x += (body.x - s.x) * k;
    s.y += (body.y - s.y) * k;
    s.z += (body.z - s.z) * k;
    if (Math.abs(body.x - s.x) > 3 || Math.abs(body.z - s.z) > 3) {
      s.x = body.x;
      s.y = body.y;
      s.z = body.z;
    }
    const x = out ? out.x : s.x, y = out ? out.y : s.y, z = out ? out.z : s.z;
    this.pushChar(id, {
      x, y, z, yaw: body.yaw, speed: body.speed, flags: (body.sprinting ? 1 : 0) | (body.onGround ? 0 : 2) | (body.climbing ? 4 : 0) | (body.wet ? 8 : 0),
      out: opt.out === undefined ? -1 : opt.out, cause: out ? out.cause : '', tag: opt.tag, name: opt.name, color: opt.color,
    }, dt);
  }

  pushChar(id, d, dt) {
    const stage = this.stage;
    let r = this.remotes.get(id);
    if (!r) {
      r = { phase: 0 };
      this.remotes.set(id, r);
    }
    const fl = d.flags | 0;
    r.phase += (d.speed || 0) * dt * 0.85;
    const color = d.color !== undefined ? d.color : this.colorOf(id);
    const skin = SKIN[hashStr(id) % SKIN.length];
    const cap = hashStr(id + 'c') % 3 === 0 ? 0xeeeeee : shade(color, 0.5);
    const knocked = d.out >= 0;
    // the world's ground (or roof) under the character, for the blob shadow
    const gy = this.world.groundAt(d.x, d.z, d.y + 0.5);
    stage.chars.add({
      x: d.x, y: d.y, z: d.z, yaw: d.yaw || 0, speed: d.speed || 0, phase: d.me ? d.ph : r.phase, air: !!(fl & 2), climb: !!(fl & 4), swim: !!(fl & 8), sprint: !!(fl & 1),
      color, skin, capColor: cap, gy: gy > -1e8 ? gy : d.y, out: knocked ? d.out : -1, cause: d.cause, key: id, me: !!d.me,
      arrow: !!d.me && (this.phase === 'warn' || this.phase === 'lobby' || this.phase === 'starting') && !this.out, pulse: this.time,
    });
    if (d.tag === false || knocked) return;
    const cam = stage.camera.position;
    const dist = Math.hypot(d.x - cam.x, d.y - cam.y, d.z - cam.z);
    const p = this.room.players.get(id);
    stage.tags.add({
      x: d.x, y: d.y + 2.3, z: d.z, name: d.name !== undefined ? d.name : this.nameOf(id), color, img: this.avatarFor(id).img,
      ready: !!(p && p.ready) && (this.phase === 'lobby' || this.phase === 'starting'), me: !!d.me, dist,
    });
  }

  // ------------------------------------------------------------------------------------------------------- sky, HUD, sound

  updateSky(dt) {
    const stage = this.stage, round = this.round, phase = this.phase, g = this.g;
    let target = 0;
    if (round) {
      this.skyKinds = round.kinds;
      if (phase === 'warn') target = clamp(1 - -this.tRun / WARN_MS, 0, 1);
      else if (phase === 'run') target = 1;
      else if (phase === 'result' && g) target = clamp(1 - (this.room.matchNow() - g.endAt) / 3000, 0, 1);
    }
    this.skyK += (target - this.skyK) * Math.min(1, dt * 3.2);
    if (this.skyK < 0.002 && target === 0) {
      this.skyK = 0;
      this.skyKinds = [];
    }
    const key = `${this.skyKinds.join('+')}:${Math.round(this.skyK * 400)}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      stage.applySky(skyMix(this.skyKinds, this.skyK, this.mixObj));
    }
    // the sea: a flood raises it exactly with the clock, and it drains afterwards
    let wl = SEA;
    if (round && round.has.flood && (phase === 'warn' || phase === 'run')) wl = floodLevel(this.tRun);
    if (wl >= this.waterVis) this.waterVis = wl;
    else this.waterVis = Math.max(wl, this.waterVis - 7 * dt);
    const stormy = round && (round.has.flood || round.has.tornado) && (phase === 'run' || phase === 'warn') ? 1.4 : 0.6;
    stage.setWater(this.waterVis, stormy);
    const under = stage.camera.position.y < this.waterVis - 0.05;
    stage.setUnderwater(under);
    this.hud.underwater(under);
    this.hud.vignette(phase === 'warn' && !this.reduced);
  }

  updateHud(dt, ms, covered) {
    const hud = this.hud, g = this.g, room = this.room, phase = this.phase, now = room.matchNow();
    const b = this.body;
    // countdown from the room's start time
    const m = room.match;
    if (m.phase === 'starting' && finite(m.startsAt)) {
      const left = m.startsAt - this.ow.now();
      const n = Math.ceil(left / 1000);
      if (n >= 1 && n <= 3) {
        if (this.cdLast !== n) {
          this.cdLast = n;
          hud.countdown(n);
          this.audio.countdown(n);
        }
      } else if (n < 1 && this.cdLast !== 0) {
        this.cdLast = 0;
        hud.countdown('GO');
        this.audio.countdown(0);
      }
    } else if (m.phase !== 'playing' && this.cdLast !== null) {
      this.cdLast = null;
      hud.countdown(null);
    }

    const inLobby = phase === 'lobby' || phase === 'starting';
    hud.setLobby(inLobby && this.mode === 'play', { value: Number(room.settings.rounds) || 5, host: room.isHost && phase === 'lobby', options: [3, 5, 8] });
    const spectating = room.spectating || (this.slot < 0 && !!g && !inLobby);
    if (!g || inLobby || phase === 'wait') {
      hud.setTop(false, {});
      hud.hideStat();
      hud.watching(phase === 'wait' && room.spectating, '');
      this.audio.setLevel(0);
      this.goneRun = false;
      return this.applyControls();
    }
    const entry = this.round;
    const kinds = entry ? entry.kinds : [];
    const timerSecs = phase === 'warn' ? Math.max(0, Math.ceil((g.runAt - now) / 1000)) : phase === 'run' ? Math.max(0, Math.ceil((g.endAt - now) / 1000)) : 0;
    const showTop = phase === 'warn' || phase === 'run';
    hud.setTop(showTop && kinds.length > 0, {
      kinds, round: g.n, rounds: g.rounds, timer: timerSecs, warn: phase === 'warn',
      frac: phase === 'warn' ? clamp((g.runAt - now) / WARN_MS, 0, 1) : phase === 'run' ? clamp((g.endAt - now) / Math.max(1, g.endAt - g.runAt), 0, 1) : null,
    });
    const alive = g.roster.filter((r) => !g.outs[r.id]).length;
    const wetNow = this.round && this.round.has.flood && this.tRun > 0 && (this.hs.breath < 3.99 || b.wet);
    hud.setStat(phase !== 'final', {
      alive, total: g.roster.length, score: g.scores[this.me.id] ?? 0,
      breath: !spectating && !this.out && wetNow ? this.hs.breath / 4 : null,
      health: !spectating && !this.out && this.round && this.round.has.acid && this.tRun > 0 ? this.hs.health / 100 : null,
      stamina: b.stamina, exhausted: b.exhausted, showStamina: !spectating && !this.out && (phase === 'warn' || phase === 'run'),
    });
    hud.hurt(this.round && this.round.has.acid && !this.out && this.tRun > 0 ? clamp((100 - this.hs.health) / 70, 0, 0.9) : 0);
    // spectating label
    const watchingNow = (this.out || room.spectating || this.slot < 0) && (phase === 'warn' || phase === 'run' || phase === 'result');
    hud.watching(watchingNow, watchingNow ? (this.followId ? this.nameOf(this.followId) : '') : '');

    // the banner goes shortly after the run begins
    if (phase === 'run' && !this.goneRun) {
      this.goneRun = true;
      hud.clearBanner(false);
      this.audio.whoosh(0.7);
      if (!this.out && this.slot >= 0) hud.callout('SURVIVE', '', 'good', 900);
    }
    if (phase === 'warn' && this.round && !hud.bannerEl && !this.bannerGone && this.tRun > -WARN_MS + 200) {
      // joined during the warning (or the banner was cleared): show it once
      this.bannerGone = true;
      hud.banner(this.round.kinds);
    }
    // others going out
    if (this.outsRef !== g.outs) {
      this.outsRef = g.outs;
      for (const id of Object.keys(g.outs)) {
        if (this.knownOuts.has(id)) continue;
        this.knownOuts.add(id);
        if (id === this.me.id) continue;
        if (phase === 'warn' || phase === 'run') {
          hud.feed(`${this.nameOf(id)} OUT`, false);
          this.audio.out(true);
        }
      }
    }
    // a round's result
    if (g.res && g.res.n === g.n && this.settledRid !== g.rid) {
      this.settledRid = g.rid;
      this.onSettled(g);
    }
    if (g.fin && this.finalMid !== g.mid) {
      this.finalMid = g.mid;
      this.onFinal(g);
    }
    this.audio.setLevel(phase === 'warn' ? 1 : phase === 'run' ? 2 : phase === 'final' ? -1 : 0);
    this.applyControls();
  }

  onSettled(g) {
    const hud = this.hud;
    const ok = new Set(g.res.ok);
    const mine = ok.has(this.me.id);
    const inRoster = g.roster.some((r) => r.id === this.me.id);
    const entries = g.roster.map((r) => ({
      name: this.nameOf(r.id), color: PLAYER_COLORS[r.c % PLAYER_COLORS.length], url: this.avatarFor(r.id).url, me: r.id === this.me.id, out: !ok.has(r.id), survived: ok.has(r.id),
    }));
    entries.sort((a, b) => (b.survived ? 1 : 0) - (a.survived ? 1 : 0));
    hud.clearBanner(true);
    hud.clearCallout();
    hud.survivors({
      entries: entries.filter((e) => e.survived),
      you: inRoster ? (mine ? 'YOU SURVIVED  +1' : 'ELIMINATED') : '',
      good: mine,
    });
    if (mine) {
      this.audio.survive();
      this.stage.fx.confetti(this.body.x, this.body.y + 2, this.body.z, 30);
      this.award('survivor');
      const kinds = this.round ? this.round.kinds : [];
      if (kinds.includes('tornado')) this.award('storm-chaser');
    } else if (inRoster) this.audio.lose();
    this.stage.rig.dist = 9;
  }

  onFinal(g) {
    const hud = this.hud;
    const rk = ranking(g);
    const mineIdx = rk.findIndex((r) => r.id === this.me.id);
    const top = rk.slice(0, 3).map((r) => ({
      name: this.nameOf(r.id), color: this.colorOf(r.id), url: this.avatarFor(r.id).url, score: r.score, place: r.place, me: r.id === this.me.id,
    }));
    const mine = mineIdx >= 0 ? rk[mineIdx] : null;
    const untouched = g.roster.filter((r) => (g.scores[r.id] ?? 0) === g.rounds).map((r) => (r.id === this.me.id ? 'YOU' : this.nameOf(r.id).toUpperCase()));
    const win = !!mine && mine.place === 1 && mine.score > 0;
    hud.clearBanner(true);
    hud.clearCallout();
    hud.podium({
      title: 'RESULTS',
      top,
      you: mine && mine.place > 3 ? `YOU: ${ordinal(mine.place)}` : win ? 'YOU WIN' : '',
      youGood: win,
      awards: untouched.length ? [`UNTOUCHED: ${untouched.slice(0, 3).join(', ')}`] : [],
    });
    if (win) {
      this.audio.win();
      this.stage.fx.confetti(this.body.x, this.body.y + 2.5, this.body.z, 90);
    } else this.audio.podium();
    this.finish(g, mine);
  }

  /** Saves stats, awards badges and posts the leaderboard: once per match. */
  finish(g, mine) {
    if (this.savedMid === g.mid || !mine) return;
    this.savedMid = g.mid;
    const s = this.stats;
    s.matches = (s.matches || 0) + 1;
    s.rounds = (s.rounds || 0) + g.rounds;
    s.survived = (s.survived || 0) + mine.score;
    if (mine.score === g.rounds) this.award('untouchable');
    if (mine.score > 0) this.award('survivor');
    if (mine.place === 1 && mine.score > 0) {
      s.wins = (s.wins || 0) + 1;
      this.award('first-win');
      Promise.resolve(this.ow.leaderboards.submit('wins', s.wins)).catch(() => {});
    }
    Promise.resolve(this.ow.save.set('stats', s)).catch(() => {});
  }

  award(id) {
    this.awarded = this.awarded || new Set();
    if (this.awarded.has(id)) return;
    this.awarded.add(id);
    Promise.resolve(this.ow.badges.award(id)).catch(() => {});
  }

  onMatchEnd() {
    // back to the lobby: the results card stays up for a few seconds over it
    this.rid = null;
    this.round = null;
    this.g = null;
    this.stage.fx.setRound(null);
    this.settledRid = null;
    this.goneRun = false;
    this.knownOuts = new Set();
    this.bsnaps = [];
    this.followId = null;
    this.slot = -1;
    if (this.mode === 'play') {
      this.spawnLobby();
      this.room.hideLobby(false);
    }
    this.hud.clearBanner(true);
    this.hud.clearCallout();
    this.audio.stopSiren();
    this.audio.setLevel(0);
    setTimeout(() => {
      if (this.phase === 'lobby' || this.phase === 'starting') this.hud.hidePanel();
    }, 7000);
    this.applyControls();
  }

  applyControls() {
    const phase = this.phase;
    const inLobby = phase === 'lobby' || phase === 'starting';
    const want = this.mode === 'play' && !this.out && !this.closed && (inLobby || ((phase === 'warn' || phase === 'run') && this.slot >= 0));
    if (this.controlsOn === want) return;
    this.controlsOn = want;
    try {
      this.ow.controls.set(want ? CONTROLS : null);
    } catch {
      // never throw into the game
    }
  }

  onImpact(kind, x, y, z, power) {
    const cam = this.stage.camera.position;
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const p = clamp(1 - d / 70, 0, 1) * power;
    if (p <= 0.02) return;
    if (kind === 'meteor' || kind === 'ball') {
      this.audio.impact(p, kind === 'ball');
      this.stage.rig.addTrauma(0.6 * p);
    } else if (kind === 'debris') {
      this.audio.chunk();
      this.stage.rig.addTrauma(0.25 * p);
    } else if (kind === 'erupt') {
      this.audio.whoosh(p);
      this.stage.rig.addTrauma(0.2 * p);
    }
  }

  audioMix(dt, cam) {
    const round = this.round, phase = this.phase;
    const live = round && (phase === 'warn' || phase === 'run') && this.tRun > -WARN_MS;
    let wind = 0, rain = 0, rumble = 0, sea = 0.3;
    if (live) {
      const ramp = clamp((this.tRun + 5000) / 5000, 0, 1);
      if (round.has.tornado) {
        const tp = tornadoAt(round, this.tRun, this.tornadoTmp || (this.tornadoTmp = { x: 0, z: 0, dist: 0 }));
        const d = Math.hypot(cam.x - tp.x, cam.z - tp.z);
        wind = clamp(1 - d / 60, 0, 1) * ramp + 0.12;
        if (d < TORNADO.pull + 10) this.stage.rig.addTrauma(dt * 0.35 * (1 - d / (TORNADO.pull + 10)));
      }
      if (round.has.acid) rain = ramp * (this.world.covered(this.body.x, this.body.y, this.body.z) ? 0.4 : 1);
      if (round.has.flood) {
        rain = Math.max(rain, 0.25 * ramp);
        sea = 0.8;
        wind = Math.max(wind, 0.2 * ramp);
      }
      if (round.has.quake) rumble = clamp((this.tRun + 500) / 1500, 0, 1) * 0.9;
      if (round.has.volcano) rumble = Math.max(rumble, 0.45 * ramp);
    }
    this.audio.weather(wind, rain, rumble, sea);
  }

  perfGovernor(dt) {
    const ow = this.ow;
    if (ow.settings.choice !== 'auto') {
      if (this.perf.scale !== 1) {
        this.perf.scale = 1;
        this.resize();
      }
      return;
    }
    const p = this.perf;
    p.sum += dt;
    p.n++;
    if (p.n < 90) return;
    const avg = p.sum / p.n;
    p.sum = 0;
    p.n = 0;
    if (avg > 0.025 && p.scale > 0.6) {
      p.scale = Math.max(0.6, p.scale - 0.1);
      p.good = 0;
      this.resize();
    } else if (avg < 0.0185) {
      p.good++;
      if (p.good >= 3 && p.scale < 1) {
        p.scale = Math.min(1, p.scale + 0.05);
        p.good = 0;
        this.resize();
      }
    } else p.good = 0;
  }
}

