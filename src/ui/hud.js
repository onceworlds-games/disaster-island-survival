// The on-screen interface: a slim top bar, your status at the top right, big transient callouts in the middle, the title, the lobby
// settings, survivors and the podium. Plain DOM; everything players can influence goes in with textContent, never innerHTML.

import { INFO } from '../sim/disasters.js';

const SVG = {
  flood: '<path d="M2 8c3-3 6 3 10 0s7 3 10 0M2 14c3-3 6 3 10 0s7 3 10 0M2 20c3-3 6 3 10 0s7 3 10 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  meteor: '<circle cx="16" cy="16" r="6" fill="currentColor"/><path d="M11 11L2 2M14 9L8 2M9 14L2 8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  tornado: '<path d="M3 4h18M5 9h14M7 14h10M9 19h6M11 23h2" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
  acid: '<path d="M12 2C8 8 5.5 11.5 5.5 15a6.5 6.5 0 0 0 13 0c0-3.500-2.500-7-6.500-13z" fill="currentColor"/><path d="M9 15a3 3 0 0 0 3 3" fill="none" stroke="#0b1420" stroke-width="2" stroke-linecap="round"/>',
  quake: '<path d="M2 12l5-4 3 5 3-8 3 7 3-3 5 3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M2 20h20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  volcano: '<path d="M2 22L9 9h6l7 13z" fill="currentColor"/><path d="M12 1c-2.500 3 0 4.500-1.500 7h4c1.500-2.500-0.500-4-2.500-7z" fill="#ffb02a"/>',
};

export function iconSvg(kind) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = SVG[kind] || SVG.meteor; // static markup from this file, never player text
  return s;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function css(color) {
  return '#' + (color >>> 0).toString(16).padStart(6, '0');
}

/** A round avatar: the platform's head image, or the player's initial on their colour. */
export function avatar(url, name, color) {
  const a = el('span', 'av');
  a.style.setProperty('--c', css(color));
  if (url) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      a.textContent = (name || '?').slice(0, 1).toUpperCase();
    });
    img.src = url;
    a.appendChild(img);
  } else a.textContent = (name || '?').slice(0, 1).toUpperCase();
  return a;
}

