import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fakedom.mjs';
const body = installDom();
const { Hud, iconSvg, avatar } = await import('../src/ui/hud.js');

const text = (el) => el.textContent;

test('the title has one Play button that calls back, and a logo', () => {
  let played = 0;
  const hud = new Hud(body, { onPlay: () => played++ });
  hud.showTitle(true);
  assert.ok(!hud.title.classList.contains('hidden'));
  assert.ok(text(hud.title).includes('DISASTER') && text(hud.title).includes('ISLAND') && text(hud.title).includes('SURVIVAL'));
  hud.playBtn.click();
  assert.equal(played, 1);
  hud.showTitle(false);
  assert.ok(hud.title.classList.contains('hidden'));
});

test('the lobby shows the setting, as buttons for the host and a plain value for the others', () => {
  const picked = [];
  const hud = new Hud(body, { onSetting: (v) => picked.push(v) });
  hud.setLobby(true, { value: 5, host: true, options: [3, 5, 8] });
  const buttons = hud.setBox.children.filter((c) => c.tagName === 'button');
  assert.deepEqual(buttons.map((b) => text(b)), ['3', '5', '8']);
  assert.ok(buttons[1].classList.contains('on'));
  buttons[2].click();
  assert.deepEqual(picked, [8]);
  hud.setLobby(true, { value: 5, host: false, options: [3, 5, 8] });
  assert.equal(hud.setBox.children.filter((c) => c.tagName === 'button').length, 0);
  assert.ok(text(hud.setBox).includes('5'));
  hud.setLobby(false);
  assert.ok(hud.lobby.classList.contains('hidden'));
  assert.ok(text(hud.tip).length < 30, 'a hint, not a paragraph');
});

test('the top bar, status, meters, banner, callouts, countdown, feed, panels and effects all work', () => {
  const hud = new Hud(body, {});
  hud.setTop(true, { kinds: ['flood', 'tornado'], round: 2, rounds: 5, timer: 42, warn: false, frac: 0.8 });
  assert.ok(text(hud.kindName).includes('FLOOD') && text(hud.kindName).includes('TORNADO'));
  assert.equal(text(hud.timerVal), '42');
  assert.equal(text(hud.roundVal), '2/5');
  hud.setTop(true, { kinds: ['meteor'], round: 1, rounds: 3, timer: 5, warn: true, frac: null });
  assert.equal(text(hud.timerLbl), 'WARNING');
  hud.setTop(false, {});
  assert.ok(hud.top.classList.contains('hidden'));
  hud.setStat(true, { alive: 5, total: 8, score: 2, breath: 0.2, health: 0.5, stamina: 0.4, exhausted: false, showStamina: true });
  assert.equal(text(hud.aliveVal), '5/8');
  assert.ok(!hud.breath.classList.contains('hidden') && hud.breath.classList.contains('low'));
  hud.setStat(true, { alive: 5, total: 8, score: 2, breath: null, health: null, stamina: 1, exhausted: false, showStamina: true });
  assert.ok(hud.breath.classList.contains('hidden') && hud.stamina.classList.contains('hide'));
  hud.hideStat();
  hud.banner(['volcano']);
  assert.ok(hud.bannerEl && text(hud.bannerEl).includes('VOLCANO') && text(hud.bannerEl).includes('AVOID LAVA'));
  hud.clearBanner(false);
  assert.equal(hud.bannerEl, null);
  hud.callout('ELIMINATED', 'DROWNED', 'bad', 5);
  assert.ok(text(hud.center).includes('ELIMINATED'));
  hud.clearCallout();
  hud.countdown(3);
  hud.countdown(3);
  hud.countdown('GO');
  assert.ok(text(hud.center).includes('GO'));
  hud.countdown(null);
  for (let i = 0; i < 7; i++) hud.feed(`P${i} OUT`, false);
  assert.ok(hud.feedBox.children.length <= 4);
  hud.survivors({ entries: [{ name: 'Nova', color: 0xe63946, url: null, me: true }, { name: 'Kai', color: 0x3a86ff, url: 'x.svg', me: false }], you: 'YOU SURVIVED  +1', good: true });
  assert.ok(text(hud.panel).includes('SURVIVORS') && text(hud.panel).includes('Nova'));
  hud.survivors({ entries: [], you: 'ELIMINATED', good: false });
  assert.ok(text(hud.panel).includes('NOBODY'));
  hud.podium({
    title: 'RESULTS',
    top: [{ name: 'A', color: 1, url: null, score: 3, place: 1 }, { name: 'B', color: 2, url: null, score: 2, place: 2 }, { name: 'C', color: 3, url: null, score: 2, place: 3 }],
    you: 'YOU: 5th', youGood: false, awards: ['UNTOUCHED: A'],
  });
  assert.ok(text(hud.panel).includes('YOU: 5th') && text(hud.panel).includes('UNTOUCHED'));
  hud.hidePanel();
  assert.equal(hud.panel, null);
  hud.watching(true, 'Echo');
  assert.ok(!hud.watch.classList.contains('hidden'));
  hud.vignette(true);
  hud.underwater(true);
  hud.hurt(0.4);
  hud.flash();
  hud.darken(false);
  hud.setWatcher(true);
  assert.ok(body.classList.contains('watcher'));
  hud.setWatcher(false);
  hud.setReduced(true);
  hud.flash();
});

test('player text only ever goes in as text, never as markup', () => {
  const hud = new Hud(body, {});
  const evil = '<img src=x onerror=alert(1)>';
  hud.survivors({ entries: [{ name: evil, color: 1, url: null, me: false }], you: '', good: false });
  const p = hud.panel.find((c) => c.className === 'p');
  assert.ok(p && text(p).includes(evil));
  assert.equal(p._html, undefined);
  const a = avatar(null, evil, 5);
  assert.equal(text(a), '<');
  hud.watching(true, evil);
  assert.equal(hud.watchName._text, evil);
  for (const k of ['flood', 'meteor', 'tornado', 'acid', 'quake', 'volcano', 'nope']) assert.ok(iconSvg(k));
});
