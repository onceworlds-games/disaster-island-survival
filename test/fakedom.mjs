// A very small DOM, enough to run the HUD and the name tags in node.
export class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._cls = new Set();
    this.style = { setProperty: (k, v) => (this.style[k] = v) };
    this.listeners = {};
    this.attrs = {};
    this._text = '';
    this.parent = null;
  }
  get className() {
    return [...this._cls].join(' ');
  }
  set className(v) {
    this._cls = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get classList() {
    const s = this._cls;
    return {
      add: (...c) => c.forEach((x) => s.add(x)),
      remove: (...c) => c.forEach((x) => s.delete(x)),
      toggle: (c, on) => {
        const want = on === undefined ? !s.has(c) : !!on;
        if (want) s.add(c);
        else s.delete(c);
        return want;
      },
      contains: (c) => s.has(c),
    };
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  set innerHTML(v) {
    this._html = v;
    this.children = [];
  }
  get offsetWidth() {
    return 0;
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  append(...cs) {
    for (const c of cs) this.appendChild(typeof c === 'string' ? Object.assign(new FakeEl('#text'), { _text: c }) : c);
  }
  replaceChildren(...cs) {
    this.children = [];
    this.append(...cs);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
  }
  focus() {}
  find(pred) {
    if (pred(this)) return this;
    for (const c of this.children) {
      const f = c.find(pred);
      if (f) return f;
    }
    return null;
  }
  click() {
    for (const f of this.listeners.click ?? []) f({});
  }
}

export function installDom() {
  const body = new FakeEl('body');
  globalThis.document = {
    body,
    fonts: { ready: Promise.resolve() },
    hidden: false,
    createElement: (t) => new FakeEl(t),
    createElementNS: (ns, t) => new FakeEl(t),
    addEventListener() {},
  };
  globalThis.Image = class {
    constructor() {
      this.listeners = {};
      this.complete = false;
      this.naturalWidth = 0;
    }
    addEventListener(ev, fn) {
      this.listeners[ev] = fn;
    }
    remove() {}
  };
  globalThis.addEventListener = () => {};
  globalThis.setTimeout = globalThis.setTimeout;
  return body;
}

/** A 2D context that accepts every call. */
export function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 12 });
      return (...a) => {
        calls.push([k, ...a]);
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  return ctx;
}
