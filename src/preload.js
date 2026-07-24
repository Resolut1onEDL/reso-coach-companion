const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  selectDotaFolder: () => ipcRenderer.invoke('select-dota-folder'),
  steamLogin: () => ipcRenderer.invoke('steam-login'),
  resoUnlink: () => ipcRenderer.invoke('reso-unlink'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  reparseFolder: (opts) => ipcRenderer.invoke('reparse-folder', opts),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  // events: subscribe to push updates
  onEvent: (cb) => {
    ipcRenderer.on('app-event', (_, payload) => cb(payload));
  },
});
