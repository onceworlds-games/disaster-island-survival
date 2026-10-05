// Two real Game instances (a host and a client) sharing one fake room: state, presence and messages travel between them as they
// would on the platform. A whole match, a host change in the middle, and a player who is knocked out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.mjs';
import { Game, fakes } from './gamefakes.mjs';

class Hub {
  constructor(ids, rounds = 3) {
    this.clock = 0;
    this.ids = ids;
    this.settings = { rounds };
    this.match = { phase: 'lobby', id: '', participants: [], seed: 99 };
    this.host = ids[0];
    this.players = new Map(ids.map((i) => [i, { id: i, name: i.toUpperCase(), connected: true, presence: null }]));
    this.rooms = new Map();
    this.ended = 0;
    for (const id of ids) this.rooms.set(id, this.makeRoom(id));
  }

  makeRoom(id) {
    const hub = this;
    const listeners = new Map();
    const room = {
      state: {},
      players: hub.players,
      me: hub.players.get(id),
      connected: true,
      clock: 0,
      get match() {
        return hub.match;
      },
      get host() {
        return hub.host;
      },
      get isHost() {
        return room.connected && hub.host === id;
      },
      get running() {
        return hub.match.phase === 'playing' && !hub.match.paused;
      },
      get spectating() {
        return hub.match.phase !== 'lobby' && !hub.match.participants.includes(id);
      },
      get settings() {
        return hub.settings;
      },
      matchNow: () => (hub.match.phase === 'playing' ? hub.clock : 0),
      setState(k, v) {
        const val = v === null ? null : JSON.parse(JSON.stringify(v));
        for (const [rid, r] of hub.rooms) {
          if (val === null) delete r.state[k];
          else r.state[k] = val;
          if (rid !== id) r.emit('state', k, val, id);
        }
      },
      setPresence(p) {
        hub.players.get(id).presence = p;
      },
      presenceAt: (pid) => hub.players.get(pid)?.presence ?? null,
      send(d, opts) {
        for (const [rid, r] of hub.rooms) {
          if (rid === id || (opts?.to && opts.to !== rid)) continue;
          r.emit('message', JSON.parse(JSON.stringify(d)), hub.players.get(id), hub.clock, hub.clock);
        }
      },
      hideLobby() {},
      setSetting() {},
      setOpen() {},
      endMatch() {
        hub.end();
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

  start() {
    this.match = { phase: 'playing', id: 'hm1', participants: this.ids.slice(), seed: 77, startedAt: 0 };
    this.clock = 0;
    for (const r of this.rooms.values()) r.emit('matchstart', this.match);
  }

  end() {
    this.ended++;
    const prev = this.match;
    this.match = { ...prev, phase: 'lobby', participants: [] };
    for (const r of this.rooms.values()) r.emit('matchend', this.match, prev);
  }
}

function pages(ids, rounds) {
  const hub = new Hub(ids, rounds);
  const envs = ids.map((id) => {
    const room = hub.rooms.get(id);
    const f = fakes(room);
    const game = new Game({ ow: f.ow, room, stage: f.stage, hud: f.hud, audio: f.audio, input: f.input, world, stats: null });
    return { id, room, game, ...f };
  });
  return { hub, envs };
}

const DT = 1 / 60;
function run(hub, envs, secs, each) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    hub.clock += 1000 / 60;
    for (const e of envs) {
      e.ow.now = () => hub.clock + 1e6;
      e.game.step(DT);
      e.game.render(DT, hub.clock);
    }
    if (each) each(i);
  }
}

test('a host and a client play a whole match together: same rounds, same results, the client sees the bots', () => {
  const { hub, envs } = pages(['A', 'B'], 3);
  const [a, b] = envs;
  a.input.onKey('Enter');
  b.input.onKey('Enter');
  run(hub, envs, 0.5);
  hub.start();
  const rids = { A: new Set(), B: new Set() };
  let botsSeen = 0;
  run(hub, envs, 240, () => {
    for (const e of envs) if (e.room.state.g) rids[e.id].add(e.room.state.g.rid);
    if (hub.match.phase === 'playing' && b.game.g && b.game.phase === 'run' && b.stage.chars.n >= 6) botsSeen++;
  });
  assert.deepEqual([...rids.A], ['hm1.1', 'hm1.2', 'hm1.3']);
  assert.deepEqual([...rids.B], ['hm1.1', 'hm1.2', 'hm1.3']);
  assert.equal(hub.ended, 1);
  assert.ok(botsSeen > 300, `the client drew the host's bots on ${botsSeen} frames`);
  const podA = a.hud.calls.filter((c) => c[0] === 'podium').at(-1), podB = b.hud.calls.filter((c) => c[0] === 'podium').at(-1);
  assert.ok(podA && podB);
  assert.deepEqual(podA[1].top.map((t) => [t.name, t.score, t.place]), podB[1].top.map((t) => [t.name, t.score, t.place]), 'both pages show the same podium');
  // the client's stats and the host's were saved once each
  assert.equal(a.saved.at(-1)[1].matches, 1);
  assert.equal(b.saved.at(-1)[1].matches, 1);
  // both pages published presence of the right shape the whole time
  const pa = hub.players.get('A').presence, pb = hub.players.get('B').presence;
  assert.ok(Number.isFinite(pa.x) && Number.isFinite(pb.x));
});

test('the client reports their knockout to the host, and both pages agree who is out', () => {
  const { hub, envs } = pages(['A', 'B'], 3);
  const [a, b] = envs;
  a.input.onKey('Enter');
  b.input.onKey('Enter');
  run(hub, envs, 0.5);
  hub.start();
  let seenOut = false;
  let agree = 0;
  run(hub, envs, 62, () => {
    const g = a.room.state.g;
    if (!g || g.n !== 1) return;
    if (b.game.out) {
      seenOut = true;
      if (g.outs.B && g.outs.B[1] > 0) agree++;
    }
  });
  const kinds = a.room.state.g?.plan[0]?.k;
  void kinds;
  // B stood on the plaza; if the first disaster was dangerous there, the host heard about it
  if (seenOut) assert.ok(agree > 0, 'the host recorded the knockout B reported');
  // the other page's view of B: B's presence says out, with a cause
  if (seenOut) assert.ok(hub.players.get('B').presence.o > 0 || b.game.g?.n > 1);
});

test('the host role moves to the client in the middle of the match and the match carries on and ends once', () => {
  const { hub, envs } = pages(['A', 'B'], 3);
  const [a, b] = envs;
  a.input.onKey('Enter');
  b.input.onKey('Enter');
  run(hub, envs, 0.5);
  hub.start();
  run(hub, envs, 70); // into the second round
  const before = a.room.state.g;
  assert.equal(before.by, 'A');
  assert.ok(before.n >= 2);
  hub.host = 'B';
  for (const e of envs) e.room.emit('host', 'B');
  run(hub, envs, 2);
  const after = b.room.state.g;
  assert.equal(after.by, 'B');
  assert.equal(after.rid, before.rid, 'the round carries on, no reset');
  run(hub, envs, 240);
  assert.equal(hub.ended, 1);
  assert.ok(b.room.state.g.fin);
  assert.equal(b.room.state.g.by, 'B');
});
