// Name tags over every character: a flat dark panel with the player's colour edge, their avatar head and name, a READY tick.
// Drawn on canvases with fillText only (names come from other players), one sprite per slot, redrawn only when something changes.

import * as THREE from 'three';

const W = 360, H = 84;
export const FONT = '"Bebas Neue", "Arial Narrow", sans-serif';

function hexCss(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0');
}

export function drawTag(ctx, t) {
  ctx.clearRect(0, 0, W, H);
  const r = 12;
  ctx.fillStyle = t.me ? 'rgba(10,14,22,0.9)' : 'rgba(10,14,22,0.74)';
  ctx.fillRect(r, 10, W - r * 2, H - 20);
  ctx.fillStyle = hexCss(t.color);
  ctx.fillRect(r, 10, 7, H - 20);
  if (t.me) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r + 1, 11, W - r * 2 - 2, H - 22);
  }
  // avatar head in a circle, or the initial while it loads
  const cx = r + 7 + 31, cy = H / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 27, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = hexCss(t.color);
  ctx.fillRect(cx - 28, cy - 28, 56, 56);
  if (t.img && t.img.complete && t.img.naturalWidth > 0) {
    try {
      ctx.drawImage(t.img, cx - 28, cy - 28, 56, 56);
    } catch {
      // a canvas tainted by an avatar that wouldn't load with CORS: keep the initial
    }
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = `46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((t.name || '?').slice(0, 1).toUpperCase(), cx, cy + 3);
  }
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.font = `46px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let name = t.name || '';
  const maxW = W - 120 - (t.ready ? 44 : 0);
  while (name.length > 1 && ctx.measureText(name).width > maxW) name = name.slice(0, -1);
  if (name !== t.name) name = name.slice(0, -1) + '.';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.fillText(name, cx + 38, cy + 3);
  ctx.shadowBlur = 0;
  if (t.ready) {
    ctx.fillStyle = '#35e08a';
    ctx.beginPath();
    ctx.arc(W - 40, cy, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#06210f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(W - 48, cy);
    ctx.lineTo(W - 41, cy + 7);
    ctx.lineTo(W - 30, cy - 7);
    ctx.stroke();
  }
}

export class TagPool {
  constructor(scene, max, makeCanvas) {
    this.sprites = [];
    this.state = [];
    this.makeCanvas = makeCanvas;
    this.n = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.redraw = 0;
    for (let i = 0; i < max; i++) {
      const canvas = makeCanvas(W, H);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false });
      const s = new THREE.Sprite(mat);
      s.center.set(0.5, 0);
      s.visible = false;
      s.renderOrder = 15;
      this.group.add(s);
      this.sprites.push({ sprite: s, canvas, tex, ctx: canvas.getContext('2d'), key: '' });
    }
  }

  begin() {
    this.n = 0;
  }

  /** t: { x, y, z, name, color, img, ready, me, dist } (y is the top of the head). */
  add(t) {
    if (this.n >= this.sprites.length) return;
    const slot = this.sprites[this.n++];
    const key = `${t.name}|${t.color}|${t.ready ? 1 : 0}|${t.me ? 1 : 0}|${t.img && t.img.complete ? 1 : 0}|${this.redraw}`;
    if (slot.key !== key && slot.ctx) {
      slot.key = key;
      drawTag(slot.ctx, t);
      slot.tex.needsUpdate = true;
    }
    const s = slot.sprite;
    s.visible = true;
    s.position.set(t.x, t.y, t.z);
    const k = Math.max(0.9, Math.min(3.6, (t.dist || 10) * 0.075)) * (t.me ? 1.05 : 1);
    s.scale.set(k * (W / H) * 0.34, k * 0.34, 1);
  }

  end() {
    for (let i = this.n; i < this.sprites.length; i++) this.sprites[i].sprite.visible = false;
  }

  /** Fonts finished loading: draw every tag again. */
  invalidate() {
    this.redraw++;
  }
}
