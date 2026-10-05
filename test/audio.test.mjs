import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installAudio, made } from './fakeaudio.mjs';
installAudio();
const { Audio } = await import('../src/game/audio.js');

test('without a tap nothing plays and nothing throws', () => {
  const a = new Audio();
  a.jump();
  a.impact(1);
  a.weather(1, 1, 1, 1);
  a.setLevel(2);
  a.siren(6);
  assert.equal(a.ok, false);
  assert.equal(made(), 0);
});

test('every sound builds valid Web Audio, and the music sequencer plays four bars', () => {
  const a = new Audio();
  a.start();
  assert.ok(a.ok);
  const sounds = ['click', 'tick', 'jump', 'step', 'splash', 'bubble', 'grab', 'whoosh', 'thud', 'ko', 'survive', 'win', 'lose', 'podium', 'crack', 'chunk'];
  for (const s of sounds) a[s]();
  a.countdown(3);
  a.countdown(0);
  a.land(0);
  a.land(3);
  a.impact(0.5, true);
  a.impact(0);
  a.out(true);
  a.siren(0.35);
  a.siren(6);
  a.stopSiren();
  for (const lv of [-1, 0, 1, 2]) {
    a.setLevel(lv);
    for (let i = 0; i < 70; i++) {
      a.ctx.currentTime += 0.12;
      a.schedule();
    }
  }
  a.weather(0.3, 0.5, 0.1, 0.9);
  a.weather(0.3, 0.5, 0.1, 0.9);
  a.weather(0, 0, 0, 0);
  assert.ok(made() > 100);
  // a second tap resumes a suspended context rather than making a new one
  a.ctx.state = 'suspended';
  const ctx = a.ctx;
  a.start();
  assert.equal(a.ctx, ctx);
  assert.equal(ctx.state, 'running');
});
