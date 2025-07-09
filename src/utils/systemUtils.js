const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const { promisify } = require('util');
const { spawn } = require('child_process');

const execPromise = promisify(exec);
const readdirPromise = promisify(fs.readdir);
const statPromise = promisify(fs.stat);

/**
 * Encuentra todos los archivos .jar en el sistema
 */
async function findAllJarFiles() {
  const jarFiles = [];
  const driveLetters = [];
  
  if (process.platform === 'win32') {
    // En Windows, buscar en todas las unidades
    for (let i = 65; i <= 90; i++) {
      const driveLetter = String.fromCharCode(i) + ':\\';
      try {
        if (fs.existsSync(driveLetter)) {
          driveLetters.push(driveLetter);
        }
      } catch (error) {
        console.error(`Error accessing drive ${driveLetter}:`, error);
      }
    }
  } else {
    // En macOS/Linux, buscar desde la raíz
    driveLetters.push('/');
  }
  
  // Agregar ubicaciones comunes primero para optimizar la búsqueda
  const userHome = os.homedir();
  const commonLocations = [
    path.join(userHome, 'Downloads'),
    path.join(userHome, 'Desktop'),
    path.join(userHome, 'Documents'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'mods'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'versions'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'libraries')
  ];
  
  // Buscar primero en ubicaciones comunes
  for (const location of commonLocations) {
    try {
      if (fs.existsSync(location)) {
        await searchJarFilesRecursively(location, jarFiles, 0);
      }
    } catch (error) {
      console.error(`Error searching location ${location}:`, error);
    }
  }
  
  // Si no encontramos suficientes archivos JAR, buscar en todo el sistema
  if (jarFiles.length < 10) {
    for (const drive of driveLetters) {
      try {
        await searchJarFilesRecursively(drive, jarFiles);
      } catch (error) {
        console.error(`Error searching drive ${drive}:`, error);
      }
    }
  }
  
  return jarFiles;
}

/**
 * Búsqueda recursiva de archivos .jar
 */
