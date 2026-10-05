import * as THREE from 'three';

/**
 * Third-person orbit camera: drag to turn, never inside a wall or the ground (it pulls in at once and eases back out), and a
 * trauma-driven shake (smooth sine offsets scaled by trauma squared) on the camera only, never on a body.
 */
export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0.3;
    this.pitch = 0.42;
    this.dist = 9;
    this.cur = 9;
    this.trauma = 0;
    this.time = 0;
    this.shakeScale = 1;
    this.pivot = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.minPitch = 0.04;
    this.maxPitch = 1.32;
  }

  addTrauma(v) {
    this.trauma = Math.min(1, this.trauma + v * this.shakeScale);
  }

  turn(dyaw, dpitch) {
    this.yaw += dyaw;
    this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch + dpitch));
  }

  /** The horizontal direction the camera looks (unit), for steering relative to the view. */
  forward(out) {
    out.x = -Math.sin(this.yaw);
    out.z = -Math.cos(this.yaw);
    return out;
  }

  /** Places the camera behind and above `target` ({ x, y, z } at the feet). `focus` raises the pivot to the head. */
  update(dt, target, orbitOnly = false) {
    this.time += dt;
    const piv = this.pivot.set(target.x, target.y + 1.55, target.z);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp, dz = Math.cos(this.yaw) * cp;
    const want = this.dist;
    let allowed = want;
    if (this.world && !orbitOnly) {
      const f = this.world.clearFraction(piv.x, piv.y, piv.z, piv.x + dx * want, piv.y + dy * want, piv.z + dz * want, 0.38);
      allowed = Math.max(0.9, want * f);
    }
    // in at once, out gently
    const k = allowed < this.cur ? 1 - Math.exp(-dt * 24) : 1 - Math.exp(-dt * 2.4);
    this.cur += (allowed - this.cur) * k;
    if (this.cur > allowed) this.cur = allowed; // never inside anything
    this.pos.set(piv.x + dx * this.cur, piv.y + dy * this.cur, piv.z + dz * this.cur);
    if (this.pos.y < 0.35) this.pos.y = 0.35;
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    const sh = this.trauma * this.trauma;
    const tt = this.time;
    const ox = (Math.sin(tt * 31.7) + Math.sin(tt * 19.3 + 1.7)) * 0.5 * sh * 0.5;
    const oy = (Math.sin(tt * 27.1 + 0.4) + Math.sin(tt * 23.9 + 2.2)) * 0.5 * sh * 0.5;
    const roll = Math.sin(tt * 21.3 + 0.9) * sh * 0.04;
    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(piv.x, piv.y - 0.1, piv.z);
    if (roll !== 0) this.camera.rotateZ(roll);
  }
}
