// Low-poly stylised humanoids drawn with instanced parts: one draw call per body part for every character on the island.
// Each character is a torso, a head with a cap and a dark visor, two arms with hands, two legs with shoes, in the player's colour.

import * as THREE from 'three';
import { MeshBuilder, shade } from '../sim/meshbuilder.js';
import { geometryFrom } from './util.js';
import { tumblePose } from '../sim/tumble.js';

export const MAX_CHARS = 24;
export const SKIN = [0xf1c9a5, 0xe0ac84, 0xc68863, 0x9c6a48, 0x7a4e35, 0xf6d9bd];

const W = 0xffffff;

function torsoGeo() {
  const mb = new MeshBuilder();
  mb.box(-0.28, 0.0, -0.16, 0.28, 0.38, 0.16, W, shade(W, 1.0));
  mb.box(-0.235, -0.3, -0.14, 0.235, 0.0, 0.14, shade(W, 0.82), shade(W, 0.82));
  mb.box(-0.245, -0.32, -0.15, 0.245, -0.22, 0.15, shade(W, 0.55)); // belt
  return geometryFrom(mb);
}
function headGeo() {
  const mb = new MeshBuilder();
  mb.sphere(0, 0, 0, 0.18, 0.2, 0.19, W, 1);
  mb.box(-0.045, -0.2, -0.04, 0.045, -0.11, 0.05, shade(W, 0.9)); // neck
  return geometryFrom(mb);
}
function capGeo() {
  const mb = new MeshBuilder();
  mb.sphere(0, 0.045, -0.005, 0.2, 0.15, 0.21, W, 1);
  mb.box(-0.15, 0.03, 0.14, 0.15, 0.065, 0.3, shade(W, 0.78)); // the brim
  return geometryFrom(mb);
}
function visorGeo() {
  const mb = new MeshBuilder();
  mb.box(-0.15, -0.045, 0.125, 0.15, 0.035, 0.205, 0x11151c);
  return geometryFrom(mb);
}
function armGeo() {
  const mb = new MeshBuilder();
  mb.box(-0.07, -0.5, -0.07, 0.07, 0.04, 0.07, W);
  return geometryFrom(mb);
}
function handGeo() {
  const mb = new MeshBuilder();
  mb.sphere(0, 0, 0, 0.075, 0.08, 0.075, W, 0);
  return geometryFrom(mb);
}
function legGeo() {
  const mb = new MeshBuilder();
  mb.box(-0.1, -0.78, -0.105, 0.1, 0.02, 0.105, W);
  return geometryFrom(mb);
}
function shoeGeo() {
  const mb = new MeshBuilder();
  mb.box(-0.105, -0.9, -0.11, 0.105, -0.76, 0.2, 0x20242b);
  mb.box(-0.105, -0.9, -0.11, 0.105, -0.88, 0.2, 0xe8e8e8);
  return geometryFrom(mb);
}

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _base = new THREE.Matrix4();
const _up = new THREE.Matrix4();
const _hip = new THREE.Matrix4();
const _part = new THREE.Matrix4();
const _aL = new THREE.Matrix4();
const _aR = new THREE.Matrix4();
const _lL = new THREE.Matrix4();
const _lR = new THREE.Matrix4();
const _col = new THREE.Color();
const _pose = { dx: 0, dy: 0, dz: 0, rx: 0, rz: 0, ry: 0, scale: 1 };

/** out = parent * translate(ox, oy, oz) * rotX * rotZ */
function compose(out, parent, ox, oy, oz, rotX, rotZ) {
  out.copy(parent);
  out.multiply(_t.makeTranslation(ox, oy, oz));
  if (rotX) out.multiply(_t.makeRotationX(rotX));
  if (rotZ) out.multiply(_t.makeRotationZ(rotZ));
  return out;
}

