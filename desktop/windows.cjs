const { BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('node:path');
const { loadWindowState, saveWindowState } = require('./window-state.cjs');
const { getCompanion } = require('./server.cjs');

let petWindow;
let gameWindow;
let latestState;

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
}
async function loadGameWindow(window, app) {
  await window.loadFile(path.join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html'));
}
async function createGameWindow(app) {
  if (!app.isReady()) return;
  if (gameWindow && !gameWindow.isDestroyed()) {
    if (gameWindow.isMinimized()) gameWindow.restore();
    gameWindow.show();
    gameWindow.focus();
    return gameWindow;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1000, area.width - 24);
  const height = Math.min(760, area.height - 24);
  gameWindow = new BrowserWindow({
    width, height, minWidth: Math.min(820, width), minHeight: Math.min(600, height),
    backgroundColor: '#f6f7f5', title: '聚宝盆', autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'desktop', 'pet', 'assets', 'processed', 'jade-basin-icon.png'),
    webPreferences: { preload: path.join(app.getAppPath(), 'desktop', 'pet', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  secureWindow(gameWindow);
  gameWindow.setMenu(null);
  gameWindow.on('closed', () => { gameWindow = undefined; });
  await loadGameWindow(gameWindow, app);
  return gameWindow;
}
function visibleBounds(bounds) {
  const size = { width: 320, height: 300 };
  const display = screen.getDisplayMatching({ ...bounds, ...size }).workArea;
  return {
    ...size,
    x: Math.round(Math.max(display.x, Math.min(bounds.x, display.x + display.width - size.width))),
    y: Math.round(Math.max(display.y, Math.min(bounds.y, display.y + display.height - size.height)))
  };
}
async function createPetWindow(app) {
  if (petWindow && !petWindow.isDestroyed()) { restorePetWindow(); return petWindow; }
  const state = loadWindowState(app.getPath('userData'));
  petWindow = new BrowserWindow({
    ...visibleBounds(state.bounds),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000', hasShadow: false, autoHideMenuBar: true, title: '聚宝盆桌宠',
    webPreferences: { preload: path.join(app.getAppPath(), 'desktop', 'pet', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  secureWindow(petWindow);
  petWindow.on('close', event => {
    if (!app.isQuitting) { event.preventDefault(); petWindow.hide(); }
  });
  let saveTimer;
  petWindow.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistPetWindowState(app), 200);
  });
  await petWindow.loadFile(path.join(app.getAppPath(), 'desktop', 'pet', 'index.html'));
  return petWindow;
}
function persistPetWindowState(app) {
  if (!petWindow || petWindow.isDestroyed()) return;
  saveWindowState(app.getPath('userData'), { bounds: petWindow.getBounds() });
}
function restorePetWindow() {
  if (!petWindow || petWindow.isDestroyed()) return;
  petWindow.setBounds(visibleBounds(petWindow.getBounds()));
  petWindow.show();
}
function hidePetWindow() { if (petWindow && !petWindow.isDestroyed()) petWindow.hide(); }
function broadcastState(state) {
  latestState = state;
  for (const window of [petWindow, gameWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('companion:state', state);
  }
}
function registerPetIpc(app, showContextMenu) {
  const trusted = event => [petWindow, gameWindow].some(window => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
  ipcMain.handle('companion:get-state', event => trusted(event) ? getCompanion()?.state() ?? latestState : null);
  ipcMain.handle('companion:collect', (event, observedTotal) => {
    if (!trusted(event)) throw new Error('Untrusted window');
    if (!Number.isSafeInteger(observedTotal) || observedTotal < 0) throw new Error('Invalid token snapshot');
    return getCompanion().acknowledge(observedTotal);
  });
  for (const method of ['draw', 'dismantle', 'dismantleBatch', 'exchange']) {
    ipcMain.handle('companion:' + method, (event, request) => {
      if (!trusted(event)) throw new Error('Untrusted window');
      return getCompanion()[method](request);
    });
  }
  ipcMain.handle('companion:choose-directory', async event => {
    if (!trusted(event)) return null;
    const result = await dialog.showOpenDialog(gameWindow, { title: '选择 Codex 日志目录', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return getCompanion().setDirectory(result.filePaths[0]);
  });
  ipcMain.on('pet:open-game', event => { if (trusted(event)) void createGameWindow(app); });
  ipcMain.on('pet:show-context-menu', event => { if (trusted(event)) showContextMenu(); });
  ipcMain.on('pet:save-bounds', event => { if (trusted(event)) persistPetWindowState(app); });
  ipcMain.on('pet:drag-to', (event, payload) => {
    if (!trusted(event) || event.sender !== petWindow?.webContents) return;
    if (!Number.isFinite(payload?.x) || !Number.isFinite(payload?.y)) return;
    petWindow.setPosition(Math.round(payload.x), Math.round(payload.y));
  });
  ipcMain.on('pet:end-drag', event => {
    if (!trusted(event) || !petWindow) return;
    petWindow.setBounds(visibleBounds(petWindow.getBounds()));
    persistPetWindowState(app);
  });
  screen.on('display-removed', () => { if (petWindow && !petWindow.isDestroyed()) petWindow.setBounds(visibleBounds(petWindow.getBounds())); });
}
module.exports = { createGameWindow, createPetWindow, loadGameWindow, hidePetWindow, restorePetWindow, registerPetIpc, persistPetWindowState, broadcastState, visibleBounds };
