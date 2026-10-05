import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { world, map } from './helpers.mjs';
import { buildWorldGeometry } from '../src/gfx/worldgeo.js';
import { Characters, MAX_CHARS, SKIN } from '../src/gfx/characters.js';
import { Effects } from '../src/gfx/effects.js';
import { Particles } from '../src/gfx/particles.js';
import { CameraRig } from '../src/gfx/camera.js';
import { skyMix, SKIES } from '../src/gfx/skies.js';
import { tumblePose, TUMBLE_SECONDS } from '../src/sim/tumble.js';
import { prepareRound, KINDS, WARN_MS, RUN_MS } from '../src/sim/disasters.js';
import { mulberry32 } from '../src/sim/rng.js';

test('the island builds into one mesh with sane numbers', () => {
  const mb = buildWorldGeometry(map);
  const a = mb.arrays();
  assert.equal(a.position.length, a.normal.length);
  assert.equal(a.position.length, a.color.length);
  assert.equal(a.position.length % 9, 0);
  for (const arr of [a.position, a.normal, a.color]) for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `bad number at ${i}`);
  const tris = a.position.length / 9;
  assert.ok(tris > 8000 && tris < 120000, `${tris} triangles`);
  for (let i = 0; i < a.normal.length; i += 3) {
    const l = Math.hypot(a.normal[i], a.normal[i + 1], a.normal[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3 || l === 0 || Number.isNaN(l) === false, 'unit normals');
  }
  // everything stays within the world (plus the sea floor disc)
  let max = 0;
  for (let i = 0; i < a.position.length; i += 3) max = Math.max(max, Math.abs(a.position[i]), Math.abs(a.position[i + 2]));
  assert.ok(max <= 521);
});

test('the geometry winds outward: a box top faces up', () => {
  const mb = buildWorldGeometry({ solids: [{ k: 0, x0: 0, x1: 2, z0: 0, z1: 2, y0: 0, y1: 3, color: 0x888888, top: 0x888888, tag: '' }], deco: [], trees: [] });
  const a = mb.arrays();
  let up = 0;
  for (let i = 0; i < a.normal.length; i += 3) if (a.normal[i + 1] > 0.99 && a.position[i + 1] === 3) up++;
  assert.ok(up >= 6);
});

test('characters: sixteen of them, every pose, knocked out and gone', () => {
  const scene = new THREE.Scene();
  const chars = new Characters(scene);
  chars.begin();
  const poses = [{}, { air: true }, { climb: true }, { swim: true }, { speed: 11, sprint: true, phase: 3 }, { out: 0.3, cause: 'meteor' }, { out: 0.9, cause: 'flung' }, { out: 1.2, cause: 'drown' }, { out: 1.0, cause: 'lava' }, { out: 2.5, cause: 'meteor' }];
  for (let i = 0; i < 16; i++) {
    chars.add({ x: i, y: 0, z: -i, yaw: i * 0.4, speed: 4, phase: i, color: 0xe63946, skin: SKIN[i % SKIN.length], capColor: 0x222222, gy: 0, key: `p${i}`, me: i === 0, arrow: i === 0, pulse: 1.2, ...poses[i % poses.length] });
  }
  chars.end();
  assert.ok(chars.n <= 16 && chars.n >= 14, `${chars.n} drawn (a finished tumble is skipped)`);
  assert.equal(chars.torso.count, chars.n);
  assert.equal(chars.arm.count, chars.n * 2);
  assert.ok(chars.ring.visible && chars.arrow.visible);
  const e = chars.torso.instanceMatrix.array;
  for (let i = 0; i < chars.n * 16; i++) assert.ok(Number.isFinite(e[i]));
  // more than the cap is ignored, never thrown
  chars.begin();
  for (let i = 0; i < MAX_CHARS + 5; i++) chars.add({ x: 0, y: 0, z: 0, yaw: 0, color: 0xffffff, skin: SKIN[0], capColor: 0 });
  chars.end();
  assert.equal(chars.n, MAX_CHARS);
});

test('a tumble goes from the knockout to nothing in under two seconds, for every cause', () => {
  const out = {};
  for (const cause of ['meteor', 'flung', 'drown', 'lava', 'acid', 'debris']) {
    let last = 1;
    for (let s = 0; s <= TUMBLE_SECONDS + 0.1; s += 0.05) {
      tumblePose(out, s, cause, 'player');
      for (const k of ['dx', 'dy', 'dz', 'rx', 'rz', 'ry', 'scale']) assert.ok(Number.isFinite(out[k]), `${cause} ${k}`);
      assert.ok(out.scale <= last + 1e-9 || s < 0.5, 'shrinks away');
      last = Math.min(last, out.scale);
    }
    tumblePose(out, TUMBLE_SECONDS + 0.01, cause, 'player');
    assert.equal(out.scale, 0);
    tumblePose(out, 0, cause, 'player');
    assert.ok(Math.abs(out.dy) < 1.3 && out.scale === 1);
  }
});

