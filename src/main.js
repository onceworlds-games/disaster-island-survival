// Boot: join the room first (before anything heavy is built, so a reload keeps its seat), then build the island and start the game.
// With ?poster=<name> the room and the SDK are skipped entirely and one staged frame of store art is drawn.

import './ui/style.css';

const poster = new URLSearchParams(location.search).get('poster');

async function boot() {
  const { standaloneSdk } = await import('./net/standalone.js');
  const ow = window.onceworlds || standaloneSdk();
  const room = await ow.rooms.join({
    maxPlayers: 16,
    minPlayers: 1,
    lobby: 'bar',
    settings: [{ id: 'rounds', label: 'Disasters', options: [3, 5, 8], default: 5 }],
  });
  room.hideLobby();
  ow.ui.setOrientation('landscape');

  // everything heavy comes after the join
  const [{ buildMap }, { World }, { Stage }, { Hud }, { Audio }, { Input }, { Game }] = await Promise.all([
    import('./sim/map.js'),
    import('./sim/collision.js'),
    import('./gfx/stage.js'),
    import('./ui/hud.js'),
    import('./game/audio.js'),
    import('./game/input.js'),
    import('./game/game.js'),
  ]);
  const map = buildMap();
  const world = new World(map);
  const canvas = document.getElementById('stage');
  const hud = new Hud(document.body, {});
  let stage;
  try {
    stage = new Stage(canvas, world, {
      quality: ow.settings.quality,
      pixelRatio: ow.settings.pixelRatio(2),
      width: innerWidth,
      height: innerHeight,
    });
  } catch (e) {
    hud.callout('THIS DEVICE CANNOT DRAW 3D', '', 'bad', 600000);
    throw e;
  }
  const audio = new Audio();
  // sound may only start from a tap or key inside the game: any of them wakes (or starts) it
  for (const ev of ['pointerup', 'touchend', 'keydown', 'click']) addEventListener(ev, () => audio.start(), { passive: true });
  const input = new Input(canvas, ow);
  let stats = null;
  try {
    stats = await ow.save.get('stats');
  } catch {
    stats = null;
  }
  const game = new Game({ ow, room, stage, hud, audio, input, world, stats: stats && typeof stats === 'object' ? stats : { matches: 0, wins: 0, survived: 0, rounds: 0 } });
  window.__game = game; // handy when debugging in a console
  game.start();
}

if (poster) {
  import('./poster.js').then((m) => m.runPoster(poster)).catch((e) => {
    console.error(e);
    throw e;
  });
} else {
  boot();
}
