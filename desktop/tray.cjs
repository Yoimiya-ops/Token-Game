const { Menu, Tray, nativeImage } = require('electron');
const path = require('node:path');
let tray;

function createTrayMenu(app, actions) {
  return Menu.buildFromTemplate([
    { label: '显示聚宝盆', click: actions.restorePet },
    { label: '隐藏聚宝盆', click: actions.hidePet },
    { label: '看看收获', click: actions.openGame },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
}
function createTray(app, actions) {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'desktop', 'pet', 'assets', 'processed', 'jade-basin-icon.png')).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('聚宝盆');
  tray.setContextMenu(createTrayMenu(app, actions));
  tray.on('click', actions.restorePet);
  tray.on('double-click', actions.openGame);
  return tray;
}
function createPetContextMenu(app, actions) { return createTrayMenu(app, actions); }
module.exports = { createPetContextMenu, createTray };
