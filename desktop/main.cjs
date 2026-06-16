const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { existsSync } = require('node:fs');

let gameServer;

async function startEmbeddedServer() {
  process.env.TOKEN_GAME_DATA_DIR = path.join(app.getPath('userData'), 'data');

  const serverEntry = path.join(app.getAppPath(), 'apps', 'server', 'dist', 'index.cjs');
  const serverModule = require(serverEntry);
  gameServer = await serverModule.startGameServer({
    port: 3001,
    host: '127.0.0.1'
  });
}

async function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#0d1117',
    title: 'Feed the Kitty with Tokens',
    autoHideMenuBar: true
  });

  const builtIndex = path.join(app.getAppPath(), 'apps', 'web', 'dist', 'index.html');
  if (existsSync(builtIndex)) {
    await window.loadFile(builtIndex);
    return;
  }

  await window.loadURL('http://localhost:3000');
}

app.whenReady().then(async () => {
  await startEmbeddedServer();
  await createMainWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (gameServer) {
    await gameServer.close();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
