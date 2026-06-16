const { app, dialog } = require('electron');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server.cjs');
const {
  createGameWindow,
  createPetWindow,
  hidePetWindow,
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
    hidePet: () => hidePetWindow()
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
