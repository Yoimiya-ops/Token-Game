# Desktop Pet Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cross-platform Electron desktop pet launcher that starts as a floating cat, opens the full game on double click, supports tray behavior, and packages for macOS and Windows.

**Architecture:** Keep the existing Fastify server and React dashboard. Split Electron code into focused CommonJS modules under `desktop/`, add a static pet renderer under `desktop/pet/`, and make the Electron main process coordinate server startup, pet window, game window, tray, persistence, and packaging.

**Tech Stack:** Electron 37, Node.js CommonJS for desktop main modules, static HTML/CSS/JS for the pet renderer, Fastify server bundle, Vite React dashboard, `@electron/packager`.

---

## File Structure

- `desktop/main.cjs`: app lifecycle only; calls helper modules.
- `desktop/server.cjs`: starts and stops the embedded game server.
- `desktop/windows.cjs`: creates pet and game windows.
- `desktop/pet-state.cjs`: reads and writes persisted pet bounds and always-on-top preference.
- `desktop/tray.cjs`: creates tray menus and app context menus.
- `desktop/pet/index.html`: static pet renderer.
- `desktop/pet/styles.css`: pet visuals and animations.
- `desktop/pet/pet.js`: click, double-click, drag, and IPC behavior.
- `desktop/pet/preload.cjs`: safe IPC bridge for the pet renderer.
- `desktop/pet-state.test.cjs`: Node tests for pet state persistence.
- `desktop/pet-click.test.cjs`: Node tests for click classification if extracted into a pure helper.
- `scripts/package-desktop.mjs`: cross-platform packager script.
- `package.json`: desktop and packaging scripts.

## Task 1: Finish Current Server Static Root Regression

**Files:**
- Modify: `apps/server/src/index.ts`
- Create or keep: `apps/server/src/index.test.ts`
- Create or keep: `apps/server/src/static-root.test.ts`
- Modify: `apps/server/package.json`
- Modify: `package.json`

- [ ] **Step 1: Confirm regression tests exist**

`apps/server/src/index.test.ts` should contain:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWebStaticRoot } from './index';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

test('resolves web static root from the repository root cwd', () => {
  assert.equal(
    resolveWebStaticRoot(repoRoot),
    path.join(repoRoot, 'apps', 'web', 'dist')
  );
});

test('resolves web static root from the server workspace cwd', () => {
  assert.equal(
    resolveWebStaticRoot(path.join(repoRoot, 'apps', 'server')),
    path.join(repoRoot, 'apps', 'web', 'dist')
  );
});
```

`apps/server/src/static-root.test.ts` should contain:

```ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveStaticRoot } from './index';

