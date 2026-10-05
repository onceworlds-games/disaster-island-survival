// On Onceworlds the platform injects `window.onceworlds` before the game's scripts. Opened on its own (the file by itself, a plain
// static server) the game gets this stand-in: saves in memory and a solo room where the player is the host, so nothing throws and the
// whole game, bots included, can still be played. Never used on the platform.

function soloRoom(player) {
  const listeners = new Map();
  const me = { id: player.id, name: player.name, presence: null, team: 0, connected: true };
  let started = 0;
  let n = 0;
  let countdownTimer = null;
  let settings = { rounds: 5 };
  const emit = (ev, ...args) => {
    for (const fn of [...(listeners.get(ev) ?? [])]) {
      try {
        fn(...args);
      } catch (e) {
        console.error(e);
      }
    }
  };
  const room = {
    id: 'solo',
    kind: 'solo',
    invite: null,
    teams: 0,
    me,
    players: new Map([[me.id, me]]),
    state: {},
    host: me.id,
    connected: true,
    closed: false,
    budget: { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 },
    match: { phase: 'lobby', n: 0, id: '', min: 1, participants: [] },
    get isHost() {
      return true;
    },
    get online() {
      return [me];
    },
    get notReady() {
      return [];
    },
    get participants() {
      return room.match.phase === 'lobby' ? [] : [me];
    },
    get spectators() {
      return [];
    },
    get spectating() {
      return false;
    },
    get running() {
      return room.match.phase === 'playing';
    },
    get canStart() {
      return true;
    },
    get settings() {
      return settings;
    },
    isParticipant: () => room.match.phase !== 'lobby',
    matchNow: () => (room.match.phase === 'playing' ? Date.now() - started : 0),
    setSetting(id, value) {
      if (room.match.phase !== 'lobby' || id !== 'rounds' || ![3, 5, 8].includes(value)) return;
      settings = { ...settings, rounds: value };
      emit('settings', settings);
    },
    hideLobby() {},
    send() {},
    setPresence(d) {
      me.presence = d;
    },
    presenceAt: () => me.presence,
    setState(k, v) {
      if (v === null || v === undefined) delete room.state[k];
      else room.state[k] = v;
    },
    setPrivate() {},
    setOpen() {},
    clearReady() {
      delete me.ready;
    },
    setReady(ready) {
      if (room.match.phase !== 'lobby') return;
      if (ready) me.ready = true;
      else delete me.ready;
      if (ready) room.startMatch();
    },
    startMatch() {
      if (room.match.phase !== 'lobby') return;
      const startsAt = Date.now() + 3000;
      room.match = { phase: 'starting', n: n + 1, id: `solo${n + 1}`, min: 1, participants: [me.id], startsAt, seed: Math.floor(Math.random() * 2 ** 31) };
      emit('match', room.match);
      emit('starting', room.match);
      clearTimeout(countdownTimer);
      countdownTimer = setTimeout(() => {
        if (room.match.phase !== 'starting') return;
        n++;
        started = Date.now();
        room.match = { ...room.match, phase: 'playing', startedAt: started };
        delete me.ready;
        emit('match', room.match);
        emit('matchstart', room.match);
      }, 3000);
    },
    endMatch() {
      clearTimeout(countdownTimer);
      started = 0;
      delete me.ready;
      const prev = room.match;
      room.match = { phase: 'lobby', n, id: prev.id, min: 1, participants: [] };
      emit('match', room.match, prev);
      emit('matchend', room.match, prev);
    },
    leave() {
      room.closed = true;
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev).delete(fn);
    },
  };
  return room;
}

export function standaloneSdk() {
  const listeners = new Map();
  const mem = new Map();
  let id = null;
  try {
    id = localStorage.getItem('dis:id');
    if (!id) {
      id = `local-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('dis:id', id);
    }
  } catch {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
  }
  const player = { id, name: 'You', guest: true };
  const stick = { x: 0, y: 0 };
  return {
    mode: 'standalone',
    env: {},
    player: { get: async () => player, rename: async () => null, avatarUrl: async () => null },
    save: {
      get: async (k) => mem.get(k) ?? null,
      set: async (k, v) => void mem.set(k, v),
      delete: async (k) => void mem.delete(k),
      list: async () => [...mem.keys()],
    },
    badges: { award: async () => false, list: async () => [], has: async () => false },
    leaderboards: { submit: async () => null, top: async () => ({ entries: [], me: null }) },
    rooms: { join: async () => soloRoom(player), on: () => () => {}, current: null },
    ratings: { get: async () => null, top: async () => [] },
    ui: { setMenuPosition() {}, requestFullscreen() {}, showInvite() {}, setOrientation() {} },
    controls: { set() {}, stick, pressed: () => false, touch: false },
    settings: {
      quality: 'medium',
      scale: 1,
      choice: 'auto',
      reducedMotion: false,
      pixelRatio: (cap = 2) => Math.min(globalThis.devicePixelRatio || 1, cap),
      on: () => () => {},
    },
    now: () => Date.now(),
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    fetch: (...args) => fetch(...args),
  };
}
