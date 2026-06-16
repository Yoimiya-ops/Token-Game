const { BrowserWindow, ipcMain } = require('electron');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { loadPetState, savePetState } = require('./pet-state.cjs');

let petWindow;
let gameWindow;

async function loadGameWindow(window, app) {
  const builtIndex = path.join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html');
  if (existsSync(builtIndex)) {
    await window.loadURL('http://127.0.0.1:3001/');
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
    title: 'Token Game Pet',
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

function hidePetWindow() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
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
  hidePetWindow,
  loadGameWindow,
  persistPetWindowState,
  registerPetIpc,
  restorePetWindow,
  togglePetAlwaysOnTop
};
