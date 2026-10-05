// Everything the disasters look like: meteors and their rings, impacts and craters, the tornado, rain, cracks and lava, falling
// debris, lava balls and the volcano's smoke. All of it is drawn from the prepared round (pure, seeded) and the shared run time,
// so every page shows the same thing, including a player who joins halfway through.

import * as THREE from 'three';
import { Particles } from './particles.js';
import {
  METEOR_TELEGRAPH, BALL_TELEGRAPH, BALL_FLIGHT, DEBRIS_FALL, RUN_MS, TORNADO,
  tornadoAt, ballAt, debrisY, flowLength,
} from '../sim/disasters.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function setInst(mesh, i, x, y, z, sx, sy, sz, ry = 0) {
  _q.setFromAxisAngle(UP, ry);
  mesh.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
}
function setInstE(mesh, i, x, y, z, sx, sy, sz, ex, ey, ez) {
  _q.setFromEuler(_e.set(ex, ey, ez));
  mesh.setMatrixAt(i, _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)));
}
function hashf(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const smooth = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

function stripeTexture() {
  const W = 64, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = hashf(x * 0.37 + y * 11.3) * 0.5 + hashf(Math.floor(x / 4) * 3.1 + y * 0.9) * 0.5;
      const band = 0.5 + 0.5 * Math.sin((x / W) * Math.PI * 2 * 5 + y * 0.12);
      const v = 0.35 + 0.5 * n * band + 0.15 * band;
      const a = Math.max(0, Math.min(1, (v - 0.32) * 2.1));
      const i = (y * W + x) * 4;
      data[i] = 150 + v * 90;
      data[i + 1] = 138 + v * 80;
      data[i + 2] = 118 + v * 70;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const RAIN_VERT = /* glsl */ `
attribute vec3 aOff;
attribute float aEnd;
uniform vec3 uCam;
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
uniform vec2 uWind;
varying float vA;
void main() {
  vec3 p = aOff;
  p.y -= uTime * uSpeed * (0.85 + fract(aOff.x * 7.3) * 0.3);
  p.xz += uWind * uTime * 0.6;
  vec3 w = mod(p - uCam + 24.0, 48.0) - 24.0 + uCam;
  w.y += aEnd * uLen;
  w.xz -= aEnd * uWind * 0.07;
  vA = 1.0 - aEnd * 0.9;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vA);
  #include <colorspace_fragment>
}
`;

export class Effects {
  /**
   * @param scene       the three scene
   * @param world       the collision world (for heights and the hill)
   * @param opts        { rand: () => number (visual randomness), quality: 'low'|'medium'|'high' }
   */
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.rand = opts.rand || Math.random;
    this.qf = 1;
    this.time = 0;
    this.round = null;
    this.lastT = -1e9;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.hill = world.map.hill;
    this.onImpact = null; // (kind, x, y, z, power 0..1)
    this.tornadoPos = { x: 0, z: 0, dist: 0 };
    this.tornadoOn = false;
    this.quake = 0;

    this.fire = new Particles(1100, true);
    this.smoke = new Particles(1300, false);
    this.group.add(this.fire.points, this.smoke.points);

    const flat = (color, opacity, additive = false) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const inst = (geo, mat, n, order = 0) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = order;
      m.setColorAt(0, _c.set(0xffffff));
      this.group.add(m);
      return m;
    };
    const ringGeo = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
    const discGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    // target rings and discs for meteors and lava balls (red / orange)
    this.rings = inst(ringGeo, flat(0xffffff, 0.9), 24, 4);
    this.discs = inst(discGeo, flat(0xffffff, 0.2), 24, 3);
    this.shocks = inst(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), flat(0xffffff, 1, true), 16, 5);
    this.craters = inst(discGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 90, 1);
    this.craterRims = inst(new THREE.RingGeometry(0.6, 1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 90, 1);
    this.shocklist = [];
    // falling meteors and lava balls
    const rock = new THREE.IcosahedronGeometry(1, 0);
    this.rocks = inst(rock, new THREE.MeshBasicMaterial({ color: 0xffffff }), 40, 6);
    // debris chunks and their shadows (earthquake)
    this.chunks = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }), 130, 0);
    this.chunks.castShadow = true;
    this.chunkShadows = inst(discGeo, flat(0x000000, 0.4), 40, 3);
    // cracks and lava strips
    const slab = new THREE.BoxGeometry(1, 0.05, 1).translate(0, 0.025, 0);
    this.lava = inst(slab, new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 120, 2);
    // tornado
    this.tex = [stripeTexture(), stripeTexture(), stripeTexture()];
    const funnel = (rt, rb, h, opacity, tex, order) => {
      const geo = new THREE.CylinderGeometry(rt, rb, h, 28, 5, true).translate(0, h / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, color: 0xd8cbb0 });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = order;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.funnels = [
      funnel(6.4, 2.3, 34, 0.62, this.tex[0], 7),
      funnel(4.8, 1.6, 31, 0.5, this.tex[1], 8),
      funnel(8.2, 3.8, 28, 0.32, this.tex[2], 6),
    ];
    this.tdebris = inst(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), 56, 0);
    for (let i = 0; i < 56; i++) this.tdebris.setColorAt(i, _c.set([0x5a4630, 0x6d6a60, 0x3d3a34, 0x8a7350][i % 4]));
    // flood: beams of light over the three places that stay dry, so the goal is on screen
    this.beacons = this.world.map.highPoints.map((hp) => {
      const geo = new THREE.CylinderGeometry(0.8, 1.3, 20, 18, 1, true).translate(0, 10, 0);
      const mat = new THREE.MeshBasicMaterial({ color: 0x7be8ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(hp.x, hp.y + 0.1, hp.z);
      m.visible = false;
      m.renderOrder = 9;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    // rain
    const N = 1100;
    const off = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    const rr = this.rand;
    for (let i = 0; i < N; i++) {
      const x = rr() * 48, y = rr() * 48, z = rr() * 48;
      for (let k = 0; k < 2; k++) {
        off[(i * 2 + k) * 3] = x;
        off[(i * 2 + k) * 3 + 1] = y;
        off[(i * 2 + k) * 3 + 2] = z;
        end[i * 2 + k] = k;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    rg.setAttribute('aOff', new THREE.BufferAttribute(off, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSpeed: { value: 30 }, uLen: { value: 1.3 },
        uWind: { value: new THREE.Vector2(3, 1) }, uColor: { value: new THREE.Color(0xbfe9ff) }, uAlpha: { value: 0.5 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 12;
    this.rain.visible = false;
    this.group.add(this.rain);
  }

  setQuality(q) {
    this.qf = q === 'low' ? 0.4 : q === 'medium' ? 0.75 : 1;
  }

  setScale(s) {
    this.fire.setScale(s);
    this.smoke.setScale(s);
  }

  /** A new round (or null for calm): forget the last one's marks. */
  setRound(round) {
    this.round = round;
    this.lastT = -1e9;
    this.fire.clear();
    this.smoke.clear();
    this.shocklist.length = 0;
    this.funnels.forEach((f) => (f.visible = false));
    this.tornadoOn = false;
    this.quake = 0;
    this.rain.visible = false;
    for (const b of this.beacons) b.visible = false;
    for (const m of [this.rings, this.discs, this.shocks, this.craters, this.craterRims, this.rocks, this.chunks, this.chunkShadows, this.lava, this.tdebris]) m.count = 0;
  }

  // ---------------------------------------------------------------------------------------------------- helpers

  em(n) {
    return Math.max(1, Math.round(n * this.qf));
  }

  explosion(x, y, z, lava, power = 1) {
    const r = this.rand;
    const c0 = lava ? 0xffd070 : 0xffe9a0, c1 = lava ? 0xe03a08 : 0xff4a14;
    const nf = this.em(34 * power);
    for (let i = 0; i < nf; i++) {
      const a = r() * Math.PI * 2, u = r(), sp = 2 + r() * 8;
      this.fire.emit(x + Math.cos(a) * u, y + 0.3, z + Math.sin(a) * u, Math.cos(a) * sp, 2 + r() * 7, Math.sin(a) * sp, 0.45 + r() * 0.5, 1.5 + r() * 1.2, 0.3, c0, c1, 0.95, 4, 1.5);
    }
    const ns = this.em(26 * power);
    for (let i = 0; i < ns; i++) {
      const a = r() * Math.PI * 2, sp = 5 + r() * 12;
      this.fire.emit(x, y + 0.4, z, Math.cos(a) * sp, 5 + r() * 12, Math.sin(a) * sp, 0.6 + r() * 0.7, 0.28, 0.05, 0xfff2b0, c1, 1, 22, 0.4);
    }
    const nm = this.em(22 * power);
    for (let i = 0; i < nm; i++) {
      const a = r() * Math.PI * 2, sp = 1 + r() * 4;
      this.smoke.emit(x + Math.cos(a) * 1.2, y + 0.6, z + Math.sin(a) * 1.2, Math.cos(a) * sp, 1.5 + r() * 3, Math.sin(a) * sp, 1.4 + r() * 1.2, 1.8, 5.5, lava ? 0x3a2a24 : 0x4a423c, 0x1e1b19, 0.8, -0.4, 0.9);
    }
    const nd = this.em(10 * power);
    for (let i = 0; i < nd; i++) {
      const a = r() * Math.PI * 2, sp = 3 + r() * 7;
      this.smoke.emit(x, y + 0.3, z, Math.cos(a) * sp, 6 + r() * 8, Math.sin(a) * sp, 1.0 + r() * 0.6, 0.45, 0.35, 0x6b5a48, 0x3d342b, 1, 24, 0.2);
    }
    this.fire.emit(x, y + 1.2, z, 0, 0, 0, 0.2, 9 * power, 14 * power, 0xfff6d0, 0xffc060, 0.9, 0, 0);
    this.shocklist.push({ x, y, z, age: 0 });
    if (this.shocklist.length > 14) this.shocklist.shift();
  }

  dustPuff(x, y, z, n = 6, color = 0xcdbf9f, size = 0.9) {
    const r = this.rand;
    for (let i = 0; i < this.em(n); i++) {
      const a = r() * Math.PI * 2, sp = 0.6 + r() * 1.6;
      this.smoke.emit(x, y + 0.1, z, Math.cos(a) * sp, 0.6 + r() * 1.2, Math.sin(a) * sp, 0.5 + r() * 0.4, size * 0.5, size * 1.4, color, 0x8f866f, 0.6, -0.5, 2.2);
    }
  }

  splash(x, y, z, n = 14) {
    const r = this.rand;
    for (let i = 0; i < this.em(n); i++) {
      const a = r() * Math.PI * 2, sp = 1 + r() * 3;
      this.smoke.emit(x, y, z, Math.cos(a) * sp, 3 + r() * 3.5, Math.sin(a) * sp, 0.6 + r() * 0.4, 0.28, 0.12, 0xe8f6ff, 0xa8d4ee, 0.9, 14, 0.2);
    }
  }

  bubbles(x, y, z, n = 2) {
    const r = this.rand;
    for (let i = 0; i < n; i++) this.smoke.emit(x + (r() - 0.5) * 0.5, y + 1.6, z + (r() - 0.5) * 0.5, (r() - 0.5) * 0.3, 1.4 + r(), (r() - 0.5) * 0.3, 1.0 + r() * 0.6, 0.18, 0.28, 0xd6f3ff, 0xffffff, 0.8, -0.1, 0.2);
  }

  confetti(x, y, z, n = 40) {
    const r = this.rand;
    const cols = [0xff4d6d, 0xffd23f, 0x4cc9f0, 0x80ed99, 0xc77dff, 0xffffff, 0xff9f1c];
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, sp = 2 + r() * 7;
      const c = cols[Math.floor(r() * cols.length)];
      this.smoke.emit(x, y, z, Math.cos(a) * sp, 6 + r() * 7, Math.sin(a) * sp, 2.2 + r() * 1.4, 0.22, 0.2, c, c, 1, 12, 0.6);
    }
  }

  // ---------------------------------------------------------------------------------------------------- the frame

  /**
   * @param dt       seconds
   * @param t        run time in ms (negative in the warning); NaN or undefined with no round
   * @param cam      camera position { x, y, z }
   * @param covered  the local player stands under a roof (rain is thinner)
   */
  update(dt, t, cam, covered) {
    this.time += dt;
    const round = this.round;
    const live = round && Number.isFinite(t);
    const prev = this.lastT;
    this.lastT = live ? t : -1e9;
    const gap = live && prev > -1e8 ? t - prev : 0;
    const allowEvents = live && prev > -1e8 && gap >= 0 && gap < 900;

    let nRings = 0, nDiscs = 0, nRocks = 0, nCraters = 0, nChunks = 0, nShadows = 0, nLava = 0;
    // a disaster that runs its full time eases away as the result shows
    const away = live ? Math.max(0, Math.min(1, 1 - (t - RUN_MS) / 2000)) : 0;

    if (live && round.has.meteor) {
      for (const m of round.meteors) {
        const dtm = m.at - t;
        if (dtm > METEOR_TELEGRAPH) break;
        if (dtm > 0) {
          const u = 1 - dtm / METEOR_TELEGRAPH;
          const pulse = 0.6 + 0.4 * Math.sin(this.time * (8 + u * 14));
          this.putRing(nRings++, nDiscs++, m.x, m.y + 0.07, m.z, m.r, u, 1.0, 0.16 * pulse + 0.1, 0.1);
          // the falling rock: from the sky down a slanted line to the ring
          const k = dtm / METEOR_TELEGRAPH;
          const px = m.x - 28 * k, py = m.y + 66 * k, pz = m.z - 15 * k;
          const sc = 0.9 + 0.25 * Math.sin(this.time * 9 + m.at);
          setInstE(this.rocks, nRocks, px, py, pz, sc, sc * 1.1, sc, this.time * 3 + m.at, this.time * 2, 0);
          this.rocks.setColorAt(nRocks, _c.setRGB(1.0, 0.45 + 0.3 * k, 0.1 + 0.2 * k, THREE.SRGBColorSpace));
          nRocks++;
          const nt = this.em(3);
          for (let i = 0; i < nt; i++) {
            const rr = this.rand;
            this.fire.emit(px + (rr() - 0.5) * 0.6, py + (rr() - 0.5) * 0.6, pz + (rr() - 0.5) * 0.6, 8 + rr() * 3, -20 - rr() * 6, 4 + rr() * 2, 0.5 + rr() * 0.3, 1.5, 0.3, 0xffd890, 0xff4a14, 0.9, 0, 1.0);
          }
          if (this.rand() < 0.5 * this.qf) this.smoke.emit(px, py, pz, 5, -10, 3, 1.0, 1.3, 3.2, 0x5a4b42, 0x2a2523, 0.55, 0, 1.2);
        } else if (dtm > -9000 && nCraters < 85) {
          this.putCrater(nCraters++, m.x, m.y, m.z, m.r * 0.62, 0x14100d, 0x3a2a20);
        }
        if (allowEvents && m.at > prev && m.at <= t) this.landed(m.x, m.y, m.z, false, 1);
      }
    }

    if (live && round.has.volcano) {
      const hill = this.hill;
      for (const b of round.balls) {
        const dtm = b.at - t;
        if (dtm > BALL_FLIGHT) break;
        const p = ballAt(round, b, t, hill);
        if (p) {
          const sc = 0.85;
          setInstE(this.rocks, nRocks, p.x, p.y, p.z, sc, sc, sc, this.time * 4, this.time * 3, 0);
          this.rocks.setColorAt(nRocks, _c.setRGB(1.0, 0.35 + 0.25 * Math.sin(this.time * 12 + b.at), 0.05, THREE.SRGBColorSpace));
          nRocks++;
          const nt = this.em(2);
          for (let i = 0; i < nt; i++) this.fire.emit(p.x, p.y, p.z, (this.rand() - 0.5) * 2, (this.rand() - 0.5) * 2, (this.rand() - 0.5) * 2, 0.5, 1.1, 0.2, 0xffc060, 0xe03a08, 0.9, 0, 1);
          if (this.rand() < 0.5 * this.qf) this.smoke.emit(p.x, p.y, p.z, 0, 0.5, 0, 1.0, 0.9, 2.2, 0x4a3b34, 0x201c1a, 0.5, -0.3, 0.8);
        }
        if (dtm > 0 && dtm <= BALL_TELEGRAPH) {
          const u = 1 - dtm / BALL_TELEGRAPH;
          const pulse = 0.6 + 0.4 * Math.sin(this.time * (8 + u * 14));
          this.putRing(nRings++, nDiscs++, b.x, b.y + 0.07, b.z, b.r, u, 1.0, 0.55 + 0.1 * pulse, 0.05);
        } else if (dtm <= 0 && dtm > -9000 && nCraters < 85) {
          const cool = smooth(-dtm / 6000);
          this.putCrater(nCraters++, b.x, b.y, b.z, b.r * 0.7, mix(0xff6a1a, 0x2a1a14, cool), mix(0xffb040, 0x4a3022, cool));
        }
        if (allowEvents && b.at > prev && b.at <= t) this.landed(b.x, b.y, b.z, true, 0.9);
        if (allowEvents && b.at - BALL_FLIGHT > prev && b.at - BALL_FLIGHT <= t) this.eruptBurst();
      }
      // the mountain smokes while the volcano runs
      const rate = this.qf * 36 * dt * away;
      let n = Math.floor(rate) + (this.rand() < rate - Math.floor(rate) ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const r = this.rand;
        this.smoke.emit(hill.x + (r() - 0.5) * 2, hill.top + 0.8, hill.z + (r() - 0.5) * 2, (r() - 0.3) * 1.5, 6 + r() * 5, (r() - 0.5) * 1.5, 3.2 + r() * 2, 2.5, 9, 0x4a3d38, 0x1a1514, 0.62, -0.5, 0.35);
      }
      n = Math.floor(this.qf * 6 * dt + this.rand());
      for (let i = 0; i < n; i++) this.fire.emit(hill.x + (this.rand() - 0.5) * 2, hill.top + 0.6, hill.z + (this.rand() - 0.5) * 2, 0, 3 + this.rand() * 3, 0, 0.8, 1.6, 0.4, 0xffb040, 0xe03a08, 0.8, 0, 0.5);
      // lava flows
      round.flows.forEach((f, fi) => {
        const len = flowLength(f, t);
        if (len <= 0) return;
        const seg = 2.2;
        const count = Math.ceil(len / seg);
        for (let k = 0; k < count && nLava < 118; k++) {
          const s0 = k * seg;
          const l = Math.min(seg, len - s0) * 1.15;
          const mid = s0 + Math.min(seg, len - s0) / 2;
          const wig = Math.sin(k * 1.3 + fi * 2) * 0.45;
          const px = f.ox + f.dx * mid - f.dz * wig, pz = f.oz + f.dz * mid + f.dx * wig;
          const wv = f.w * (0.85 + 0.25 * hashf(k + fi * 17));
          const pulse = 0.5 + 0.5 * Math.sin(this.time * 4 + k * 0.9);
          setInst(this.lava, nLava, px, 0.06 + fi * 0.002, pz, l, 1, wv, -Math.atan2(f.dz, f.dx));
          this.lava.setColorAt(nLava, _c.setRGB(1.0, 0.28 + 0.3 * pulse, 0.03 + 0.04 * pulse, THREE.SRGBColorSpace));
          nLava++;
        }
        if (this.rand() < 0.7 * this.qf) {
          const k = this.rand() * len;
          this.fire.emit(f.ox + f.dx * k + (this.rand() - 0.5) * f.w * 0.6, 0.3, f.oz + f.dz * k + (this.rand() - 0.5) * f.w * 0.6, 0, 1.5 + this.rand() * 2, 0, 0.9, 0.5, 0.1, 0xffc060, 0xe03a08, 0.7, -0.5, 0.4);
        }
      });
    }

    if (live && round.has.quake) {
      this.quake = Math.min(1, Math.max(0, (t + 500) / 1200)) * away;
      round.cracks.forEach((c, ci) => {
        if (t < c.crackAt) return;
        const open = smooth((t - c.openAt) / 700);
        const crack = smooth((t - c.crackAt) / 1200);
        const isLava = t >= c.openAt;
        const cs = Math.cos(c.th), sn = Math.sin(c.th);
        const segs = 5;
        for (let k = 0; k < segs && nLava < 118; k++) {
          const u = ((k + 0.5) / segs - 0.5) * c.len;
          const j = (hashf(ci * 13 + k) - 0.5);
          const lat = j * 0.9;
          const px = c.x + cs * u - sn * lat, pz = c.z + sn * u + cs * lat;
          const ang = -(c.th + (hashf(ci * 7 + k * 3) - 0.5) * 0.4);
          const wv = c.w * (0.12 + 0.88 * open) * (0.8 + hashf(ci + k * 5) * 0.4) * (0.35 + 0.65 * crack);
          setInst(this.lava, nLava, px, 0.055 + ci * 0.001, pz, (c.len / segs) * 1.3, 1, Math.max(0.12, wv), ang);
          if (isLava) {
            const pulse = 0.5 + 0.5 * Math.sin(this.time * 5 + k * 1.7 + ci);
            this.lava.setColorAt(nLava, _c.setRGB(1.0, 0.25 + 0.32 * pulse, 0.03 + 0.05 * pulse, THREE.SRGBColorSpace));
          } else this.lava.setColorAt(nLava, _c.setRGB(0.07, 0.05, 0.045, THREE.SRGBColorSpace));
          nLava++;
        }
        if (isLava && this.rand() < 0.6 * this.qf) {
          const u = (this.rand() - 0.5) * c.len;
          this.fire.emit(c.x + cs * u, 0.3, c.z + sn * u, 0, 1.2 + this.rand() * 2.2, 0, 1.0, 0.45, 0.1, 0xffc060, 0xe03a08, 0.75, -0.4, 0.4);
        } else if (!isLava && this.rand() < 0.5 * this.qf) {
          const u = (this.rand() - 0.5) * c.len;
          this.smoke.emit(c.x + cs * u, 0.1, c.z + sn * u, 0, 0.8, 0, 0.8, 0.5, 1.2, 0x8f836c, 0x6a604e, 0.5, 0, 1);
        }
      });
      // debris falling beside the buildings, and the rubble it leaves
      const list = round.debris;
      let rubble = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const d = list[i];
        if (d.at - DEBRIS_FALL > t) continue;
        if (d.at < t && rubble++ > 70) continue;
        if (nChunks >= 128) break;
        const y = debrisY(d, t);
        const fall = y !== null;
        const cy = fall ? y : d.y;
        const u = fall ? 1 - (d.at - t) / DEBRIS_FALL : 1;
        const sz = d.size;
        const spin = fall ? u * 3 : 3;
        setInstE(this.chunks, nChunks, d.x, cy + sz * 0.5, d.z, sz * 1.1, sz * 0.8, sz, i * 1.7 + spin, i * 0.9 + spin * 0.6, i * 2.3);
        this.chunks.setColorAt(nChunks, _c.set([0x8a7f72, 0x6f6458, 0x9c9184, 0x7a6f62][i % 4]));
        nChunks++;
        if (fall && nShadows < 38) {
          setInst(this.chunkShadows, nShadows++, d.x, d.y + 0.06, d.z, sz * (0.5 + u * 0.9), 1, sz * (0.5 + u * 0.9));
        }
        if (allowEvents && d.at > prev && d.at <= t) {
          this.dustPuff(d.x, d.y, d.z, 8, 0xb9ab90, 1.4);
          if (this.onImpact) this.onImpact('debris', d.x, d.y, d.z, 0.4);
        }
      }
    }

    this.rings.count = nRings;
    this.discs.count = nDiscs;
    this.rocks.count = nRocks;
    this.craters.count = nCraters;
    this.craterRims.count = nCraters;
    this.chunks.count = nChunks;
    this.chunkShadows.count = nShadows;
    this.lava.count = nLava;

    // shock rings
    let ns = 0;
    for (let i = this.shocklist.length - 1; i >= 0; i--) {
      const s = this.shocklist[i];
      s.age += dt;
      if (s.age > 0.7) {
        this.shocklist.splice(i, 1);
        continue;
      }
      const u = s.age / 0.7;
      const r = 1 + u * 5.5;
      setInst(this.shocks, ns, s.x, s.y + 0.15, s.z, r, 1, r);
      const f = (1 - u) * (1 - u);
      this.shocks.setColorAt(ns, _c.setRGB(f, f * 0.7, f * 0.3, THREE.SRGBColorSpace));
      ns++;
    }
    this.shocks.count = ns;

    // tornado
    if (live && round.has.tornado) {
      const tp = tornadoAt(round, t, this.tornadoPos);
      const grow = Math.max(0.05, Math.min(1, (t + 6000) / 6000)) * Math.max(0.02, away);
      this.tornadoOn = away > 0.01;
      // the ground it will take: a ring where it flings
      if (t > -4000 && away > 0.3) {
        const gy = this.world.topAtPoint(tp.x, tp.z);
        this.putRing(nRings++, nDiscs++, tp.x, gy + 0.09, tp.z, TORNADO.kill * Math.min(1, grow + 0.2), 1, 1.0, 0.72, 0.28);
      }
      const spins = [2.4, -3.0, 1.7];
      this.funnels.forEach((f, i) => {
        f.visible = away > 0.01;
        f.position.set(tp.x, 0, tp.z);
        f.scale.set(grow, grow, grow);
        f.rotation.y += spins[i] * dt;
        f.rotation.z = Math.sin(this.time * 0.7 + i) * 0.03;
        this.tex[i].offset.y -= dt * (0.55 + i * 0.12);
        this.tex[i].offset.x += dt * 0.1 * (i - 1);
      });
      const nd = Math.min(56, Math.round(56 * this.qf));
      for (let j = 0; j < nd; j++) {
        const h = (((j * 0.7371 + this.time * (0.07 + (j % 4) * 0.012)) % 1) * 27 + 0.5) * grow;
        const rad = (1.7 + h * 0.19 + (j % 5) * 0.4) * grow;
        const a = this.time * (2.8 + (j % 3) * 0.45) + j * 2.399;
        setInstE(this.tdebris, j, tp.x + Math.cos(a) * rad, h, tp.z + Math.sin(a) * rad, 1, 1, 1, this.time * (1 + j * 0.13), this.time * 1.7, j);
      }
      this.tdebris.count = nd;
      // the dust skirt along the ground
      const n = Math.round(7 * this.qf * grow);
      for (let i = 0; i < n; i++) {
        const r = this.rand;
        const a = r() * Math.PI * 2, rad = 2.2 + r() * 3.2 * grow;
        const sp = 5 + r() * 3;
        this.smoke.emit(tp.x + Math.cos(a) * rad, 0.3, tp.z + Math.sin(a) * rad, -Math.sin(a) * sp, 1.5 + r() * 3.5, Math.cos(a) * sp, 1.1 + r() * 0.7, 1.4 * grow, 3.4 * grow, 0xa89a7c, 0x6a604e, 0.55, -0.3, 0.7);
      }
    } else if (this.tornadoOn) {
      this.tornadoOn = false;
      this.funnels.forEach((f) => (f.visible = false));
      this.tdebris.count = 0;
    }

    // rain: strong green acid, thin grey drizzle in a flood or a tornado
    const acid = live && round.has.acid && away > 0.01;
    const drizzle = live && (round.has.flood || round.has.tornado) && away > 0.01;
    this.rain.visible = !!(acid || drizzle);
    if (this.rain.visible) {
      const u = this.rainMat.uniforms;
      u.uTime.value = this.time;
      u.uCam.value.set(cam.x, cam.y, cam.z);
      if (acid) {
        u.uColor.value.setRGB(0.72, 1.0, 0.32, THREE.SRGBColorSpace);
        u.uAlpha.value = covered ? 0.18 : 0.62;
        u.uSpeed.value = 34;
        u.uLen.value = 1.6;
      } else {
        u.uColor.value.setRGB(0.78, 0.86, 0.94, THREE.SRGBColorSpace);
        u.uAlpha.value = covered ? 0.1 : 0.3;
        u.uSpeed.value = 28;
        u.uLen.value = 1.2;
      }
      const ramp = Math.max(0, Math.min(1, (t + 4000) / 4000));
      u.uAlpha.value *= ramp * away;
    }

    // the beams stay up while the water is still climbing
    const beamsOn = live && round.has.flood && t < 36000 && away > 0;
    const fade = beamsOn ? Math.min(1, (t + 5500) / 2500) * (t > 30000 ? Math.max(0, 1 - (t - 30000) / 6000) : 1) : 0;
    this.beacons.forEach((m, i) => {
      m.visible = beamsOn && fade > 0.01;
      if (m.visible) m.material.opacity = (0.14 + 0.1 * (0.5 + 0.5 * Math.sin(this.time * 3 + i * 1.7))) * fade;
    });

    // flags for the HUD / audio
    for (const m of [this.rings, this.discs, this.shocks, this.craters, this.craterRims, this.rocks, this.chunks, this.chunkShadows, this.lava, this.tdebris]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.fire.update(dt);
    this.smoke.update(dt);
  }

  putRing(iRing, iDisc, x, y, z, r, u, cr, cg, cb) {
    if (iRing >= 24 || iDisc >= 24) return;
    const k = 0.35 + 0.65 * u;
    setInst(this.rings, iRing, x, y, z, r, 1, r);
    this.rings.setColorAt(iRing, _c.setRGB(cr, cg, cb, THREE.SRGBColorSpace));
    setInst(this.discs, iDisc, x, y - 0.01, z, r * k, 1, r * k);
    this.discs.setColorAt(iDisc, _c.setRGB(cr, cg * 0.5, cb * 0.5, THREE.SRGBColorSpace));
  }

  putCrater(i, x, y, z, r, hex, rim) {
    setInst(this.craters, i, x, y + 0.045, z, r, 1, r);
    this.craters.setColorAt(i, _c.set(hex));
    setInst(this.craterRims, i, x, y + 0.05, z, r * 1.25, 1, r * 1.25);
    this.craterRims.setColorAt(i, _c.set(rim));
  }

  landed(x, y, z, lava, power) {
    this.explosion(x, y, z, lava, power);
    if (this.onImpact) this.onImpact(lava ? 'ball' : 'meteor', x, y, z, power);
  }

  eruptBurst() {
    const hill = this.hill;
    const r = this.rand;
    for (let i = 0; i < this.em(22); i++) {
      const a = r() * Math.PI * 2, sp = 3 + r() * 6;
      this.fire.emit(hill.x, hill.top + 0.8, hill.z, Math.cos(a) * sp, 10 + r() * 10, Math.sin(a) * sp, 0.9 + r() * 0.6, 1.4, 0.3, 0xffd070, 0xe03a08, 0.95, 12, 0.5);
    }
    if (this.onImpact) this.onImpact('erupt', hill.x, hill.top, hill.z, 0.5);
  }

  clearAll() {
    this.setRound(null);
  }
}

function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

