import assert from 'node:assert/strict';

// A fake Web Audio that checks the rules the real one enforces: exponential ramps need positive values, times can't be NaN.
class Param {
  constructor() {
    this.value = 0;
    this.events = 0;
  }
  check(v, t) {
    assert.ok(Number.isFinite(v), `param value ${v}`);
    assert.ok(t === undefined || Number.isFinite(t), `param time ${t}`);
    this.events++;
  }
  setValueAtTime(v, t) { this.check(v, t); return this; }
  linearRampToValueAtTime(v, t) { this.check(v, t); return this; }
  exponentialRampToValueAtTime(v, t) { this.check(v, t); assert.ok(v > 0, `exponential ramp to ${v}`); return this; }
  setTargetAtTime(v, t, k) { this.check(v, t); assert.ok(k > 0); return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor() {
    this.gain = new Param();
    this.frequency = new Param();
    this.detune = new Param();
    this.Q = new Param();
    this.threshold = new Param();
    this.ratio = new Param();
    this.connections = [];
  }
  connect(n) { this.connections.push(n); return n; }
  start(t = 0, off = 0) { assert.ok(Number.isFinite(t) && Number.isFinite(off)); this.started = true; }
  stop(t) { assert.ok(Number.isFinite(t)); }
}
let madeCount = 0;
class FakeAC {
  constructor() {
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.destination = new Node();
    this.state = 'suspended';
  }
  resume() { this.state = 'running'; }
  createGain() { madeCount++; return new Node(); }
  createOscillator() { madeCount++; return new Node(); }
  createBufferSource() { madeCount++; return new Node(); }
  createBiquadFilter() { madeCount++; return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBuffer(c, len) { return { getChannelData: () => new Float32Array(len) }; }
}
export function installAudio() {
  globalThis.AudioContext = FakeAC;
  // no real timers: the sequencer is stepped by hand
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
}
export const made = () => madeCount;

