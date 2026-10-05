# Disaster Island Survival

A 3D multiplayer survival game for Onceworlds. Everyone stands on a small island town, a disaster is announced, and you
survive it: floods, meteors, tornadoes, acid rain, earthquakes and a volcano. One point for every disaster you outlast.

- `npm run build` bundles the game (Vite + three.js) into `dist/`, which is what gets published.
- `npm test` runs the unit and simulation tests (`node --test`): the character controller against boxes and ramps, every
  disaster's deterministic timeline, the bots, whole matches with only bots over many seeds, the host's director against a
  fake room, and the client against fake HUD, audio and stage.
- Store art is drawn by the game itself: open it with `?poster=cover`, `action`, `win`, `icon` or `badge-<id>`.

## How it is put together

- `src/sim/` is pure (no three.js, no DOM, seeded randomness): the island's collision world (`map.js`, `collision.js`),
  the disasters as functions of a seed and the match clock (`disasters.js`, `hazards.js`), a walking graph and the bots
  (`nav.js`, `bots.js`), and the match record and its rules (`rules.js`).
- `src/net/director.js` is the host's half of a match: it writes the record, simulates the bots, judges players who are away,
  records the knockouts players report, and ends the match. A new host calls `adopt()` and carries on from room state.
- `src/game/game.js` is the client: your own character at a fixed 60 Hz, everyone else from presence and the host's snapshots.
- `src/gfx/` and `src/ui/` draw it: instanced characters, one merged mesh for the island, the effects, the HUD.
- Disasters are never sent over the network: the host writes which ones and their seeds, and every page derives the same
  meteors, tornado path, cracks and lava from the seed and the shared match time.
