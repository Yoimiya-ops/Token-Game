const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadWindowState, saveWindowState } = require('./window-state.cjs');

function fixture() {
  const windows = [];
  const handlers = {};
  const acknowledged = [];
  const batches = [];
  const companion = { state: () => ({ totalTokens: 42 }), acknowledge: value => acknowledged.push(value), dismantleBatch: request => batches.push(request) };
  class Window {
    constructor(options) {
      this.options = options;
      this.events = {};
      this.webContents = {
        mainFrame: {}, events: {},
        setWindowOpenHandler: handler => { this.openHandler = handler; },
        on: (name, handler) => { this.webContents.events[name] = handler; }
      };
      windows.push(this);
    }
    on(name, handler) { this.events[name] = handler; }
    setMenu() {}
    isDestroyed() { return false; }
    async loadFile(file) { this.file = file; }
  }
  const electron = {
    BrowserWindow: Window,
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: (name, fn) => { handlers[name] = fn; } },
    dialog: {},
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), on() {}
    }
  };
  const context = {
    module: { exports: {} }, setTimeout, clearTimeout,
    require: name => name === 'electron' ? electron : name === './server.cjs' ? { getCompanion: () => companion } : name.startsWith('./') ? require(name) : require(name)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'windows.cjs'), 'utf8'), context);
  const app = { getAppPath: () => path.resolve(__dirname, '..'), getPath: () => os.tmpdir(), isReady: () => true };
  return { api: context.module.exports, app, windows, handlers, acknowledged, batches };
}

test('both production surfaces load local files and keep the Electron sandbox', async () => {
  const f = fixture();
  await f.api.createPetWindow(f.app);
  await f.api.createGameWindow(f.app);
  assert.equal(f.windows.length, 2);
  assert.ok(f.windows[0].file.endsWith(path.join('desktop', 'pet', 'index.html')));
  assert.ok(f.windows[1].file.endsWith(path.join('apps', 'web', 'dist', 'index.html')));
  assert.equal(f.windows[0].options.transparent, true);
  for (const window of f.windows) {
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.openHandler().action, 'deny');
    let prevented = false;
    window.webContents.events['will-navigate']({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
});

test('only a known main frame can read state or collect a safe integer snapshot', async () => {
  const f = fixture();
  await f.api.createPetWindow(f.app);
  f.api.registerPetIpc(f.app, () => {});
  const contents = f.windows[0].webContents;
  const trusted = { sender: contents, senderFrame: contents.mainFrame };
  assert.equal(f.handlers['companion:get-state'](trusted).totalTokens, 42);
  assert.equal(f.handlers['companion:get-state']({ sender: contents, senderFrame: {} }), null);
  assert.throws(() => f.handlers['companion:collect']({ sender: {}, senderFrame: {} }, 42), /Untrusted/);
  for (const invalid of [NaN, Infinity, -1, 1.5, '42', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => f.handlers['companion:collect'](trusted, invalid), /Invalid/);
  }
  f.handlers['companion:collect'](trusted, 42);
  assert.deepEqual(f.acknowledged, [42]);
});

test('basin position migrates old bounds without loading demo pet selection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'basin-position-'));
  const file = path.join(directory, 'pet-state.json');
  fs.writeFileSync(file, JSON.stringify({ bounds: { x: 320, y: 120 }, activePetId: 'default-cat' }));
  const state = loadWindowState(directory);
  assert.equal(state.bounds.x, 320);
  assert.equal(state.activePetId, undefined);
  saveWindowState(directory, { bounds: { x: 500, y: 300 } });
  assert.equal(loadWindowState(directory).bounds.x, 500);
  fs.writeFileSync(file, 'invalid');
  assert.equal(loadWindowState(directory).bounds.x, 80);
});

test('batch dismantle IPC is limited to known top-level windows', async () => {
  const f = fixture();
  await f.api.createPetWindow(f.app);
  await f.api.createGameWindow(f.app);
  f.api.registerPetIpc(f.app, () => {});
  const request = { requestId: 'batch-request', expectedRevision: 0, weaponIds: ['w1-sword'] };
  for (const window of f.windows) {
    const contents = window.webContents;
    assert.throws(() => f.handlers['companion:dismantleBatch']({ sender: contents, senderFrame: {} }, request), /Untrusted/);
    f.handlers['companion:dismantleBatch']({ sender: contents, senderFrame: contents.mainFrame }, request);
  }
  assert.throws(() => f.handlers['companion:dismantleBatch']({ sender: {}, senderFrame: {} }, request), /Untrusted/);
  assert.deepEqual(f.batches, [request, request]);
});
