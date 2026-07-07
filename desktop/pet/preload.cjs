const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenPet', {
  getAsset: () => ipcRenderer.invoke('pet:get-asset'),
  interact: () => ipcRenderer.send('pet:interact'),
  onAssetChanged: (callback) => {
    ipcRenderer.on('pet:asset-changed', (_, asset) => callback(asset));
  },
  onTokenRefreshed: (callback) => {
    ipcRenderer.on('pet:token-refreshed', (_, result) => callback(result));
  },
  openGame: () => ipcRenderer.send('pet:open-game'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  saveBounds: () => ipcRenderer.send('pet:save-bounds'),
  dragTo: (x, y) => ipcRenderer.send('pet:drag-to', { x, y }),
  endDrag: () => ipcRenderer.send('pet:end-drag')
});
