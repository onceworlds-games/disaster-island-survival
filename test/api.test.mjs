// Calls across modules are checked by name: a method the game calls on the HUD, the audio, the stage, the effects or the host's
// director must exist there (a typo in a rarely used path otherwise only shows when a player reaches it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { installDom } from './fakedom.mjs';

installDom();
globalThis.AudioContext = undefined;
const { Hud } = await import('../src/ui/hud.js');
const { Audio } = await import('../src/game/audio.js');
const { Stage } = await import('../src/gfx/stage.js');
const { Effects } = await import('../src/gfx/effects.js');
const { Characters } = await import('../src/gfx/characters.js');
const { TagPool } = await import('../src/gfx/tags.js');
const { CameraRig } = await import('../src/gfx/camera.js');
const { Director } = await import('../src/net/director.js');
const { Input } = await import('../src/game/input.js');
const { Particles } = await import('../src/gfx/particles.js');
const { World } = await import('../src/sim/collision.js');
const { BotSim } = await import('../src/sim/bots.js');

const names = (cls) => {
  const out = new Set();
  for (let p = cls.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) for (const n of Object.getOwnPropertyNames(p)) out.add(n);
  return out;
};
const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const files = ['game/game.js', 'main.js', 'poster.js', 'net/director.js'].map((f) => [f, read(f)]);

function calls(text, re) {
  const found = new Set();
  for (const m of text.matchAll(re)) found.add(m[1]);
  return [...found];
}

function check(label, cls, re, extra = []) {
  const have = names(cls);
  for (const [f, text] of files) {
    for (const n of calls(text, re)) assert.ok(have.has(n) || extra.includes(n), `${f} calls ${label}.${n}(), which does not exist`);
  }
}

test('what the game calls on its own modules exists', () => {
  check('hud', Hud, /\bhud\.([A-Za-z]+)\(/g);
  check('audio', Audio, /\baudio\.([A-Za-z]+)\(/g);
  check('stage', Stage, /\bstage\.([A-Za-z]+)\(/g);
  check('fx', Effects, /\bfx\.([A-Za-z]+)\(/g);
  check('chars', Characters, /\bchars\.([A-Za-z]+)\(/g, ['forEach']);
  check('tags', TagPool, /\btags\.([A-Za-z]+)\(/g);
  check('rig', CameraRig, /\brig\.([A-Za-z]+)\(/g);
  check('director', Director, /\bdirector\??\.([A-Za-z]+)\(/g);
  check('input', Input, /\binput\.([A-Za-z]+)\(/g);
  check('world', World, /\bworld\.([A-Za-z]+)\(/g);
  check('sim', BotSim, /\bsim\.([A-Za-z]+)\(/g);
});

test('the feedback code calls real sounds on the audio object', () => {
  const have = names(Audio);
  const text = read('game/game.js');
  const feedback = text.slice(text.indexOf('  feedback(dt) {'), text.indexOf('  knockOut(cause) {'));
  for (const n of calls(feedback, /\ba\.([A-Za-z]+)\(/g)) assert.ok(have.has(n), `audio.${n}`);
});

test('an Audio object has no property that hides one of its own methods', () => {
  const a = new Audio();
  for (const n of names(Audio)) {
    if (n === 'constructor') continue;
    assert.equal(typeof a[n], 'function', `${n} is shadowed by a field`);
  }
  const p = new Particles(4, false);
  for (const n of names(Particles)) if (n !== 'constructor') assert.equal(typeof p[n], 'function', `Particles.${n}`);
});

test('the SDK calls the game makes are all in the guide', () => {
  const sdk = new Set(['on', 'me', 'spectating', 'matchNow', 'isHost', 'hideLobby', 'match', 'state', 'running', 'players', 'setState', 'settings', 'setPresence', 'setSetting', 'send', 'presenceAt', 'host', 'endMatch', 'setOpen']);
  for (const [f, text] of files) {
    for (const n of calls(text, /\broom\.([A-Za-z]+)/g)) assert.ok(sdk.has(n), `${f}: room.${n} is not in the SDK reference`);
  }
  const events = new Set(['starting', 'matchstart', 'host', 'reconnect', 'matchend', 'match', 'message', 'state', 'rename', 'leave', 'close']);
  for (const [, text] of files) for (const n of calls(text, /room\.on\('([a-z]+)'/g)) assert.ok(events.has(n), `event ${n}`);
});

test('no source file uses a three.js name that no longer exists (r186)', () => {
  const dir = new URL('../src/', import.meta.url);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(`${e.name}/`, d)) : [new URL(e.name, d)]));
  for (const u of walk(dir)) {
    const t = readFileSync(u, 'utf8');
    assert.ok(!t.includes('PCFSoftShadowMap'), `${u.pathname} uses PCFSoftShadowMap`);
    assert.ok(!/THREE\.Clock\b/.test(t), 'THREE.Clock is deprecated');
    assert.ok(!/innerHTML\s*=\s*[^'"`]*\$\{/.test(t), `${u.pathname}: innerHTML with interpolation`);
  }
  void Stage;
});