export class Characters {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.74, metalness: 0.02 });
    const make = (geo, per, tinted) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_CHARS * per);
      m.castShadow = true;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.count = 0;
      if (tinted) m.setColorAt(0, _col.set(0xffffff));
      this.group.add(m);
      return m;
    };
    this.torso = make(torsoGeo(), 1, true);
    this.head = make(headGeo(), 1, true);
    this.cap = make(capGeo(), 1, true);
    this.visor = make(visorGeo(), 1, false);
    this.arm = make(armGeo(), 2, true);
    this.hand = make(handGeo(), 2, true);
    this.leg = make(legGeo(), 2, true);
    this.shoe = make(shoeGeo(), 2, false);
    this.meshes = [this.torso, this.head, this.cap, this.visor, this.arm, this.hand, this.leg, this.shoe];
    // blob shadows under everyone, so a character always sits on the ground even with real shadows off
    const blob = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.62, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
      MAX_CHARS,
    );
    blob.frustumCulled = false;
    blob.count = 0;
    blob.renderOrder = 2;
    this.group.add(blob);
    this.blob = blob;
    // the marker ring under your own character and the arrow above it at the start of a round
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.ring.renderOrder = 3;
    this.ring.visible = false;
    this.group.add(this.ring);
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.26, 0.55, 4).rotateX(Math.PI),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    this.arrow.renderOrder = 20;
    this.arrow.visible = false;
    this.group.add(this.arrow);
    this.n = 0;
  }

  begin() {
    this.n = 0;
    this.ring.visible = false;
    this.arrow.visible = false;
  }

  /**
   * One character. d: { x, y, z, yaw, speed, phase, air, climb, swim, sprint, color, skin, capColor, gy (ground height under it),
   *   out (seconds since knocked out, or -1), cause, key, me, arrow (show the arrow above it), pulse (time for the marker) }
   */
  add(d) {
    if (this.n >= MAX_CHARS) return;
    let px = d.x, py = d.y, pz = d.z, rx = 0, rz = 0, ry = 0, sc = 1;
    const knocked = d.out !== undefined && d.out >= 0;
    if (knocked) {
      const p = tumblePose(_pose, d.out, d.cause, d.key || 'x');
      if (p.scale <= 0.001) return;
      px += p.dx;
      py += p.dy;
      pz += p.dz;
      rx = p.rx;
      rz = p.rz;
      ry = p.ry;
      sc = p.scale;
    }
    const i = this.n++;
    // the world matrix of the body: turn to face, tumble about the middle of the body, shrink when disappearing
    _base.makeTranslation(px, py + 0.9, pz);
    _t.makeRotationY(d.yaw + ry);
    _base.multiply(_t);
    if (rx !== 0) {
      _t.makeRotationX(rx);
      _base.multiply(_t);
    }
    if (rz !== 0) {
      _t.makeRotationZ(rz);
      _base.multiply(_t);
    }
    if (sc !== 1) {
      _t.makeScale(sc, sc, sc);
      _base.multiply(_t);
    }
    _t.makeTranslation(0, -0.9, 0);
    _base.multiply(_t);

    // animation: legs and arms swing with the stride; air, climbing and swimming have their own poses
    const sp = Math.min(1, (d.speed || 0) / 8);
    let legL = 0, legR = 0, armL = 0, armR = 0, lean = 0, bob = 0, armSpread = 0;
    const ph = d.phase || 0;
    if (knocked) {
      legL = -0.6;
      legR = 0.5;
      armL = -1.4;
      armR = 1.2;
    } else if (d.climb) {
      legL = Math.sin(ph) * 0.7;
      legR = -Math.sin(ph) * 0.7;
      armL = -2.4 + Math.sin(ph) * 0.5;
      armR = -2.4 - Math.sin(ph) * 0.5;
      lean = 0.1;
    } else if (d.swim) {
      legL = Math.sin(ph * 1.4) * 0.5;
      legR = -Math.sin(ph * 1.4) * 0.5;
      armL = -1.3 + Math.sin(ph * 1.4) * 1.1;
      armR = -1.3 - Math.sin(ph * 1.4) * 1.1;
      lean = 0.35;
    } else if (d.air) {
      legL = -0.65;
      legR = 0.45;
      armL = -2.5;
      armR = -2.3;
      armSpread = 0.35;
      lean = 0.05;
    } else {
      const amp = 0.95 * sp;
      legL = Math.sin(ph) * amp;
      legR = -Math.sin(ph) * amp;
      armL = -Math.sin(ph) * amp * 0.95;
      armR = Math.sin(ph) * amp * 0.95;
      lean = (d.sprint ? 0.3 : 0.14) * sp;
      bob = Math.abs(Math.sin(ph)) * 0.07 * sp + Math.sin((d.pulse || 0) * 2) * 0.008 * (1 - sp);
      if (sp < 0.05) {
        armL = Math.sin((d.pulse || 0) * 1.6) * 0.05;
        armR = -armL;
      }
    }
    const tint = d.color;
    // frames: the hips (legs hang from here) and the upper body, which leans forward from the hips
    _hip.copy(_base).multiply(_t.makeTranslation(0, 0.9 + bob, 0));
    _up.copy(_hip).multiply(_t.makeRotationX(lean));

    this.torso.setMatrixAt(i, compose(_part, _up, 0, 0.3, 0, 0, 0));
    this.torso.setColorAt(i, _col.set(tint));
    this.head.setMatrixAt(i, compose(_part, _up, 0, 0.8, 0, 0, 0));
    this.head.setColorAt(i, _col.set(d.skin));
    this.cap.setMatrixAt(i, compose(_part, _up, 0, 0.8, 0, 0, 0));
    this.cap.setColorAt(i, _col.set(d.capColor));
    this.visor.setMatrixAt(i, compose(_part, _up, 0, 0.8, 0, 0, 0));

    compose(_aL, _up, -0.36, 0.6, 0, armL, -armSpread);
    compose(_aR, _up, 0.36, 0.6, 0, armR, armSpread);
    this.arm.setMatrixAt(i * 2, _aL);
    this.arm.setMatrixAt(i * 2 + 1, _aR);
    this.arm.setColorAt(i * 2, _col.set(tint));
    this.arm.setColorAt(i * 2 + 1, _col.set(tint));
    this.hand.setMatrixAt(i * 2, _m.copy(_aL).multiply(_t.makeTranslation(0, -0.54, 0)));
    this.hand.setMatrixAt(i * 2 + 1, _m.copy(_aR).multiply(_t.makeTranslation(0, -0.54, 0)));
    this.hand.setColorAt(i * 2, _col.set(d.skin));
    this.hand.setColorAt(i * 2 + 1, _col.set(d.skin));

    compose(_lL, _hip, -0.12, 0, 0, legL, 0);
    compose(_lR, _hip, 0.12, 0, 0, legR, 0);
    this.leg.setMatrixAt(i * 2, _lL);
    this.leg.setMatrixAt(i * 2 + 1, _lR);
    const pants = shade(tint, 0.38);
    this.leg.setColorAt(i * 2, _col.set(pants));
    this.leg.setColorAt(i * 2 + 1, _col.set(pants));
    this.shoe.setMatrixAt(i * 2, _lL);
    this.shoe.setMatrixAt(i * 2 + 1, _lR);

    // blob shadow under the feet, on the ground (or the roof) they stand over
    if (!knocked || sc > 0.2) {
      const gy = (d.gy === undefined ? d.y : d.gy) + 0.04;
      _m.makeTranslation(d.x, gy, d.z);
      const k = knocked ? Math.max(0.3, sc) : 1;
      _t.makeScale(k, 1, k);
      _m.multiply(_t);
      this.blob.setMatrixAt(i, _m);
    } else {
      _m.makeScale(0, 0, 0);
      this.blob.setMatrixAt(i, _m);
    }

    if (d.me && !knocked) {
      this.ring.visible = true;
      this.ring.position.set(d.x, (d.gy === undefined ? d.y : d.gy) + 0.06, d.z);
      const pulse = 1 + Math.sin((d.pulse || 0) * 4) * 0.04;
      this.ring.scale.set(pulse, 1, pulse);
      this.ring.material.color.set(tint);
      if (d.arrow) {
        this.arrow.visible = true;
        this.arrow.position.set(d.x, d.y + 2.55 + Math.sin((d.pulse || 0) * 5) * 0.12, d.z);
        this.arrow.rotation.y = (d.pulse || 0) * 2;
        this.arrow.material.color.set(tint);
      }
    }
  }

  end() {
    const n = this.n;
    this.torso.count = this.head.count = this.cap.count = this.visor.count = n;
    this.arm.count = this.hand.count = this.leg.count = this.shoe.count = n * 2;
    this.blob.count = n;
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.blob.instanceMatrix.needsUpdate = true;
  }
}

