// Keyboard, mouse-drag and touch input for the character and the camera. The platform's stick and buttons press real keys
// (the stick in analog mode only fills ow.controls.stick), so this reads both and sums them.

const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(canvas, ow) {
    this.canvas = canvas;
    this.ow = ow;
    this.keys = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.pointer = null; // { id, x, y, moved, t0 }
    this.tapped = false;
    this.onKey = null; // (code, event) for one-shot keys
    this.enabled = true;
    this.pressedOnce = new Set();
    const prevent = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
    this._kd = (e) => {
      if (e.repeat) {
        if (prevent.has(e.code)) e.preventDefault();
        return;
      }
      if (prevent.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressedOnce.add(e.code);
      if (this.onKey) this.onKey(e.code, e);
    };
    this._ku = (e) => {
      this.keys.delete(e.code);
    };
    this._blur = () => {
      this.keys.clear();
      this.pointer = null;
    };
    addEventListener('keydown', this._kd);
    addEventListener('keyup', this._ku);
    addEventListener('blur', this._blur);
    document.addEventListener('visibilitychange', () => document.hidden && this._blur());
    canvas.addEventListener('pointerdown', (e) => {
      if (this.pointer) return;
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t0: performance.now() };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // some browsers refuse capture
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      p.moved += Math.abs(dx) + Math.abs(dy);
      if (this.enabled) {
        const k = e.pointerType === 'mouse' ? 1 : 1.25;
        this.lookX += dx * k;
        this.lookY += dy * k;
      }
    });
    const up = (e) => {
      const p = this.pointer;
      if (!p || p.id !== e.pointerId) return;
      if (p.moved < 10 && performance.now() - p.t0 < 450) this.tapped = true;
      this.pointer = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  held(code) {
    return this.keys.has(code);
  }

  /** True once per key press (cleared by reading). */
  once(code) {
    return this.pressedOnce.delete(code);
  }

  /** Right (x) and forward (y) from the keyboard and the platform's stick, each -1..1 with a round dead zone. */
  move(out) {
    let x = 0, y = 0;
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) {
        x += m[0];
        y += m[1];
      }
    }
    const c = this.ow && this.ow.controls;
    if (c && c.stick && (c.stick.x !== 0 || c.stick.y !== 0)) {
      x += c.stick.x;
      y += -c.stick.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    out.x = x;
    out.y = y;
    return out;
  }

  jump() {
    const c = this.ow && this.ow.controls;
    return this.keys.has('Space') || !!(c && c.pressed && c.pressed('jump'));
  }

  sprint() {
    const c = this.ow && this.ow.controls;
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || !!(c && c.pressed && c.pressed('sprint'));
  }

  /** Keyboard camera turn (Q and E), -1..1. */
  turnKeys() {
    return (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0);
  }

  /** Accumulated camera drag since the last call: { x, y } in pixels. */
  takeLook(out) {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  takeTap() {
    const t = this.tapped;
    this.tapped = false;
    return t;
  }

  /** End of a frame: one-shot presses that nothing read are dropped. */
  endFrame() {
    this.pressedOnce.clear();
  }
}