export class Hud {
  constructor(root, handlers) {
    this.h = handlers;
    this.root = root;
    this.cache = {};
    const hud = el('div');
    hud.id = 'hud';
    const screens = el('div');
    screens.id = 'screens';
    root.append(hud, screens);
    this.hud = hud;
    this.screens = screens;

    // overlays
    this.fxVig = el('div', 'fx vig');
    this.fxUnder = el('div', 'fx under');
    this.fxHurt = el('div', 'fx hurt');
    this.fxFlash = el('div', 'fx flash');
    this.fxDark = el('div', 'fx dark');
    hud.append(this.fxVig, this.fxUnder, this.fxHurt, this.fxFlash, this.fxDark);

    // top bar
    this.top = el('div', 'top hidden');
    this.kindCell = el('div', 'cell kind');
    this.kindIcon = el('span');
    this.kindName = el('div', 'val outline');
    this.kindCell.append(this.kindIcon, this.kindName);
    this.timerCell = el('div', 'cell timer');
    this.timerLbl = el('div', 'lbl', 'TIME');
    this.timerVal = el('div', 'val outline', '0');
    this.timerCell.append(this.timerLbl, this.timerVal);
    this.roundCell = el('div', 'cell');
    this.roundLbl = el('div', 'lbl', 'DISASTER');
    this.roundVal = el('div', 'val outline', '1/5');
    this.roundCell.append(this.roundLbl, this.roundVal);
    this.bar = el('div', 'bar');
    this.barFill = el('i');
    this.bar.appendChild(this.barFill);
    this.top.append(this.kindCell, this.timerCell, this.roundCell, this.bar);
    hud.appendChild(this.top);

    // top right
    this.tr = el('div', 'tr hidden');
    const stat = el('div', 'stat');
    const c1 = el('div', 'cell');
    c1.append(el('div', 'lbl', 'ALIVE'));
    this.aliveVal = el('div', 'val outline', '0');
    c1.appendChild(this.aliveVal);
    const c2 = el('div', 'cell');
    c2.append(el('div', 'lbl', 'SCORE'));
    this.scoreVal = el('div', 'val outline', '0');
    c2.appendChild(this.scoreVal);
    stat.append(c1, c2);
    this.breath = el('div', 'meter breath hidden');
    this.breath.append(el('i'), el('b', '', 'BREATH'));
    this.health = el('div', 'meter health hidden');
    this.health.append(el('i'), el('b', '', 'HEALTH'));
    this.tr.append(stat, this.breath, this.health);
    hud.appendChild(this.tr);
    this.feedBox = el('div', 'feed');
    hud.appendChild(this.feedBox);
    this.stamina = el('div', 'stamina hide');
    this.staminaFill = el('i');
    this.stamina.appendChild(this.staminaFill);
    hud.appendChild(this.stamina);

    // watching label
    this.watch = el('div', 'watch hidden');
    this.watchName = el('span', 'outline', '');
    this.watch.append(el('span', '', 'WATCHING'), this.watchName, el('kbd', '', 'Q'), el('kbd', '', 'E'));
    hud.appendChild(this.watch);

    // lobby settings
    this.lobby = el('div', 'lobby hidden');
    this.setBox = el('div', 'set');
    this.lobby.appendChild(this.setBox);
    this.tip = el('div', 'tip outline', 'SURVIVE THE DISASTER');
    this.lobby.appendChild(this.tip);
    hud.appendChild(this.lobby);

    // centre stack
    this.center = el('div', 'center');
    hud.appendChild(this.center);

    // title
    this.title = el('div', 'title hidden');
    const logo = el('div', 'logo');
    logo.append(el('span', 'l1', 'DISASTER'), el('span', 'l2', 'ISLAND'));
    const l3 = el('span', 'l3', 'SURVIVAL');
    logo.appendChild(l3);
    this.playBtn = el('button', 'play');
    this.playBtn.type = 'button';
    this.playBtn.append(el('span', '', 'PLAY'), el('kbd', '', 'Enter'));
    this.playBtn.addEventListener('click', () => this.h.onPlay && this.h.onPlay());
    this.title.append(logo, this.playBtn);
    screens.appendChild(this.title);

    // panels (survivors, podium)
    this.panelBox = el('div', 'center');
    this.panelBox.style.pointerEvents = 'none';
    screens.appendChild(this.panelBox);
    this.bannerTimer = 0;
    this.calloutTimer = 0;
  }

  setReduced(on) {
    document.body.classList.toggle('reduced', !!on);
  }

  text(node, value) {
    const v = String(value);
    if (node._v !== v) {
      node._v = v;
      node.textContent = v;
    }
  }

  // ------------------------------------------------------------------------------------------------------- title, lobby

