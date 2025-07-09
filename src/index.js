const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const systemUtils = require('./utils/systemUtils');

// Mantener una referencia global del objeto window
let mainWindow;

function createWindow() {
  // Crear la ventana del navegador
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'KeniBox SS Tool',
    backgroundColor: '#242424'
  });

  // Cargar el archivo HTML
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  
  // Quitar menú por defecto
  mainWindow.setMenu(null);
  
  // Opcional: abrir las herramientas de desarrollador
  // mainWindow.webContents.openDevTools();
}

// Este método se llamará cuando Electron haya terminado la inicialización
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Salir cuando todas las ventanas estén cerradas
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Configurar comunicación IPC para las características solicitadas
ipcMain.handle('find-jar-files', async () => {
  try {
    return await systemUtils.findAllJarFiles();
  } catch (error) {
    console.error('Error finding JAR files:', error);
    return { error: error.message };
  }
});

ipcMain.handle('check-extension-changes', async () => {
  try {
    return await systemUtils.checkFileExtensionChanges();
  } catch (error) {
    console.error('Error checking extension changes:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-deleted-files', async (event, minutes) => {
  try {
    return await systemUtils.getRecentlyDeletedFiles(minutes);
  } catch (error) {
    console.error('Error getting deleted files:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-executed-jars', async (event, hours) => {
  try {
    return await systemUtils.getRecentlyExecutedJars(hours);
  } catch (error) {
    console.error('Error getting executed JARs:', error);
    return { error: error.message };
  }
});

ipcMain.handle('check-usb-disconnection', async () => {
  try {
    return await systemUtils.checkUSBDisconnection();
  } catch (error) {
    console.error('Error checking USB disconnection:', error);
    return { error: error.message };
  }
});

ipcMain.handle('check-screen-recording', async () => {
  try {
    return await systemUtils.checkScreenRecording();
  } catch (error) {
    console.error('Error checking screen recording:', error);
    return { error: error.message };
  }
});

ipcMain.handle('open-browser-history', async () => {
  try {
    return await systemUtils.openBrowserHistory();
  } catch (error) {
    console.error('Error opening browser history:', error);
    return { error: error.message };
  }
});

ipcMain.handle('detect-browsers', async () => {
  try {
    return await systemUtils.detectBrowsers();
  } catch (error) {
    console.error('Error detecting browsers:', error);
    return { error: error.message };
  }
});

ipcMain.handle('detect-minecraft-cheats', async () => {
  try {
    return await systemUtils.detectMinecraftCheats();
  } catch (error) {
    console.error('Error detecting Minecraft cheats:', error);
    return { error: error.message };
  }
});

ipcMain.handle('detect-stopped-services', async () => {
  try {
    return await systemUtils.detectStoppedServices();
  } catch (error) {
    console.error('Error detecting stopped services:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-folder-history', async () => {
  try {
    return await systemUtils.getFolderHistory();
  } catch (error) {
    console.error('Error getting folder history:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-execution-history', async (event, hours) => {
  try {
    return await systemUtils.getCompleteExecutionHistory(hours);
  } catch (error) {
    console.error('Error getting execution history:', error);
    return { error: error.message };
  }
});

ipcMain.handle('open-minecraft-files', async () => {
  try {
    return await systemUtils.openMinecraftFiles();
  } catch (error) {
    console.error('Error opening Minecraft files:', error);
    return { error: error.message };
  }
});

ipcMain.handle('open-file-location', async (event, filePath) => {
  try {
    return await systemUtils.openFileLocation(filePath);
  } catch (error) {
    console.error('Error opening file location:', error);
    return { error: error.message };
  }
});

ipcMain.handle('get-command-history', async () => {
  try {
    return await systemUtils.getCommandHistory();
  } catch (error) {
    console.error('Error getting command history:', error);
    return { error: error.message };
  }
});

ipcMain.handle('export-results', async (event, data) => {
  try {
    const options = {
      title: 'Guardar Resultados',
      defaultPath: path.join(app.getPath('documents'), 'kenibox_results.json'),
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'Texto', extensions: ['txt'] }
      ]
    };
    
    const { filePath } = await dialog.showSaveDialog(options);
    
    if (filePath) {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
      return { success: true, path: filePath };
    } else {
      return { canceled: true };
    }
  } catch (error) {
    console.error('Error exporting results:', error);
    return { error: error.message };
  }
});