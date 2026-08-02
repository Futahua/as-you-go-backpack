/** A DOM stand-in good enough to mount the real workspace composition.
 *
 * The project deliberately carries no DOM library, and the existing controller
 * tests each hand-roll the few nodes they touch. Mounting the whole app needs
 * more than that — every element in the registry, an SVG namespace, and enough
 * of the element API for d3 to attach to — so it lives here once rather than
 * being rebuilt per test.
 *
 * This is not a browser. It models structure, attributes, classes, listeners
 * and geometry stubs; it does not lay anything out. Tests that depend on real
 * measurement or painting cannot be written against it, which is why the live
 * app still has to be driven by hand before a visual claim is made. */

/** Style objects double as plain property bags and as a CSS-variable sink —
 * the app sets custom properties (--icon-size and friends) through
 * setProperty, which a bare object would not answer. */
function createStyle() {
  const custom = new Map();
  return {
    setProperty(name, value) { custom.set(name, value == null ? '' : String(value)); },
    getPropertyValue(name) { return custom.get(name) ?? ''; },
    removeProperty(name) { custom.delete(name); },
  };
}

function createClassList() {
  const set = new Set();
  return {
    add(...names) { for (const name of names) set.add(name); },
    remove(...names) { for (const name of names) set.delete(name); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : force;
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    get value() { return [...set].join(' '); },
  };
}

export function createElement(tagName, { namespace = null } = {}) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    namespaceURI: namespace,
    childNodes: [],
    parentNode: null,
    attributes: new Map(),
    dataset: {},
    style: createStyle(),
    classList: createClassList(),
    hidden: false,
    textContent: '',
    innerHTML: '',
    scrollHeight: 0,
    _listeners: [],

    get children() { return node.childNodes.filter((child) => child.tagName); },
    get firstChild() { return node.childNodes[0] ?? null; },

    appendChild(child) {
      child.parentNode = node;
      node.childNodes.push(child);
      return child;
    },
    insertBefore(child, reference) {
      const index = node.childNodes.indexOf(reference);
      child.parentNode = node;
      node.childNodes.splice(index < 0 ? node.childNodes.length : index, 0, child);
      return child;
    },
    removeChild(child) {
      const index = node.childNodes.indexOf(child);
      if (index >= 0) node.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() { node.parentNode?.removeChild(node); },
    /** d3-selection appends nodes rather than using appendChild directly. */
    append(...children) {
      for (const child of children) {
        node.appendChild(typeof child === 'string' ? { nodeType: 3, textContent: child } : child);
      }
    },
    ownerDocument: null,
    replaceChildren(...children) {
      node.childNodes = [];
      for (const child of children) node.appendChild(child);
    },

    setAttribute(name, value) { node.attributes.set(name, String(value)); },
    getAttribute(name) { return node.attributes.has(name) ? node.attributes.get(name) : null; },
    removeAttribute(name) { node.attributes.delete(name); },
    hasAttribute(name) { return node.attributes.has(name); },

    addEventListener(type, handler, options) {
      const entry = { type, handler, options };
      node._listeners.push(entry);
      options?.signal?.addEventListener?.('abort', () => {
        const index = node._listeners.indexOf(entry);
        if (index >= 0) node._listeners.splice(index, 1);
      });
    },
    removeEventListener(type, handler) {
      node._listeners = node._listeners.filter((e) => !(e.type === type && e.handler === handler));
    },
    /** Fires listeners registered for this type. Tests drive gestures with it. */
    dispatch(type, event = {}) {
      const payload = { type, target: node, preventDefault() {}, stopPropagation() {}, ...event };
      for (const entry of [...node._listeners]) {
        if (entry.type === type) entry.handler(payload);
      }
      return payload;
    },

    // Geometry stubs: no layout engine, so these report a fixed box unless a
    // test overrides them deliberately.
    getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() { return false; },
    focus() {},
    blur() {},
    click() { node.dispatch('click'); },
    closest() { return null; },
    contains(other) {
      if (other === node) return true;
      return node.children.some((child) => child.contains?.(other));
    },
    matches() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return null; },
  };
  return node;
}

/** The ids the fake serves are read out of the shipped markup rather than
 * listed here. A hand-kept list would drift: an element added to the HTML and
 * queried by the app would still be missing from the fake, and the mount test
 * would fail for a reason that has nothing to do with the change under test.
 * Reading the real file also means a *removed* id breaks the mount, which is
 * the drift worth catching. */
export function idsInShippedMarkup(html) {
  return [...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((match) => `#${match[1]}`);
}

/** Class selectors the app resolves as single elements at mount time. Which
 * classes matter is decided by the query sites, not by the markup, so the list
 * is explicit — but each is checked against the shipped HTML, so removing one
 * from the markup fails the mount rather than silently handing back a stub. */
const MOUNT_CLASS_SELECTORS = ['.workspace', '.icon-choice', '.copy-label'];

export function classSelectorsInShippedMarkup(html) {
  return MOUNT_CLASS_SELECTORS.filter((selector) => {
    const name = selector.slice(1);
    return new RegExp(`class="[^"]*\\b${name}\\b`).test(html);
  });
}

export function createFakeDocument({ selectors = [], extraSelectors = [] } = {}) {
  const registry = new Map();
  for (const selector of [...selectors, ...extraSelectors]) {
    const element = createElement('div');
    element.id = selector.replace(/^#/, '');
    registry.set(selector, element);
  }

  const body = createElement('body');
  const documentElement = createElement('html');

  const document = {
    body,
    documentElement,
    _registry: registry,
    createElement: (tag) => createElement(tag),
    createElementNS: (namespace, tag) => createElement(tag, { namespace }),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => createElement('#fragment'),
    querySelector: (selector) => registry.get(selector) ?? null,
    querySelectorAll: () => [],
    getElementById: (id) => registry.get(`#${id}`) ?? null,
    addEventListener(type, handler, options) { documentElement.addEventListener(type, handler, options); },
    removeEventListener(type, handler) { documentElement.removeEventListener(type, handler); },
    dispatch(type, event) { return documentElement.dispatch(type, event); },
    defaultView: null,
  };
  return document;
}

export function createFakeWindow(document) {
  const frames = [];
  const window = {
    document,
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    _listeners: [],
    addEventListener(type, handler, options) { window._listeners.push({ type, handler, options }); },
    removeEventListener(type, handler) {
      window._listeners = window._listeners.filter((e) => !(e.type === type && e.handler === handler));
    },
    dispatch(type, event = {}) {
      const payload = { type, preventDefault() {}, stopPropagation() {}, ...event };
      for (const entry of [...window._listeners]) {
        if (entry.type === type) entry.handler(payload);
      }
      return payload;
    },
    // Frames are captured rather than run, so a test decides when animation
    // advances instead of racing a real clock.
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    _runFrame(time = 0) {
      const pending = frames.splice(0, frames.length);
      for (const callback of pending) callback(time);
      return pending.length;
    },
    // Observes nothing: there is no layout to change. Held so a test can fire
    // the callback deliberately if it needs to simulate a resize.
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; window._resizeObservers.push(this); }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    _resizeObservers: [],
    getComputedStyle() { return { getPropertyValue: () => '' }; },
    matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
    chrome: { webview: { postMessage() {}, addEventListener() {}, removeEventListener() {} } },
  };
  document.defaultView = window;
  return window;
}