  showTitle(on) {
    if (this.cache.title === on) return;
    this.cache.title = on;
    this.title.classList.toggle('hidden', !on);
    if (on) {
      try {
        this.playBtn.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }
  }

  /** The lobby's settings across the top. `host` gets buttons. */
  setLobby(show, opts) {
    this.lobby.classList.toggle('hidden', !show);
    if (!show) return;
    const key = `${opts.value}|${opts.host}|${opts.options.join(',')}`;
    if (this.cache.lobby === key) return;
    this.cache.lobby = key;
    this.setBox.replaceChildren(el('span', 'lbl', 'DISASTERS'));
    if (opts.host) {
      for (const o of opts.options) {
        const b = el('button', o === opts.value ? 'on' : '', String(o));
        b.type = 'button';
        b.addEventListener('click', () => this.h.onSetting && this.h.onSetting(o));
        this.setBox.appendChild(b);
      }
    } else this.setBox.appendChild(el('span', 'v', String(opts.value)));
  }

  // ------------------------------------------------------------------------------------------------------- round HUD

  /**
   * show; kinds; round; rounds; timer (text); warn (the warning is running); frac (0..1 of the run left, or null)
   */
  setTop(show, o) {
    this.top.classList.toggle('hidden', !show);
    if (!show) return;
    const names = o.kinds.map((k) => INFO[k]?.name ?? '').join(' + ');
    if (this.cache.kinds !== names) {
      this.cache.kinds = names;
      this.kindIcon.replaceChildren(iconSvg(o.kinds[0]));
      if (o.kinds[1]) {
        const sec = iconSvg(o.kinds[1]);
        sec.style.marginLeft = '-6px';
        this.kindIcon.appendChild(sec);
        this.kindIcon.style.display = 'flex';
      } else this.kindIcon.style.display = 'contents';
    }
    this.text(this.kindName, names);
    this.text(this.timerVal, o.timer);
    this.text(this.timerLbl, o.warn ? 'WARNING' : 'TIME');
    this.timerCell.classList.toggle('warn', !!o.warn);
    this.text(this.roundVal, `${o.round}/${o.rounds}`);
    if (o.frac === null || o.frac === undefined) this.bar.classList.add('hidden');
    else {
      this.bar.classList.remove('hidden');
      this.barFill.style.transform = `scaleX(${Math.max(0, Math.min(1, o.frac)).toFixed(3)})`;
      this.barFill.style.background = o.warn ? 'var(--acc)' : '#fff';
    }
  }

  setStat(show, o) {
    this.tr.classList.toggle('hidden', !show);
    if (!show) return;
    this.text(this.aliveVal, `${o.alive}/${o.total}`);
    this.text(this.scoreVal, o.score);
    this.setMeter(this.breath, o.breath);
    this.setMeter(this.health, o.health);
    const st = o.stamina;
    this.stamina.classList.toggle('hide', !(o.showStamina && st < 0.995));
    this.staminaFill.style.transform = `scaleX(${Math.max(0, Math.min(1, st)).toFixed(3)})`;
    this.staminaFill.style.background = o.exhausted ? 'var(--bad)' : '#ffd23f';
  }

  setMeter(node, v) {
    if (v === null || v === undefined) {
      node.classList.add('hidden');
      return;
    }
    node.classList.remove('hidden');
    node.firstChild.style.transform = `scaleX(${Math.max(0, Math.min(1, v)).toFixed(3)})`;
    node.classList.toggle('low', v < 0.3);
  }

  hideStat() {
    this.tr.classList.add('hidden');
    this.stamina.classList.add('hide');
  }

  watching(show, name) {
    this.watch.classList.toggle('hidden', !show);
    if (show) this.text(this.watchName, name || '');
  }

  // ------------------------------------------------------------------------------------------------------- transient

  /** The disaster announcement: icon, name, hint. */
  banner(kinds) {
    this.clearBanner(true);
    const b = el('div', 'banner');
    const icons = el('div');
    icons.style.display = 'flex';
    icons.style.justifyContent = 'center';
    icons.style.gap = '12px';
    for (const k of kinds) icons.appendChild(iconSvg(k));
    b.append(icons, el('div', 'name outline', kinds.map((k) => INFO[k]?.name ?? '').join(' + ')), el('div', 'hint outline', INFO[kinds[0]]?.hint ?? ''));
    this.center.appendChild(b);
    this.bannerEl = b;
  }

  clearBanner(now) {
    const b = this.bannerEl;
    if (!b) return;
    this.bannerEl = null;
    if (now) b.remove();
    else {
      b.classList.add('done');
      setTimeout(() => b.remove(), 520);
    }
  }

  callout(text, sub, cls = '', ms = 1800) {
    if (this.calloutEl) this.calloutEl.remove();
    const c = el('div', `callout outline ${cls}`);
    c.textContent = text;
    if (sub) c.appendChild(el('small', '', sub));
    this.center.appendChild(c);
    this.calloutEl = c;
    clearTimeout(this.calloutTimer);
    this.calloutTimer = setTimeout(() => {
      c.classList.add('fade');
      setTimeout(() => c.remove(), 420);
    }, ms);
  }

  clearCallout() {
    if (this.calloutEl) this.calloutEl.remove();
    this.calloutEl = null;
  }

  /** The 3, 2, 1, GO: n is a number, 'GO', or null to clear. */
  countdown(n) {
    if (this.cache.cd === n) return;
    this.cache.cd = n;
    if (this.cdEl) this.cdEl.remove();
    this.cdEl = null;
    if (n === null || n === undefined) return;
    const c = el('div', `cd outline ${n === 'GO' ? 'go' : ''}`, String(n));
    this.center.appendChild(c);
    this.cdEl = c;
  }

  feed(text, me) {
    const d = el('div', me ? 'me' : '', text);
    this.feedBox.appendChild(d);
    while (this.feedBox.children.length > 4) this.feedBox.firstChild.remove();
    setTimeout(() => d.remove(), 3600);
  }

  /** SURVIVORS: who made it. entries: [{ name, color, url, me, out }]. */
  survivors(o) {
    this.hidePanel();
    const p = el('div', 'panel');
    p.appendChild(el('h2', 'ok outline', 'SURVIVORS'));
    if (o.you) p.appendChild(el('div', `you outline ${o.good ? 'good' : 'bad'}`, o.you));
    const list = el('div', 'list');
    const shown = o.entries.slice(0, 14);
    for (const e of shown) {
      const row = el('div', `p${e.me ? ' me' : ''}${e.out ? ' out' : ''}`);
      row.style.setProperty('--c', css(e.color));
      row.append(avatar(e.url, e.name, e.color), el('span', '', e.name));
      list.appendChild(row);
    }
    if (o.entries.length > shown.length) list.appendChild(el('div', 'p', `+${o.entries.length - shown.length}`));
    if (!o.entries.length) list.appendChild(el('div', 'p', 'NOBODY'));
    p.appendChild(list);
    this.panelBox.appendChild(p);
    this.panel = p;
  }

  /** The podium: top 3 and the player's own place. entries sorted: [{ name, color, url, score, place, me }]. */
  podium(o) {
    this.hidePanel();
    const p = el('div', 'panel');
    p.appendChild(el('h2', 'outline', o.title));
    const pod = el('div', 'podium');
    const order = [1, 0, 2];
    for (const i of order) {
      const e = o.top[i];
      if (!e) continue;
      const col = el('div', `col c${i + 1}`);
      col.style.setProperty('--c', css(e.color));
      if (i === 0) col.appendChild(el('div', 'crown', '★'));
      col.appendChild(avatar(e.url, e.name, e.color));
      col.appendChild(el('div', 'nm outline', e.name));
      col.appendChild(el('div', 'pts', `${e.score} SURVIVED`));
      col.appendChild(el('div', 'step', String(e.place)));
      pod.appendChild(col);
    }
    p.appendChild(pod);
    if (o.you) p.appendChild(el('div', `you outline ${o.youGood ? 'good' : ''}`, o.you));
    if (o.awards && o.awards.length) p.appendChild(el('div', 'awards', o.awards.join('   ')));
    this.panelBox.appendChild(p);
    this.panel = p;
  }

  hidePanel() {
    if (this.panel) this.panel.remove();
    this.panel = null;
  }

  // ------------------------------------------------------------------------------------------------------- screen effects

  vignette(on) {
    this.fxVig.classList.toggle('on', !!on);
  }
  underwater(on) {
    this.fxUnder.classList.toggle('on', !!on);
  }
  hurt(a) {
    const v = Math.max(0, Math.min(1, a)).toFixed(2);
    if (this.cache.hurt !== v) {
      this.cache.hurt = v;
      this.fxHurt.style.opacity = v;
    }
  }
  flash() {
    this.fxFlash.classList.remove('on');
    void this.fxFlash.offsetWidth;
    this.fxFlash.classList.add('on');
  }
  darken(on) {
    this.fxDark.classList.toggle('on', !!on);
  }
}
