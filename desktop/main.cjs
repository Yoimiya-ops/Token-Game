const { app, dialog, powerMonitor } = require('electron');
const { startCompanion, stopCompanion } = require('./server.cjs');
const { createGameWindow, createPetWindow, hidePetWindow, registerPetIpc, restorePetWindow, broadcastState } = require('./windows.cjs');
const { createPetContextMenu, createTray } = require('./tray.cjs');


if (process.env.TOKEN_GAME_USER_DATA_DIR) {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = path.resolve(process.env.TOKEN_GAME_USER_DATA_DIR);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}

let shuttingDown = false;
let stopped = false;
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    restorePetWindow();
    void createGameWindow(app);
  });
  app.whenReady().then(async () => {
    try {
      const companion = startCompanion(app, broadcastState);
      const actions = {
        restorePet: restorePetWindow, hidePet: hidePetWindow,
        openGame: () => { void createGameWindow(app); }
      };
      createTray(app, actions);
      registerPetIpc(app, () => createPetContextMenu(app, actions).popup());
      await createPetWindow(app);
      if (companion.store.created) await createGameWindow(app);
      powerMonitor.on('resume', () => { void companion.scan(); });
      app.on('activate', restorePetWindow);
    } catch (error) {
      console.error(error);
      dialog.showErrorBox('聚宝盆启动失败', error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });
  app.on('before-quit', event => {
    app.isQuitting = true;
    if (stopped) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void stopCompanion().finally(() => { stopped = true; app.quit(); });
  });
  app.on('window-all-closed', () => {});
}
