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
  const petAssetItems = actions.listPetAssets().map((asset) => ({
    label: asset.label,
    type: 'radio',
    checked: asset.id === actions.getActivePetAsset().id,
    click: () => actions.setActivePetAsset(asset.id)
  }));

  return Menu.buildFromTemplate([
    { label: '打开游戏', click: actions.openGame },
    {
      label: '切换桌宠',
      submenu: petAssetItems
    },
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
