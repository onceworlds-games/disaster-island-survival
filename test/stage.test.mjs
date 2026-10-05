import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.mjs';
import { installDom, fakeCtx, FakeEl } from './fakedom.mjs';
installDom();
const { Stage } = await import('../src/gfx/stage.js');
const { drawTag, TagPool } = await import('../src/gfx/tags.js');
const { skyMix } = await import('../src/gfx/skies.js');
const { prepareRound } = await import('../src/sim/disasters.js');
const { mulberry32 } = await import('../src/sim/rng.js');

function fakeRenderer() {
  const r = {
    shadowMap: { enabled: false, type: 0 },
    renders: 0, sizes: [], ratios: [],
    setClearColor() {},
    setPixelRatio(v) { r.ratios.push(v); },
    setSize(w, h) { r.sizes.push([w, h]); },
    render() { r.renders++; },
    clearDepth() {},
    dispose() {},
  };
  return r;
}

function makeStage(quality = 'medium') {
  const makeCanvas = (w, h) => ({ width: w, height: h, getContext: () => fakeCtx() });
  return new Stage({}, world, { quality, width: 1280, height: 720, pixelRatio: 2, rand: mulberry32(2), makeCanvas, renderer: fakeRenderer });
}

test('the stage builds the whole scene, with a sun, shadows by quality, sea and sky', () => {
  for (const q of ['low', 'medium', 'high']) {
    const s = makeStage(q);
    assert.equal(s.renderer.shadowMap.enabled, q !== 'low');
    assert.equal(s.sun.castShadow, q !== 'low');
    assert.equal(s.sun.shadow.mapSize.x, q === 'high' ? 2048 : 1024);
    assert.ok(s.scene.children.length > 8);
    // static scenery is a handful of draw calls, not hundreds
    let meshes = 0;
    s.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite) meshes++;
    });
    assert.ok(meshes < 90, `${meshes} drawables`);
  }
});

test('the stage follows quality, size, sky, water and a camera', () => {
  const s = makeStage();
  s.setSize(800, 600, 1.5);
  assert.deepEqual(s.renderer.sizes.at(-1), [800, 600]);
  assert.equal(s.renderer.ratios.at(-1), 1.5);
  assert.equal(s.camera.fov, 62);
  s.setSize(400, 800, 1);
  assert.equal(s.camera.fov, 74, 'a portrait phone gets a wider view');
  s.setQuality('low');
  assert.equal(s.sun.castShadow, false);
  s.setQuality('high');
  assert.equal(s.shadowSize, 2048);
  for (const k of ['flood', 'meteor', 'tornado', 'acid', 'quake', 'volcano']) {
    s.applySky(skyMix([k], 1, {}));
    assert.ok(s.sun.intensity > 0 && s.scene.fog.far > s.scene.fog.near);
  }
  s.setWater(14, 1.4);
  assert.equal(s.sea.position.y, 14);
  assert.equal(s.foam.visible, false);
  s.setWater(-0.6, 1);
  assert.equal(s.foam.visible, true);
  const fogBefore = s.scene.fog.far;
  s.setUnderwater(true);
  assert.ok(s.scene.fog.far < 60);
  s.applySky(skyMix(['flood'], 1, {}));
  assert.ok(s.scene.fog.far < 60, 'underwater fog is kept while the sky changes');
  s.setUnderwater(false);
  assert.ok(s.scene.fog.far > 100 && fogBefore > 100);
  s.follow(10, 0, -4);
  assert.equal(s.sun.target.position.x, 10);
  s.setSunDir(-30, 10, -40);
  assert.ok(s.skyMat.uniforms.uSunDir.value.y > 0);
  s.update(0.016);
  s.update(0.016);
  s.render();
  assert.equal(s.renderer.renders, 1);
});

test('the sea shader hooks compile-time replacements into the standard shader', () => {
  const s = makeStage();
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n}',
  };
  s.seaMat.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('transformed.y += w1 * uAmp') && shader.vertexShader.includes('varying float vWave'));
  assert.ok(shader.fragmentShader.includes('vWave') && shader.fragmentShader.includes('smoothstep'));
  assert.ok(shader.uniforms.uTime && shader.uniforms.uAmp);
});

test('name tags draw with a name, a ready tick, a missing avatar and a long name', () => {
  const ctx = fakeCtx();
  drawTag(ctx, { name: 'Nova', color: 0xe63946, ready: true, me: true, img: null });
  drawTag(ctx, { name: 'A very long player name that must not overflow the tag', color: 0x3a86ff, ready: false, me: false, img: { complete: true, naturalWidth: 10 } });
  drawTag(ctx, { name: '', color: 0x3a86ff });
  assert.ok(ctx.calls.some((c) => c[0] === 'fillText'));
  const made = [];
  const pool = new TagPool({ add() {} }, 4, (w, h) => {
    made.push([w, h]);
    return { width: w, height: h, getContext: () => fakeCtx() };
  });
  pool.begin();
  pool.add({ x: 0, y: 2, z: 0, name: 'Kai', color: 0xff9f1c, ready: false, me: false, dist: 12, img: null });
  pool.add({ x: 1, y: 2, z: 0, name: 'Kai', color: 0xff9f1c, ready: true, me: true, dist: 90, img: null });
  pool.end();
  assert.equal(pool.sprites.filter((x) => x.sprite.visible).length, 2);
  pool.invalidate();
  assert.equal(made.length, 4);
});

test('the stage draws effects for a round through its own particles without errors', () => {
  const s = makeStage();
  const round = prepareRound(['meteor', 'volcano'], 9, world);
  s.fx.setRound(round);
  for (let t = -6000; t < 20000; t += 50) s.fx.update(0.05, t, s.camera.position, false);
  s.chars.begin();
  s.chars.end();
  s.render();
  assert.ok(s.fx.fire.live >= 0);
  void FakeEl;
});
