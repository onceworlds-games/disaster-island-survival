import * as THREE from 'three';
import { hexToLinear } from '../sim/meshbuilder.js';

/** A BufferGeometry from a MeshBuilder's arrays. */
export function geometryFrom(mb) {
  const a = mb.arrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.computeBoundingSphere();
  return g;
}

const rgbCache = new Map();
/** Linear rgb [r, g, b] for an sRGB hex colour (cached: particles ask for the same few colours every frame). */
export function rgbOf(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    c = hexToLinear(hex);
    rgbCache.set(hex, c);
  }
  return c;
}

/** Sets a THREE.Color from sRGB 0..1 channels. */
export function setSrgb(color, r, g, b) {
  return color.setRGB(r, g, b, THREE.SRGBColorSpace);
}

export function srgbChannels(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export const lerpv = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
