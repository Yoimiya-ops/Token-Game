const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenPet', {
  getAsset: () => ipcRenderer.invoke('pet:get-asset'),
  interact: () => ipcRenderer.send('pet:interact'),
  onAssetChanged: (callback) => {
    ipcRenderer.on('pet:asset-changed', (_, asset) => callback(asset));
  },
  openGame: () => ipcRenderer.send('pet:open-game'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  saveBounds: () => ipcRenderer.send('pet:save-bounds')
});
