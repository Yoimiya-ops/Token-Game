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
