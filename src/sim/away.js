// Players whose connection is away: the host judges them from where they were last seen, standing still, by the same hazard rules,
// so a dropped player is neither immortal nor stuck holding a round open.

import { makeBody } from './collision.js';
import { makeHazard, stepHazards } from './hazards.js';

export class AwaySim {
  constructor(world) {
    this.world = world;
    this.round = null;
    this.items = new Map();
  }

  setRound(round) {
    this.round = round;
    this.items.clear();
  }

  forget(id) {
    this.items.delete(id);
  }

  /** One step for one away player standing at pos ({ x, y, z }); returns a knockout cause or null. */
  step(id, pos, dt, tPrev, t) {
    if (!this.round || !pos) return null;
    let it = this.items.get(id);
    if (!it) {
      it = { body: makeBody(pos.x, pos.y, pos.z), hs: makeHazard() };
      this.items.set(id, it);
    }
    const b = it.body;
    b.x = pos.x;
    b.y = pos.y;
    b.z = pos.z;
    b.ex = 0;
    b.ez = 0;
    return stepHazards(it.hs, this.round, tPrev, t, b, dt, this.world);
  }
}
