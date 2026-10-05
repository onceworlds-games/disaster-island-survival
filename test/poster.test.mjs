import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world } from './helpers.mjs';
import { stagePoster, POSTERS } from '../src/game/posterdata.js';
import { prepareRound, tornadoAt, METEOR_TELEGRAPH } from '../src/sim/disasters.js';

function view(d) {
  const cam = new THREE.PerspectiveCamera(d.camera.fov, d.w / d.h, 0.3, 900);
  cam.position.set(...d.camera.pos);
  cam.lookAt(...d.camera.target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(cam);
    return { x: (v.x * 0.5 + 0.5) * d.w, y: (1 - (v.y * 0.5 + 0.5)) * d.h, z: v.z };
  };
}

test('every poster name is staged, and badges need no camera', () => {
  for (const name of Object.keys(POSTERS)) assert.ok(stagePoster(name, world), name);
  assert.equal(stagePoster('nope', world), null);
  assert.equal(POSTERS.cover.w, 1280);
  assert.equal(POSTERS.icon.w, 512);
  assert.equal(POSTERS['badge-first-win'].w, 256);
  for (const id of ['survivor', 'untouchable', 'storm-chaser', 'first-win']) assert.ok(POSTERS[`badge-${id}`]);
});

test('cover: meteors in the air, an impact just now, players running and standing high, all in frame', () => {
  const d = stagePoster('cover', world);
  assert.equal(d.title, true);
  const p = view(d);
  const round = prepareRound(d.kinds, d.seed, world);
  let air = 0, boom = 0;
  for (const m of round.meteors) {
    const dt = m.at - d.t;
    if (dt > 0 && dt < METEOR_TELEGRAPH) {
      const rock = p(m.x - (28 * dt) / 1500, m.y + (66 * dt) / 1500, m.z - (15 * dt) / 1500);
      if (rock.y > 40 && rock.y < 700 && rock.x > 0 && rock.x < 1280) air++;
    }
    if (dt <= 0 && dt > -300) {
      const b = p(m.x, m.y, m.z);
      if (b.x > 100 && b.x < 1180 && b.y > 300 && b.y < 700) boom++;
    }
  }
  assert.ok(air >= 2, `${air} rocks in frame`);
  assert.ok(boom >= 1, 'an impact in frame');
  const inFrame = d.chars.filter((c) => {
    const f = p(c.x, c.y, c.z), h = p(c.x, c.y + 1.9, c.z);
    return f.x > 20 && f.x < 1260 && h.y > 200 && f.y < 715 && f.y - h.y > 25;
  });
  assert.ok(inFrame.length >= 8, `${inFrame.length} of ${d.chars.length} characters in frame`);
  assert.ok(d.chars.some((c) => c.y > 8), 'one on a roof');
  const clock = p(0, 18, -15);
  assert.ok(clock.x > 300 && clock.x < 980 && clock.y > 150 && clock.y < 500, 'the clock tower in the middle');
  assert.ok(d.title && d.h === 720);
});

test('action: the tornado fills the frame and someone is being flung', () => {
  const d = stagePoster('action', world);
  const p = view(d);
  const round = prepareRound(d.kinds, d.seed, world);
  const tp = tornadoAt(round, d.t);
  const base = p(tp.x, 0, tp.z), top = p(tp.x, 34, tp.z);
  assert.ok(Math.abs(base.x - 640) < 120 && top.y < 80 && base.y > 500 && base.y < 700, `base ${base.x | 0},${base.y | 0} top ${top.y | 0}`);
  const flung = d.chars.find((c) => c.cause === 'flung');
  assert.ok(flung && flung.out > 0.3 && flung.out < 1.2);
  const f = p(flung.x, flung.y + 4, flung.z);
  assert.ok(f.x > 100 && f.x < 1180 && f.y > 100 && f.y < 700, 'the flung player is in frame');
  for (const c of d.chars) {
    const feet = p(c.x, c.y, c.z);
    assert.ok(feet.y < 715 && feet.x > 0 && feet.x < 1280, 'nobody is cut off at the bottom');
  }
});

test('win: survivors on the clock tower, the flood far below, in the middle of the frame', () => {
  const d = stagePoster('win', world);
  assert.equal(d.water, 14);
  assert.deepEqual(d.sky, ['sunset']);
  assert.ok(d.sunDir && d.sunDir[1] > 0);
  const p = view(d);
  assert.ok(d.chars.length >= 4 && d.chars.every((c) => c.y === 18));
  for (const c of d.chars) {
    const f = p(c.x, c.y, c.z), h = p(c.x, c.y + 1.9, c.z);
    assert.ok(f.x > 400 && f.x < 880 && h.y > 200 && f.y < 520 && f.y - h.y > 60, `${f.x | 0},${f.y | 0}`);
  }
  // they stand on the deck of the tower
  for (const c of d.chars) assert.ok(Math.abs(c.x) < 2.2 && c.z > -17.2 && c.z < -12.8);
});

test('icon: one tornado, centred, with room around it', () => {
  const d = stagePoster('icon', world);
  assert.equal(d.w, 512);
  const p = view(d);
  const round = prepareRound(d.kinds, d.seed, world);
  const tp = tornadoAt(round, d.t);
  const base = p(tp.x, 0, tp.z), top = p(tp.x, 34, tp.z);
  assert.ok(Math.abs(base.x - 256) < 60);
  assert.ok(top.y > 51 && base.y < 461, `tornado spans ${top.y | 0}..${base.y | 0}: nothing important in the outer tenth`);
  assert.equal(d.chars.length, 0);
});
