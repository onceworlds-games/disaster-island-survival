// Drives the real Game (the client) end to end with a fake room, fake HUD, fake audio and a stage that has the real characters,
// effects and camera but no renderer: a whole match from the title screen to the podium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.mjs';
import { Game, fakes } from './gamefakes.mjs';

function fakeRoom(ids, rounds = 3) {
  const players = new Map(ids.map((id) => [id, { id, name: id.toUpperCase(), connected: true, presence: null }]));
  const listeners = new Map();
  const room = {
    clock: 0,
    host: ids[0],
    me: players.get(ids[0]),
    players,
    state: {},
    settings: { rounds },
    match: { phase: 'lobby', id: '', participants: [], seed: 4321 },
    ended: 0,
    connected: true,
    sent: [],
    hidden: [],
    setCalls: [],
    get isHost() {
      return this.connected && this.host === this.me.id;
    },
    get running() {
      return this.match.phase === 'playing' && !this.match.paused;
    },
    get spectating() {
      return this.match.phase !== 'lobby' && !this.match.participants.includes(this.me.id);
    },
    matchNow() {
      return this.match.phase === 'playing' ? this.clock : 0;
    },
    setState(k, v) {
      if (v === null) delete this.state[k];
      else this.state[k] = JSON.parse(JSON.stringify(v));
    },
    setPresence(p) {
      this.me.presence = p;
    },
    presenceAt(id) {
      return players.get(id)?.presence ?? null;
    },
    send(d, o) {
      this.sent.push([d, o]);
    },
    hideLobby(v = true) {
      this.hidden.push(v);
    },
    setSetting(id, v) {
      this.setCalls.push([id, v]);
      this.settings = { ...this.settings, [id]: v };
    },
    setOpen() {},
    endMatch() {
      this.ended++;
      const prev = this.match;
      this.match = { ...prev, phase: 'lobby', participants: [] };
      this.emit('matchend', this.match, prev);
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    emit(ev, ...a) {
      for (const f of listeners.get(ev) ?? []) f(...a);
    },
  };
  return room;
}

function setup(ids = ['me', 'p2'], rounds = 3, meId = ids[0]) {
  const room = fakeRoom(ids, rounds);
  room.me = room.players.get(meId);
  const f = fakes(room);
  const game = new Game({ ow: f.ow, room, stage: f.stage, hud: f.hud, audio: f.audio, input: f.input, world, stats: null });
  return { room, game, ...f };
}

const DT = 1 / 60;
function frames(env, secs, each) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    env.room.clock += 1000 / 60;
    env.game.step(DT);
    env.game.render(DT, env.room.clock);
    if (each) each(i);
  }
}

function startMatch(env) {
  const { room, game } = env;
  const ids = [...room.players.keys()];
  room.match = { phase: 'starting', id: 'mm1', participants: ids, seed: 777, startsAt: env.ow.now() + 3000 };
  room.emit('starting', room.match);
  frames(env, 3.05);
  room.match = { phase: 'playing', id: 'mm1', participants: ids, seed: 777, startedAt: 0 };
  room.clock = 0;
  room.emit('matchstart', room.match);
  void game;
}

test('the title screen: nothing is sent, controls are off, Play (or Enter) goes to the lobby with controls on', () => {
  const env = setup();
  frames(env, 1);
  assert.equal(env.game.mode, 'title');
  assert.equal(env.room.me.presence, null, 'nobody is told about a player on the title screen');
  assert.ok(env.hud.calls.some((c) => c[0] === 'showTitle' && c[1] === true));
  env.input.onKey('Enter');
  assert.equal(env.game.mode, 'play');
  frames(env, 0.5);
  assert.equal(env.controls.at(-1)?.stick, 'analog');
  assert.deepEqual(env.controls.at(-1).buttons.map((b) => b.id), ['jump', 'sprint']);
  assert.equal(env.room.hidden.at(-1), false, 'the lobby strip is back');
  const p = env.room.me.presence;
  assert.ok(p && Number.isFinite(p.x) && Number.isFinite(p.z) && p.o === 0);
  assert.ok(env.tagCalls.length >= 1, 'a name tag above me');
  const lobbyCall = env.hud.calls.filter((c) => c[0] === 'setLobby').at(-1);
  assert.equal(lobbyCall[1], true);
  assert.equal(lobbyCall[2].value, 3);
  assert.equal(lobbyCall[2].host, true);
});

