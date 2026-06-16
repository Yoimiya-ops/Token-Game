const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tokenPet', {
  interact: () => ipcRenderer.send('pet:interact'),
  openGame: () => ipcRenderer.send('pet:open-game'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  saveBounds: () => ipcRenderer.send('pet:save-bounds')
});
