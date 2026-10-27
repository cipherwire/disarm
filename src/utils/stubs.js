/**
 * Minimal browser environment so challenge scripts can execute inside a
 * Node `vm` context without touching a real browser. Stubs are inert:
 * they return harmless values and never throw.
 */
export function makeStubs() {
  const window = {};
  window.window = window;
  window.top = window;
  window.self = window;
  window.parent = window;
  window.globalThis = window;

  const element = () => ({
    style: {},
    setAttribute() {},
    getAttribute() { return null; },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    attachEvent() {},
    removeEventListener() {},
    getContext: () => null,
  });

  const document = {
    readyState: 'loading',
    createElement: element,
    createElementNS: () => element(),
    createTextNode: () => ({}),
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: element(),
    body: element(),
    head: element(),
    addEventListener() {},
    attachEvent() {},
    removeEventListener() {},
    cookie: '',
    referrer: '',
    domain: '',
    title: '',
  };

  const navigator = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    vendor: 'Google Inc.',
    language: 'en-US',
    languages: ['en-US', 'en'],
    platform: 'Win32',
    hardwareConcurrency: 8,
    maxTouchPoints: 0,
    cookieEnabled: true,
    doNotTrack: null,
  };

  const location = {
    href: 'https://example.com/',
    protocol: 'https:',
    host: 'example.com',
    hostname: 'example.com',
    pathname: '/',
    search: '',
    hash: '',
  };

  const screen = { width: 1920, height: 1080, colorDepth: 24, availWidth: 1920, availHeight: 1040 };
  const history = { length: 1, pushState() {}, replaceState() {} };
  const performance = { now: () => 0, timeOrigin: 0 };
  const storage = () => ({
    getItem() { return null; },
    setItem() {},
    removeItem() {},
    clear() {},
    length: 0,
    key() { return null; },
  });
  const localStorage = storage();
  const sessionStorage = storage();
  const crypto = {
    getRandomValues(arr) {
      if (arr && arr.length) {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    },
    subtle: {},
  };

  const stubs = {
    window,
    document,
    navigator,
    location,
    screen,
    history,
    performance,
    localStorage,
    sessionStorage,
    crypto,
    setTimeout: (fn) => 0,
    clearTimeout: () => {},
    setInterval: (fn) => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    alert() {},
    confirm: () => false,
    prompt: () => null,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    atob: (s) => (typeof globalThis.atob === 'function' ? globalThis.atob(s) : Buffer.from(s, 'base64').toString('binary')),
    btoa: (s) => (typeof globalThis.btoa === 'function' ? globalThis.btoa(s) : Buffer.from(s, 'binary').toString('base64')),
    escape: globalThis.escape,
    unescape: globalThis.unescape,
    encodeURIComponent: globalThis.encodeURIComponent,
    decodeURIComponent: globalThis.decodeURIComponent,
    Image: function () {},
    XMLHttpRequest: function () {
      this.open = () => {};
      this.send = () => {};
      this.setRequestHeader = () => {};
    },
  };

  // Wire all BOM/DOM stubs to window as well
  for (const [key, value] of Object.entries(stubs)) {
    if (key !== 'window') {
      window[key] = value;
    }
  }

  return stubs;
}
