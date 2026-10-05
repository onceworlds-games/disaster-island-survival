import * as THREE from 'three';
import { rgbOf } from './util.js';

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uScale / max(0.1, -mv.z), 220.0);
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.3, d) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A pool of soft round particles drawn as points: sparks, smoke, dust, confetti. A ring buffer, so emitting never allocates. */
export class Particles {
  constructor(max, additive) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(1);
    this.age = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 11 : 10;
    this.live = 0;
  }

  setScale(s) {
    this.material.uniforms.uScale.value = s;
  }

  /** Releases a particle: position, velocity, life (s), size from/to (world units), colours from/to (sRGB hex), alpha, gravity, drag. */
  emit(x, y, z, vx, vy, vz, life, size0, size1, hex0, hex1, alpha = 1, grav = 0, drag = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    const k3 = i * 3;
    this.pos[k3] = x;
    this.pos[k3 + 1] = y;
    this.pos[k3 + 2] = z;
    this.vel[k3] = vx;
    this.vel[k3 + 1] = vy;
    this.vel[k3 + 2] = vz;
    this.life[i] = Math.max(0.01, life);
    this.age[i] = 0;
    this.s0[i] = size0;
    this.s1[i] = size1;
    const a = rgbOf(hex0), b = rgbOf(hex1);
    this.c0[k3] = a[0];
    this.c0[k3 + 1] = a[1];
    this.c0[k3 + 2] = a[2];
    this.c1[k3] = b[0];
    this.c1[k3 + 1] = b[1];
    this.c1[k3 + 2] = b[2];
    this.a0[i] = alpha;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const age = this.age[i];
      if (age >= this.life[i]) {
        this.size[i] = 0;
        continue;
      }
      live++;
      const k3 = i * 3, k4 = i * 4;
      const na = age + dt;
      this.age[i] = na;
      const u = Math.min(1, na / this.life[i]);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[k3] *= dr;
      this.vel[k3 + 1] = this.vel[k3 + 1] * dr - this.grav[i] * dt;
      this.vel[k3 + 2] *= dr;
      this.pos[k3] += this.vel[k3] * dt;
      this.pos[k3 + 1] += this.vel[k3 + 1] * dt;
      this.pos[k3 + 2] += this.vel[k3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * u;
      this.col[k4] = this.c0[k3] + (this.c1[k3] - this.c0[k3]) * u;
      this.col[k4 + 1] = this.c0[k3 + 1] + (this.c1[k3 + 1] - this.c0[k3 + 1]) * u;
      this.col[k4 + 2] = this.c0[k3 + 2] + (this.c1[k3 + 2] - this.c0[k3 + 2]) * u;
      // fade in quickly, fade out over the last 60%
      const fadeIn = Math.min(1, u * 12);
      const fadeOut = u > 0.4 ? 1 - (u - 0.4) / 0.6 : 1;
      this.col[k4 + 3] = this.a0[i] * fadeIn * fadeOut;
    }
    this.live = live;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  clear() {
    this.age.fill(1);
    this.life.fill(1);
    this.size.fill(0);
    this.sizeAttr.needsUpdate = true;
  }
}
