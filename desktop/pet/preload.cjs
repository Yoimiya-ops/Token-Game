const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tokenPet', {
  getState: () => ipcRenderer.invoke('companion:get-state'),
  collect: observedTotal => ipcRenderer.invoke('companion:collect', observedTotal),
  draw: request => ipcRenderer.invoke('companion:draw', request),
  dismantle: request => ipcRenderer.invoke('companion:dismantle', request),
  dismantleBatch: request => ipcRenderer.invoke('companion:dismantleBatch', request),
  exchange: request => ipcRenderer.invoke('companion:exchange', request),
  chooseDirectory: () => ipcRenderer.invoke('companion:choose-directory'),
  onState: callback => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('companion:state', listener);
    return () => ipcRenderer.removeListener('companion:state', listener);
  },
  openGame: () => ipcRenderer.send('pet:open-game'),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
  saveBounds: () => ipcRenderer.send('pet:save-bounds'),
  dragTo: (x, y) => ipcRenderer.send('pet:drag-to', { x, y }),
  endDrag: () => ipcRenderer.send('pet:end-drag')
});
