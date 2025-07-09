const { contextBridge, ipcRenderer } = require('electron');

// Exponer APIs protegidas al proceso de renderizado
contextBridge.exposeInMainWorld('keniboxAPI', {
  // Funciones para comunicarse con el proceso principal
  findJarFiles: () => ipcRenderer.invoke('find-jar-files'),
  checkExtensionChanges: () => ipcRenderer.invoke('check-extension-changes'),
  getDeletedFiles: (minutes = 60) => ipcRenderer.invoke('get-deleted-files', minutes),
  getExecutedJars: (hours = 4) => ipcRenderer.invoke('get-executed-jars', hours),
  checkUSBDisconnection: () => ipcRenderer.invoke('check-usb-disconnection'),
  checkScreenRecording: () => ipcRenderer.invoke('check-screen-recording'),
  openBrowserHistory: () => ipcRenderer.invoke('open-browser-history'),
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),
  detectMinecraftCheats: () => ipcRenderer.invoke('detect-minecraft-cheats'),
  detectStoppedServices: () => ipcRenderer.invoke('detect-stopped-services'),
  getFolderHistory: () => ipcRenderer.invoke('get-folder-history'),
  getExecutionHistory: (hours = 4) => ipcRenderer.invoke('get-execution-history', hours),
  openMinecraftFiles: () => ipcRenderer.invoke('open-minecraft-files'),
  exportResults: (data) => ipcRenderer.invoke('export-results', data),
  openFileLocation: (path) => ipcRenderer.invoke('open-file-location', path),
  getCommandHistory: () => ipcRenderer.invoke('get-command-history'),
  // Funciones de utilidad para el frontend
  getCurrentTime: () => new Date().toISOString()
});