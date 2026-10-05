// Fakes for driving the real Game without a browser: a recording HUD, the real Audio on a fake Web Audio, and a stage with the real
// characters, effects and camera but no renderer.
import * as THREE from 'three';
import { world } from './helpers.mjs';
import { Characters } from '../src/gfx/characters.js';
import { Effects } from '../src/gfx/effects.js';
import { CameraRig } from '../src/gfx/camera.js';
import { mulberry32 } from '../src/sim/rng.js';
import { installAudio } from './fakeaudio.mjs';

installAudio();
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: () => ({}), addEventListener() {}, hidden: false };
globalThis.requestAnimationFrame = () => 0;
export const { Game } = await import('../src/game/game.js');
const { Audio } = await import('../src/game/audio.js');

export function fakes(room) {
  const calls = [];
  const rec = (name) => (...a) => {
    calls.push([name, ...a]);
  };
  const hud = {
    h: {},
    cache: {},
    bannerEl: null,
    title: { addEventListener() {} },
    calls,
    banner(kinds) {
      calls.push(['banner', kinds]);
      this.bannerEl = {};
    },
    clearBanner() {
      calls.push(['clearBanner']);
      this.bannerEl = null;
    },
    survivors: rec('survivors'),
    podium: rec('podium'),
    callout: rec('callout'),
    countdown: rec('countdown'),
    feed: rec('feed'),
    flash: rec('flash'),
    hidePanel: rec('hidePanel'),
    clearCallout: rec('clearCallout'),
    setTop: rec('setTop'),
    setStat: rec('setStat'),
    setLobby: rec('setLobby'),
    hideStat: rec('hideStat'),
    watching: rec('watching'),
    showTitle: rec('showTitle'),
    setReduced: rec('setReduced'),
    underwater: rec('underwater'),
    vignette: rec('vignette'),
    hurt: rec('hurt'),
    setWatcher: rec('setWatcher'),
    hint: rec('hint'),
    darken: rec('darken'),
  };
  // the real Audio on a fake Web Audio, recording every call
  const audio = new Audio();
  audio.calls = [];
  for (const n of Object.getOwnPropertyNames(Audio.prototype)) {
    if (n === 'constructor' || typeof audio[n] !== 'function') continue;
    const orig = audio[n].bind(audio);
    audio[n] = (...a) => {
      audio.calls.push([n, ...a]);
      return orig(...a);
    };
  }
  const awarded = [];
  const controls = [];
  const saved = [];
  const submitted = [];
  const ow = {
    settings: { quality: 'medium', reducedMotion: false, pixelRatio: () => 1, choice: 'fixed', on() {} },
    controls: { set: (l) => controls.push(l), stick: { x: 0, y: 0 }, pressed: () => false },
    ui: { setOrientation() {}, showInvite() {} },
    player: { avatarUrl: async () => null },
    now: () => room.clock + 1e6,
    badges: { award: async (id) => awarded.push(id) },
    leaderboards: { submit: async (...a) => submitted.push(a) },
    save: { set: async (k, v) => saved.push([k, JSON.parse(JSON.stringify(v))]) },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const rig = new CameraRig(camera, world);
  const fx = new Effects(scene, world, { rand: mulberry32(1) });
  const chars = new Characters(scene);
  const tagCalls = [];
  const stage = {
    camera, rig, fx, chars, scene, mix: null,
    tags: { begin() { tagCalls.length = 0; }, add(t) { tagCalls.push(t); }, end() {}, invalidate() {} },
    update() {}, applySky() {}, setWater() {}, setUnderwater() {}, follow() {}, render() {}, setSize() {}, setQuality() {},
  };
  const keys = { move: { x: 0, y: 0 }, jump: false };
  const input = {
    onKey: null,
    move(o) {
      o.x = keys.move.x;
      o.y = keys.move.y;
      return o;
    },
    jump: () => keys.jump,
    sprint: () => false,
    turnKeys: () => 0,
    takeLook(o) {
      o.x = o.y = 0;
      return o;
    },
    takeTap: () => false,
    endFrame() {},
  };
  return { hud, audio, ow, stage, input, awarded, controls, saved, submitted, keys, tagCalls };
}
