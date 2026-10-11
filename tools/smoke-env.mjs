// Headless smoke-test harness: lets Node import and run scene-building modules
// with Babylon's NullEngine. Stubs just enough DOM/canvas for DynamicTexture,
// particle textures, etc. Rendering is not verified here — only that code runs
// without throwing. Usage (from project root):
//   node tools/smoke-run.mjs            (runs every module that exists)
function stubCtx(canvas) {
  const target = {
    canvas,
    measureText: (t) => ({ width: String(t).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getLineDash: () => [],
    isPointInPath: () => false,
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return function () {};
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
}
function makeCanvas(w = 300, h = 150) {
  const c = {
    width: w,
    height: h,
    style: {},
    _ctx: undefined,
    getContext(type) {
      if (type === "2d") return (this._ctx ||= stubCtx(this));
      return null;
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }),
    toDataURL: () => "data:image/png;base64,",
    setAttribute() {},
    focus() {},
  };
  return c;
}
// Universal DOM element stub: any unknown property read returns a no-op
// function (that itself returns another stub element), so typical DOM-building
// code (createElement, append, classList, style, addEventListener, animate,
// querySelector...) runs without throwing in Node.
function el(tag = "div", base = null) {
  const store = {
    _ctx: undefined,
    tagName: String(tag).toUpperCase(),
    style: new Proxy({}, { get: (t, p) => (p in t ? t[p] : p === "setProperty" || p === "removeProperty" ? () => {} : ""), set: (t, p, v) => ((t[p] = v), true) }),
    dataset: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains: () => false, replace() {} },
    children: [],
    childNodes: [],
    innerHTML: "",
    textContent: "",
    innerText: "",
    value: "",
    offsetWidth: 100,
    offsetHeight: 100,
    clientWidth: 100,
    clientHeight: 100,
    width: 300,
    height: 150,
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    querySelectorAll: () => [],
    getAttribute: () => null,
    hasAttribute: () => false,
    closest: () => null,
    contains: () => false,
    matches: () => false,
    animate: () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null }),
    getContext(type) {
      if (type === "2d") return (this._ctx ||= makeCanvas(this.width, this.height).getContext("2d"));
      return null;
    },
  };
  if (base) Object.assign(store, base);
  const proxy = new Proxy(store, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === "symbol") return undefined;
      if (/^on[a-z]+$/.test(p)) return null;
      if (["parentNode", "parentElement", "firstChild", "lastChild", "firstElementChild", "nextSibling", "previousSibling", "shadowRoot"].includes(p)) return null;
      return (...args) => {
        if (p === "appendChild" || p === "insertBefore" || p === "replaceChild") return args[0];
        if (p === "querySelector" || p === "getElementById" || p === "cloneNode" || p === "attachShadow") return el();
        return undefined;
      };
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
  });
  return proxy;
}
globalThis.window ??= globalThis;
globalThis.OffscreenCanvas = class { constructor(w, h) { return makeCanvas(w, h); } };
globalThis.document ??= {
  createElement: (tag) => (String(tag).toLowerCase() === "canvas" ? el("canvas", makeCanvas()) : el(tag)),
  createElementNS: (ns, tag) => el(tag),
  createTextNode: (t) => el("#text"),
  createDocumentFragment: () => el("fragment"),
  getElementById: () => el(),
  querySelector: () => el(),
  fonts: { load: async () => [], ready: Promise.resolve(), check: () => true },
  hidden: false,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: el(),
  documentElement: el(),
  visibilityState: "visible",
};
try { globalThis.navigator ??= {}; } catch {}
globalThis.getComputedStyle ??= () => new Proxy({}, { get: () => "" });
globalThis.performance ??= { now: () => Date.now() };
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};
globalThis.devicePixelRatio ??= 1;
globalThis.innerWidth ??= 1280;
globalThis.innerHeight ??= 720;
globalThis.location ??= { search: "", href: "http://localhost/" };
export { makeCanvas };