test('walking in the lobby moves the body and publishes it', () => {
  const env = setup(['me']);
  env.input.onKey('Space');
  frames(env, 0.3);
  const x0 = env.game.body.x, z0 = env.game.body.z;
  env.keys.move.y = 1;
  frames(env, 1.5);
  assert.ok(Math.hypot(env.game.body.x - x0, env.game.body.z - z0) > 5, 'moved');
  assert.ok(env.game.body.speed > 6);
  assert.ok(env.audio.calls.some((c) => c[0] === 'step'), 'footsteps');
  env.keys.jump = true;
  frames(env, 0.2);
  env.keys.jump = false;
  assert.ok(env.audio.calls.some((c) => c[0] === 'jump'));
  assert.ok(env.room.me.presence.s > 5);
});

test('a whole match from the countdown to the podium: banner, siren, knockout, survivors, results, badges, stats', () => {
  const env = setup(['me', 'p2'], 3);
  env.input.onKey('Enter');
  frames(env, 0.5);
  startMatch(env);
  const g0 = () => env.room.state.g;
  frames(env, 0.3);
  assert.ok(g0(), 'the host wrote the record');
  assert.equal(g0().roster.length, 8);
  assert.equal(env.game.slot, 0);
  assert.ok(env.hud.calls.some((c) => c[0] === 'banner'), 'the announcement');
  assert.ok(env.audio.calls.some((c) => c[0] === 'siren'));
  assert.ok(env.hud.calls.some((c) => c[0] === 'countdown'));
  // p2 is a remote human who just stands there; me stands still too and will be knocked out by whatever comes
  env.room.players.get('p2').presence = { x: 3, y: 0, z: 3, r: 0, s: 0, f: 0, q: g0().rid, o: 0, ot: 0 };
  const seen = new Set();
  const causes = [];
  let finAt = -1;
  frames(env, 240, (i) => {
    const g = g0();
    if (g) seen.add(`${g.rid}`);
    if (env.game.out && !causes.includes(env.game.out.cause + g.n)) causes.push(env.game.out.cause + g.n);
    if (g && g.fin && finAt < 0) finAt = i;
    // the match ends by itself: stop when the room is back in the lobby
    if (env.room.match.phase === 'lobby') return;
  });
  assert.deepEqual([...seen], ['mm1.1', 'mm1.2', 'mm1.3']);
  assert.equal(env.room.ended, 1);
  assert.ok(env.hud.calls.some((c) => c[0] === 'survivors'), 'survivors shown');
  const pod = env.hud.calls.filter((c) => c[0] === 'podium').at(-1);
  assert.ok(pod && pod[1].top.length === 3 && pod[1].title === 'RESULTS');
  assert.ok(pod[1].top[0].place === 1);
  assert.ok(causes.length >= 1, 'standing still gets you knocked out in some round');
  // reported to the host: it is the host, so it recorded the knockout itself
  assert.ok(env.saved.length >= 1 && env.saved[0][0] === 'stats' && env.saved[0][1].matches === 1);
  assert.ok(env.audio.calls.some((c) => c[0] === 'ko'));
  assert.ok(env.hud.calls.some((c) => c[0] === 'callout' && c[1] === 'ELIMINATED'));
  // after the match the results card stays over the lobby and the controls come back
  frames(env, 0.5);
  assert.equal(env.game.phase, 'lobby');
  assert.equal(env.controls.at(-1)?.stick, 'analog');
  assert.equal(env.game.slot, -1);
});