async function searchJarFilesRecursively(directory, result, depth = 0) {
  // Limitar la profundidad de búsqueda para evitar bucles infinitos
  if (depth > 10) return;
  
  try {
    const files = await readdirPromise(directory);
    
    for (const file of files) {
      if (file.startsWith('.')) continue; // Ignorar archivos ocultos
      
      const fullPath = path.join(directory, file);
      
      try {
        const stats = await statPromise(fullPath);
        
        if (stats.isDirectory()) {
          // Evitar directorios del sistema
          if (!shouldSkipDirectory(fullPath)) {
            await searchJarFilesRecursively(fullPath, result, depth + 1);
          }
        } else if (file.endsWith('.jar')) {
          result.push({
            name: file,
            path: fullPath,
            size: stats.size,
            lastModified: stats.mtime
          });
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
}

/**
 * Verificar si un directorio debe ser omitido en la búsqueda
 */
function shouldSkipDirectory(directory) {
  const skipDirs = ['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'System Volume Information', '$Recycle.Bin', 'node_modules'];
  return skipDirs.some(dir => directory.includes(dir));
}

/**
 * Detecta si se han cambiado nombres o extensiones de archivos
 */
async function checkFileExtensionChanges() {
  const renamedFiles = [];
  const userHome = os.homedir();
  const dirsToCheck = [
    path.join(userHome, 'Desktop'),
    path.join(userHome, 'Documents'),
    path.join(userHome, 'Downloads'),
    // Añadir carpetas comunes de Minecraft
    path.join(userHome, 'AppData', 'Roaming', '.minecraft'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'mods'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'resourcepacks'),
    path.join(userHome, 'AppData', 'Roaming', '.minecraft', 'screenshots')
  ];
  
  // Mantener un registro de archivos modificados recientemente
  const recentlyModified = [];
  
  for (const dir of dirsToCheck) {
    try {
      await findRecentlyModifiedFiles(dir, recentlyModified);
    } catch (error) {
      console.error(`Error checking directory ${dir}:`, error);
    }
  }
  
  // Filtrar archivos que tienen patrones de renombrado
  for (const file of recentlyModified) {
    // Detectar posibles archivos renombrados
    const filename = path.basename(file.path);
    const ext = path.extname(file.path).toLowerCase();
    
    // Verificar patrones comunes de renombrado
    const hasMultipleExtensions = filename.split('.').length > 2;
    const hasUncommonNaming = /(\.|_)(old|new|bak|backup|copy|renamed|changed)/.test(filename);
    const hasDatePattern = /\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\(\d+\)/.test(filename);
    
    if (hasMultipleExtensions || hasUncommonNaming || hasDatePattern) {
      renamedFiles.push({
        name: filename,
        path: file.path,
        modifiedTime: file.modifiedTime,
        originalName: getOriginalNameGuess(filename),
        reason: hasMultipleExtensions ? 'Múltiples extensiones' : 
               hasUncommonNaming ? 'Patrón de renombrado' : 'Contiene marca de fecha'
      });
    }
    
    // Comprobar si hay archivos con el mismo nombre base pero diferente extensión
    const baseName = filename.substring(0, filename.lastIndexOf('.'));
    const similarFiles = recentlyModified.filter(f => {
      const otherName = path.basename(f.path);
      const otherBaseName = otherName.substring(0, otherName.lastIndexOf('.'));
      return otherBaseName === baseName && f.path !== file.path;
    });
    
    if (similarFiles.length > 0) {
      renamedFiles.push({
        name: filename,
        path: file.path,
        modifiedTime: file.modifiedTime,
        similarFiles: similarFiles.map(f => ({
          name: path.basename(f.path),
          path: f.path, 
          modifiedTime: f.modifiedTime
        })),
        reason: 'Archivos similares encontrados'
      });
    }
  }
  
  return renamedFiles;
}

/**
 * Encuentra archivos modificados recientemente
 */
async function findRecentlyModifiedFiles(directory, result, depth = 0) {
  // Limitar profundidad para evitar búsquedas infinitas
  if (depth > 5) return;
  
  try {
    const files = await readdirPromise(directory);
    
    for (const file of files) {
      const fullPath = path.join(directory, file);
      
      try {
        const stats = await statPromise(fullPath);
        const fileModTime = new Date(stats.mtime);
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 24); // Buscar en las últimas 24 horas
        
        if (stats.isDirectory() && !file.startsWith('.')) {
          await findRecentlyModifiedFiles(fullPath, result, depth + 1);
        } else if (stats.isFile() && fileModTime > oneHourAgo) {
          result.push({
            name: file,
            path: fullPath,
            modifiedTime: fileModTime,
            size: stats.size
          });
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
}

/**
 * Intenta adivinar el nombre original de un archivo
 */
function getOriginalNameGuess(filename) {
  const parts = filename.split('.');
  
  // Si tiene múltiples extensiones, intentar adivinar la original
  if (parts.length > 2) {
    return parts[0] + '.' + parts[parts.length-1];
  }
  
  // Si tiene patrones de renombrado, intentar limpiarlos
  const cleanName = filename.replace(/(\.|_)(old|new|bak|backup|copy|renamed|changed|\d{4}-\d{2}-\d{2})/, '');
  
  return cleanName;
}

/**
 * Obtiene los archivos eliminados recientemente
 * @param {number} minutes - Minutos hacia atrás para buscar
 */
async function getRecentlyDeletedFiles(minutes = 60) {
  const deletedFiles = [];
  const timeThreshold = new Date();
  timeThreshold.setMinutes(timeThreshold.getMinutes() - minutes);
  
  try {
    if (process.platform === 'win32') {
      // En Windows, buscar en el Registro del Sistema eventos de eliminación
      const { stdout } = await execPromise(
        `powershell "Get-EventLog -LogName 'Application' -After (Get-Date).AddMinutes(-${minutes}) | Where-Object {$_.EventID -eq 1025 -or $_.EventID -eq 1026} | Select-Object TimeGenerated, Message | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const events = JSON.parse(stdout);
        const eventList = Array.isArray(events) ? events : events ? [events] : [];
        
        for (const event of eventList) {
          if (event && event.Message && (event.Message.includes('deleted') || event.Message.includes('removed'))) {
            // Extraer el nombre del archivo de los mensajes del evento
            const fileMatch = event.Message.match(/file\s+([^\r\n]+)/i);
            if (fileMatch) {
              deletedFiles.push({
                name: path.basename(fileMatch[1].trim()),
                path: fileMatch[1].trim(),
                deletedTime: new Date(event.TimeGenerated)
              });
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing deleted files:', parseError);
      }
      
      // Método alternativo usando la papelera de reciclaje
      const recyclebinPath = path.join(os.homedir(), '$RECYCLE.BIN');
      try {
        await searchRecycleBin(recyclebinPath, deletedFiles, timeThreshold);
      } catch (rbError) {
        console.error('Error accessing recycle bin:', rbError);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, buscar en la Papelera
      const trashPath = path.join(os.homedir(), '.Trash');
      await searchDeletedFiles(trashPath, deletedFiles, timeThreshold);
    } else {
      // En Linux, buscar en la Papelera
      const trashPath = path.join(os.homedir(), '.local/share/Trash/files');
      const trashInfoPath = path.join(os.homedir(), '.local/share/Trash/info');
      await searchLinuxTrash(trashPath, trashInfoPath, deletedFiles, timeThreshold);
    }
    
    // Intentar usar herramientas de recuperación de datos disponibles
    await tryUsingDataRecoveryTools(deletedFiles, minutes);
    
  } catch (error) {
    console.error('Error accessing trash:', error);
  }
  
  // Ordenar por tiempo de eliminación y limitar a los más recientes
  return deletedFiles
    .sort((a, b) => b.deletedTime - a.deletedTime)
    .slice(0, 20); // Mostrar más resultados
}

/**
 * Busca en la papelera de Windows
 */
async function searchRecycleBin(directory, result, timeThreshold) {
  try {
    const files = await readdirPromise(directory);
    
    for (const file of files) {
      const fullPath = path.join(directory, file);
      
      try {
        const stats = await statPromise(fullPath);
        
        if (stats.isDirectory()) {
          await searchRecycleBin(fullPath, result, timeThreshold);
        } else if (stats.mtime >= timeThreshold) {
          // En la papelera de Windows, los archivos tienen nombres codificados
          // Intentamos obtener información original con PowerShell
          try {
            const { stdout } = await execPromise(
              `powershell "(New-Object -ComObject Shell.Application).NameSpace(10).Items() | Where-Object { $_.Path -like '*${file}*' } | Select-Object Name, Path | ConvertTo-Json"`
            ).catch(() => ({ stdout: '[]' }));
            
            const items = JSON.parse(stdout);
            const itemList = Array.isArray(items) ? items : items ? [items] : [];
            
            if (itemList.length > 0) {
              result.push({
                name: itemList[0].Name,
                path: itemList[0].Path,
                deletedTime: stats.mtime
              });
            } else {
              result.push({
                name: file,
                path: fullPath,
                deletedTime: stats.mtime
              });
            }
          } catch (psError) {
            result.push({
              name: file,
              path: fullPath,
              deletedTime: stats.mtime
            });
          }
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
}

/**
 * Busca archivos eliminados en la papelera
 */
async function searchDeletedFiles(directory, result, timeThreshold) {
  try {
    const files = await readdirPromise(directory);
    
    for (const file of files) {
      const fullPath = path.join(directory, file);
      
      try {
        const stats = await statPromise(fullPath);
        
        if (stats.isDirectory()) {
          await searchDeletedFiles(fullPath, result, timeThreshold);
        } else if (stats.mtime >= timeThreshold) {
          result.push({
            name: file,
            path: fullPath,
            deletedTime: stats.mtime
          });
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
}

/**
 * Busca archivos en la papelera de Linux con información de eliminación
 */
async function searchLinuxTrash(trashPath, infoPath, result, timeThreshold) {
  try {
    const files = await readdirPromise(trashPath);
    
    for (const file of files) {
      const filePath = path.join(trashPath, file);
      const infoFilePath = path.join(infoPath, file + '.trashinfo');
      
      try {
        const stats = await statPromise(filePath);
        
        // Intentar leer el archivo de información si existe
        let originalPath = "";
        let deletionDate = stats.mtime;
        
        if (fs.existsSync(infoFilePath)) {
          const infoContent = fs.readFileSync(infoFilePath, 'utf8');
          const pathMatch = infoContent.match(/Path=(.*)/);
          const dateMatch = infoContent.match(/DeletionDate=(.*)/);
          
          if (pathMatch && pathMatch[1]) {
            originalPath = decodeURIComponent(pathMatch[1]);
          }
          
          if (dateMatch && dateMatch[1]) {
            deletionDate = new Date(dateMatch[1]);
          }
        }
        
        if (deletionDate >= timeThreshold) {
          result.push({
            name: file,
            path: originalPath || filePath,
            deletedTime: deletionDate
          });
        }
      } catch (error) {
        // Ignorar errores de acceso
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
  }
}

/**
 * Intenta usar herramientas de recuperación de datos si están disponibles
 */
async function tryUsingDataRecoveryTools(result, minutes) {
  if (process.platform === 'win32') {
    try {
      // Ver si podemos usar forfiles para buscar archivos eliminados recientemente
      const { stdout } = await execPromise(
        `powershell "Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -Name 'NtfsDisableLastAccessUpdate' | Select-Object NtfsDisableLastAccessUpdate | ConvertTo-Json"`
      ).catch(() => ({ stdout: '{}' }));
      
      // Si la característica está habilitada, podríamos buscar archivos con acceso reciente pero que ya no existen
      // Esta es una técnica avanzada y puede requerir herramientas forenses
    } catch (error) {
      // Ignorar errores, esta es solo una característica adicional
    }
  }
}

/**
 * Obtiene los archivos .jar ejecutados recientemente con opción de tiempo
 * @param {number} hours - Horas hacia atrás para buscar
 */
async function getRecentlyExecutedJars(hours = 4) {
  const executedJars = [];
  const timeThreshold = new Date();
  timeThreshold.setHours(timeThreshold.getHours() - hours);
  
  try {
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para obtener el historial de procesos
      const { stdout } = await execPromise(
        `powershell "Get-WmiObject Win32_Process | Where-Object {$_.CommandLine -like '*java*' -and $_.CommandLine -like '*.jar*'} | Select-Object CommandLine, CreationDate, ProcessId | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const processes = JSON.parse(stdout);
        const processList = Array.isArray(processes) ? processes : processes ? [processes] : [];
        
        for (const process of processList) {
          if (process && process.CommandLine) {
            const jarMatch = process.CommandLine.match(/-jar\s+"?([^"]+\.jar)"?/);
            if (jarMatch) {
              const jarPath = jarMatch[1];
              const creationDate = new Date(process.CreationDate || Date.now());
              
              if (creationDate >= timeThreshold) {
                executedJars.push({
                  name: path.basename(jarPath),
                  path: jarPath,
                  startTime: creationDate.toLocaleString(),
                  pid: process.ProcessId,
                  command: process.CommandLine
                });
              }
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing process output:', parseError);
      }
      
      // También buscar en el registro de eventos de Windows
      const { stdout: eventStdout } = await execPromise(
        `powershell "Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime='${timeThreshold.toISOString()}'} -ErrorAction SilentlyContinue | Where-Object {$_.Message -like '*java*' -and $_.Message -like '*.jar*'} | Select-Object TimeCreated, Message | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const events = JSON.parse(eventStdout);
        const eventList = Array.isArray(events) ? events : events ? [events] : [];
        
        for (const event of eventList) {
          if (event && event.Message) {
            const jarMatch = event.Message.match(/([A-Za-z]:(?:\\[^:\\*\?"<>\|][^:\\*\?"<>\|]*)+\.jar)/);
            if (jarMatch) {
              executedJars.push({
                name: path.basename(jarMatch[1]),
                path: jarMatch[1],
                startTime: new Date(event.TimeCreated).toLocaleString(),
                source: 'Event Log'
              });
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing event log:', parseError);
      }
      
      // Buscar en el registro de Prefetch
      const { stdout: prefetchStdout } = await execPromise(
        `powershell "Get-ChildItem -Path 'C:\\Windows\\Prefetch' -Filter '*.pf' | Where-Object {$_.Name -like '*JAVA*'} | Select-Object Name, LastWriteTime | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const prefetchFiles = JSON.parse(prefetchStdout);
        const prefetchList = Array.isArray(prefetchFiles) ? prefetchFiles : prefetchFiles ? [prefetchFiles] : [];
        
        for (const prefetch of prefetchList) {
          if (prefetch && prefetch.Name) {
            const lastWriteTime = new Date(prefetch.LastWriteTime);
            
            if (lastWriteTime >= timeThreshold) {
              executedJars.push({
                name: prefetch.Name.replace('.pf', ''),
                path: prefetch.Name.replace('.pf', ''),
                startTime: lastWriteTime.toLocaleString(),
                source: 'Prefetch'
              });
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing prefetch files:', parseError);
      }
      
      // Buscar archivos JAR en carpetas comunes y verificar último acceso
      const minecraftFolders = [
        path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft'),
        path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft', 'mods'),
        path.join(os.homedir(), 'Downloads')
      ];
      
      for (const folder of minecraftFolders) {
        try {
          if (fs.existsSync(folder)) {
            const files = await readdirPromise(folder);
            
            for (const file of files) {
              if (file.endsWith('.jar')) {
                const filePath = path.join(folder, file);
                
                try {
                  const stats = await statPromise(filePath);
                  const lastAccessed = new Date(stats.atime);
                  
                  if (lastAccessed >= timeThreshold) {
                    executedJars.push({
                      name: file,
                      path: filePath,
                      startTime: lastAccessed.toLocaleString(),
                      source: 'File Access',
                      size: stats.size
                    });
                  }
                } catch (error) {
                  // Ignorar errores de acceso
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error accessing folder ${folder}:`, error);
        }
      }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // En macOS/Linux, usar ps
      const { stdout } = await execPromise('ps -eo pid,lstart,command | grep -i java | grep -i \\.jar').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          const jarMatch = line.match(/.*java.*-jar\s+([^\s]+\.jar)/);
          if (jarMatch) {
            // Extraer la fecha del formato de salida de ps
            const dateMatch = line.match(/([A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})/);
            let startTime;
            
            if (dateMatch) {
              startTime = new Date(dateMatch[1]);
              
              if (startTime >= timeThreshold) {
                executedJars.push({
                  name: path.basename(jarMatch[1]),
                  path: jarMatch[1],
                  startTime: startTime.toLocaleString(),
                  source: 'Process List'
                });
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error getting executed JARs:', error);
  }
  
  // Eliminar duplicados manteniendo la información más reciente
  const uniqueJars = [];
  const jarPaths = new Set();
  
  for (const jar of executedJars) {
    const normalizedPath = jar.path.toLowerCase();
    
    if (!jarPaths.has(normalizedPath)) {
      jarPaths.add(normalizedPath);
      uniqueJars.push(jar);
    }
  }
  
  return uniqueJars.sort((a, b) => {
    return new Date(b.startTime) - new Date(a.startTime);
  });
}

/**
 * Verifica si un dispositivo USB fue desconectado recientemente
 */
async function checkUSBDisconnection() {
  try {
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para obtener eventos de dispositivos
      const { stdout } = await execPromise(
        'powershell "Get-WinEvent -FilterHashtable @{LogName=\'System\'; Id=225; ProviderName=\'Microsoft-Windows-Kernel-PnP\'} -MaxEvents 10 | Select-Object TimeCreated, Message | ConvertTo-Json"'
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const events = JSON.parse(stdout);
        const eventList = Array.isArray(events) ? events : events ? [events] : [];
        
        const disconnections = eventList
          .filter(event => event && event.Message && event.Message.includes('USB'))
          .map(event => ({
            device: event.Message.match(/(?:dispositivo|device) ([^\(]+)/i)?.[1] || 'USB Device',
            time: new Date(event.TimeCreated).toLocaleString()
          }));
        
        return {
          disconnected: disconnections.length > 0,
          details: disconnections
        };
      } catch (parseError) {
        console.error('Error parsing USB events:', parseError);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, revisar el log del sistema
      const { stdout } = await execPromise('log show --predicate "eventMessage CONTAINS[c] \\"USB\\"" --last 1h').catch(() => ({ stdout: '' }));
      
      const disconnectMatches = stdout.match(/USB device (.*) disconnected/g);
      const disconnections = disconnectMatches ? disconnectMatches.map(match => ({
        device: match.match(/USB device (.*) disconnected/)?.[1] || 'USB Device',
        time: new Date().toLocaleString() // Aproximado
      })) : [];
      
      return {
        disconnected: disconnections.length > 0,
        details: disconnections
      };
    } else {
      // En Linux, revisar dmesg
      const { stdout } = await execPromise('dmesg | grep -i "usb disconnect" | tail -10').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n').filter(line => line.trim());
      const disconnections = lines.map(line => ({
        device: line.match(/usb .*: USB disconnect/i)?.[0] || 'USB Device',
        time: new Date().toLocaleString() // Aproximado
      }));
      
      return {
        disconnected: disconnections.length > 0,
        details: disconnections
      };
    }
  } catch (error) {
    console.error('Error checking USB disconnection:', error);
  }
  
  return { disconnected: false, details: [] };
}

/**
 * Lista de aplicaciones conocidas de grabación de pantalla
 */
const screenRecordingApps = [
    // Software de streaming y grabación popular
    'OBS Studio', 'obs64.exe', 'obs.exe', 'obs-studio',
    'Bandicam', 'bdcam.exe', 'bandicam.exe',
    'Camtasia', 'camtasia.exe', 'camtasiastudio.exe',
    'Action!', 'action.exe', 'mirillis.exe',
    'Fraps', 'fraps.exe',
    'Streamlabs OBS', 'streamlabs-obs.exe',
    'XSplit', 'xsplit.exe', 'xsplitbroadcaster.exe',
    'DXtory', 'dxtory.exe',
    'Nvidia ShadowPlay', 'nvstreamsvc.exe', 'nvspcaps64.exe',
    'AMD ReLive', 'amdow.exe', 'radeonoverlay',
    'Movavi Screen Recorder', 'movavi_screencapturer.exe',
    'ScreenRec', 'screenrec.exe',
    'ScreenCastify', 'screencastify',
    'ScreenFlow',
    'FFmpeg', 'ffmpeg.exe',
    
    // Software menos conocido pero también utilizado
    'D3DGear', 'd3dgear.exe',
    'Icecream Screen Recorder', 'icecreamscreenrecorder.exe',
    'CamStudio', 'camstudio.exe',
    'TinyTake', 'tinytake.exe',
    'Screencast-O-Matic', 'screencastomatic.exe',
    'Debut Video Capture', 'debut.exe',
    'FlashBack Express', 'flashback.exe',
    'Snagit', 'snagit.exe',
    'ActivePresenter', 'activepresenter.exe',
    'Apowersoft Screen Recorder', 'apowersoftscreenrecorder.exe',
    'AceThinker Screen Grabber Pro', 'acethinkerscreengrabber.exe',
    'iSpring Cam', 'ispringcam.exe',
    'Screen Recorder Gold', 'screenrecordergold.exe',
    'Any Video Recorder', 'anyvideorecorder.exe',
    
    // Software integrado del sistema
    'Xbox Game Bar', 'gamebar.exe', 'xboxgamebar.exe', 'gamebarft.exe',
    'Windows Game Recording', 'xboxapp.exe', 'gamerecording',
    'QuickTime Player',
    
    // Extensiones de navegador y apps web
    'Loom', 'loom.exe',
    'Nimbus', 'nimbus.exe',
    'Awesome Screenshot',
    'Screencastify',
    'ShareX', 'sharex.exe',
    'Screen Capture',
    'Grabilla', 'grabilla.exe',
    
    // Términos genéricos relacionados
    'screen recorder', 'screenrecorder', 
    'capture', 'screen capture', 'screencapture',
    'record', 'recording', 'grabber',
    'screengrab', 'screen grab'
];

/**
 * Detecta si hay aplicaciones de grabación de pantalla activas
 */
async function checkScreenRecording() {
  try {
    let processOutput = '';
    let detectedApps = [];
    
    if (process.platform === 'win32') {
      // En Windows, obtener lista de procesos en formato detallado
      const { stdout: tasklist } = await execPromise('tasklist /fo csv /v').catch(() => ({ stdout: '' }));
      processOutput = tasklist;
      
      // Búsqueda más específica de procesos de grabación conocidos
      for (const app of screenRecordingApps) {
        try {
          const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${app}" /FO CSV /V`).catch(() => ({ stdout: '' }));
          if (stdout && stdout.includes('.exe') && !stdout.includes('No tasks')) {
            detectedApps.push(app);
          }
        } catch (error) {
          // Ignorar errores
        }
      }
      
      // También verificar los servicios en ejecución
      const { stdout: servicesOutput } = await execPromise('powershell "Get-Service | Where-Object {$_.Status -eq \'Running\'} | Select-Object DisplayName | ConvertTo-Json"').catch(() => ({ stdout: '[]' }));
      
      try {
        const services = JSON.parse(servicesOutput);
        const serviceList = Array.isArray(services) ? services : services ? [services] : [];
        
        for (const service of serviceList) {
          processOutput += service.DisplayName + '\n';
        }
      } catch (error) {
        console.error('Error parsing services output:', error);
      }
      
      // Verificar aplicaciones en segundo plano
      const { stdout: bgAppsOutput } = await execPromise('powershell "Get-Process | Select-Object ProcessName, Description | ConvertTo-Json"').catch(() => ({ stdout: '[]' }));
      
      try {
        const bgApps = JSON.parse(bgAppsOutput);
        const bgAppsList = Array.isArray(bgApps) ? bgApps : bgApps ? [bgApps] : [];
        
        for (const app of bgAppsList) {
          processOutput += `${app.ProcessName} - ${app.Description || ''}\n`;
          
          // Verificar si esta aplicación está en nuestra lista de apps de grabación
          for (const recordingApp of screenRecordingApps) {
            if ((app.ProcessName && app.ProcessName.toLowerCase().includes(recordingApp.toLowerCase())) || 
                (app.Description && app.Description.toLowerCase().includes(recordingApp.toLowerCase()))) {
              if (!detectedApps.includes(app.ProcessName)) {
                detectedApps.push(app.ProcessName + (app.Description ? ` (${app.Description})` : ''));
              }
            }
          }
        }
      } catch (error) {
        console.error('Error parsing background apps output:', error);
      }
      
      // Verificar configuración del Xbox Game Bar
      try {
        const { stdout: xboxOutput } = await execPromise('powershell "Get-ItemProperty -Path \'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR\' -ErrorAction SilentlyContinue | ConvertTo-Json"').catch(() => ({ stdout: '{}' }));
        
        try {
          const xboxSettings = JSON.parse(xboxOutput);
          if (xboxSettings && xboxSettings.AppCaptureEnabled === 1) {
            processOutput += 'Xbox Game Bar - Capture Enabled\n';
            detectedApps.push('Xbox Game Bar (habilitado para captura)');
          }
        } catch (error) {
          console.error('Error parsing Xbox Game Bar settings:', error);
        }
      } catch (error) {
        console.error('Error checking Xbox Game Bar settings:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar ps para listar procesos con más detalle
      const { stdout } = await execPromise('ps -axo comm,pid').catch(() => ({ stdout: '' }));
      processOutput = stdout;
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        for (const app of screenRecordingApps) {
          if (line.toLowerCase().includes(app.toLowerCase())) {
            const appName = line.trim().split(' ')[0];
            if (!detectedApps.includes(appName)) {
              detectedApps.push(appName);
            }
          }
        }
      }
    } else {
      // En Linux, usar ps
      const { stdout } = await execPromise('ps -axo comm,pid').catch(() => ({ stdout: '' }));
      processOutput = stdout;
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        for (const app of screenRecordingApps) {
          if (line.toLowerCase().includes(app.toLowerCase())) {
            const appName = line.trim().split(' ')[0];
            if (!detectedApps.includes(appName)) {
              detectedApps.push(appName);
            }
          }
        }
      }
    }
    
    // Si no encontramos aplicaciones específicas, buscar términos en la salida completa
    if (detectedApps.length === 0) {
      for (const app of screenRecordingApps) {
        if (processOutput.toLowerCase().includes(app.toLowerCase())) {
          if (!detectedApps.includes(app)) {
            detectedApps.push(app);
          }
        }
      }
    }
    
    return {
      recording: detectedApps.length > 0,
      applications: detectedApps
    };
  } catch (error) {
    console.error('Error checking screen recording:', error);
    return { recording: false, applications: [] };
  }
}

/**
 * Detecta el navegador web instalado y predeterminado
 */
async function detectBrowsers() {
  const browsers = [];
  
  try {
    if (process.platform === 'win32') {
      // Buscar navegadores comunes en Windows
      const browserPaths = [
        { name: 'Google Chrome', path: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome') },
        { name: 'Mozilla Firefox', path: path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox') },
        { name: 'Microsoft Edge', path: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge') },
        { name: 'Opera', path: path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera Stable') },
        { name: 'Opera GX', path: path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera GX Stable') },
        { name: 'Brave', path: path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser') },
        { name: 'Vivaldi', path: path.join(os.homedir(), 'AppData', 'Local', 'Vivaldi') },
        { name: 'Safari', path: path.join('C:', 'Program Files', 'Safari') }
      ];
      
      for (const browser of browserPaths) {
        if (fs.existsSync(browser.path)) {
          browsers.push({
            name: browser.name,
            path: browser.path,
            default: false
          });
        }
      }
      
      // Intentar detectar el navegador predeterminado
      try {
        const { stdout } = await execPromise(
          'powershell "Get-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice\' | Select-Object ProgId | ConvertTo-Json"'
        ).catch(() => ({ stdout: '{}' }));
        
        try {
          const defaultBrowser = JSON.parse(stdout);
          if (defaultBrowser && defaultBrowser.ProgId) {
            let browserName = 'Unknown';
            
            if (defaultBrowser.ProgId.includes('Chrome')) browserName = 'Google Chrome';
            else if (defaultBrowser.ProgId.includes('Firefox')) browserName = 'Mozilla Firefox';
            else if (defaultBrowser.ProgId.includes('Edge')) browserName = 'Microsoft Edge';
            else if (defaultBrowser.ProgId.includes('Opera')) {
              // Verificar si es Opera GX u Opera normal
              if (fs.existsSync(path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera GX Stable'))) {
                browserName = 'Opera GX';
              } else {
                browserName = 'Opera';
              }
            }
            else if (defaultBrowser.ProgId.includes('Brave')) browserName = 'Brave';
            else if (defaultBrowser.ProgId.includes('Vivaldi')) browserName = 'Vivaldi';
            else if (defaultBrowser.ProgId.includes('Safari')) browserName = 'Safari';
            
            // Marcar el navegador predeterminado
            for (const browser of browsers) {
              if (browser.name === browserName) {
                browser.default = true;
              }
            }
          }
        } catch (error) {
          console.error('Error parsing default browser:', error);
        }
      } catch (error) {
        console.error('Error getting default browser:', error);
      }
    } else if (process.platform === 'darwin') {
      // Buscar navegadores comunes en macOS
      const { stdout } = await execPromise('ls /Applications | grep -E "Chrome|Firefox|Safari|Opera|Edge|Brave|Vivaldi"').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('Chrome')) browsers.push({ name: 'Google Chrome', path: `/Applications/${line}`, default: false });
        else if (line.includes('Firefox')) browsers.push({ name: 'Mozilla Firefox', path: `/Applications/${line}`, default: false });
        else if (line.includes('Safari')) browsers.push({ name: 'Safari', path: `/Applications/${line}`, default: false });
        else if (line.includes('Opera')) {
          if (line.includes('GX')) browsers.push({ name: 'Opera GX', path: `/Applications/${line}`, default: false });
          else browsers.push({ name: 'Opera', path: `/Applications/${line}`, default: false });
        }
        else if (line.includes('Edge')) browsers.push({ name: 'Microsoft Edge', path: `/Applications/${line}`, default: false });
        else if (line.includes('Brave')) browsers.push({ name: 'Brave', path: `/Applications/${line}`, default: false });
        else if (line.includes('Vivaldi')) browsers.push({ name: 'Vivaldi', path: `/Applications/${line}`, default: false });
      }
      
      // Obtener el navegador predeterminado en macOS
      try {
        const { stdout } = await execPromise('defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep "LSHandlerURLScheme = http"').catch(() => ({ stdout: '' }));
        
        if (stdout) {
          const defaultBrowserMatch = stdout.match(/LSHandlerRoleAll = "([^"]+)"/);
          if (defaultBrowserMatch && defaultBrowserMatch[1]) {
            const defaultId = defaultBrowserMatch[1];
            let browserName = '';
            
            if (defaultId.includes('chrome')) browserName = 'Google Chrome';
            else if (defaultId.includes('firefox')) browserName = 'Mozilla Firefox';
            else if (defaultId.includes('safari')) browserName = 'Safari';
            else if (defaultId.includes('opera')) {
              // Verificar si es Opera GX u Opera normal
              if (fs.existsSync('/Applications/Opera GX.app')) {
                browserName = 'Opera GX';
              } else {
                browserName = 'Opera';
              }
            }
            else if (defaultId.includes('edge')) browserName = 'Microsoft Edge';
            else if (defaultId.includes('brave')) browserName = 'Brave';
            else if (defaultId.includes('vivaldi')) browserName = 'Vivaldi';
            
            // Marcar el navegador predeterminado
            for (const browser of browsers) {
              if (browser.name === browserName) {
                browser.default = true;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error getting default browser:', error);
      }
    } else {
      // En Linux
      // Buscar navegadores comunes instalados
      const commands = [
        { name: 'Google Chrome', cmd: 'which google-chrome' },
        { name: 'Mozilla Firefox', cmd: 'which firefox' },
        { name: 'Opera', cmd: 'which opera' },
        { name: 'Brave', cmd: 'which brave-browser' },
        { name: 'Vivaldi', cmd: 'which vivaldi' },
        { name: 'Microsoft Edge', cmd: 'which microsoft-edge' }
      ];
      
      for (const browser of commands) {
        try {
          const { stdout } = await execPromise(browser.cmd).catch(() => ({ stdout: '' }));
          
          if (stdout.trim()) {
            browsers.push({
              name: browser.name,
              path: stdout.trim(),
              default: false
            });
          }
        } catch (error) {
          // Ignorar errores
        }
      }
      
      // Intentar detectar el navegador predeterminado en Linux
      try {
        const { stdout } = await execPromise('xdg-settings get default-web-browser').catch(() => ({ stdout: '' }));
        
        if (stdout.trim()) {
          const defaultBrowser = stdout.trim().toLowerCase();
          let browserName = '';
          
          if (defaultBrowser.includes('chrome')) browserName = 'Google Chrome';
          else if (defaultBrowser.includes('firefox')) browserName = 'Mozilla Firefox';
          else if (defaultBrowser.includes('opera')) browserName = 'Opera';
          else if (defaultBrowser.includes('brave')) browserName = 'Brave';
          else if (defaultBrowser.includes('vivaldi')) browserName = 'Vivaldi';
          else if (defaultBrowser.includes('edge')) browserName = 'Microsoft Edge';
          
          // Marcar el navegador predeterminado
          for (const browser of browsers) {
            if (browser.name === browserName) {
              browser.default = true;
            }
          }
        }
      } catch (error) {
        console.error('Error getting default browser:', error);
      }
    }
  } catch (error) {
    console.error('Error detecting browsers:', error);
  }
  
  return browsers;
}

/**
 * Abre el historial del navegador, con soporte para Opera GX y otros navegadores
 */
async function openBrowserHistory() {
  try {
    // Primero detectar los navegadores instalados
    const browsers = await detectBrowsers();
    let browserOpened = false;
    let errorMessage = '';
    
    // Intentar abrir el navegador predeterminado primero
    const defaultBrowser = browsers.find(browser => browser.default);
    if (defaultBrowser) {
      try {
        await openSpecificBrowserHistory(defaultBrowser);
        return { success: true, browser: defaultBrowser.name };
      } catch (error) {
        errorMessage = `Error al abrir ${defaultBrowser.name}: ${error.message}`;
        console.error(errorMessage);
      }
    }
    
    // Si no se pudo abrir el predeterminado, intentar con todos los navegadores detectados
    for (const browser of browsers) {
      if (!browserOpened) {
        try {
          await openSpecificBrowserHistory(browser);
          browserOpened = true;
          return { success: true, browser: browser.name };
        } catch (error) {
          console.error(`Error al abrir ${browser.name}: ${error.message}`);
        }
      }
    }
    
    // Si aún no se ha abierto, intentar con los comandos genéricos
    if (process.platform === 'win32') {
      // Intentar con métodos adicionales en Windows
      try {
        await execPromise('start microsoft-edge:about:history');
        return { success: true, browser: 'Microsoft Edge' };
      } catch (edgeError) {
        console.error('Error opening Edge:', edgeError);
      }
      
      try {
        await execPromise('start chrome:about:history');
        return { success: true, browser: 'Google Chrome' };
      } catch (chromeError) {
        console.error('Error opening Chrome:', chromeError);
      }
    }
    
    if (browserOpened) {
      return { success: true };
    } else {
      throw new Error(errorMessage || 'No se pudo abrir ningún navegador compatible');
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Abre el historial en un navegador específico
 */
async function openSpecificBrowserHistory(browser) {
  if (process.platform === 'win32') {
    if (browser.name === 'Google Chrome') {
      await execPromise('start chrome chrome://history');
    } else if (browser.name === 'Mozilla Firefox') {
      await execPromise('start firefox about:history');
    } else if (browser.name === 'Microsoft Edge') {
      await execPromise('start msedge edge://history');
    } else if (browser.name === 'Opera') {
      await execPromise(`"${browser.path}\\launcher.exe" opera://history`);
    } else if (browser.name === 'Opera GX') {
      // Verificar varias rutas posibles para Opera GX
      const possiblePaths = [
        path.join(browser.path, 'launcher.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Opera GX', 'launcher.exe'),
        path.join('C:', 'Program Files', 'Opera GX', 'launcher.exe'),
        path.join('C:', 'Program Files (x86)', 'Opera GX', 'launcher.exe')
      ];
      
      for (const exePath of possiblePaths) {
        if (fs.existsSync(exePath)) {
          await execPromise(`"${exePath}" opera://history`);
          return;
        }
      }
      
      throw new Error('No se pudo encontrar el ejecutable de Opera GX');
    } else if (browser.name === 'Brave') {
      await execPromise('start brave chrome://history');
    } else if (browser.name === 'Vivaldi') {
      await execPromise('start vivaldi vivaldi://history');
    } else if (browser.name === 'Safari') {
      await execPromise('start safari');
    }
  } else if (process.platform === 'darwin') {
    // En macOS
    if (browser.name === 'Google Chrome') {
      await execPromise('open -a "Google Chrome" chrome://history');
    } else if (browser.name === 'Mozilla Firefox') {
      await execPromise('open -a "Firefox" about:history');
    } else if (browser.name === 'Safari') {
      await execPromise('open -a Safari');
    } else if (browser.name === 'Opera GX') {
      await execPromise('open -a "Opera GX" opera://history');
    } else if (browser.name === 'Opera') {
      await execPromise('open -a "Opera" opera://history');
    } else if (browser.name === 'Microsoft Edge') {
      await execPromise('open -a "Microsoft Edge" edge://history');
    } else if (browser.name === 'Brave') {
      await execPromise('open -a "Brave Browser" chrome://history');
    } else if (browser.name === 'Vivaldi') {
      await execPromise('open -a "Vivaldi" vivaldi://history');
    }
  } else {
    // En Linux
    if (browser.name === 'Google Chrome') {
      await execPromise('google-chrome chrome://history');
    } else if (browser.name === 'Mozilla Firefox') {
      await execPromise('firefox about:history');
    } else if (browser.name === 'Opera') {
      await execPromise('opera opera://history');
    } else if (browser.name === 'Microsoft Edge') {
      await execPromise('microsoft-edge edge://history');
    } else if (browser.name === 'Brave') {
      await execPromise('brave-browser chrome://history');
    } else if (browser.name === 'Vivaldi') {
      await execPromise('vivaldi vivaldi://history');
    }
  }
}

/**
 * Lista completa de cheats y hacks conocidos para Minecraft
 */
const minecraftCheatsDatabase = [
  // Clientes populares
  { name: "Wurst Client", category: "Client", type: "Combat/Utility", description: "Cliente de hacks popular con módulos de combate, movimiento y más" },
  { name: "Impact Client", category: "Client", type: "Combat/Utility", description: "Cliente para supervivencia y anárquicos con muchos módulos" },
  { name: "LiquidBounce", category: "Client", type: "Combat/Utility/Movement", description: "Cliente de código abierto con múltiples funciones" },
  { name: "Sigma Client", category: "Client", type: "Combat/PVP", description: "Cliente con enfoque en PVP con múltiples versiones" },
  { name: "Aristois", category: "Client", type: "Utility", description: "Cliente con múltiples características para supervivencia" },
  { name: "Flux", category: "Client", type: "Premium", description: "Cliente premium con varios bypasses para servidores" },
  { name: "Future Client", category: "Client", type: "Premium/Anarchy", description: "Cliente premium para servidores anárquicos" },
  { name: "ForgeHax", category: "Mod", type: "Forge-based", description: "Conjunto de mods basado en Forge con múltiples cheats" },
  { name: "Inertia", category: "Client", type: "Utility", description: "Anteriormente llamado WWE, cliente para servidores anárquicos" },
  { name: "Meteor Client", category: "Client", type: "Fabric-based", description: "Cliente moderno basado en Fabric con muchos módulos" },
  { name: "KAMI Blue", category: "Client", type: "Utility", description: "Fork de KAMI con más características" },
  { name: "Sallos", category: "Client", type: "Premium", description: "Cliente premium con funcionalidades avanzadas" },
  { name: "Vape Client", category: "Client", type: "Premium/Ghost", description: "Cliente premium ghost enfocado en bypasses de anticheats" },
  { name: "Aristois", category: "Client", type: "Mixed", description: "Cliente con múltiples características y actualización constante" },
  { name: "Huzuni", category: "Client", type: "Legacy", description: "Cliente antiguo pero popular para versiones anteriores" },
  { name: "Wolfram", category: "Client", type: "Legacy", description: "Cliente clásico para versiones antiguas" },
  
  // Mods específicos
  { name: "Xray Mod", category: "Mod", type: "Vision", description: "Permite ver a través de bloques para encontrar minerales y estructuras" },
  { name: "Baritone", category: "Mod", type: "Bot/Automation", description: "Sistema de pathfinding y automatización para Minecraft" },
  { name: "Schematica", category: "Mod", type: "Utility", description: "Permite colocar esquemas de construcción en el mundo" },
  { name: "Mini Mods/Macro Mods", category: "Mod", type: "Utility", description: "Pequeños mods que automatizan tareas específicas" },
  
  // Hacks específicos
  { name: "KillAura", category: "Hack", type: "Combat", description: "Ataca automáticamente a entidades cercanas" },
  { name: "Aimbot", category: "Hack", type: "Combat", description: "Apunta automáticamente a enemigos" },
  { name: "Criticals", category: "Hack", type: "Combat", description: "Asegura golpes críticos en cada ataque" },
  { name: "AutoClicker", category: "Hack", type: "Combat/Utility", description: "Hace clicks automáticos a velocidades configurables" },
  { name: "Reach", category: "Hack", type: "Combat", description: "Aumenta el alcance de ataque y colocación de bloques" },
  { name: "Velocity", category: "Hack", type: "Movement", description: "Reduce o elimina el retroceso al recibir daño" },
  { name: "AntiKnockback", category: "Hack", type: "Movement", description: "Previene ser empujado por ataques" },
  { name: "BHop/Bunny Hop", category: "Hack", type: "Movement", description: "Permite saltar y moverse más rápido" },
  { name: "Speed", category: "Hack", type: "Movement", description: "Aumenta la velocidad de movimiento" },
  { name: "Fly", category: "Hack", type: "Movement", description: "Permite volar en modo supervivencia" },
  { name: "Jesus/Water Walk", category: "Hack", type: "Movement", description: "Permite caminar sobre el agua" },
  { name: "NoFall", category: "Hack", type: "Player", description: "Evita daño por caídas" },
  { name: "Spider", category: "Hack", type: "Movement", description: "Permite escalar paredes como una araña" },
  { name: "Step", category: "Hack", type: "Movement", description: "Permite subir bloques automáticamente sin saltar" },
  { name: "Scaffold", category: "Hack", type: "World", description: "Coloca bloques automáticamente bajo el jugador" },
  { name: "Nuker", category: "Hack", type: "World", description: "Rompe bloques a gran velocidad alrededor del jugador" },
  { name: "ESP", category: "Hack", type: "Render", description: "Muestra entidades, cofres y otros objetos a través de paredes" },
  { name: "Tracers", category: "Hack", type: "Render", description: "Dibuja líneas hacia entidades y puntos de interés" },
  { name: "Freecam", category: "Hack", type: "Render", description: "Permite mover la cámara separada del jugador" },
  { name: "Wallhack", category: "Hack", type: "Render", description: "Permite ver a través de paredes" },
  { name: "Chams", category: "Hack", type: "Render", description: "Colorea entidades para verlas mejor" },
  { name: "FastBreak", category: "Hack", type: "World", description: "Rompe bloques más rápido" },
  { name: "FastPlace", category: "Hack", type: "World", description: "Coloca bloques más rápido" },
  { name: "AutoTool", category: "Hack", type: "Utility", description: "Selecciona automáticamente la mejor herramienta" },
  { name: "ChestESP", category: "Hack", type: "Render", description: "Muestra cofres a través de paredes" },
  
  // Ghost cheats
  { name: "Legit Aim Assist", category: "Ghost", type: "Combat", description: "Asistencia sutil para apuntar" },
  { name: "Smooth Aim", category: "Ghost", type: "Combat", description: "Ayuda a apuntar de forma suave y poco detectable" },
  { name: "Trigger Bot", category: "Ghost", type: "Combat", description: "Ataca automáticamente cuando el cursor está sobre un enemigo" },
  { name: "Auto Clicker (Low CPS)", category: "Ghost", type: "Combat", description: "Auto clicker con velocidades realistas para evitar detección" },
  { name: "Legit Reach", category: "Ghost", type: "Combat", description: "Pequeño aumento en el alcance difícil de detectar" },
  { name: "Legit Velocity", category: "Ghost", type: "Movement", description: "Reducción sutil de retroceso" },
  { name: "Timer", category: "Ghost", type: "Movement", description: "Aceleración leve del juego para movimiento más rápido" },
  { name: "FastClick", category: "Ghost", type: "Utility", description: "Ayuda a hacer clicks más rápidos en situaciones específicas" },
  { name: "HitBoxes", category: "Hack", type: "Combat", description: "Aumenta el tamaño de hitbox de los enemigos" },
  
  // Anticheats conocidos (para evadirlos)
  { name: "NoCheatPlus", category: "AntiCheat", type: "Server", description: "Anticheat popular en muchos servidores" },
  { name: "AAC", category: "AntiCheat", type: "Server", description: "Advanced Anti-Cheat, sistema avanzado de detección" },
  { name: "Matrix", category: "AntiCheat", type: "Server", description: "Sistema de detección moderno" },
  { name: "Spartan", category: "AntiCheat", type: "Server", description: "Anticheat con múltiples capas de detección" },
  { name: "Watchdog", category: "AntiCheat", type: "Server", description: "Sistema usado en Hypixel" },
  { name: "Grim", category: "AntiCheat", type: "Server", description: "Anticheat moderno con detección avanzada" },
  { name: "Vulcan", category: "AntiCheat", type: "Server", description: "Anticheat premium con múltiples comprobaciones" },
  { name: "Verus", category: "AntiCheat", type: "Server", description: "Anticheat usado en varios servidores grandes" },
  
  // Utilidades auxiliares y destructivas
  { name: "NBTEdit", category: "Tool", type: "Utility", description: "Edita datos NBT de items y entidades" },
  { name: "Inventory Editors", category: "Tool", type: "Utility", description: "Edita inventarios y cofres en el juego" },
  { name: "Server Crashers", category: "Tool", type: "Destructive", description: "Provoca crasheos en servidores" },
  { name: "UUID Spoofer", category: "Tool", type: "Identity", description: "Cambia UUID para evadir baneos" },
  { name: "Skin Stealers", category: "Tool", type: "Identity", description: "Copia skins de otros jugadores" },
  { name: "Chat Spammer", category: "Hack", type: "Utility", description: "Envía mensajes automáticamente al chat" },
  { name: "BookBots", category: "Tool", type: "Destructive", description: "Crea libros con texto que puede causar lag" },
  
  // Herramientas avanzadas
  { name: "Packet Editors", category: "Advanced", type: "Network", description: "Modifica paquetes de red enviados al servidor" },
  { name: "Protocol Manipulation", category: "Advanced", type: "Network", description: "Manipula el protocolo de comunicación del juego" },
  { name: "Memory Editors", category: "Advanced", type: "System", description: "Modifica memoria del juego directamente" },
  { name: "Proxy Tools", category: "Advanced", type: "Network", description: "Usa proxies para evadir baneos por IP" },
  { name: "VPN for Ban Evasion", category: "Advanced", type: "Network", description: "Usa VPN para evadir baneos" }
];

/**
 * Detecta páginas de cheats de Minecraft en el historial del navegador
 */
async function detectMinecraftCheats() {
  const cheatSites = [
    'cheatbreaker', 'wurst-client', 'impact-client', 'liquidbounce',
    'minecraftcheat', 'hackphoenix', 'skidclient', 'fluxclient', 
    'aristois', 'wolfram', 'huzuni', 'sigma', 'xray', 'nodus',
    'badlion', 'lunar', 'pvplounge', 'vape', 'forge', 'mchack',
    'cheatminecraft', 'minecrafthack', 'hackedclient', 'minecraftforge',
    'autoclicker', 'killaura', 'bhop', 'flyhack', 'xrayhack'
  ];
  
  let foundCheatSites = [];
  
  try {
    // Intentar acceder al historial del navegador
    if (process.platform === 'win32') {
      // Intentar con Chrome
      const chromeHistoryPath = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History');
      if (fs.existsSync(chromeHistoryPath)) {
        try {
          // Crear una copia temporal del archivo de historial para poder leerlo
          const tempHistoryPath = path.join(os.tmpdir(), 'temp_chrome_history');
          fs.copyFileSync(chromeHistoryPath, tempHistoryPath);
          
          // Usar sqlite3 a través de exec
          const { stdout } = await execPromise(
            `powershell "Add-Type -AssemblyName System.Data.SQLite; $conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=${tempHistoryPath}'); $conn.Open(); $cmd = $conn.CreateCommand(); $cmd.CommandText = 'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 1000'; $adapter = New-Object System.Data.SQLite.SQLiteDataAdapter($cmd); $data = New-Object System.Data.DataSet; [void]$adapter.Fill($data); $conn.Close(); $data.Tables[0] | ConvertTo-Json"`
          ).catch(() => ({ stdout: '[]' }));
          
          try {
            const historyItems = JSON.parse(stdout);
            const itemList = Array.isArray(historyItems) ? historyItems : historyItems ? [historyItems] : [];
            
            for (const item of itemList) {
              const url = item.url.toLowerCase();
              const title = item.title.toLowerCase();
              
              for (const cheatSite of cheatSites) {
                if (url.includes(cheatSite) || title.includes(cheatSite)) {
                  foundCheatSites.push({
                    url: item.url,
                    title: item.title,
                    visitTime: new Date(item.last_visit_time),
                    browser: 'Google Chrome'
                  });
                  break;
                }
              }
            }
          } catch (parseError) {
            console.error('Error parsing history:', parseError);
          }
          
          // Eliminar el archivo temporal
          fs.unlinkSync(tempHistoryPath);
        } catch (error) {
          console.error('Error accessing Chrome history:', error);
        }
      }
      
      // Intentar con Firefox
      const firefoxProfilesPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
      if (fs.existsSync(firefoxProfilesPath)) {
        try {
          const profiles = await readdirPromise(firefoxProfilesPath);
          
          for (const profile of profiles) {
            const placesPath = path.join(firefoxProfilesPath, profile, 'places.sqlite');
            
            if (fs.existsSync(placesPath)) {
              // Crear una copia temporal
              const tempPlacesPath = path.join(os.tmpdir(), 'temp_firefox_places');
              fs.copyFileSync(placesPath, tempPlacesPath);
              
              try {
                const { stdout } = await execPromise(
                  `powershell "Add-Type -AssemblyName System.Data.SQLite; $conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=${tempPlacesPath}'); $conn.Open(); $cmd = $conn.CreateCommand(); $cmd.CommandText = 'SELECT url, title, last_visit_date FROM moz_places ORDER BY last_visit_date DESC LIMIT 1000'; $adapter = New-Object System.Data.SQLite.SQLiteDataAdapter($cmd); $data = New-Object System.Data.DataSet; [void]$adapter.Fill($data); $conn.Close(); $data.Tables[0] | ConvertTo-Json"`
                ).catch(() => ({ stdout: '[]' }));
                
                try {
                  const historyItems = JSON.parse(stdout);
                  const itemList = Array.isArray(historyItems) ? historyItems : historyItems ? [historyItems] : [];
                  
                  for (const item of itemList) {
                    const url = item.url.toLowerCase();
                    const title = (item.title || '').toLowerCase();
                    
                    for (const cheatSite of cheatSites) {
                      if (url.includes(cheatSite) || title.includes(cheatSite)) {
                        foundCheatSites.push({
                          url: item.url,
                          title: item.title || 'Sin título',
                          visitTime: new Date(item.last_visit_date / 1000),
                          browser: 'Mozilla Firefox'
                        });
                        break;
                      }
                    }
                  }
                } catch (parseError) {
                  console.error('Error parsing Firefox history:', parseError);
                }
                
                fs.unlinkSync(tempPlacesPath);
                break; // Solo necesitamos un perfil
              } catch (error) {
                console.error('Error accessing Firefox profile:', error);
              }
            }
          }
        } catch (error) {
          console.error('Error accessing Firefox profiles:', error);
        }
      }
      
      // Intentar con Edge
      const edgeHistoryPath = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'History');
      if (fs.existsSync(edgeHistoryPath)) {
        // Similar al proceso de Chrome
        try {
          const tempHistoryPath = path.join(os.tmpdir(), 'temp_edge_history');
          fs.copyFileSync(edgeHistoryPath, tempHistoryPath);
          
          const { stdout } = await execPromise(
            `powershell "Add-Type -AssemblyName System.Data.SQLite; $conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=${tempHistoryPath}'); $conn.Open(); $cmd = $conn.CreateCommand(); $cmd.CommandText = 'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 1000'; $adapter = New-Object System.Data.SQLite.SQLiteDataAdapter($cmd); $data = New-Object System.Data.DataSet; [void]$adapter.Fill($data); $conn.Close(); $data.Tables[0] | ConvertTo-Json"`
          ).catch(() => ({ stdout: '[]' }));
          
          try {
            const historyItems = JSON.parse(stdout);
            const itemList = Array.isArray(historyItems) ? historyItems : historyItems ? [historyItems] : [];
            
            for (const item of itemList) {
              const url = item.url.toLowerCase();
              const title = item.title.toLowerCase();
              
              for (const cheatSite of cheatSites) {
                if (url.includes(cheatSite) || title.includes(cheatSite)) {
                  foundCheatSites.push({
                    url: item.url,
                    title: item.title,
                    visitTime: new Date(item.last_visit_time),
                    browser: 'Microsoft Edge'
                  });
                  break;
                }
              }
            }
          } catch (parseError) {
            console.error('Error parsing Edge history:', parseError);
          }
          
          fs.unlinkSync(tempHistoryPath);
        } catch (error) {
          console.error('Error accessing Edge history:', error);
        }
      }
      
      // Intentar con Opera/Opera GX
      const operaHistoryPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera Stable', 'History');
      const operaGXHistoryPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Opera Software', 'Opera GX Stable', 'History');
      
      for (const historyPath of [operaHistoryPath, operaGXHistoryPath]) {
        if (fs.existsSync(historyPath)) {
          try {
            const tempHistoryPath = path.join(os.tmpdir(), 'temp_opera_history');
            fs.copyFileSync(historyPath, tempHistoryPath);
            
            const { stdout } = await execPromise(
              `powershell "Add-Type -AssemblyName System.Data.SQLite; $conn = New-Object System.Data.SQLite.SQLiteConnection('Data Source=${tempHistoryPath}'); $conn.Open(); $cmd = $conn.CreateCommand(); $cmd.CommandText = 'SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 1000'; $adapter = New-Object System.Data.SQLite.SQLiteDataAdapter($cmd); $data = New-Object System.Data.DataSet; [void]$adapter.Fill($data); $conn.Close(); $data.Tables[0] | ConvertTo-Json"`
            ).catch(() => ({ stdout: '[]' }));
            
            try {
              const historyItems = JSON.parse(stdout);
              const itemList = Array.isArray(historyItems) ? historyItems : historyItems ? [historyItems] : [];
              
              for (const item of itemList) {
                const url = item.url.toLowerCase();
                const title = item.title.toLowerCase();
                
                for (const cheatSite of cheatSites) {
                  if (url.includes(cheatSite) || title.includes(cheatSite)) {
                    foundCheatSites.push({
                      url: item.url,
                      title: item.title,
                      visitTime: new Date(item.last_visit_time),
                      browser: historyPath.includes('GX') ? 'Opera GX' : 'Opera'
                    });
                    break;
                  }
                }
              }
            } catch (parseError) {
              console.error('Error parsing Opera history:', parseError);
            }
            
            fs.unlinkSync(tempHistoryPath);
          } catch (error) {
            console.error('Error accessing Opera history:', error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error detecting Minecraft cheats:', error);
  }
  
  // Eliminar duplicados y ordenar por fecha de visita
  const uniqueResults = [];
  const urls = new Set();
  
  for (const site of foundCheatSites) {
    if (!urls.has(site.url)) {
      urls.add(site.url);
      uniqueResults.push(site);
    }
  }
  
  return {
    cheatSites: uniqueResults.sort((a, b) => b.visitTime - a.visitTime),
    cheatsList: minecraftCheatsDatabase
  };
}

/**
 * Detecta servicios detenidos que pueden ser relevantes para Minecraft
 */
async function detectStoppedServices() {
  const minecraftRelatedServices = [
    'Java', 'JavaQuickStarterService', 'JavService', 
    'Hamachi', 'Hamachi2', 'LogMeInHamachi', 
    'vboxservice', 'VirtualBox', 
    'vmware', 'VMTools', 'VMwareHostd',
    'Docker', 'com.docker',
    'AdobeARMservice', // Servicios comunes que podrían interferir
    'TeamViewer', 
    'Discord',
    'Firewall'
  ];
  
  const stoppedServices = [];
  
  try {
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para obtener servicios
      const { stdout } = await execPromise(
        'powershell "Get-Service | Where-Object {$_.Status -eq \'Stopped\'} | Select-Object Name, DisplayName, Status | ConvertTo-Json"'
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const services = JSON.parse(stdout);
        const serviceList = Array.isArray(services) ? services : services ? [services] : [];
        
        // Filtrar solo servicios relacionados con Minecraft
        for (const service of serviceList) {
          for (const relatedService of minecraftRelatedServices) {
            if (service.Name.toLowerCase().includes(relatedService.toLowerCase()) || 
                service.DisplayName.toLowerCase().includes(relatedService.toLowerCase())) {
              
              stoppedServices.push({
                name: service.DisplayName,
                id: service.Name,
                status: service.Status
              });
              break;
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing services:', parseError);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar launchctl
      const { stdout } = await execPromise('launchctl list').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        for (const relatedService of minecraftRelatedServices) {
          if (line.toLowerCase().includes(relatedService.toLowerCase())) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3 && parts[0] === '-') {
              stoppedServices.push({
                name: parts[2],
                id: parts[2],
                status: 'Stopped'
              });
            }
          }
        }
      }
    } else {
      // En Linux, usar systemctl
      const { stdout } = await execPromise('systemctl list-units --state=inactive').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        for (const relatedService of minecraftRelatedServices) {
          if (line.toLowerCase().includes(relatedService.toLowerCase())) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5) {
              stoppedServices.push({
                name: parts[0],
                id: parts[0],
                status: 'Inactive'
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking stopped services:', error);
  }
  
  return stoppedServices;
}

/**
 * Obtiene el historial de carpetas visitadas recientemente
 */
async function getFolderHistory() {
  const recentFolders = [];
  
  try {
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para acceder al registro de carpetas recientes
      const { stdout } = await execPromise(
        'powershell "Get-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\OpenSavePidlMRU\\*\' | Select-Object | ConvertTo-Json"'
      ).catch(() => ({ stdout: '{}' }));
      
      try {
        const folderData = JSON.parse(stdout);
        
        // Extraer las rutas de carpetas del registro
        if (folderData && folderData.PSPath) {
          const explorerKey = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer';
          
          // Intentar acceder al historial de Explorador de Windows
          const { stdout: recentStdout } = await execPromise(
            `powershell "Get-ChildItem -Path '${explorerKey}\\RecentDocs' | Select-Object PSChildName | ConvertTo-Json"`
          ).catch(() => ({ stdout: '[]' }));
          
          try {
            const recentItems = JSON.parse(recentStdout);
            const itemList = Array.isArray(recentItems) ? recentItems : recentItems ? [recentItems] : [];
            
            for (const item of itemList) {
              if (item.PSChildName && !item.PSChildName.startsWith('.')) {
                try {
                  // Convertir de bytes a string cuando sea posible
                  const name = Buffer.from(item.PSChildName, 'hex').toString('utf16le').replace(/\0/g, '');
                  
                  if (name && !name.includes('\u0000\u0000')) {
                    recentFolders.push({
                      name: name,
                      type: 'Explorer History'
                    });
                  }
                } catch (convError) {
                  // Ignorar errores de conversión
                }
              }
            }
          } catch (parseError) {
            console.error('Error parsing recent items:', parseError);
          }
        }
        
        // También intentar acceder a Quick Access
        const { stdout: quickAccessStdout } = await execPromise(
          'powershell "Get-ChildItem -Path \'shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}\' | Select-Object Name, LastAccessTime | ConvertTo-Json"'
        ).catch(() => ({ stdout: '[]' }));
        
        try {
          const quickAccessItems = JSON.parse(quickAccessStdout);
          const qaItemList = Array.isArray(quickAccessItems) ? quickAccessItems : quickAccessItems ? [quickAccessItems] : [];
          
          for (const item of qaItemList) {
            if (item.Name) {
              recentFolders.push({
                name: item.Name,
                lastAccess: new Date(item.LastAccessTime),
                type: 'Quick Access'
              });
            }
          }
        } catch (parseError) {
          console.error('Error parsing Quick Access items:', parseError);
        }
      } catch (parseError) {
        console.error('Error parsing folder history:', parseError);
      }
      
      // Buscar carpetas específicas de Minecraft
      const minecraftFolders = [
        path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft'),
        path.join(os.homedir(), 'AppData', 'Local', 'Packages'),
        path.join(os.homedir(), 'Documents', 'Curse'),
        path.join(os.homedir(), 'Documents', 'Minecraft')
      ];
      
      for (const folder of minecraftFolders) {
        try {
          if (fs.existsSync(folder)) {
            const stats = await statPromise(folder);
            
            recentFolders.push({
              name: folder,
              lastAccess: stats.atime,
              type: 'Minecraft Related'
            });
            
            // También verificar subcarpetas
            const subfolders = await readdirPromise(folder);
            for (const subfolder of subfolders) {
              const subfolderPath = path.join(folder, subfolder);
              
              try {
                const subStats = await statPromise(subfolderPath);
                
                if (subStats.isDirectory()) {
                  recentFolders.push({
                    name: subfolderPath,
                    lastAccess: subStats.atime,
                    type: 'Minecraft Subfolder'
                  });
                }
              } catch (error) {
                // Ignorar errores de acceso
              }
            }
          }
        } catch (error) {
          // Ignorar errores de acceso
        }
      }
    } else if (process.platform === 'darwin') {
      // En macOS, intentar acceder al historial de Finder
      const { stdout } = await execPromise(
        'defaults read com.apple.finder FXRecentFolders'
      ).catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes('file://')) {
          const urlMatch = line.match(/file:\/\/([^"]+)/);
          if (urlMatch) {
            const folderPath = decodeURIComponent(urlMatch[1]).replace(/^\/\//, '/');
            
            recentFolders.push({
              name: folderPath,
              type: 'Finder History'
            });
          }
        }
      }
      
      // Buscar carpetas específicas de Minecraft en macOS
      const minecraftFolders = [
        path.join(os.homedir(), 'Library', 'Application Support', 'minecraft'),
        path.join(os.homedir(), 'Documents', 'Minecraft')
      ];
      
      for (const folder of minecraftFolders) {
        try {
          if (fs.existsSync(folder)) {
            const stats = await statPromise(folder);
            
            recentFolders.push({
              name: folder,
              lastAccess: stats.atime,
              type: 'Minecraft Related'
            });
          }
        } catch (error) {
          // Ignorar errores de acceso
        }
      }
    }
  } catch (error) {
    console.error('Error getting folder history:', error);
  }
  
  // Eliminar duplicados y ordenar por fecha de acceso
  const uniqueFolders = [];
  const paths = new Set();
  
  for (const folder of recentFolders) {
    if (!paths.has(folder.name)) {
      paths.add(folder.name);
      uniqueFolders.push(folder);
    }
  }
  
  return uniqueFolders.sort((a, b) => {
    if (a.lastAccess && b.lastAccess) {
      return b.lastAccess - a.lastAccess;
    } else {
      return 0;
    }
  });
}

/**
 * Obtiene el historial completo de ejecuciones
 * @param {number} hours - Horas hacia atrás para buscar
 */
async function getCompleteExecutionHistory(hours = 4) {
  const executionHistory = [];
  const timeThreshold = new Date();
  timeThreshold.setHours(timeThreshold.getHours() - hours);
  
  try {
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para obtener el historial de procesos
      const { stdout } = await execPromise(
        `powershell "Get-WmiObject Win32_Process | Select-Object ProcessId, Name, CommandLine, CreationDate | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const processes = JSON.parse(stdout);
        const processList = Array.isArray(processes) ? processes : processes ? [processes] : [];
        
        for (const process of processList) {
          if (process && process.Name) {
            const creationDate = new Date(process.CreationDate || Date.now());
            
            if (creationDate >= timeThreshold) {
              executionHistory.push({
                name: process.Name,
                command: process.CommandLine || 'N/A',
                startTime: creationDate.toLocaleString(),
                pid: process.ProcessId
              });
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing process output:', parseError);
      }
      
      // También buscar en Prefetch para archivos ejecutados recientemente
      const { stdout: prefetchStdout } = await execPromise(
        `powershell "Get-ChildItem -Path 'C:\\Windows\\Prefetch' | Sort-Object LastWriteTime -Descending | Select-Object Name, LastWriteTime | ConvertTo-Json"`
      ).catch(() => ({ stdout: '[]' }));
      
      try {
        const prefetchFiles = JSON.parse(prefetchStdout);
        const prefetchList = Array.isArray(prefetchFiles) ? prefetchFiles : prefetchFiles ? [prefetchFiles] : [];
        
        for (const prefetch of prefetchList) {
          if (prefetch && prefetch.Name) {
            const lastWriteTime = new Date(prefetch.LastWriteTime);
            
            if (lastWriteTime >= timeThreshold) {
              const exeName = prefetch.Name.replace('.pf', '').split('-')[0];
              
              executionHistory.push({
                name: exeName,
                startTime: lastWriteTime.toLocaleString(),
                source: 'Prefetch'
              });
            }
          }
        }
      } catch (parseError) {
        console.error('Error parsing prefetch files:', parseError);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar ps
      const { stdout } = await execPromise('ps -eo pid,lstart,command').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          // Extraer la fecha del formato de salida de ps
          const dateMatch = line.match(/([A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})/);
          let startTime;
          
          if (dateMatch) {
            startTime = new Date(dateMatch[1]);
            
            if (startTime >= timeThreshold) {
              const parts = line.split(dateMatch[1]);
              const pid = parseInt(parts[0].trim());
              const command = parts[1].trim();
              
              executionHistory.push({
                name: command.split(' ')[0].split('/').pop(),
                command: command,
                startTime: startTime.toLocaleString(),
                pid: pid
              });
            }
          }
        }
      }
    } else {
      // En Linux, usar ps
      const { stdout } = await execPromise('ps -eo pid,lstart,cmd').catch(() => ({ stdout: '' }));
      
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          // Extraer la fecha del formato de salida de ps
          const dateMatch = line.match(/([A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} \d{4})/);
          let startTime;
          
          if (dateMatch) {
            startTime = new Date(dateMatch[1]);
            
            if (startTime >= timeThreshold) {
              const parts = line.split(dateMatch[1]);
              const pid = parseInt(parts[0].trim());
              const command = parts[1].trim();
              
              executionHistory.push({
                name: command.split(' ')[0].split('/').pop(),
                command: command,
                startTime: startTime.toLocaleString(),
                pid: pid
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error getting execution history:', error);
  }
  
  return executionHistory.sort((a, b) => {
    return new Date(b.startTime) - new Date(a.startTime);
  });
}

/**
 * Abre archivos comunes de Minecraft
 */
async function openMinecraftFiles() {
  const mcFiles = [];
  const userHome = os.homedir();
  const minecraftPath = path.join(userHome, 'AppData', 'Roaming', '.minecraft');
  
  try {
    // Verificar si existe la carpeta de Minecraft
    if (!fs.existsSync(minecraftPath)) {
      return { error: 'No se encontró la carpeta de Minecraft' };
    }
    
    // Lista de archivos importantes a verificar
    const importantFiles = [
      { name: 'options.txt', path: path.join(minecraftPath, 'options.txt'), type: 'Configuración' },
      { name: 'launcher_profiles.json', path: path.join(minecraftPath, 'launcher_profiles.json'), type: 'Perfiles' },
      { name: 'launcher_accounts.json', path: path.join(minecraftPath, 'launcher_accounts.json'), type: 'Cuentas' },
      { name: 'usercache.json', path: path.join(minecraftPath, 'usercache.json'), type: 'Cache de Usuario' },
      { name: 'servers.dat', path: path.join(minecraftPath, 'servers.dat'), type: 'Servidores' },
      { name: 'logs', path: path.join(minecraftPath, 'logs'), type: 'Carpeta de Logs' },
      { name: 'screenshots', path: path.join(minecraftPath, 'screenshots'), type: 'Carpeta de Capturas' },
      { name: 'crash-reports', path: path.join(minecraftPath, 'crash-reports'), type: 'Reportes de Crash' },
      { name: 'mods', path: path.join(minecraftPath, 'mods'), type: 'Carpeta de Mods' }
    ];
    
    // Verificar cada archivo
    for (const file of importantFiles) {
      try {
        if (fs.existsSync(file.path)) {
          const stats = await statPromise(file.path);
          
          mcFiles.push({
            name: file.name,
            path: file.path,
            type: file.type,
            isDirectory: stats.isDirectory(),
            lastModified: stats.mtime,
            size: stats.size
          });
          
          // Si es la carpeta de mods, buscar dentro de ella
          if (file.name === 'mods' && stats.isDirectory()) {
            const mods = await readdirPromise(file.path);
            const modFiles = [];
            
            for (const mod of mods) {
              if (mod.endsWith('.jar')) {
                const modPath = path.join(file.path, mod);
                const modStats = await statPromise(modPath);
                
                modFiles.push({
                  name: mod,
                  path: modPath,
                  lastModified: modStats.mtime,
                  size: modStats.size
                });
              }
            }
            
            mcFiles.push({
              name: 'Lista de Mods',
              path: file.path,
              type: 'Lista de Mods',
              files: modFiles.sort((a, b) => b.lastModified - a.lastModified)
            });
          }
          
          // Si es la carpeta de logs, buscar el último log
          if (file.name === 'logs' && stats.isDirectory()) {
            const logs = await readdirPromise(file.path);
            let latestLog = null;
            let latestTime = 0;
            
            for (const log of logs) {
              if (log.endsWith('.log') || log.endsWith('.txt')) {
                const logPath = path.join(file.path, log);
                const logStats = await statPromise(logPath);
                
                if (logStats.mtime > latestTime) {
                  latestTime = logStats.mtime;
                  latestLog = {
                    name: log,
                    path: logPath,
                    lastModified: logStats.mtime,
                    size: logStats.size
                  };
                }
              }
            }
            
            if (latestLog) {
              mcFiles.push({
                name: 'Último Log',
                path: latestLog.path,
                type: 'Log Reciente',
                lastModified: latestLog.lastModified
              });
              
              // Intentar leer el contenido del último log
              try {
                const logContent = fs.readFileSync(latestLog.path, 'utf8');
                const relevantLines = [];
                
                // Buscar líneas relevantes (errores, advertencias, conexiones a servidores)
                const lines = logContent.split('\n');
                for (const line of lines) {
                  if (line.includes('Exception') || 
                      line.includes('Error') || 
                      line.includes('Connecting to ') ||
                      line.includes('WARN') ||
                      line.includes('Server brand')) {
                    relevantLines.push(line.trim());
                  }
                }
                
                mcFiles.push({
                  name: 'Líneas relevantes del log',
                  type: 'Contenido de Log',
                  lines: relevantLines.slice(-20) // Últimas 20 líneas relevantes
                });
              } catch (error) {
                console.error('Error reading log file:', error);
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error accessing file ${file.path}:`, error);
      }
    }
    
    // Abrir el explorador de archivos en la carpeta de Minecraft
    if (process.platform === 'win32') {
      await execPromise(`explorer "${minecraftPath}"`);
    } else if (process.platform === 'darwin') {
      await execPromise(`open "${minecraftPath}"`);
    } else {
      await execPromise(`xdg-open "${minecraftPath}"`);
    }
    
    return { success: true, files: mcFiles };
  } catch (error) {
    console.error('Error opening Minecraft files:', error);
    return { error: error.message };
  }
}

/**
 * Navega a la ubicación de un archivo en el explorador
 * @param {string} filePath - Ruta del archivo
 */
async function openFileLocation(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { error: 'El archivo no existe' };
    }
    
    const directoryPath = path.dirname(filePath);
    
    if (process.platform === 'win32') {
      await execPromise(`explorer /select,"${filePath}"`);
    } else if (process.platform === 'darwin') {
      await execPromise(`open -R "${filePath}"`);
    } else {
      // En Linux, intentar abrir el directorio padre
      await execPromise(`xdg-open "${directoryPath}"`);
    }
    
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error opening file location:', error);
    return { error: error.message };
  }
}

/**
 * Obtiene el historial de comandos CMD/PowerShell
 */
async function getCommandHistory() {
  const commands = [];
  
  try {
    if (process.platform === 'win32') {
      // Intentar obtener el historial de PowerShell
      const psHistoryPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadLine', 'ConsoleHost_history.txt');
      
      if (fs.existsSync(psHistoryPath)) {
        try {
          const historyContent = fs.readFileSync(psHistoryPath, 'utf8');
          const historyLines = historyContent.split('\n').filter(line => line.trim());
          
          for (const line of historyLines.slice(-100)) { // Últimos 100 comandos
            commands.push({
              source: 'PowerShell',
              command: line,
              timestamp: null // Historial de PS no guarda timestamps
            });
          }
        } catch (error) {
          console.error('Error reading PowerShell history:', error);
        }
      }
      
      // Intentar obtener historial de CMD (doskey)
      try {
        const { stdout } = await execPromise('doskey /history').catch(() => ({ stdout: '' }));
        
        if (stdout) {
          const cmdLines = stdout.split('\n').filter(line => line.trim());
          
          for (const line of cmdLines) {
            commands.push({
              source: 'CMD',
              command: line,
              timestamp: null // doskey no guarda timestamps
            });
          }
        }
      } catch (error) {
        console.error('Error getting CMD history:', error);
      }
      
      // También verificar el historial de Windows Terminal si existe
      const windowsTerminalPath = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState');
      
      if (fs.existsSync(windowsTerminalPath)) {
        try {
          const files = await readdirPromise(windowsTerminalPath);
          for (const file of files) {
            if (file.includes('commandHistory') || file.includes('state')) {
              try {
                const filePath = path.join(windowsTerminalPath, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const json = JSON.parse(content);
                
                if (json && json.commandHistory) {
                  for (const cmd of json.commandHistory) {
                    commands.push({
                      source: 'Windows Terminal',
                      command: cmd,
                      timestamp: null
                    });
                  }
                }
              } catch (e) {
                // Ignorar errores de parseo
              }
            }
          }
        } catch (error) {
          console.error('Error reading Windows Terminal history:', error);
        }
      }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // Buscar historiales en sistemas Unix
      const historyPaths = [
        { path: path.join(os.homedir(), '.bash_history'), source: 'Bash' },
        { path: path.join(os.homedir(), '.zsh_history'), source: 'Zsh' },
        { path: path.join(os.homedir(), '.history'), source: 'Shell' }
      ];
      
      for (const histFile of historyPaths) {
        if (fs.existsSync(histFile.path)) {
          try {
            const historyContent = fs.readFileSync(histFile.path, 'utf8');
            const historyLines = historyContent.split('\n').filter(line => line.trim());
            
            for (const line of historyLines.slice(-100)) { // Últimos 100 comandos
              // Intentar extraer timestamp si está presente (formato zsh)
              const timestampMatch = line.match(/^: (\d+):/);
              let timestamp = null;
              let command = line;
              
              if (timestampMatch) {
                timestamp = new Date(parseInt(timestampMatch[1]) * 1000);
                command = line.substring(line.indexOf(':') + 1);
                // Si hay dos puntos al principio, quitar todo hasta el segundo
                if (command.startsWith(':')) {
                  command = command.substring(command.indexOf(':') + 1);
                }
              }
              
              commands.push({
                source: histFile.source,
                command: command,
                timestamp: timestamp
              });
            }
          } catch (error) {
            console.error(`Error reading ${histFile.source} history:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error getting command history:', error);
  }
  
  return commands;
}

module.exports = {
  findAllJarFiles,
  checkFileExtensionChanges,
  getRecentlyDeletedFiles,
  getRecentlyExecutedJars,
  checkUSBDisconnection,
  checkScreenRecording,
  openBrowserHistory,
  detectBrowsers,
  detectMinecraftCheats,
  detectStoppedServices,
  getFolderHistory,
  getCompleteExecutionHistory,
  openMinecraftFiles,
  openFileLocation,
  getCommandHistory,
  minecraftCheatsDatabase
};