const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

class Element {
  constructor() {
    this.events = {}; this.dataset = {}; this.children = []; this.textContent = ''; this.className = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) };
  }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute() {}
  setPointerCapture() {}
  replaceChildren(...children) { this.children = children; }
}
async function setup(pending = 12345) {
  const elements = Object.fromEntries(['pet', 'scene', 'bubble', 'pending-label'].map(id => [id, new Element()]));
  let clock = 0, timerId = 0, opens = 0, collections = 0;
  const timers = new Map();
  const state = { totalTokens: pending, acknowledgedTokens: 0, pendingTokens: pending, receipt: { revision: 0, tokens: 0 }, forge: { revision: 0 } };
  const window = {
    screenX: 0, screenY: 0, events: {},
    addEventListener(name, callback) { this.events[name] = callback; },
    tokenPet: {
      onState() {},
      getState: async () => structuredClone(state),
      collect: async () => {
        collections++;
        const tokens = state.pendingTokens;
        state.acknowledgedTokens = state.totalTokens; state.pendingTokens = 0;
        if (tokens) { state.receipt.revision++; state.receipt.tokens = tokens; }
        return { state: structuredClone(state), collectedTokens: tokens };
      },
      openGame: () => opens++, dragTo() {}, endDrag() {}, saveBounds() {}
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pet/pet.js'), 'utf8'), {
    document: { getElementById: id => elements[id], createElement: () => new Element() },
    window, matchMedia: () => ({ matches: true }),
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const advance = async milliseconds => {
    clock += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
    await flush();
  };
  return { elements, window, advance, stats: () => ({ opens, collections, pending: state.pendingTokens }) };
}
test('single click responds immediately, then collects without opening a window', async () => {
  const f = await setup();
  f.elements.pet.events.click({ detail: 1 });
  assert.ok(f.elements.scene.classList.contains('is-tapping'));
  assert.equal(f.stats().collections, 0);
  await f.advance(501);
  assert.equal(f.stats().collections, 1);
  assert.equal(f.stats().opens, 0);
  assert.equal(f.elements.bubble.children[0].textContent, '+12,345 Token');
});
test('empty harvest still animates and reports zero without fabricating income', async () => {
  const f = await setup(0);
  f.elements.pet.events.click({ detail: 1 });
  await f.advance(501);
  assert.ok(f.elements.scene.classList.contains('is-empty'));
  assert.equal(f.elements.bubble.children[0].textContent, '+0 Token');
  assert.equal(f.elements.bubble.children[1].textContent, '盆中暂无积累');
});
test('double click cancels pending harvest and right click only opens the receipt', async () => {
  const f = await setup();
  f.elements.pet.events.click({ detail: 1 });
  await f.advance(100);
  f.elements.pet.events.click({ detail: 2 });
  f.elements.pet.events.dblclick({ preventDefault() {} });
  await f.advance(600);
  assert.deepEqual(f.stats(), { opens: 1, collections: 0, pending: 12345 });
  f.window.events.contextmenu({ preventDefault() {} });
  assert.deepEqual(f.stats(), { opens: 2, collections: 0, pending: 12345 });
});
test('drag cancels harvest, suppresses the trailing click, and keyboard still collects', async () => {
  const f = await setup();
  f.elements.pet.events.pointerdown({ button: 0, pointerId: 1, screenX: 100, screenY: 100 });
  f.elements.pet.events.pointermove({ pointerId: 1, screenX: 120, screenY: 130 });
  f.elements.pet.events.pointerup({ pointerId: 1 });
  f.elements.pet.events.click({ detail: 1 });
  await f.advance(600);
  assert.equal(f.stats().collections, 0);
  f.elements.pet.events.keydown({ key: ' ', preventDefault() {} });
  await f.advance(0);
  assert.equal(f.stats().collections, 1);
});