test('a player who is not the host reports their own knockout to the host, and the report is repeated until it is heard', () => {
  const env = setup(['host', 'me'], 3, 'me');
  env.input.onKey('Enter');
  frames(env, 0.3);
  const { room } = env;
  const ids = ['host', 'me'];
  room.match = { phase: 'playing', id: 'x1', participants: ids, seed: 5, startedAt: 0 };
  room.clock = 0;
  // the host's page wrote this (here: built by the same rules)
  // eslint-disable-next-line no-undef
  return import('../src/sim/rules.js').then(({ buildRoster, newMatch, startRound }) => {
    const roster = buildRoster(ids, 5);
    let g = newMatch({ mid: 'x1', by: 'host', seed: 5, rounds: 3, roster });
    g = startRound(g, 1, 0);
    room.state.g = JSON.parse(JSON.stringify(g));
    room.emit('matchstart', room.match);
    // wait for a hazard to catch the player who is standing still
    const kinds = g.plan[0].k;
    frames(env, 6 + 48, () => {});
    assert.ok(env.game.out || !(kinds.includes('flood') || kinds.includes('meteor')), `${kinds}: standing on the plaza should be fatal`);
    if (env.game.out) {
      const msgs = room.sent.filter(([d]) => d && d.t === 'out');
      assert.ok(msgs.length >= 2, `report sent ${msgs.length} times while unanswered`);
      const [d, o] = msgs[0];
      assert.equal(d.rid, 'x1.1');
      assert.ok(typeof d.cause === 'string' && Number.isFinite(d.tr));
      assert.equal(o.to, 'host');
      assert.ok(msgs.length <= 6);
      assert.equal(room.me.presence.o > 0, true);
    }
  });
});

test('a late arrival watches: no body, no controls, the camera follows a survivor', () => {
  const env = setup(['host', 'late'], 3, 'late');
  env.input.onKey('Enter');
  frames(env, 0.3);
  const { room } = env;
  room.match = { phase: 'playing', id: 'x2', participants: ['host'], seed: 9, startedAt: 0 };
  room.clock = 0;
  return import('../src/sim/rules.js').then(({ buildRoster, newMatch, startRound }) => {
    const roster = buildRoster(['host'], 9);
    let g = newMatch({ mid: 'x2', by: 'host', seed: 9, rounds: 3, roster });
    g = startRound(g, 1, 0);
    room.state.g = JSON.parse(JSON.stringify(g));
    room.state.b = { rid: g.rid, t: 100, p: Object.fromEntries(roster.filter((r) => r.b).map((r, i) => [r.id, [i, 0, 3, 0, 0, 0, 0, 0]])) };
    room.players.get('host').presence = { x: 1, y: 0, z: 1, r: 0, s: 0, f: 0, q: g.rid, o: 0, ot: 0 };
    room.emit('matchstart', room.match);
    frames(env, 3);
    assert.equal(env.game.slot, -1);
    assert.deepEqual(env.room.me.presence, { w: 1 }, 'a spectator publishes no body');
    assert.equal(env.controls.at(-1), null);
    assert.ok(env.hud.calls.some((c) => c[0] === 'watching' && c[1] === true));
    assert.ok(env.game.followId, 'follows someone');
    assert.ok(Number.isFinite(env.stage.camera.position.x));
  });
});

test('rendering never throws across pauses, host changes, closing and re-entering the lobby', () => {
  const env = setup(['me', 'p2']);
  env.input.onKey('Enter');
  frames(env, 0.3);
  startMatch(env);
  frames(env, 8);
  env.room.match.paused = { since: 0 };
  frames(env, 2);
  env.room.match.paused = null;
  frames(env, 3);
  env.room.host = 'p2';
  frames(env, 3);
  env.room.host = 'me';
  env.room.emit('host', 'me');
  frames(env, 5);
  env.room.connected = false;
  frames(env, 1);
  env.room.connected = true;
  env.room.emit('reconnect');
  frames(env, 2);
  env.room.emit('close', 'kicked');
  frames(env, 1);
  assert.ok(env.hud.calls.some((c) => c[0] === 'callout' && c[1] === 'REMOVED'));
});
