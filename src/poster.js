// Store art. With ?poster=<name> the game skips the room and the SDK and draws ONE staged, deterministic frame with the real renderer
// (cover, action, win, icon, badge-<id>), then sets document.body.dataset.ready = '1'. No HUD, and only the cover carries text.

import * as THREE from 'three';
import { buildMap } from './sim/map.js';
import { World } from './sim/collision.js';
import { prepareRound } from './sim/disasters.js';
import { mulberry32 } from './sim/rng.js';
import { Stage } from './gfx/stage.js';
import { skyMix } from './gfx/skies.js';
import { SKIN } from './gfx/characters.js';
import { shade } from './sim/meshbuilder.js';
import { stagePoster } from './game/posterdata.js';

const FONT = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';

function spaced(ctx, text, x, y, spacing, stroke) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  w -= spacing;
  let cx = x - w / 2;
  for (const ch of text) {
    if (stroke) ctx.strokeText(ch, cx, y);
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}

/** The width a spaced line of text takes, and a font size that makes it fit. */
function fit(ctx, text, px, spacing, maxW) {
  ctx.font = `${px}px ${FONT}`;
  let w = -spacing;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w > maxW ? Math.floor((px * maxW) / w) : px;
}

function titleTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 8;
  const p1 = fit(ctx, 'DISASTER ISLAND', 176, 5, w * 0.92);
  ctx.font = `${p1}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(8,10,16,0.7)';
  ctx.lineWidth = 12;
  spaced(ctx, 'DISASTER ISLAND', w / 2, 168, 5, true);
  const p2 = fit(ctx, 'SURVIVAL', 104, 26, w * 0.6);
  ctx.font = `${p2}px ${FONT}`;
  ctx.fillStyle = '#ff5a2a';
  spaced(ctx, 'SURVIVAL', w / 2, 262, 26, true);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function badge(id, canvas) {
  const S = 256;
  canvas.width = S;
  canvas.height = S;
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${S}px;height:${S}px;display:block`;
  const ctx = canvas.getContext('2d');
  const look = {
    survivor: ['#2fd68b', '#0f7a4d'],
    untouchable: ['#7b5cff', '#3a22b8'],
    'storm-chaser': ['#5a7390', '#243344'],
    'first-win': ['#ffcf3f', '#d68a12'],
  }[id] || ['#ff5a2a', '#a82a0a'];
  const cx = S / 2, cy = S / 2;
  const g = ctx.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, 128);
  g.addColorStop(0, look[0]);
  g.addColorStop(1, look[1]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, 106, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 5;
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(128, 48);
    ctx.lineTo(188, 68);
    ctx.lineTo(188, 124);
    ctx.bezierCurveTo(188, 166, 160, 192, 128, 208);
    ctx.bezierCurveTo(96, 192, 68, 166, 68, 124);
    ctx.lineTo(68, 68);
    ctx.closePath();
  };
  ctx.fillStyle = '#ffffff';
  if (id === 'survivor' || id === 'untouchable') {
    shield();
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = look[1];
    if (id === 'survivor') {
      // a heart
      ctx.beginPath();
      ctx.moveTo(128, 170);
      ctx.bezierCurveTo(84, 140, 88, 98, 112, 98);
      ctx.bezierCurveTo(122, 98, 128, 106, 128, 112);
      ctx.bezierCurveTo(128, 106, 134, 98, 144, 98);
      ctx.bezierCurveTo(168, 98, 172, 140, 128, 170);
      ctx.fill();
    } else {
      // a star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 22 : 52, a = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = 128 + Math.cos(a) * r, y = 126 + Math.sin(a) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  } else if (id === 'storm-chaser') {
    const rows = [[128, 140], [128, 114], [128, 90], [128, 66], [128, 44], [128, 26]];
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff';
    rows.forEach(([x, w], i) => {
      const y = 64 + i * 25;
      const off = Math.sin(i * 1.2) * 8;
      ctx.lineWidth = 15;
      ctx.beginPath();
      ctx.moveTo(x - w / 2 + off, y);
      ctx.lineTo(x + w / 2 + off, y);
      ctx.stroke();
    });
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ff7a2a';
    ctx.beginPath();
    ctx.arc(176, 190, 9, 0, Math.PI * 2);
    ctx.arc(84, 176, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'first-win') {
    ctx.beginPath();
    ctx.moveTo(86, 62);
    ctx.lineTo(170, 62);
    ctx.lineTo(170, 108);
    ctx.bezierCurveTo(170, 140, 150, 158, 128, 160);
    ctx.bezierCurveTo(106, 158, 86, 140, 86, 108);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(84, 96, 22, Math.PI * 0.5, Math.PI * 1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(172, 96, 22, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();
    ctx.fillRect(118, 158, 20, 26);
    ctx.fillRect(98, 184, 60, 14);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = look[1];
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 26, a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = 128 + Math.cos(a) * r, y = 102 + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

export async function runPoster(name) {
  const canvas = document.getElementById('stage');
  document.body.style.margin = '0';
  if (name.startsWith('badge-')) {
    // a bold symbol on a coloured disc: plain 2D drawing, no scene needed
    const flat = document.createElement('canvas');
    canvas.style.display = 'none';
    document.body.appendChild(flat);
    badge(name.slice(6), flat);
    document.body.dataset.ready = '1';
    return;
  }
  const map = buildMap();
  const world = new World(map);
  const data = stagePoster(name, world);
  if (!data) return;
  const rand = mulberry32(20261004);
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${data.w}px;height:${data.h}px;display:block`;
  const stage = new Stage(canvas, world, { poster: true, quality: 'high', width: data.w, height: data.h, pixelRatio: 1, rand, fov: data.camera.fov });
  stage.setSize(data.w, data.h, 1);
  stage.setQuality('high');
  const mix = skyMix(data.sky, 1, {});
  stage.applySky(mix);
  stage.setWater(data.water, 1.2);
  stage.uTime.value = 3.4;
  if (data.sunDir) stage.setSunDir(data.sunDir[0] * 60, data.sunDir[1] * 60, data.sunDir[2] * 60);
  const cam = stage.camera;
  cam.position.set(...data.camera.pos);
  cam.lookAt(...data.camera.target);
  cam.updateMatrixWorld();

  // the disaster, frozen at its moment: run the effects up to it so the explosion and the smoke are really there
  if (data.kinds.length) {
    const round = prepareRound(data.kinds, data.seed, world);
    stage.fx.setRound(round);
    const dt = 1 / 30;
    for (let t = data.t - 2400; t <= data.t + 1; t += 1000 / 30) stage.fx.update(dt, t, cam.position, false);
  }
  stage.chars.begin();
  stage.tags.begin();
  data.chars.forEach((c, i) => {
    stage.chars.add({
      x: c.x, y: c.y, z: c.z, yaw: c.yaw, speed: c.speed, phase: c.phase, air: !!c.air, climb: false, swim: false, sprint: !!c.sprint,
      color: c.color, skin: SKIN[(i * 5 + 1) % SKIN.length], capColor: i % 3 === 0 ? 0xeeeeee : shade(c.color, 0.5), gy: c.y,
      out: c.out === undefined ? -1 : c.out, cause: c.cause, key: c.key || `p${i}`, pulse: 1 + i,
    });
  });
  stage.chars.end();
  stage.tags.end();
  const focus = data.chars[0] ? { x: data.chars[0].x, y: 0, z: data.chars[0].z } : { x: 0, y: 0, z: 0 };
  stage.follow(name === 'win' ? 0 : focus.x, 0, name === 'win' ? -15 : focus.z);

  let overlay = null;
  if (data.title) {
    try {
      await document.fonts.load(`176px "Bebas Neue"`);
    } catch {
      // the fallback face is fine
    }
    await document.fonts.ready;
    const scene2 = new THREE.Scene();
    const cam2 = new THREE.OrthographicCamera(-data.w / 2, data.w / 2, data.h / 2, -data.h / 2, -10, 10);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(data.w, data.h),
      new THREE.MeshBasicMaterial({ map: titleTexture(data.w, data.h), transparent: true, toneMapped: false, depthTest: false, depthWrite: false }),
    );
    scene2.add(quad);
    overlay = { scene: scene2, camera: cam2 };
  } else {
    try {
      await document.fonts.ready;
    } catch {
      // nothing to wait for
    }
  }
  const draw = () => {
    stage.renderer.autoClear = true;
    stage.renderer.render(stage.scene, stage.camera);
    if (overlay) {
      stage.renderer.autoClear = false;
      stage.renderer.clearDepth();
      stage.renderer.render(overlay.scene, overlay.camera);
    }
  };
  draw();
  const loop = () => {
    draw();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  setTimeout(() => {
    document.body.dataset.ready = '1';
  }, 400);
}
