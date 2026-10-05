import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, fakeCtx } from './fakedom.mjs';

const body = installDom();
const { runPoster } = await import('../src/poster.js');
const { POSTERS } = await import('../src/game/posterdata.js');

function fakeRenderer() {
  const r = {
    shadowMap: { enabled: false, type: 0 }, renders: 0, autoClear: true, cleared: 0,
    setClearColor() {}, setPixelRatio() {}, setSize() {}, dispose() {},
    render() { r.renders++; },
    clearDepth() { r.cleared++; },
  };
  return r;
}

for (const name of Object.keys(POSTERS)) {
  test(`poster ${name} draws one frame and says it is ready`, async () => {
    delete body.dataset;
    body.dataset = {};
    let renderer;
    await runPoster(name, {
      stage: { renderer: () => (renderer = fakeRenderer()), makeCanvas: (w, h) => ({ width: w, height: h, getContext: () => fakeCtx() }) },
    });
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(body.dataset.ready, '1');
    if (!name.startsWith('badge-')) {
      assert.ok(renderer.renders >= 1);
      if (name === 'cover') assert.ok(renderer.cleared >= 1, 'the title is drawn over the scene');
    }
  });
}
