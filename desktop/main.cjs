const { app, dialog } = require('electron');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server.cjs');
const {
  createGameWindow,
  createPetWindow,
  getActivePetAsset,
  hidePetWindow,
  listAllPetAssets,
  registerPetIpc,
  refreshActivePetAsset,
  restorePetWindow,
  setActivePetAsset,
  togglePetAlwaysOnTop
} = require('./windows.cjs');
const { createPetContextMenu, createTray } = require('./tray.cjs');
const { importCustomPetAsset } = require('./custom-pet-assets.cjs');
const { defaultPetAssetId, deletePetAsset, renamePetAsset } = require('./pet-assets.cjs');
const { promptForText } = require('./prompt-window.cjs');
const { createGameSession } = require('./game-session.cjs');

let gameSession = null;

async function openGame() {
  await createGameWindow(app);
}

async function importPetAsset() {
  const result = await dialog.showOpenDialog({
    title: '添加图片桌宠',
    properties: ['openFile'],
    filters: [
      { name: '图片桌宠', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) {
    return;
  }

  const asset = importCustomPetAsset(app.getPath('userData'), result.filePaths[0]);
  setActivePetAsset(app, asset.id);
}

async function renameActivePetAsset() {
  const activeAsset = getActivePetAsset(app);
  const nextName = await promptForText({
    title: '重命名桌宠',
    label: '桌宠名称',
    value: activeAsset.label
  });
  const renamed = renamePetAsset(app.getPath('userData'), activeAsset.id, nextName);
  if (renamed) {
    refreshActivePetAsset(app);
  }
}

async function deleteActivePetAsset() {
  const activeAsset = getActivePetAsset(app);
  if (activeAsset.id === defaultPetAssetId) {
    return;
  }

  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['删除', '取消'],
    defaultId: 1,
    cancelId: 1,
    title: '删除桌宠',
    message: `删除“${activeAsset.label}”？`,
    detail: activeAsset.custom
      ? '这个操作会移除该自定义桌宠和应用内保存的图片文件。'
      : '这个操作会从桌宠列表中隐藏该内置角色。'
  });

  if (result.response !== 0) {
    return;
  }

  const deleted = deletePetAsset(app.getPath('userData'), activeAsset.id);
  if (deleted) {
    setActivePetAsset(app, defaultPetAssetId);
  }
}

async function boot() {
  await startEmbeddedServer(app);

  gameSession = createGameSession(app);
  void gameSession.start().catch((err) => {
    dialog.showErrorBox(
      'Token Game session',
      err instanceof Error ? err.message : String(err)
    );
  });

  const actions = {
    restorePet: () => restorePetWindow(),
    openGame: () => {
      void openGame();
    },
    toggleAlwaysOnTop: () => togglePetAlwaysOnTop(app),
    hidePet: () => hidePetWindow(),
    listPetAssets: () => listAllPetAssets(app),
    getActivePetAsset: () => getActivePetAsset(app),
    setActivePetAsset: (id) => setActivePetAsset(app, id),
    importPetAsset: () => {
      void importPetAsset();
    },
    renameActivePetAsset: () => {
      void renameActivePetAsset();
    },
    deleteActivePetAsset: () => {
      void deleteActivePetAsset();
    },
    refreshTokens: async () => gameSession.refreshTokens()
  };

  createTray(app, actions);
  registerPetIpc(app, () => createPetContextMenu(app, actions).popup());
  await createPetWindow(app);
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
  // Best-effort close. The server will sweep the session on the next
  // idle check anyway if this fails (network glitch, process killed).
  try {
    await gameSession?.stop();
  } catch {
    // ignore
  }
  await stopEmbeddedServer();
});
