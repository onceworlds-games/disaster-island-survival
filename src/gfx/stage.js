// The 3D stage: renderer, sun and shadows, sky, the animated sea, the island, characters, tags and effects.

import * as THREE from 'three';
import { MeshBuilder } from '../sim/meshbuilder.js';
import { buildWorldGeometry } from './worldgeo.js';
import { geometryFrom, setSrgb } from './util.js';
import { Characters } from './characters.js';
import { TagPool } from './tags.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { skyMix, SKIES } from './skies.js';
import { SEA, ISLAND_VIS } from '../sim/map.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
}
`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.5)) : mix(uHorizon, uHorizon * 0.55, min(1.0, -h * 3.0));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 2.4 + pow(s, 18.0) * 0.22);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Stage {
  /**
   * @param canvas  the page's canvas
   * @param world   the collision world
   * @param opts    { quality, poster, width, height, pixelRatio, rand, makeCanvas }
   */
  constructor(canvas, world, opts = {}) {
    this.world = world;
    this.map = world.map;
    this.poster = !!opts.poster;
    this.quality = opts.quality || 'medium';
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q !== 'low',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.poster,
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setClearColor(0x9fc4e0, 1);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcde3f0, 110, 380);
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.3, 900);
    this.rig = new CameraRig(this.camera, world);
    this.pr = opts.pixelRatio || 1;
    this.w = opts.width || 1280;
    this.h = opts.height || 720;
    this.sunOffset = new THREE.Vector3(-34, 52, 24);
    this.underwater = false;
    this.fovOverride = opts.fov ?? null;
    this.level = SEA;
    this.time = 0;

    // light
    this.hemi = new THREE.HemisphereLight(0xbfe0ff, 0xd8c8a2, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d2, 2.7);
    this.sun.position.copy(this.sunOffset);
    this.sun.castShadow = q !== 'low';
    const sc = this.sun.shadow.camera;
    sc.left = -36;
    sc.right = 36;
    sc.top = 36;
    sc.bottom = -36;
    sc.near = 1;
    sc.far = 170;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 2.5;
    this.shadowSize = q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.scene.add(this.sun, this.sun.target);

    // the island
    const geo = geometryFrom(buildWorldGeometry(this.map));
    this.worldMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    this.worldMesh = new THREE.Mesh(geo, this.worldMat);
    this.worldMesh.castShadow = true;
    this.worldMesh.receiveShadow = true;
    this.scene.add(this.worldMesh);

    // sea
    this.uTime = { value: 0 };
    this.uAmp = { value: 1 };
    const seaGeo = new THREE.PlaneGeometry(900, 900, 150, 150).rotateX(-Math.PI / 2);
    this.seaMat = new THREE.MeshStandardMaterial({ color: 0x1f93c9, roughness: 0.3, metalness: 0.06, flatShading: true, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
    this.seaMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uAmp = this.uAmp;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;\nvarying float vWave;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float w1 = sin(position.x * 0.19 + uTime * 1.25) * 0.17 + sin(position.z * 0.16 - uTime * 1.05) * 0.15 + sin((position.x - position.z) * 0.09 + uTime * 0.6) * 0.22;
          transformed.y += w1 * uAmp;
          vWave = w1;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWave;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.96, 1.0), smoothstep(0.3, 0.5, vWave) * 0.75);`);
    };
    this.sea = new THREE.Mesh(seaGeo, this.seaMat);
    this.sea.position.y = SEA;
    this.sea.renderOrder = 1;
    this.scene.add(this.sea);
    // foam along the shore
    const foamGeo = new THREE.RingGeometry(1.036, 1.07, 128).rotateX(-Math.PI / 2);
    this.foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    this.foam = new THREE.Mesh(foamGeo, this.foamMat);
    this.foam.scale.set(ISLAND_VIS.a, 1, ISLAND_VIS.b);
    this.foam.position.y = SEA + 0.04;
    this.foam.renderOrder = 2;
    this.scene.add(this.foam);

    // sky dome and clouds
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x3f86d4) },
        uHorizon: { value: new THREE.Color(0xcfe7f7) },
        uSunDir: { value: this.sunOffset.clone().normalize() },
        uSunColor: { value: new THREE.Color(0xfff0d2) },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(520, 28, 14), this.skyMat);
    this.skyDome.renderOrder = -10;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
    const cb = new MeshBuilder();
    let seed = 7;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, d = 120 + rnd() * 230, y = 85 + rnd() * 45;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, sz = 12 + rnd() * 16;
      for (let k = 0; k < 4; k++) cb.sphere(cx + (k - 1.5) * sz * 0.55, y + (rnd() - 0.4) * sz * 0.2, cz + (rnd() - 0.5) * sz * 0.4, sz * (0.55 + rnd() * 0.35), sz * 0.32, sz * 0.5, 0xffffff, 1);
    }
    this.cloudMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.92, depthWrite: false });
    this.clouds = new THREE.Mesh(geometryFrom(cb), this.cloudMat);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -9;
    this.scene.add(this.clouds);

    // characters, tags, effects
    this.chars = new Characters(this.scene);
    const makeCanvas = opts.makeCanvas || ((w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });
    this.tags = new TagPool(this.scene, 24, makeCanvas);
    this.fx = new Effects(this.scene, world, { rand: opts.rand, quality: q });
    this.fx.setQuality(q);
    this.mix = {};
    skyMix([], 0, this.mix);
    this.applySky(this.mix);
    this.setSize(this.w, this.h, this.pr);
  }

  setQuality(q) {
    this.quality = q;
    const on = q !== 'low';
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    const size = q === 'high' ? 2048 : 1024;
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.fx.setQuality(q);
    this.worldMat.needsUpdate = true;
    for (const m of this.chars.meshes) m.material.needsUpdate = true;
  }

  /** Canvas size in CSS pixels and the pixel ratio to draw with. */
  setSize(w, h, pr) {
    this.w = Math.max(2, Math.floor(w));
    this.h = Math.max(2, Math.floor(h));
    this.pr = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    // a narrow (portrait) screen needs a wider field of view to see about the same
    this.camera.fov = this.fovOverride ?? (this.camera.aspect < 1 ? 74 : 62);
    this.camera.updateProjectionMatrix();
    const scale = (this.h * pr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.fx.setScale(scale);
  }

  /** Applies a sky mix (see skyMix): colours, light, fog, exposure. */
  applySky(m) {
    this.mix = m;
    const u = this.skyMat.uniforms;
    setSrgb(u.uTop.value, ...m.top);
    setSrgb(u.uHorizon.value, ...m.horizon);
    setSrgb(u.uSunColor.value, ...m.sun);
    setSrgb(this.sun.color, ...m.sun);
    this.sun.intensity = m.sunI;
    setSrgb(this.hemi.color, ...m.hemiSky);
    setSrgb(this.hemi.groundColor, ...m.hemiGround);
    this.hemi.intensity = m.hemiI;
    if (!this.underwater) {
      setSrgb(this.scene.fog.color, ...m.fog);
      this.scene.fog.near = m.fogNear;
      this.scene.fog.far = m.fogFar;
    }
    this.renderer.toneMappingExposure = m.exposure;
    setSrgb(this.seaMat.color, ...m.sea);
    setSrgb(this.cloudMat.color, ...m.cloud);
    this.renderer.setClearColor(this.scene.fog.color, 1);
  }

  /** The sea's height (y) and how rough it is. */
  setWater(level, rough = 1) {
    this.level = level;
    this.sea.position.y = level;
    this.uAmp.value = 0.8 + rough * 0.7;
    this.foam.visible = level < 0.4;
  }

  /** Under the water the world turns to a short blue fog. */
  setUnderwater(flag) {
    if (flag === this.underwater) return;
    this.underwater = flag;
    if (flag) {
      this.scene.fog.color.setRGB(0.03, 0.2, 0.32, THREE.SRGBColorSpace);
      this.scene.fog.near = 1;
      this.scene.fog.far = 42;
      this.renderer.setClearColor(this.scene.fog.color, 1);
    } else this.applySky(this.mix);
  }

  /** Where the sun is, as an offset from what it lights (poster art puts it low). */
  setSunDir(x, y, z) {
    this.sunOffset.set(x, y, z);
    this.skyMat.uniforms.uSunDir.value.copy(this.sunOffset).normalize();
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
  }

  /** Keeps the shadow box around the action. */
  follow(x, y, z) {
    const sx = Math.round(x / 2) * 2, sz = Math.round(z / 2) * 2;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunOffset.x, this.sunOffset.y, sz + this.sunOffset.z);
    this.sun.target.updateMatrixWorld();
  }

  /** Per-frame animation: the sea, the clouds, the world's shiver in an earthquake. */
  update(dt) {
    this.time += dt;
    this.uTime.value = this.time;
    this.clouds.rotation.y += dt * 0.004;
    this.foamMat.opacity = 0.45 + 0.2 * Math.sin(this.time * 1.4);
    const q = this.fx.quake;
    if (q > 0) {
      const a = 0.035 * q;
      this.worldMesh.position.set(Math.sin(this.time * 47) * a, Math.sin(this.time * 61) * a * 0.5, Math.cos(this.time * 53) * a);
    } else this.worldMesh.position.set(0, 0, 0);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}

export { SKIES, skyMix };
