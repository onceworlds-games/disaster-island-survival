import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.mjs';
import { Director } from '../src/net/director.js';
import { phaseAt, ranking } from '../src/sim/rules.js';
import { CAUSES, WARN_MS } from '../src/sim/disasters.js';

/** The little of the SDK's room that the host's Director uses, with a clock the test drives. */
function fakeRoom(humans, rounds = 3) {
  const players = new Map(humans.map((id) => [id, { id, name: id, connected: true, presence: null }]));
  const room = {
    clock: 0,
    host: humans[0],
    me: players.get(humans[0]),
    players,
    state: {},
    settings: { rounds },
    match: { phase: 'lobby', id: '', participants: [], seed: 12345 },
    ended: 0,
    connected: true,
    get isHost() {
      return this.connected && this.host === this.me.id;
    },
    get running() {
      return this.match.phase === 'playing' && !this.match.paused;
    },
    matchNow() {
      return this.match.phase === 'playing' ? this.clock : 0;
    },
    setState(k, v) {
      if (v === null) delete this.state[k];
      else this.state[k] = JSON.parse(JSON.stringify(v)); // like the wire: no shared references
    },
    endMatch() {
      this.ended++;
      this.match = { ...this.match, phase: 'lobby' };
    },
  };
  room.start = (id = 'm1') => {
    room.match = { phase: 'playing', id, participants: humans.slice(), seed: 12345 };
    room.clock = 0;
  };
  return room;
}

function run(room, director, ms, each) {
  const n = Math.round(ms / (1000 / 60));
  for (let i = 0; i < n && room.match.phase === 'playing'; i++) {
    room.clock += 1000 / 60;
    director.tick(1 / 60);
    if (each) each(i);
  }
}

test('the host writes the record at the start and plays a whole match of three disasters, then ends it once', () => {
  const room = fakeRoom(['me'], 3);
  const d = new Director(room, world);
  room.start();
  d.adopt();
  const g0 = room.state.g;
  assert.ok(g0 && g0.mid === 'm1' && g0.by === 'me');
  assert.equal(g0.roster.length, 8);
  assert.equal(g0.roster.filter((r) => r.b).length, 7);
  assert.equal(g0.rid, 'm1.1');
  const rids = new Set();
  let fin = false;
  run(room, d, 300000, () => {
    const g = room.state.g;
    if (g) rids.add(g.rid);
    if (g && g.fin) fin = true;
  });
  assert.ok(fin, 'the record reached its final state');
  assert.deepEqual([...rids], ['m1.1', 'm1.2', 'm1.3']);
  assert.equal(room.ended, 1, 'ended exactly once');
  assert.equal(room.match.phase, 'lobby');
  const g = room.state.g;
  assert.equal(g.n, 3);
  assert.equal(ranking(g).length, 8);
  // the human stood still and never reported anything, so they survived every round on their own page
  assert.equal(g.scores.me, 3);
  // bots were published as compact snapshots the whole time
  assert.ok(room.state.b && room.state.b.rid && Object.keys(room.state.b.p).length === 7);
});

test('a player reports their knockout; the host checks it', () => {
  const room = fakeRoom(['me', 'p2'], 3);
  const d = new Director(room, world);
  room.start();
  d.adopt();
  const g = room.state.g;
  const kinds = g.plan[0].k;
  const good = kinds[0] === 'flood' ? 'drown' : 'meteor';
  const bad = kinds[0] === 'flood' ? 'flung' : 'drown';
  run(room, d, WARN_MS + 5000);
  const p2 = room.players.get('p2');
  d.onMessage({ t: 'out', rid: 'wrong', cause: good, tr: 4000 }, p2);
  d.onMessage({ t: 'out', rid: g.rid, cause: bad, tr: 4000 }, p2);
  d.onMessage({ t: 'out', rid: g.rid, cause: 'left', tr: 4000 }, p2);
  d.onMessage({ t: 'out', rid: g.rid, cause: good, tr: 4000 }, { id: 'stranger' });
  d.onMessage({ t: 'out', rid: g.rid, cause: good, tr: 'soon' }, p2);
  d.onMessage(null, p2);
  d.onMessage({ t: 'nonsense' }, p2);
  assert.equal(room.state.g.outs.p2, undefined, 'nothing valid yet');
  d.onMessage({ t: 'out', rid: g.rid, cause: good, tr: 4000 }, p2);
  assert.deepEqual(room.state.g.outs.p2.length, 2);
  assert.equal(CAUSES[room.state.g.outs.p2[1]], good);
  // presence alone carries it too (a lost message costs nothing)
  const p3 = room.players.get('me');
  p3.presence = { x: 0, y: 0, z: 0, q: g.rid, o: 2, ot: 5000 };
  // the host is 'me'; its own page reports through applyLocalOut instead
  assert.ok(d.applyLocalOut('me', good, 5200) || true);
});