test('resolves the web dist directory when server starts from the server workspace', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-game-'));
  const webDist = path.join(root, 'apps', 'web', 'dist');
  const serverWorkspace = path.join(root, 'apps', 'server');

  mkdirSync(webDist, { recursive: true });
  mkdirSync(serverWorkspace, { recursive: true });
  writeFileSync(path.join(webDist, 'index.html'), '<main></main>');

  assert.equal(resolveStaticRoot(serverWorkspace), webDist);
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
corepack pnpm test
```

Expected: server tests pass with 3 tests and 0 failures.

- [ ] **Step 3: Commit server regression fix**

Run:

```bash
git add package.json apps/server/package.json apps/server/src/index.ts apps/server/src/index.test.ts apps/server/src/static-root.test.ts
git commit -m "fix: resolve server static root from workspace"
```

Expected: commit succeeds.

## Task 2: Add Pet State Persistence

**Files:**
- Create: `desktop/pet-state.cjs`
- Create: `desktop/pet-state.test.cjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `desktop/pet-state.test.cjs`:

```js
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  defaultPetState,
  loadPetState,
  savePetState
} = require('./pet-state.cjs');

test('returns default pet state when no file exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));

  assert.deepEqual(loadPetState(dir), defaultPetState);

  rmSync(dir, { recursive: true, force: true });
});

test('persists pet bounds and always-on-top preference', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));
  const state = {
    bounds: { x: 42, y: 84, width: 180, height: 180 },
    alwaysOnTop: false
  };

  savePetState(dir, state);

  assert.deepEqual(loadPetState(dir), state);

  rmSync(dir, { recursive: true, force: true });
});

test('falls back to defaults when state JSON is invalid', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));
  const fs = require('node:fs');
  fs.writeFileSync(path.join(dir, 'pet-state.json'), '{not-json');

  assert.deepEqual(loadPetState(dir), defaultPetState);

  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Add root test script for desktop tests**

Modify `package.json` scripts:

```json
"test:desktop": "node --test desktop/*.test.cjs"
```

Keep existing `test` and run desktop tests separately or add them to the root `test` command after they pass.

- [ ] **Step 3: Verify tests fail**

Run:

```bash
corepack pnpm test:desktop
```

Expected: FAIL because `desktop/pet-state.cjs` does not exist.

- [ ] **Step 4: Implement pet state module**

Create `desktop/pet-state.cjs`:

```js
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const STATE_FILE = 'pet-state.json';

const defaultPetState = {
  bounds: {
    x: 80,
    y: 120,
    width: 180,
    height: 180
  },
  alwaysOnTop: true
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePetState(value) {
  const bounds = value && typeof value === 'object' ? value.bounds : undefined;
  const normalizedBounds = {
    x: isFiniteNumber(bounds?.x) ? bounds.x : defaultPetState.bounds.x,
    y: isFiniteNumber(bounds?.y) ? bounds.y : defaultPetState.bounds.y,
    width: isFiniteNumber(bounds?.width) ? bounds.width : defaultPetState.bounds.width,
    height: isFiniteNumber(bounds?.height) ? bounds.height : defaultPetState.bounds.height
  };

  return {
    bounds: normalizedBounds,
    alwaysOnTop:
      typeof value?.alwaysOnTop === 'boolean'
        ? value.alwaysOnTop
        : defaultPetState.alwaysOnTop
  };
}

function getStatePath(userDataPath) {
  return path.join(userDataPath, STATE_FILE);
}

function loadPetState(userDataPath) {
  const statePath = getStatePath(userDataPath);
  if (!existsSync(statePath)) {
    return defaultPetState;
  }

  try {
    return normalizePetState(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch {
    return defaultPetState;
  }
}

function savePetState(userDataPath, state) {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(getStatePath(userDataPath), JSON.stringify(normalizePetState(state), null, 2));
}

module.exports = {
  defaultPetState,
  getStatePath,
  loadPetState,
  savePetState
};
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
corepack pnpm test:desktop
```

Expected: 3 tests pass, 0 failures.

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json desktop/pet-state.cjs desktop/pet-state.test.cjs
git commit -m "feat: persist desktop pet state"
```

## Task 3: Split Electron Main Process

**Files:**
- Modify: `desktop/main.cjs`
- Create: `desktop/server.cjs`
- Create: `desktop/windows.cjs`
- Create: `desktop/tray.cjs`

- [ ] **Step 1: Extract server startup**

Create `desktop/server.cjs`:

```js
const path = require('node:path');

let gameServer;

async function startEmbeddedServer(app) {
  process.env.TOKEN_GAME_DATA_DIR = path.join(app.getPath('userData'), 'data');

  const serverEntry = path.join(app.getAppPath(), 'apps', 'server', 'dist', 'index.cjs');
  const serverModule = require(serverEntry);
  gameServer = await serverModule.startGameServer({
    port: 3001,
    host: '127.0.0.1'
  });

  return gameServer;
}

async function stopEmbeddedServer() {
  if (gameServer) {
    await gameServer.close();
    gameServer = undefined;
  }
}

module.exports = {
  startEmbeddedServer,
  stopEmbeddedServer
};
```

- [ ] **Step 2: Extract game window creation**

Create `desktop/windows.cjs` with a first pass:

```js
const { BrowserWindow } = require('electron');
const { existsSync } = require('node:fs');
const path = require('node:path');

let gameWindow;

async function loadGameWindow(window, app) {
  const builtIndex = path.join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html');
  if (existsSync(builtIndex)) {
    await window.loadFile(builtIndex);
    return;
  }

  await window.loadURL('http://localhost:3000');
}

async function createGameWindow(app) {
  if (gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.show();
    gameWindow.focus();
    return gameWindow;
  }

  gameWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#0d1117',
    title: 'Feed the Kitty with Tokens',
    autoHideMenuBar: true
  });

  gameWindow.on('closed', () => {
    gameWindow = undefined;
  });

  await loadGameWindow(gameWindow, app);
  return gameWindow;
}

module.exports = {
  createGameWindow,
  loadGameWindow
};
```

- [ ] **Step 3: Update main process to use helpers**

Replace `desktop/main.cjs` with:

```js
const { app } = require('electron');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server.cjs');
const { createGameWindow } = require('./windows.cjs');

app.whenReady().then(async () => {
  await startEmbeddedServer(app);
  await createGameWindow(app);

  app.on('activate', async () => {
    if (process.platform === 'darwin') {
      await createGameWindow(app);
    }
  });
});

app.on('window-all-closed', async () => {
  await stopEmbeddedServer();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 4: Verify existing desktop behavior still builds**

Run:

```bash
corepack pnpm build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/main.cjs desktop/server.cjs desktop/windows.cjs
git commit -m "refactor: split electron desktop main process"
```

## Task 4: Add Pet Renderer

**Files:**
- Create: `desktop/pet/index.html`
- Create: `desktop/pet/styles.css`
- Create: `desktop/pet/pet.js`
- Create: `desktop/pet/preload.cjs`

- [ ] **Step 1: Create pet preload bridge**

Create `desktop/pet/preload.cjs`:

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenPet', {
  interact: () => ipcRenderer.send('pet:interact'),
  openGame: () => ipcRenderer.send('pet:open-game'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  saveBounds: (bounds) => ipcRenderer.send('pet:save-bounds', bounds)
});
```

- [ ] **Step 2: Create pet HTML**

Create `desktop/pet/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Token Game Pet</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main id="pet" class="pet" aria-label="Token Game desktop pet">
      <div class="bubble" id="bubble">Token 消化中...</div>
      <div class="cat" id="cat">
        <div class="ear ear-left"></div>
        <div class="ear ear-right"></div>
        <div class="face">
          <span class="eye eye-left"></span>
          <span class="eye eye-right"></span>
          <span class="nose"></span>
          <span class="mouth"></span>
        </div>
        <div class="tail"></div>
      </div>
    </main>
    <script src="./pet.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create pet CSS**

Create `desktop/pet/styles.css`:

```css
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
  user-select: none;
  -webkit-user-select: none;
}

body {
  display: grid;
  place-items: center;
  font-family: "Segoe UI", "PingFang SC", sans-serif;
}

.pet {
  position: relative;
  width: 180px;
  height: 180px;
  display: grid;
  place-items: end center;
  -webkit-app-region: drag;
}

.cat,
.bubble {
  -webkit-app-region: no-drag;
}

.cat {
  position: relative;
  width: 118px;
  height: 102px;
  border-radius: 54px 54px 42px 42px;
  background: #f7c873;
  filter: drop-shadow(0 12px 18px rgba(0, 0, 0, 0.28));
  transform-origin: 50% 90%;
}

.cat.is-happy {
  animation: bounce 420ms ease;
}

.ear {
  position: absolute;
  top: -24px;
  width: 36px;
  height: 42px;
  background: #f7c873;
  clip-path: polygon(50% 0, 0 100%, 100% 100%);
}

.ear-left {
  left: 18px;
  transform: rotate(-8deg);
}

.ear-right {
  right: 18px;
  transform: rotate(8deg);
}

.face {
  position: absolute;
  inset: 0;
}

.eye {
  position: absolute;
  top: 42px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #1f2937;
}

.eye-left {
  left: 34px;
}

.eye-right {
  right: 34px;
}

.nose {
  position: absolute;
  top: 58px;
  left: 53px;
  width: 12px;
  height: 8px;
  border-radius: 999px;
  background: #d66b7b;
}

.mouth {
  position: absolute;
  top: 70px;
  left: 51px;
  width: 16px;
  height: 8px;
  border-bottom: 2px solid #8b4a38;
  border-radius: 0 0 999px 999px;
}

.tail {
  position: absolute;
  right: -22px;
  bottom: 20px;
  width: 44px;
  height: 24px;
  border: 10px solid #f7c873;
  border-left: 0;
  border-bottom: 0;
  border-radius: 0 999px 0 0;
}

.bubble {
  position: absolute;
  top: 2px;
  left: 50%;
  max-width: 150px;
  padding: 8px 10px;
  border-radius: 12px;
  color: #111827;
  background: rgba(255, 255, 255, 0.92);
  font-size: 13px;
  line-height: 1.3;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16);
  opacity: 0;
  transform: translate(-50%, 10px);
  transition:
    opacity 160ms ease,
    transform 160ms ease;
  pointer-events: none;
}

.bubble.is-visible {
  opacity: 1;
  transform: translate(-50%, 0);
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  45% {
    transform: translateY(-12px) scale(1.03);
  }
}
```

- [ ] **Step 4: Create pet interaction script**

Create `desktop/pet/pet.js`:

```js
const cat = document.getElementById('cat');
const bubble = document.getElementById('bubble');
const messages = ['喵，Token 消化中...', '+1 摸摸', '双击我进入游戏', '今天也要好好喂猫'];
let clickTimer;
let messageIndex = 0;

function showInteraction() {
  window.tokenPet.interact();
  cat.classList.remove('is-happy');
  void cat.offsetWidth;
  cat.classList.add('is-happy');
  bubble.textContent = messages[messageIndex % messages.length];
  messageIndex += 1;
  bubble.classList.add('is-visible');
  window.setTimeout(() => {
    bubble.classList.remove('is-visible');
  }, 1400);
}

cat.addEventListener('click', () => {
  if (clickTimer) {
    window.clearTimeout(clickTimer);
    clickTimer = undefined;
    window.tokenPet.openGame();
    return;
  }

  clickTimer = window.setTimeout(() => {
    clickTimer = undefined;
    showInteraction();
  }, 220);
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.tokenPet.showContextMenu();
});

window.addEventListener('mouseup', () => {
  window.tokenPet.saveBounds({
    width: window.outerWidth,
    height: window.outerHeight
  });
});
```

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/pet/index.html desktop/pet/styles.css desktop/pet/pet.js desktop/pet/preload.cjs
git commit -m "feat: add desktop pet renderer"
```

## Task 5: Create Pet Window, Tray, and IPC

**Files:**
- Modify: `desktop/windows.cjs`
- Modify: `desktop/main.cjs`
- Modify: `desktop/tray.cjs`

- [ ] **Step 1: Extend windows module**

Replace `desktop/windows.cjs` with:

```js
const { BrowserWindow, ipcMain } = require('electron');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { loadPetState, savePetState } = require('./pet-state.cjs');

let petWindow;
let gameWindow;

async function loadGameWindow(window, app) {
  const builtIndex = path.join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html');
  if (existsSync(builtIndex)) {
    await window.loadFile(builtIndex);
    return;
  }

  await window.loadURL('http://localhost:3000');
}

async function createGameWindow(app) {
  if (gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.show();
    gameWindow.focus();
    return gameWindow;
  }

  gameWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#0d1117',
    title: 'Feed the Kitty with Tokens',
    autoHideMenuBar: true
  });

  gameWindow.on('closed', () => {
    gameWindow = undefined;
  });

  await loadGameWindow(gameWindow, app);
  return gameWindow;
}

async function createPetWindow(app) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    return petWindow;
  }

  const state = loadPetState(app.getPath('userData'));
  petWindow = new BrowserWindow({
    ...state.bounds,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: state.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'pet', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  petWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      petWindow.hide();
    }
  });

  petWindow.on('moved', () => {
    persistPetWindowState(app);
  });

  await petWindow.loadFile(path.join(app.getAppPath(), 'desktop', 'pet', 'index.html'));
  return petWindow;
}

function persistPetWindowState(app) {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  savePetState(app.getPath('userData'), {
    bounds: petWindow.getBounds(),
    alwaysOnTop: petWindow.isAlwaysOnTop()
  });
}

function restorePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
  }
}

function togglePetAlwaysOnTop(app) {
  if (!petWindow || petWindow.isDestroyed()) {
    return false;
  }

  const nextValue = !petWindow.isAlwaysOnTop();
  petWindow.setAlwaysOnTop(nextValue);
  persistPetWindowState(app);
  return nextValue;
}

function registerPetIpc(app, showPetContextMenu) {
  ipcMain.on('pet:open-game', () => {
    void createGameWindow(app);
  });

  ipcMain.on('pet:show-context-menu', () => {
    showPetContextMenu();
  });

  ipcMain.on('pet:save-bounds', () => {
    persistPetWindowState(app);
  });

  ipcMain.on('pet:interact', () => {
    persistPetWindowState(app);
  });
}

module.exports = {
  createGameWindow,
  createPetWindow,
  loadGameWindow,
  persistPetWindowState,
  registerPetIpc,
  restorePetWindow,
  togglePetAlwaysOnTop
};
```

- [ ] **Step 2: Create tray module**

Create `desktop/tray.cjs`:

```js
const { Menu, Tray, nativeImage } = require('electron');

let tray;

function createTray(app, actions) {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Token Game');
  tray.setContextMenu(createTrayMenu(app, actions));
  tray.on('click', actions.restorePet);
  tray.on('double-click', actions.openGame);
  return tray;
}

function createTrayMenu(app, actions) {
  return Menu.buildFromTemplate([
    { label: '显示小猫', click: actions.restorePet },
    { label: '打开游戏', click: actions.openGame },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createPetContextMenu(app, actions) {
  return Menu.buildFromTemplate([
    { label: '打开游戏', click: actions.openGame },
    {
      label: '置顶/取消置顶',
      click: actions.toggleAlwaysOnTop
    },
    { label: '隐藏到托盘', click: actions.hidePet },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

module.exports = {
  createPetContextMenu,
  createTray
};
```

- [ ] **Step 3: Update main lifecycle**

Replace `desktop/main.cjs` with:

```js
const { app, dialog } = require('electron');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server.cjs');
const {
  createGameWindow,
  createPetWindow,
  registerPetIpc,
  restorePetWindow,
  togglePetAlwaysOnTop
} = require('./windows.cjs');
const { createPetContextMenu, createTray } = require('./tray.cjs');

let petContextMenu;

async function openGame() {
  await createGameWindow(app);
}

async function boot() {
  await startEmbeddedServer(app);
  await createPetWindow(app);

  const actions = {
    restorePet: () => restorePetWindow(),
    openGame: () => {
      void openGame();
    },
    toggleAlwaysOnTop: () => togglePetAlwaysOnTop(app),
    hidePet: () => {
      const windows = require('electron').BrowserWindow.getAllWindows();
      for (const window of windows) {
        if (window.getTitle() === '') {
          window.hide();
        }
      }
    }
  };

  petContextMenu = createPetContextMenu(app, actions);
  createTray(app, actions);
  registerPetIpc(app, () => petContextMenu.popup());
}

app.whenReady().then(async () => {
  try {
    await boot();
  } catch (error) {
    dialog.showErrorBox('Token Game 启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on('activate', () => {
    restorePetWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('will-quit', async () => {
  await stopEmbeddedServer();
});
```

- [ ] **Step 4: Run build**

Run:

```bash
corepack pnpm build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/main.cjs desktop/windows.cjs desktop/tray.cjs
git commit -m "feat: launch electron app as desktop pet"
```

## Task 6: Add Cross-Platform Packaging Script

**Files:**
- Create: `scripts/package-desktop.mjs`
- Modify: `package.json`
- Optionally keep: `scripts/package-win.mjs`

- [ ] **Step 1: Create package script**

Create `scripts/package-desktop.mjs`:

```js
import packager from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const target = process.argv[2] ?? 'current';
const platformMap = {
  mac: 'darwin',
  win: 'win32',
  current: process.platform
};

const platform = platformMap[target];
if (!platform) {
  throw new Error(`Unknown desktop package target: ${target}`);
}

const outDir = path.resolve(cwd, 'outputs', target);
fs.rmSync(outDir, { recursive: true, force: true });

function ignore(filePath) {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath.startsWith(`node_modules${path.sep}`)) {
    return false;
  }

  const parts = relativePath.split(path.sep);
  return ['.git', '.superpowers', 'docs', 'outputs', 'prisma', 'work'].includes(parts[0]);
}

const appPaths = await packager({
  dir: cwd,
  out: outDir,
  overwrite: true,
  prune: false,
  asar: false,
  platform,
  arch: 'x64',
  name: 'Token Game',
  executableName: 'TokenGame',
  ignore
});

for (const appPath of appPaths) {
  console.log(`Packaged: ${appPath}`);
}
```

- [ ] **Step 2: Update package scripts**

Modify root `package.json` scripts:

```json
"dist:mac": "npm run build && node scripts/package-desktop.mjs mac",
"dist:win": "npm run build && node scripts/package-desktop.mjs win",
"dist:current": "npm run build && node scripts/package-desktop.mjs current"
```

Keep existing `dist:win` only if it is intentionally replaced by the new command.

- [ ] **Step 3: Verify current-platform package**

Run on macOS:

```bash
corepack pnpm dist:current
```

Expected: `outputs/current/Token Game-darwin-x64/Token Game.app` exists.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json scripts/package-desktop.mjs
git commit -m "feat: add cross-platform desktop packaging"
```

## Task 7: Manual Launch Verification

**Files:**
- Modify only if verification reveals a bug.

- [ ] **Step 1: Run automated checks**

Run:

```bash
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 2: Run Electron in development**

Run:

```bash
corepack pnpm desktop
```

Expected:

- app opens as a floating pet window, not the full game dashboard
- single click shows pet interaction
- double click opens the game dashboard
- pet can be dragged
- closing pet hides it instead of quitting
- tray menu can restore pet and quit app

- [ ] **Step 3: Run current-platform package**

Run:

```bash
corepack pnpm dist:current
open "outputs/current/Token Game-darwin-x64/Token Game.app"
```

Expected: packaged macOS app opens as the desktop pet first.

- [ ] **Step 4: Commit verification fixes if needed**

If any code changed during verification:

```bash
git add <changed-files>
git commit -m "fix: polish desktop pet launch behavior"
```

If no code changed, do not create an empty commit.
