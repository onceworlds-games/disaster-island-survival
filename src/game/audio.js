// All sound is synthesised with Web Audio (no files): punchy impacts (a noise burst over a low thump), whooshes, UI ticks, stingers,
// weather beds (wind, rain, rumble), a siren, and a small sequencer playing driving electronic music (128 BPM, A minor).
// Nothing here may throw into the game: every call is guarded, and without an AudioContext everything is a no-op.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this.level = 0; // music intensity: 0 menu, 1 play, 2 danger
    this.musicOn = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.beds = {};
    this.sirenNodes = null;
  }

  /** Call from a tap or key inside the game (browsers only let sound start from one). */
  start() {
    if (this.ctx) {
      try {
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch {
        // ignore
      }
      return;
    }
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 5;
      this.master.connect(this.comp);
      this.comp.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.music.gain.value = 0.0;
      this.music.connect(this.master);
      // one second of white noise, shared
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.ok = true;
      this.makeBeds();
      this.startMusic();
    } catch {
      this.ok = false;
    }
  }

  // ---------------------------------------------------------------------------------------------------- one-shot sounds

  tone(freq, dur, type = 'sine', vol = 0.3, slideTo = 0, delay = 0, bus = null) {
    if (!this.ok) return;
    try {
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(bus || this.sfx);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch {
      // ignore
    }
  }

  burst(dur, freq, vol = 0.3, kind = 'lowpass', q = 0.7, sweepTo = 0, delay = 0) {
    if (!this.ok) return;
    try {
      const c = this.ctx, t = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = kind;
      f.frequency.setValueAtTime(freq, t);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      src.start(t);
      src.stop(t + dur + 0.05);
    } catch {
      // ignore
    }
  }

  click() {
    this.tone(1200, 0.05, 'square', 0.08);
  }
  tick() {
    this.tone(880, 0.07, 'triangle', 0.16);
  }
  countdown(n) {
    if (n > 0) {
      this.tone(520, 0.16, 'square', 0.16);
      this.tone(260, 0.2, 'sine', 0.18);
    } else {
      this.tone(880, 0.4, 'square', 0.18);
      this.tone(1320, 0.5, 'triangle', 0.18, 0, 0.02);
      this.burst(0.35, 3000, 0.12, 'highpass', 0.7);
    }
  }
  jump() {
    this.tone(260, 0.16, 'triangle', 0.14, 520);
    this.burst(0.09, 2200, 0.04, 'highpass');
  }
  land(power = 1) {
    this.tone(95, 0.14, 'sine', Math.min(0.3, 0.1 + power * 0.04), 55);
    this.burst(0.08, 700, Math.min(0.14, 0.04 + power * 0.02), 'lowpass');
  }
  step() {
    this.burst(0.045, 1400 + Math.random() * 500, 0.03, 'bandpass', 1.2);
  }
  splash() {
    this.burst(0.35, 2600, 0.14, 'bandpass', 0.8, 700);
    this.tone(300, 0.18, 'sine', 0.06, 120);
  }
  bubble() {
    this.tone(500 + Math.random() * 300, 0.08, 'sine', 0.05, 900);
  }
  grab() {
    this.tone(330, 0.05, 'square', 0.05);
  }
  /** A meteor or lava ball landing: a noise burst over a low thump. power 0..1 by distance. */
  impact(power = 1, lava = false) {
    const p = Math.max(0.05, Math.min(1, power));
    this.tone(120, 0.5, 'sine', 0.55 * p, 38);
    this.burst(0.55, lava ? 1800 : 2400, 0.4 * p, 'lowpass', 0.6, 160);
    this.burst(0.18, 5000, 0.14 * p, 'highpass');
  }
  whoosh(power = 1) {
    const p = Math.max(0.05, Math.min(1, power));
    this.burst(0.9, 500, 0.16 * p, 'bandpass', 1.4, 3200);
  }
  thud(power = 1) {
    this.tone(80, 0.25, 'sine', 0.3 * Math.min(1, power), 40);
    this.burst(0.12, 500, 0.1 * Math.min(1, power), 'lowpass');
  }
  ko() {
    this.tone(420, 0.45, 'sawtooth', 0.14, 70);
    this.tone(70, 0.4, 'sine', 0.4, 38);
    this.burst(0.3, 1500, 0.18, 'lowpass', 0.7, 200);
  }
  out(other = false) {
    this.tone(300, 0.2, 'triangle', other ? 0.05 : 0.12, 120);
  }
  survive() {
    [0, 4, 7, 12].forEach((s, i) => this.tone(NOTE(69 + s), 0.28, 'triangle', 0.16, 0, i * 0.07));
    this.tone(NOTE(81), 0.5, 'sine', 0.12, 0, 0.3);
  }
  win() {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(NOTE(60 + s), 0.5, 'square', 0.1, 0, i * 0.09));
    [0, 4, 7].forEach((s, i) => this.tone(NOTE(48 + s), 1.2, 'sawtooth', 0.08, 0, 0.5 + i * 0.01));
    this.burst(0.6, 6000, 0.1, 'highpass', 0.7, 0, 0.55);
  }
  lose() {
    [7, 3, 0, -5].forEach((s, i) => this.tone(NOTE(60 + s), 0.4, 'triangle', 0.12, 0, i * 0.12));
  }
  podium() {
    [0, 7, 12, 16].forEach((s, i) => this.tone(NOTE(60 + s), 0.35, 'triangle', 0.13, 0, i * 0.1));
  }
  crack() {
    this.burst(0.25, 900, 0.22, 'bandpass', 2, 200);
    this.tone(60, 0.4, 'sine', 0.3, 35);
  }
  chunk() {
    this.tone(70, 0.3, 'sine', 0.35, 35);
    this.burst(0.3, 800, 0.22, 'lowpass', 0.8, 150);
  }

  /** The siren of a disaster warning: a rising and falling two-tone wail for `secs` seconds. */
  siren(secs = 6) {
    if (!this.ok) return;
    this.stopSiren();
    try {
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sawtooth';
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.3);
      g.gain.setValueAtTime(0.13, t + secs - 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
      for (let k = 0; k < secs * 1.25 + 1; k++) {
        o.frequency.setValueAtTime(560, t + k * 0.8);
        o.frequency.linearRampToValueAtTime(860, t + k * 0.8 + 0.4);
        o.frequency.linearRampToValueAtTime(560, t + k * 0.8 + 0.8);
      }
      o.connect(lp);
      lp.connect(g);
      g.connect(this.sfx);
      o.start(t);
      o.stop(t + secs + 0.1);
      this.sirenNodes = { o, g };
    } catch {
      // ignore
    }
  }
  stopSiren() {
    if (!this.sirenNodes) return;
    try {
      this.sirenNodes.g.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sirenNodes.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      this.sirenNodes.o.stop(this.ctx.currentTime + 0.3);
    } catch {
      // ignore
    }
    this.sirenNodes = null;
  }

  // ---------------------------------------------------------------------------------------------------- weather beds

  makeBeds() {
    const c = this.ctx;
    const bed = (type, freq, q, lfoHz, lfoDepth) => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      src.start();
      let lfo = null;
      if (lfoHz) {
        lfo = c.createOscillator();
        lfo.frequency.value = lfoHz;
        const d = c.createGain();
        d.gain.value = lfoDepth;
        lfo.connect(d);
        d.connect(f.frequency);
        lfo.start();
      }
      return { g, f };
    };
    this.beds.wind = bed('bandpass', 520, 0.8, 0.23, 260);
    this.beds.rain = bed('highpass', 3800, 0.4, 0, 0);
    this.beds.rumble = bed('lowpass', 90, 1.4, 7.3, 22);
    this.beds.sea = bed('lowpass', 420, 0.5, 0.11, 140);
  }

  /** Levels 0..1 for the weather beds, eased. */
  weather(wind, rain, rumble, sea) {
    if (!this.ok) return;
    try {
      const t = this.ctx.currentTime;
      this.beds.wind.g.gain.setTargetAtTime(Math.min(1, wind) * 0.42, t, 0.25);
      this.beds.rain.g.gain.setTargetAtTime(Math.min(1, rain) * 0.07, t, 0.3);
      this.beds.rumble.g.gain.setTargetAtTime(Math.min(1, rumble) * 0.6, t, 0.2);
      this.beds.sea.g.gain.setTargetAtTime(Math.min(1, sea) * 0.1, t, 0.4);
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------------------------------------------- music

  /** 0 menus and lobby, 1 a disaster's warning, 2 the disaster itself, -1 silent (results use stingers). */
  setLevel(level) {
    this.level = level;
    if (!this.ok) return;
    try {
      const target = level < 0 ? 0 : level === 0 ? 0.22 : level === 1 ? 0.4 : 0.55;
      this.music.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
    } catch {
      // ignore
    }
  }

  startMusic() {
    if (!this.ok || this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = setInterval(() => this.schedule(), 30);
    this.setLevel(this.level);
  }

  schedule() {
    if (!this.ok) return;
    try {
      const c = this.ctx;
      const spb = 60 / 128 / 4; // a sixteenth
      while (this.nextTime < c.currentTime + 0.14) {
        this.play(this.step, this.nextTime);
        this.nextTime += spb;
        this.step++;
      }
    } catch {
      // ignore
    }
  }

  play(step, t) {
    const lv = this.level;
    if (lv < 0) return;
    const s16 = step % 16, bar = Math.floor(step / 16) % 8;
    // Am  F  C  G  Am  F  G  E (A minor, a little tension on the last bars)
    const roots = [57, 53, 48, 55, 57, 53, 55, 52][bar];
    const minor = [true, false, false, false, true, false, false, false][bar];
    const third = minor ? 3 : 4;
    // drums
    if (s16 % 4 === 0 && lv >= 0) this.kick(t, lv === 0 ? 0.5 : 1);
    if (lv >= 1 && s16 % 2 === 0) this.hat(t, s16 % 4 === 2 ? 0.5 : 0.25);
    if (lv >= 2) {
      if (s16 === 4 || s16 === 12) this.snare(t);
      if (s16 % 2 === 1) this.hat(t, 0.16);
    }
    // bass: pumping eighths from level 1
    if (lv >= 1 && s16 % 2 === 0) this.bass(t, roots - 12 + (s16 === 6 || s16 === 14 ? 7 : 0), lv >= 2 ? 0.2 : 0.16);
    // pad: a held chord every bar
    if (s16 === 0) this.pad(t, [roots, roots + third, roots + 7].map((n) => n + 12), lv === 0 ? 0.05 : 0.04);
    // arp
    const arp = [0, third, 7, 12, 7, third, 0, third + 12];
    if (lv === 0 ? s16 % 4 === 2 : s16 % 2 === 1) this.arp(t, roots + 24 + arp[(s16 >> 1) % arp.length] - (lv >= 2 ? 0 : 12), lv === 0 ? 0.04 : 0.055);
  }

  osc(t, freq, dur, type, vol, filter = 0, detune = 0) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(filter, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(120, filter * 0.25), t + dur);
      o.connect(f);
      out = f;
    }
    out.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  kick(t, v) {
    const c = this.ctx;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.6 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.3);
  }
  hat(t, v) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.18 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.07);
  }
  snare(t) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.34, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    src.connect(f);
    f.connect(g);
    g.connect(this.music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.2);
    this.osc(t, 190, 0.1, 'triangle', 0.2);
  }
  bass(t, note, v) {
    this.osc(t, NOTE(note), 0.2, 'sawtooth', v, 900);
  }
  pad(t, notes, v) {
    const dur = (60 / 128) * 4;
    for (const n of notes) {
      this.osc(t, NOTE(n), dur, 'sawtooth', v, 1400, -7);
      this.osc(t, NOTE(n), dur, 'sawtooth', v, 1400, 7);
    }
  }
  arp(t, note, v) {
    this.osc(t, NOTE(note), 0.16, 'square', v, 2600);
  }
}