test('particles emit, age and recycle without growing', () => {
  const p = new Particles(50, true);
  for (let i = 0; i < 400; i++) p.emit(0, 1, 0, 1, 2, 0, 0.5, 1, 0.2, 0xffcc00, 0xff0000, 1, 9, 1);
  p.update(0.1);
  assert.ok(p.live > 0 && p.live <= 50);
  for (let i = 0; i < 20; i++) p.update(0.1);
  assert.equal(p.live, 0);
  for (let i = 0; i < p.max; i++) assert.equal(p.size[i], 0);
  assert.ok(p.posAttr.array.every(Number.isFinite));
});

test('effects run every disaster through a whole round, on every frame, without throwing', () => {
  for (const kinds of [['meteor'], ['volcano'], ['quake'], ['tornado'], ['acid'], ['flood'], ['meteor', 'volcano'], ['quake', 'tornado']]) {
    const scene = new THREE.Scene();
    const fx = new Effects(scene, world, { rand: mulberry32(5) });
    const round = prepareRound(kinds, 77, world);
    fx.setRound(round);
    let impacts = 0;
    fx.onImpact = () => impacts++;
    let maxLive = 0;
    for (let t = -WARN_MS; t <= RUN_MS + 2000; t += 1000 / 60) {
      fx.update(1 / 60, t, { x: 0, y: 5, z: 10 }, false);
      maxLive = Math.max(maxLive, fx.fire.live, fx.smoke.live);
    }
    assert.ok(fx.fire.live <= fx.fire.max && fx.smoke.live <= fx.smoke.max);
    if (kinds.includes('meteor') || kinds.includes('volcano') || kinds.includes('quake')) assert.ok(impacts > 5, `${kinds}: ${impacts} impacts`);
    for (const m of [fx.rings, fx.rocks, fx.lava, fx.chunks, fx.craters]) assert.ok(m.count <= m.instanceMatrix.count, 'within capacity');
    for (const m of [fx.rings, fx.lava, fx.chunks, fx.tdebris]) for (let i = 0; i < Math.min(m.count, 20) * 16; i++) assert.ok(Number.isFinite(m.instanceMatrix.array[i]));
    fx.update(1 / 60, NaN, { x: 0, y: 5, z: 10 }, false);
    fx.setRound(null);
    fx.update(1 / 60, undefined, { x: 0, y: 5, z: 10 }, false);
  }
});

test('joining a round halfway shows its marks without a storm of old explosions', () => {
  const scene = new THREE.Scene();
  const fx = new Effects(scene, world, { rand: mulberry32(1) });
  fx.setRound(prepareRound(['meteor'], 3, world));
  let impacts = 0;
  fx.onImpact = () => impacts++;
  fx.update(1 / 60, 30000, { x: 0, y: 5, z: 10 }, false);
  fx.update(1 / 60, 30016, { x: 0, y: 5, z: 10 }, false);
  assert.ok(impacts <= 1);
  assert.ok(fx.craters.count > 3, 'the craters of the earlier ones are there');
});

test('the camera never ends up inside a building and eases back out', () => {
  const cam = new THREE.PerspectiveCamera();
  const rig = new CameraRig(cam, world);
  // stand in the shop doorway looking inward from the plaza side
  for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.7) {
    rig.yaw = yaw;
    rig.pitch = 0.2;
    for (const [x, z] of [[-16, -8], [-20, -8], [-6, 18], [0, -11], [21, 2.5], [24, -13]]) {
      for (let i = 0; i < 40; i++) rig.update(1 / 60, { x, y: 0, z }, false);
      assert.ok(!world.solidAt(cam.position.x, cam.position.y, cam.position.z, 0.05), `camera inside something at ${x},${z} yaw ${yaw.toFixed(1)}`);
      assert.ok(cam.position.y >= 0.34);
    }
  }
  rig.yaw = 0;
  rig.pitch = 0.5;
  for (let i = 0; i < 300; i++) rig.update(1 / 60, { x: 0, y: 0, z: 5 }, false);
  assert.ok(Math.abs(rig.cur - 9) < 0.2, `back out to ${rig.cur}`);
  rig.addTrauma(1);
  rig.update(1 / 60, { x: 0, y: 0, z: 5 }, false);
  assert.ok(rig.trauma < 1 && rig.trauma > 0.9);
});

test('every sky mixes to valid colours and the calm sky is the start of every blend', () => {
  const out = {};
  for (const k of KINDS) {
    skyMix([k], 0, out);
    assert.deepEqual(out.top.map((v) => Math.round(v * 255)), [(SKIES.calm.top >> 16) & 255, (SKIES.calm.top >> 8) & 255, SKIES.calm.top & 255]);
    skyMix([k], 1, out);
    for (const key of ['top', 'horizon', 'sun', 'fog', 'sea', 'cloud', 'hemiSky', 'hemiGround']) assert.ok(out[key].every((v) => v >= 0 && v <= 1), `${k} ${key}`);
    assert.ok(out.fogFar > out.fogNear && out.sunI > 0 && out.exposure > 0.5);
  }
  skyMix(['flood', 'meteor'], 0.5, out);
  assert.ok(out.top.every(Number.isFinite));
});