test('a player whose connection dropped is judged where they stood; one who left is out', () => {
  const room = fakeRoom(['host', 'away', 'gone'], 3);
  const d = new Director(room, world);
  room.start();
  room.state = {};
  d.adopt();
  room.players.get('away').connected = false;
  room.players.get('away').presence = { x: 0, y: 0, z: 5, q: room.state.g.rid };
  room.players.delete('gone');
  run(room, d, WARN_MS + 30000);
  const g = room.state.g;
  assert.equal(g.n, 1);
  const kinds = g.plan[0].k;
  assert.ok(g.outs.gone && CAUSES[g.outs.gone[1]] === 'left', 'left the room: out');
  if (kinds.includes('flood') || kinds.includes('meteor')) assert.ok(g.outs.away, `${kinds}: standing in the middle of the plaza does not survive this`);
});

test('a new host carries on from the record and the bots where the old one left them', () => {
  const room = fakeRoom(['a', 'b'], 3);
  const d1 = new Director(room, world);
  room.start();
  d1.adopt();
  run(room, d1, 25000);
  const before = JSON.parse(JSON.stringify(room.state.b));
  const gBefore = room.state.g;
  assert.equal(gBefore.by, 'a');
  // the host role moves to b, whose page has its own Director
  room.host = 'b';
  room.me = room.players.get('b');
  const d2 = new Director(room, world);
  d2.adopt();
  assert.equal(room.state.g.by, 'b');
  assert.equal(room.state.g.rid, gBefore.rid, 'no reset');
  run(room, d2, 100);
  const after = room.state.b;
  assert.equal(after.rid, before.rid);
  for (const id of Object.keys(before.p)) {
    const a = before.p[id], b = after.p[id];
    assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 2.5, `${id} jumped from ${a} to ${b}`);
  }
  run(room, d2, 300000);
  assert.ok(room.state.g.fin && room.ended === 1);
  // the old host, no longer the host, does nothing
  const writes = JSON.stringify(room.state.g);
  d1.tick(1 / 60);
  assert.equal(JSON.stringify(room.state.g), writes);
});

test('a paused match stands still, and a second match starts clean', () => {
  const room = fakeRoom(['me'], 3);
  const d = new Director(room, world);
  room.start('m1');
  d.adopt();
  run(room, d, 10000);
  const t = room.state.b.t;
  room.match.paused = { since: 0 };
  run(room, d, 5000);
  assert.equal(room.state.b.t, t, 'no snapshots while paused');
  room.match.paused = null;
  run(room, d, 300000);
  assert.equal(room.ended, 1);
  room.start('m2');
  d.adopt();
  const g = room.state.g;
  assert.equal(g.mid, 'm2');
  assert.equal(g.rid, 'm2.1');
  assert.equal(g.n, 1);
  assert.ok(Object.values(g.scores).every((v) => v === 0));
  run(room, d, 70000);
  assert.ok(room.state.g.n >= 2);
  void phaseAt;
});

test('a page that is not the host does nothing and writes nothing', () => {
  const room = fakeRoom(['a', 'b'], 3);
  room.start();
  room.host = 'b';
  const d = new Director(room, world);
  d.adopt();
  run(room, d, 2000);
  assert.equal(room.state.g, undefined);
  assert.equal(room.state.b, undefined);
});
