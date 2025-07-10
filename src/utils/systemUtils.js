const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const os = require('os');
const util = require('util');
const { shell, app } = require('electron');

// Convertir exec a promesa
const execAsync = util.promisify(exec);

/**
 * Busca todos los archivos JAR en el sistema
 * @param {Object} options Opciones de búsqueda (fechaInicio, fechaFin)
 * @returns {Promise<Array>} Lista de archivos JAR encontrados
 */
async function findAllJarFiles(options = {}) {
  try {
    const result = [];
    const homeDir = os.homedir();
    const drives = await getSystemDrives();
    
    // Mostrar progreso
    let progress = 0;
    const totalDrives = drives.length;
    const updateProgress = () => {
      progress++;
      return Math.floor((progress / totalDrives) * 100);
    };
    
    for (const drive of drives) {
      try {
        await searchJarFilesRecursively(drive, result, 0, options);
        // Actualizar progreso después de cada unidad
        updateProgress();
      } catch (error) {
        console.error(`Error buscando en ${drive}:`, error);
      }
    }
    
    // Ordenar por fecha de modificación, más reciente primero
    result.sort((a, b) => b.lastModified - a.lastModified);
    
    return result;
  } catch (error) {
    console.error('Error en findAllJarFiles:', error);
    throw error;
  }
}

/**
 * Busca archivos JAR de forma recursiva en un directorio
 * @param {string} directory Directorio donde buscar
 * @param {Array} result Array donde almacenar resultados
 * @param {number} depth Profundidad actual de recursión
 * @param {Object} options Opciones de filtrado
 */
async function searchJarFilesRecursively(directory, result, depth = 0, options = {}) {
  // Limitar la profundidad para evitar búsquedas infinitas
  if (depth > 15) return;
  
  try {
    // Verificar si debemos omitir este directorio
    if (shouldSkipDirectory(directory)) return;
    
    const items = await fs.promises.readdir(directory, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(directory, item.name);
      
      try {
        if (item.isDirectory()) {
          // Continuar búsqueda recursiva en subdirectorios
          await searchJarFilesRecursively(fullPath, result, depth + 1, options);
        } else if (item.name.toLowerCase().endsWith('.jar')) {
          const stats = await fs.promises.stat(fullPath);
          const fileInfo = {
            name: item.name,
            path: fullPath,
            size: stats.size,
            lastModified: stats.mtime.getTime(),
            createdTime: stats.birthtime.getTime()
          };
          
          // Aplicar filtros de fecha si están especificados
          if (options.fechaInicio || options.fechaFin) {
            const fileDate = new Date(stats.mtime);
            
            if (options.fechaInicio) {
              const startDate = new Date(options.fechaInicio);
              if (fileDate < startDate) continue;
            }
            
            if (options.fechaFin) {
              const endDate = new Date(options.fechaFin);
              if (fileDate > endDate) continue;
            }
          }
          
          // Agregar a resultados
          result.push(fileInfo);
        }
      } catch (error) {
        // Ignorar errores de permisos específicos
        if (error.code !== 'EPERM' && error.code !== 'EACCES') {
          console.error(`Error procesando ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
    if (error.code !== 'EPERM' && error.code !== 'EACCES') {
      console.error(`Error leyendo directorio ${directory}:`, error);
    }
  }
}

/**
 * Verifica si un directorio debe omitirse de la búsqueda
 * @param {string} directory Ruta del directorio
 * @returns {boolean} true si debe omitirse
 */
function shouldSkipDirectory(directory) {
  const skipDirs = [
    'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 
    'System Volume Information', '$Recycle.Bin', 'node_modules',
    'AppData\\Local\\Temp', 'Recovery', 'Config.Msi', '$WINDOWS.~BT', 
    '$WinREAgent', 'Windows.old', 'DriverStore', 'Temp', 'tmp'
  ];
  
  const normalizedPath = directory.replace(/\\/g, '/').toLowerCase();
  return skipDirs.some(dir => normalizedPath.includes(dir.toLowerCase()));
}

/**
 * Obtiene las unidades disponibles en el sistema
 * @returns {Promise<Array>} Lista de unidades
 */
async function getSystemDrives() {
  try {
    if (process.platform === 'win32') {
      // En Windows, obtener todas las unidades disponibles
      const { stdout } = await execAsync('wmic logicaldisk get caption');
      return stdout.split('\n')
        .filter(line => /^[A-Za-z]:/.test(line.trim()))
        .map(drive => drive.trim() + '\\');
    } else if (process.platform === 'darwin') {
      // En macOS, empezar desde /Volumes
      const items = await fs.promises.readdir('/Volumes');
      return ['/'].concat(items.map(item => `/Volumes/${item}`));
    } else {
      // En Linux, empezar desde el directorio raíz
      return ['/'];
    }
  } catch (error) {
    console.error('Error al obtener unidades:', error);
    // Retornar al menos el directorio principal del usuario
    return [os.homedir()];
  }
}

/**
 * Busca cambios sospechosos en extensiones de archivos
 */
async function checkFileExtensionChanges() {
  try {
    const result = [];
    const homeDir = os.homedir();
    const downloadsDir = path.join(homeDir, 'Downloads');
    const desktopDir = path.join(homeDir, 'Desktop');
    const documentsDir = path.join(homeDir, 'Documents');
    
    // Buscar en directorios comunes
    await findRecentlyModifiedFiles(downloadsDir, result);
    await findRecentlyModifiedFiles(desktopDir, result);
    await findRecentlyModifiedFiles(documentsDir, result);
    
    // Buscar en carpetas de juegos comunes
    const gameDirs = [
      path.join(homeDir, 'AppData', 'Roaming', '.minecraft'),
      path.join(homeDir, 'AppData', 'Local', 'Packages'),
      'C:\\Games',
      'D:\\Games',
      'E:\\Games',
      path.join(homeDir, 'Games')
    ];
    
    for (const gameDir of gameDirs) {
      try {
        if (fs.existsSync(gameDir)) {
          await findRecentlyModifiedFiles(gameDir, result);
        }
      } catch (error) {
        console.error(`Error al verificar directorio ${gameDir}:`, error);
      }
    }
    
    // Ordenar por fecha de modificación
    result.sort((a, b) => b.modifiedTime - a.modifiedTime);
    
    return result;
  } catch (error) {
    console.error('Error en checkFileExtensionChanges:', error);
    throw error;
  }
}

/**
 * Busca archivos modificados recientemente y detecta cambios de extensión
 */
async function findRecentlyModifiedFiles(directory, result, depth = 0) {
  // Limitar la profundidad para evitar búsquedas infinitas
  if (depth > 10) return;
  
  try {
    // Verificar si debemos omitir este directorio
    if (shouldSkipDirectory(directory)) return;
    
    const items = await fs.promises.readdir(directory, { withFileTypes: true });
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
    
    for (const item of items) {
      const fullPath = path.join(directory, item.name);
      
      try {
        if (item.isDirectory()) {
          // Continuar búsqueda recursiva en subdirectorios
          await findRecentlyModifiedFiles(fullPath, result, depth + 1);
        } else {
          const stats = await fs.promises.stat(fullPath);
          
          // Solo verificar archivos modificados recientemente
          if (stats.mtime.getTime() > oneWeekAgo) {
            // Verificar patrones sospechosos de cambio de extensión
            const fileName = item.name.toLowerCase();
            const suspiciousExtensions = [
              '.jar.txt', '.exe.txt', '.jar.png', '.exe.png', '.jar.jpg', '.exe.jpg',
              '.minecraft.jar', '.dll.txt', '.dll.jar', '.bat.txt', '.vbs.txt'
            ];
            
            if (suspiciousExtensions.some(ext => fileName.includes(ext))) {
              // Encontrar archivos similares en el mismo directorio para comparar
              const baseName = getOriginalNameGuess(item.name);
              const similarFiles = [];
              
              if (baseName) {
                for (const otherItem of items) {
                  if (otherItem.name !== item.name && otherItem.name.toLowerCase().includes(baseName.toLowerCase())) {
                    try {
                      const otherPath = path.join(directory, otherItem.name);
                      const otherStats = await fs.promises.stat(otherPath);
                      
                      similarFiles.push({
                        name: otherItem.name,
                        path: otherPath,
                        modifiedTime: otherStats.mtime.getTime()
                      });
                    } catch (error) {
                      // Ignorar errores para archivos individuales
                    }
                  }
                }
              }
              
              result.push({
                name: item.name,
                path: fullPath,
                modifiedTime: stats.mtime.getTime(),
                reason: 'Posible cambio de extensión para ocultar tipo real',
                similarFiles: similarFiles
              });
            }
          }
        }
      } catch (error) {
        // Ignorar errores de permisos específicos
        if (error.code !== 'EPERM' && error.code !== 'EACCES') {
          console.error(`Error procesando ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    // Ignorar errores de acceso
    if (error.code !== 'EPERM' && error.code !== 'EACCES') {
      console.error(`Error leyendo directorio ${directory}:`, error);
    }
  }
}

/**
 * Intenta adivinar el nombre original basado en el nombre actual
 */
function getOriginalNameGuess(filename) {
  // Eliminar extensiones potencialmente ocultas
  const doubleExtRegex = /^(.+)\.(jar|exe|dll|bat|vbs)\.(txt|png|jpg|jpeg)$/i;
  const match = filename.match(doubleExtRegex);
  
  if (match) {
    return match[1] + '.' + match[2];
  }
  
  return null;
}

/**
 * Obtiene archivos eliminados recientemente
 */
async function getRecentlyDeletedFiles(minutes = 60) {
  try {
    const result = [];
    const now = Date.now();
    const timeThreshold = now - (minutes * 60 * 1000);
    
    if (process.platform === 'win32') {
      // En Windows, buscar en la papelera de reciclaje y en registros del sistema
      const recycleBinPath = path.join(process.env.USERPROFILE, '$Recycle.Bin');
      await searchRecycleBin(recycleBinPath, result, timeThreshold);
      
      // Buscar en el registro de eventos de Windows
      try {
        const eventLogs = await getFileOperationsFromEventLog(minutes);
        result.push(...eventLogs.filter(item => item.operation === 'delete'));
      } catch (error) {
        console.error('Error obteniendo eventos de eliminación:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, buscar en la papelera
      const trashPath = path.join(os.homedir(), '.Trash');
      await searchDeletedFiles(trashPath, result, timeThreshold);
    } else {
      // En Linux, buscar en la papelera
      const trashPath = path.join(os.homedir(), '.local', 'share', 'Trash', 'files');
      const trashInfoPath = path.join(os.homedir(), '.local', 'share', 'Trash', 'info');
      await searchLinuxTrash(trashPath, trashInfoPath, result, timeThreshold);
    }
    
    // Usar herramientas de recuperación de datos como respaldo
    await tryUsingDataRecoveryTools(result, minutes);
    
    // Ordenar por fecha de eliminación, más reciente primero
    result.sort((a, b) => b.deletedTime - a.deletedTime);
    
    return result;
  } catch (error) {
    console.error('Error en getRecentlyDeletedFiles:', error);
    throw error;
  }
}

/**
 * Busca en la papelera de reciclaje de Windows
 */
async function searchRecycleBin(directory, result, timeThreshold) {
  try {
    if (!fs.existsSync(directory)) return;
    
    const items = await fs.promises.readdir(directory, { withFileTypes: true });
    
    for (const item of items) {
      try {
        const fullPath = path.join(directory, item.name);
        
        if (item.isDirectory()) {
          const subItems = await fs.promises.readdir(fullPath, { withFileTypes: true });
          
          for (const subItem of subItems) {
            try {
              // Los archivos en la papelera de reciclaje tienen nombres diferentes
              // pero podemos verificar la fecha de modificación
              const subItemPath = path.join(fullPath, subItem.name);
              const stats = await fs.promises.stat(subItemPath);
              
              if (stats.mtime.getTime() >= timeThreshold) {
                // Intentar recuperar el nombre original (complicado en la papelera de Windows)
                let originalName = subItem.name;
                
                // Algunos archivos en la papelera tienen metadatos con el nombre original
                try {
                  if (subItem.name.startsWith('$R')) {
                    const infoFilePath = path.join(fullPath, subItem.name.replace('$R', '$I'));
                    if (fs.existsSync(infoFilePath)) {
                      const buffer = await fs.promises.readFile(infoFilePath);
                      // Los metadatos de la papelera tienen un formato específico
                      // donde el nombre del archivo está después de algunos bytes
                      if (buffer.length > 24) {
                        const nameStart = 24;
                        let nameEnd = nameStart;
                        while (nameEnd < buffer.length && buffer[nameEnd] !== 0 && buffer[nameEnd + 1] !== 0) {
                          nameEnd += 2;
                        }
                        if (nameEnd > nameStart) {
                          originalName = buffer.toString('utf16le', nameStart, nameEnd);
                        }
                      }
                    }
                  }
                } catch (error) {
                  console.error('Error recuperando nombre original:', error);
                }
                
                result.push({
                  name: originalName,
                  path: subItemPath,
                  deletedTime: stats.mtime.getTime(),
                  inRecycleBin: true
                });
              }
            } catch (error) {
              // Ignorar errores individuales
            }
          }
        }
      } catch (error) {
        // Ignorar errores de permisos
        if (error.code !== 'EPERM' && error.code !== 'EACCES') {
          console.error(`Error procesando ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error buscando en la papelera ${directory}:`, error);
  }
}

/**
 * Busca archivos eliminados en sistemas distintos a Windows
 */
async function searchDeletedFiles(directory, result, timeThreshold) {
  try {
    if (!fs.existsSync(directory)) return;
    
    const items = await fs.promises.readdir(directory, { withFileTypes: true });
    
    for (const item of items) {
      try {
        const fullPath = path.join(directory, item.name);
        const stats = await fs.promises.stat(fullPath);
        
        if (stats.mtime.getTime() >= timeThreshold) {
          result.push({
            name: item.name,
            path: fullPath,
            deletedTime: stats.mtime.getTime(),
            inRecycleBin: true
          });
        }
        
        if (item.isDirectory()) {
          await searchDeletedFiles(fullPath, result, timeThreshold);
        }
      } catch (error) {
        // Ignorar errores de permisos
        if (error.code !== 'EPERM' && error.code !== 'EACCES') {
          console.error(`Error procesando ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error buscando en directorio ${directory}:`, error);
  }
}

/**
 * Busca archivos eliminados en la papelera de Linux
 */
async function searchLinuxTrash(trashPath, infoPath, result, timeThreshold) {
  try {
    if (!fs.existsSync(trashPath) || !fs.existsSync(infoPath)) return;
    
    const trashItems = await fs.promises.readdir(trashPath, { withFileTypes: true });
    const infoItems = await fs.promises.readdir(infoPath, { withFileTypes: true });
    
    // Crear un mapa de archivos de información
    const infoMap = new Map();
    for (const item of infoItems) {
      if (item.isFile() && item.name.endsWith('.trashinfo')) {
        try {
          const content = await fs.promises.readFile(path.join(infoPath, item.name), 'utf8');
          const pathMatch = content.match(/Path=(.*)/);
          const deletionDateMatch = content.match(/DeletionDate=(.*)/);
          
          if (pathMatch && deletionDateMatch) {
            const originalPath = pathMatch[1];
            const deletionDate = new Date(deletionDateMatch[1]);
            
            if (deletionDate.getTime() >= timeThreshold) {
              const basename = item.name.replace('.trashinfo', '');
              infoMap.set(basename, {
                originalPath,
                deletionDate
              });
            }
          }
        } catch (error) {
          console.error(`Error leyendo archivo de información: ${item.name}`, error);
        }
      }
    }
    
    // Relacionar los archivos con su información
    for (const item of trashItems) {
      const info = infoMap.get(item.name);
      if (info) {
        result.push({
          name: path.basename(info.originalPath),
          path: info.originalPath,
          deletedTime: info.deletionDate.getTime(),
          inRecycleBin: true
        });
      }
    }
  } catch (error) {
    console.error('Error buscando en la papelera de Linux:', error);
  }
}

/**
 * Intenta usar herramientas de recuperación de datos si están disponibles
 */
async function tryUsingDataRecoveryTools(result, minutes) {
  // Esta función podría integrarse con herramientas específicas
  // como recuva, testdisk, etc., pero requeriría instalación adicional
  // Por ahora, solo se incluye como un marcador para futura implementación
  return;
}

/**
 * Obtiene eventos de operaciones de archivo desde el registro de eventos de Windows
 */
async function getFileOperationsFromEventLog(minutes) {
  const result = [];
  
  if (process.platform !== 'win32') return result;
  
  try {
    // Convertir minutos a formato de tiempo para PowerShell
    const timeRange = `-${minutes}min`;
    
    // Consulta para obtener eventos de eliminación de archivos
    const command = `powershell -Command "& {
      $startTime = (Get-Date).AddMinutes(${-minutes});
      Get-WinEvent -FilterHashtable @{
        LogName='Security';
        StartTime=$startTime;
        ID=4663
      } -ErrorAction SilentlyContinue | 
      Where-Object { $_.Message -like '*delete*' } |
      Select-Object TimeCreated, Message |
      ConvertTo-Json -Depth 1
    }"`;
    
    const { stdout } = await execAsync(command);
    
    if (stdout.trim()) {
      let events;
      try {
        events = JSON.parse(stdout);
        // Asegurar que sea un array incluso si solo hay un resultado
        if (!Array.isArray(events)) events = [events];
      } catch (error) {
        console.error('Error parseando JSON de eventos:', error);
        return result;
      }
      
      events.forEach(event => {
        // Extraer información relevante del mensaje
        const message = event.Message;
        const timeCreated = new Date(event.TimeCreated);
        
        // Intentar extraer el nombre del archivo
        const fileNameMatch = message.match(/Object Name:\s+([^\r\n]+)/);
        const fileName = fileNameMatch ? fileNameMatch[1].trim() : 'Archivo desconocido';
        
        result.push({
          name: path.basename(fileName),
          path: fileName,
          deletedTime: timeCreated.getTime(),
          operation: 'delete',
          source: 'Event Log'
        });
      });
    }
  } catch (error) {
    console.error('Error obteniendo eventos del registro:', error);
  }
  
  return result;
}

/**
 * Obtiene archivos JAR ejecutados recientemente
 */
async function getRecentlyExecutedJars(hours = 4) {
  try {
    const result = [];
    const now = Date.now();
    const timeThreshold = now - (hours * 60 * 60 * 1000);
    
    // Método 1: Buscar en el registro de Windows (solo para Windows)
    if (process.platform === 'win32') {
      try {
        const recentJarsFromRegistry = await getJarsFromRegistry(timeThreshold);
        result.push(...recentJarsFromRegistry);
      } catch (error) {
        console.error('Error obteniendo JARs del registro:', error);
      }
    }
    
    // Método 2: Buscar en historial de ejecuciones (multiplataforma)
    try {
      const execHistory = await getCompleteExecutionHistory(hours);
      const jarExecutions = execHistory.filter(item => 
        (item.command && item.command.toLowerCase().includes('.jar')) ||
        (item.name && item.name.toLowerCase().endsWith('.jar'))
      );
      
      // Añadir las ejecuciones de JAR encontradas
      for (const execution of jarExecutions) {
        // Extraer ruta del JAR del comando
        let jarPath = '';
        if (execution.command) {
          const jarMatch = execution.command.match(/-jar\s+["']?([^"'\s]+\.jar)/i);
          if (jarMatch) {
            jarPath = jarMatch[1];
          } else {
            const pathMatch = execution.command.match(/["']([^"']+\.jar)["']/i);
            if (pathMatch) {
              jarPath = pathMatch[1];
            }
          }
        }
        
        // Si no se encontró en el comando, usar el nombre directamente
        if (!jarPath && execution.name) {
          jarPath = execution.name;
        }
        
        // Añadir solo si tenemos una ruta
        if (jarPath) {
          let size = 0;
          try {
            if (fs.existsSync(jarPath)) {
              const stats = await fs.promises.stat(jarPath);
              size = stats.size;
            }
          } catch (error) {
            // Ignorar errores de acceso al archivo
          }
          
          result.push({
            name: path.basename(jarPath),
            path: jarPath,
            startTime: execution.startTime,
            source: execution.source || 'Historial de ejecución',
            size
          });
        }
      }
    } catch (error) {
      console.error('Error obteniendo historial de ejecuciones:', error);
    }
    
    // Método 3: Buscar en logs de Java (multiplataforma)
    try {
      const javaLogs = await getJavaLogs(timeThreshold);
      result.push(...javaLogs);
    } catch (error) {
      console.error('Error obteniendo logs de Java:', error);
    }
    
    // Eliminar duplicados basados en la ruta
    const uniqueResults = [];
    const seenPaths = new Set();
    
    for (const item of result) {
      if (!seenPaths.has(item.path)) {
        seenPaths.add(item.path);
        uniqueResults.push(item);
      }
    }
    
    // Ordenar por fecha de inicio, más reciente primero
    uniqueResults.sort((a, b) => {
      const timeA = typeof a.startTime === 'string' ? new Date(a.startTime).getTime() : a.startTime;
      const timeB = typeof b.startTime === 'string' ? new Date(b.startTime).getTime() : b.startTime;
      return timeB - timeA;
    });
    
    return uniqueResults;
  } catch (error) {
    console.error('Error en getRecentlyExecutedJars:', error);
    throw error;
  }
}

/**
 * Obtiene JARs ejecutados desde el registro de Windows
 */
async function getJarsFromRegistry(timeThreshold) {
  const result = [];
  
  if (process.platform !== 'win32') return result;
  
  try {
    // Consultar el registro de Windows para JARs ejecutados
    const command = `powershell -Command "& {
      $recentItems = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs' -ErrorAction SilentlyContinue;
      $userAssist = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\*\\Count\\*' -ErrorAction SilentlyContinue;
      
      $jarItems = @();
      
      # Revisar RecentDocs
      if ($recentItems) {
        $recentItems.PSObject.Properties | Where-Object { $_.Name -like '*.jar*' } | ForEach-Object {
          $name = [System.Text.Encoding]::Unicode.GetString($_.Value);
          if ($name -match '\\.jar') {
            $jarItems += @{
              'Name' = $name.Trim('\u0000');
              'Source' = 'RecentDocs';
              'Time' = (Get-Item 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs').LastWriteTime
            }
          }
        }
      }
      
      # Revisar UserAssist
      if ($userAssist) {
        $userAssist.PSObject.Properties | Where-Object { $_.Name -like '*jar*' } | ForEach-Object {
          $decodedName = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($_.Name));
          if ($decodedName -match '\\.jar') {
            $jarItems += @{
              'Name' = $decodedName;
              'Source' = 'UserAssist';
              'Time' = (Get-Item $_.PSPath).LastWriteTime
            }
          }
        }
      }
      
      # JumpList items
      $jumpLists = Get-ChildItem 'C:\\Users\\*\\AppData\\Roaming\\Microsoft\\Windows\\Recent\\AutomaticDestinations' -ErrorAction SilentlyContinue;
      foreach ($jumpList in $jumpLists) {
        $content = [System.IO.File]::ReadAllBytes($jumpList.FullName);
        $contentString = [System.Text.Encoding]::Unicode.GetString($content);
        if ($contentString -match '\\.jar') {
          $jarItems += @{
            'Name' = 'JAR en JumpList';
            'Source' = 'JumpList';
            'Time' = $jumpList.LastWriteTime
          }
        }
      }
      
      # Convertir a JSON
      $jarItems | ConvertTo-Json
    }"`;
    
    const { stdout } = await execAsync(command);
    
    if (stdout.trim()) {
      let jarItems;
      try {
        jarItems = JSON.parse(stdout);
        // Asegurar que sea un array incluso si solo hay un resultado
        if (!Array.isArray(jarItems)) jarItems = [jarItems];
      } catch (error) {
        console.error('Error parseando JSON de JARs:', error);
        return result;
      }
      
      jarItems.forEach(item => {
        const time = new Date(item.Time).getTime();
        if (time >= timeThreshold) {
          result.push({
            name: path.basename(item.Name),
            path: item.Name,
            startTime: new Date(item.Time).toLocaleString(),
            source: item.Source
          });
        }
      });
    }
  } catch (error) {
    console.error('Error obteniendo JARs del registro:', error);
  }
  
  return result;
}

/**
 * Obtiene logs de ejecución de Java
 */
async function getJavaLogs(timeThreshold) {
  const result = [];
  
  try {
    // Rutas comunes de logs de Java
    const logPaths = [
      path.join(os.homedir(), '.java', 'error'),
      path.join(os.homedir(), '.minecraft', 'logs'),
      path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft', 'logs'),
      path.join(os.homedir(), 'Library', 'Logs', 'Java'),
      '/var/log/java'
    ];
    
    for (const logPath of logPaths) {
      try {
        if (fs.existsSync(logPath)) {
          const items = await fs.promises.readdir(logPath, { withFileTypes: true });
          
          for (const item of items) {
            try {
              if (item.isFile() && (item.name.includes('.log') || item.name.includes('hs_err'))) {
                const fullPath = path.join(logPath, item.name);
                const stats = await fs.promises.stat(fullPath);
                
                if (stats.mtime.getTime() >= timeThreshold) {
                  // Leer el contenido del log para buscar referencias a JARs
                  const content = await fs.promises.readFile(fullPath, 'utf8');
                  const jarMatches = content.match(/[-.\w\/\\]+\.jar/g);
                  
                  if (jarMatches) {
                    for (const jarPath of jarMatches) {
                      const normalizedPath = jarPath.replace(/\\/g, path.sep).replace(/\//g, path.sep);
                      
                      result.push({
                        name: path.basename(normalizedPath),
                        path: normalizedPath,
                        startTime: new Date(stats.mtime).toLocaleString(),
                        source: `Log de Java (${item.name})`
                      });
                    }
                  }
                }
              }
            } catch (error) {
              // Ignorar errores individuales
            }
          }
        }
      } catch (error) {
        // Ignorar errores de acceso a directorios
      }
    }
  } catch (error) {
    console.error('Error obteniendo logs de Java:', error);
  }
  
  return result;
}

/**
 * Verifica si un USB fue desconectado antes de la SS
 */
async function checkUSBDisconnection() {
  try {
    const result = {
      disconnected: false,
      details: []
    };
    
    if (process.platform === 'win32') {
      // En Windows, usar PowerShell para obtener información de eventos
      try {
        const command = `powershell -Command "& {
          $events = Get-WinEvent -FilterHashtable @{
            LogName='System';
            ID=2100,2102,6420,6421;
          } -MaxEvents 50 -ErrorAction SilentlyContinue;
          
          $events | ForEach-Object {
            $time = $_.TimeCreated;
            $message = $_.Message;
            
            # Extraer información del dispositivo
            $deviceInfo = '';
            if ($message -match 'dispositivo|device|removable media|storage|usb|flash|drive') {
              $deviceInfo = $message -replace '\\r\\n', ' ' -replace '\\s+', ' ';
            }
            
            if ($deviceInfo -ne '') {
              [PSCustomObject]@{
                Time = $time;
                Device = $deviceInfo;
              }
            }
          } | ConvertTo-Json
        }"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          let events;
          try {
            events = JSON.parse(stdout);
            // Asegurar que sea un array incluso si solo hay un resultado
            if (!Array.isArray(events)) events = [events];
          } catch (error) {
            console.error('Error parseando JSON de eventos USB:', error);
            return result;
          }
          
          // Verificar los últimos 30 minutos para dispositivos desconectados
          const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
          
          events.forEach(event => {
            const eventTime = new Date(event.Time).getTime();
            if (eventTime >= thirtyMinutesAgo) {
              result.disconnected = true;
              
              // Extraer información relevante
              let deviceInfo = event.Device;
              if (deviceInfo.length > 100) {
                deviceInfo = deviceInfo.substring(0, 100) + '...';
              }
              
              result.details.push({
                device: deviceInfo,
                time: new Date(event.Time).toLocaleString()
              });
            }
          });
        }
      } catch (error) {
        console.error('Error obteniendo eventos de USB:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar system_profiler
      try {
        const { stdout } = await execAsync('system_profiler SPUSBDataType');
        
        // Buscar información de dispositivos USB
        const usbDevices = stdout.split('\n\n')
          .filter(section => section.includes('USB'))
          .map(section => section.trim());
        
        // Verificar logs del sistema para desconexiones
        const { stdout: logOutput } = await execAsync('log show --predicate "subsystem == \'com.apple.iokit.IOUSBFamily\'" --style compact --last 30m');
        
        const disconnectionLines = logOutput.split('\n')
          .filter(line => line.includes('disconnect') || line.includes('detach'));
        
        if (disconnectionLines.length > 0) {
          result.disconnected = true;
          
          disconnectionLines.forEach(line => {
            const timeMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : 'Tiempo desconocido';
            
            result.details.push({
              device: 'Dispositivo USB',
              time: time
            });
          });
        }
      } catch (error) {
        console.error('Error obteniendo información USB en macOS:', error);
      }
    } else {
      // En Linux, revisar logs del sistema
      try {
        const { stdout } = await execAsync('dmesg | grep -i "usb disconnect\\|removed"');
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        
        if (lines.length > 0) {
          result.disconnected = true;
          
          lines.forEach(line => {
            result.details.push({
              device: line.replace(/\[\d+\.\d+\]/, '').trim(),
              time: 'Recientemente'
            });
          });
        }
      } catch (error) {
        // Es normal que grep falle si no hay coincidencias
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en checkUSBDisconnection:', error);
    throw error;
  }
}

/**
 * Verifica si hay aplicaciones grabando la pantalla
 */
async function checkScreenRecording() {
  try {
    const result = {
      recording: false,
      applications: []
    };
    
    // Lista de aplicaciones conocidas de grabación de pantalla
    const recordingApps = [
      'OBS Studio',
      'OBS',
      'Streamlabs OBS',
      'XSplit',
      'Bandicam',
      'Camtasia',
      'ScreenRecorder',
      'Fraps',
      'Action!',
      'ShareX',
      'Screencast-O-Matic',
      'Debut',
      'CamStudio',
      'ScreenFlow',
      'QuickTime Player',
      'ScreencastX',
      'ScreenRec',
      'Movavi Screen Recorder',
      'Icecream Screen Recorder',
      'Apowersoft',
      'ScreenToGif',
      'DU Recorder',
      'AZ Screen Recorder',
      'FBX',
      'FFmpeg',
      'Screen Recorder'
    ];
    
    // Excluir aplicaciones conocidas de falsos positivos
    const falsePositives = [
      'Capture One',
      'Capture NX',
      'Capture Manager',
      'Capture Service',
      'Windows Media Player',
      'Windows Photo Viewer',
      'Photos',
      'Camera',
      'ScreenSaver',
      'ScreenConnect',
      'Screen Time',
      'Microsoft Teams',
      'Adobe Capture',
      'TeamViewer'
    ];
    
    if (process.platform === 'win32') {
      // En Windows, verificar procesos en ejecución
      try {
        const { stdout } = await execAsync('tasklist /v /fo csv');
        
        // Convertir CSV a array de objetos
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
        
        for (let i = 1; i < lines.length; i++) {
          try {
            const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
            if (values) {
              const processName = values[0].replace(/"/g, '');
              const windowTitle = values[values.length - 1].replace(/"/g, '');
              
              const isFalsePositive = falsePositives.some(app => 
                processName.toLowerCase().includes(app.toLowerCase()) || 
                windowTitle.toLowerCase().includes(app.toLowerCase())
              );
              
              if (!isFalsePositive) {
                const isRecording = recordingApps.some(app => 
                  processName.toLowerCase().includes(app.toLowerCase()) || 
                  windowTitle.toLowerCase().includes(app.toLowerCase())
                );
                
                if (isRecording) {
                  result.recording = true;
                  result.applications.push(processName + (windowTitle ? ` (${windowTitle})` : ''));
                }
              }
            }
          } catch (error) {
            // Ignorar errores en líneas individuales
          }
        }
      } catch (error) {
        console.error('Error verificando procesos en Windows:', error);
      }
      
      // Verificar servicios y componentes específicos
      try {
        const { stdout: servicesOutput } = await execAsync('powershell -Command "& { Get-Service | Where-Object { $_.Status -eq \'Running\' } | Select-Object Name, DisplayName | ConvertTo-Csv -NoTypeInformation }"');
        
        const serviceLines = servicesOutput.split('\n').filter(line => line.trim() !== '' && !line.includes('Name,DisplayName'));
        
        for (const line of serviceLines) {
          const match = line.match(/"([^"]+)","([^"]+)"/);
          if (match) {
            const serviceName = match[1];
            const displayName = match[2];
            
            const isFalsePositive = falsePositives.some(app => 
              serviceName.toLowerCase().includes(app.toLowerCase()) || 
              displayName.toLowerCase().includes(app.toLowerCase())
            );
            
            if (!isFalsePositive) {
              const isRecording = recordingApps.some(app => 
                serviceName.toLowerCase().includes(app.toLowerCase()) || 
                displayName.toLowerCase().includes(app.toLowerCase())
              );
              
              if (isRecording) {
                result.recording = true;
                result.applications.push(`Servicio: ${displayName}`);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error verificando servicios en Windows:', error);
      }
      
      // Verificar dispositivos de captura activos
      try {
        const { stdout: deviceOutput } = await execAsync('powershell -Command "& { Get-WmiObject Win32_PnPEntity | Where-Object { $_.Caption -like \'*capture*\' -or $_.Caption -like \'*video*\' } | Select-Object Caption | ConvertTo-Csv -NoTypeInformation }"');
        
        const deviceLines = deviceOutput.split('\n').filter(line => line.trim() !== '' && !line.includes('Caption'));
        
        for (const line of deviceLines) {
          const match = line.match(/"([^"]+)"/);
          if (match) {
            const deviceName = match[1];
            
            const isFalsePositive = falsePositives.some(app => 
              deviceName.toLowerCase().includes(app.toLowerCase())
            );
            
            if (!isFalsePositive && deviceName.toLowerCase().includes('capture')) {
              result.applications.push(`Dispositivo de captura: ${deviceName}`);
              
              // Solo marcamos como grabación si no es un falso positivo común
              if (!deviceName.match(/webcam|camera|cam$/i)) {
                result.recording = true;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error verificando dispositivos en Windows:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, verificar procesos en ejecución
      try {
        const { stdout } = await execAsync('ps -ax -o comm=');
        
        const processes = stdout.split('\n').filter(p => p.trim() !== '');
        
        for (const process of processes) {
          const isFalsePositive = falsePositives.some(app => 
            process.toLowerCase().includes(app.toLowerCase())
          );
          
          if (!isFalsePositive) {
            const isRecording = recordingApps.some(app => 
              process.toLowerCase().includes(app.toLowerCase())
            );
            
            if (isRecording) {
              result.recording = true;
              result.applications.push(process);
            }
          }
        }
        
        // Verificar permisos de grabación de pantalla
        const { stdout: permissionsOutput } = await execAsync('tccutil list');
        
        if (permissionsOutput.includes('ScreenCapture') || permissionsOutput.includes('kTCCServiceScreenCapture')) {
          // Hay aplicaciones con permiso de captura de pantalla
          const permissionLines = permissionsOutput.split('\n').filter(line => 
            line.includes('ScreenCapture') || line.includes('kTCCServiceScreenCapture')
          );
          
          for (const line of permissionLines) {
            const appMatch = line.match(/([^\/\s]+)\.app/);
            if (appMatch) {
              const appName = appMatch[1];
              
              const isFalsePositive = falsePositives.some(app => 
                appName.toLowerCase().includes(app.toLowerCase())
              );
              
              if (!isFalsePositive) {
                result.applications.push(`${appName} (tiene permisos de captura)`);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error verificando procesos en macOS:', error);
      }
    } else {
      // En Linux, verificar procesos en ejecución
      try {
        const { stdout } = await execAsync('ps -e -o comm=');
        
        const processes = stdout.split('\n').filter(p => p.trim() !== '');
        
        for (const process of processes) {
          const isFalsePositive = falsePositives.some(app => 
            process.toLowerCase().includes(app.toLowerCase())
          );
          
          if (!isFalsePositive) {
            const isRecording = recordingApps.some(app => 
              process.toLowerCase().includes(app.toLowerCase())
            );
            
            if (isRecording) {
              result.recording = true;
              result.applications.push(process);
            }
          }
        }
        
        // Verificar compositors de grabación (gstreamer, ffmpeg, etc.)
        const { stdout: compositorOutput } = await execAsync('ps -e -o args= | grep -E "ffmpeg|gst|v4l2|x11grab|xcbgrab"');
        
        const compositorProcesses = compositorOutput.split('\n').filter(p => p.trim() !== '');
        
        for (const process of compositorProcesses) {
          if (process.includes('grep')) continue; // Ignorar el propio grep
          
          result.recording = true;
          result.applications.push(`Compositor de grabación: ${process.substring(0, 50)}...`);
        }
      } catch (error) {
        // Es normal que grep falle si no hay coincidencias
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en checkScreenRecording:', error);
    throw error;
  }
}

/**
 * Detecta navegadores instalados en el sistema
 */
async function detectBrowsers() {
  try {
    const browsers = [];
    const defaultBrowserInfo = await getDefaultBrowser();
    
    if (process.platform === 'win32') {
      // En Windows, buscar navegadores comunes
      const browserPaths = [
        { name: 'Google Chrome', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe') },
        { name: 'Google Chrome', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe') },
        { name: 'Mozilla Firefox', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Mozilla Firefox\\firefox.exe') },
        { name: 'Mozilla Firefox', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Mozilla Firefox\\firefox.exe') },
        { name: 'Microsoft Edge', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe') },
        { name: 'Microsoft Edge', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe') },
        { name: 'Opera', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Opera\\launcher.exe') },
        { name: 'Opera', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Opera\\launcher.exe') },
        { name: 'Opera GX', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Opera GX\\launcher.exe') },
        { name: 'Opera GX', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Opera GX\\launcher.exe') },
        { name: 'Opera GX', path: path.join(os.homedir(), 'AppData\\Local\\Programs\\Opera GX\\launcher.exe') },
        { name: 'Brave', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
        { name: 'Brave', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') },
        { name: 'Vivaldi', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Vivaldi\\Application\\vivaldi.exe') },
        { name: 'Vivaldi', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Vivaldi\\Application\\vivaldi.exe') },
        { name: 'Yandex Browser', path: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Yandex\\YandexBrowser\\browser.exe') },
        { name: 'Yandex Browser', path: path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Yandex\\YandexBrowser\\browser.exe') }
      ];
      
      // Verificar si los navegadores están instalados
      for (const browser of browserPaths) {
        if (fs.existsSync(browser.path)) {
          browsers.push({
            name: browser.name,
            path: browser.path,
            default: defaultBrowserInfo.name === browser.name
          });
        }
      }
      
      // Buscar instalaciones alternativas comunes
      const alternativePaths = [
        path.join(os.homedir(), 'AppData\\Local\\Programs'),
        path.join(os.homedir(), 'AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs')
      ];
      
      for (const dirPath of alternativePaths) {
        try {
          if (fs.existsSync(dirPath)) {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const item of items) {
              if (item.isDirectory()) {
                // Buscar navegadores en estas ubicaciones alternativas
                const folderPath = path.join(dirPath, item.name);
                const browserKeywords = ['chrome', 'firefox', 'edge', 'opera', 'brave', 'vivaldi', 'yandex', 'browser'];
                
                if (browserKeywords.some(keyword => item.name.toLowerCase().includes(keyword))) {
                  // Es posible que sea una carpeta de navegador, buscar ejecutables
                  try {
                    const files = fs.readdirSync(folderPath, { withFileTypes: true });
                    
                    for (const file of files) {
                      if (file.name.endsWith('.exe')) {
                        browsers.push({
                          name: item.name,
                          path: path.join(folderPath, file.name),
                          default: defaultBrowserInfo.name === item.name
                        });
                        break;
                      }
                    }
                  } catch (error) {
                    // Ignorar errores de acceso
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error leyendo directorio alternativo ${dirPath}:`, error);
        }
      }
    } else if (process.platform === 'darwin') {
      // En macOS, buscar navegadores comunes
      const browserPaths = [
        { name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
        { name: 'Mozilla Firefox', path: '/Applications/Firefox.app' },
        { name: 'Safari', path: '/Applications/Safari.app' },
        { name: 'Opera', path: '/Applications/Opera.app' },
        { name: 'Opera GX', path: '/Applications/Opera GX.app' },
        { name: 'Brave', path: '/Applications/Brave Browser.app' },
        { name: 'Vivaldi', path: '/Applications/Vivaldi.app' },
        { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app' },
        { name: 'Yandex Browser', path: '/Applications/Yandex.app' }
      ];
      
      // Verificar si los navegadores están instalados
      for (const browser of browserPaths) {
        if (fs.existsSync(browser.path)) {
          browsers.push({
            name: browser.name,
            path: browser.path,
            default: defaultBrowserInfo.name === browser.name
          });
        }
      }
    } else {
      // En Linux, verificar procesos comunes
      try {
        const { stdout } = await execAsync('which google-chrome chromium firefox opera brave vivaldi edge');
        
        const browserPaths = stdout.split('\n').filter(path => path.trim() !== '');
        
        for (const browserPath of browserPaths) {
          let name = '';
          
          if (browserPath.includes('google-chrome')) name = 'Google Chrome';
          else if (browserPath.includes('chromium')) name = 'Chromium';
          else if (browserPath.includes('firefox')) name = 'Mozilla Firefox';
          else if (browserPath.includes('opera')) name = 'Opera';
          else if (browserPath.includes('brave')) name = 'Brave';
          else if (browserPath.includes('vivaldi')) name = 'Vivaldi';
          else if (browserPath.includes('edge')) name = 'Microsoft Edge';
          else name = path.basename(browserPath);
          
          browsers.push({
            name,
            path: browserPath,
            default: defaultBrowserInfo.name === name
          });
        }
      } catch (error) {
        console.error('Error detectando navegadores en Linux:', error);
      }
    }
    
    // Si no se encontró un navegador marcado como predeterminado, marcar el primero
    if (browsers.length > 0 && !browsers.some(b => b.default)) {
      browsers[0].default = true;
    }
    
    return browsers;
  } catch (error) {
    console.error('Error en detectBrowsers:', error);
    throw error;
  }
}

/**
 * Obtiene el navegador predeterminado del sistema
 */
async function getDefaultBrowser() {
  try {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('powershell -Command "& { (Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice).ProgId }"');
        
        const progId = stdout.trim();
        let browserName = 'Desconocido';
        
        if (progId.includes('Chrome')) browserName = 'Google Chrome';
        else if (progId.includes('Firefox')) browserName = 'Mozilla Firefox';
        else if (progId.includes('Edge')) browserName = 'Microsoft Edge';
        else if (progId.includes('Opera')) {
          // Verificar si es Opera GX
          if (fs.existsSync(path.join(os.homedir(), 'AppData\\Local\\Programs\\Opera GX'))) {
            browserName = 'Opera GX';
          } else {
            browserName = 'Opera';
          }
        }
        else if (progId.includes('Brave')) browserName = 'Brave';
        else if (progId.includes('Vivaldi')) browserName = 'Vivaldi';
        else if (progId.includes('IE')) browserName = 'Internet Explorer';
        
        return {
          name: browserName,
          progId
        };
      } catch (error) {
        console.error('Error obteniendo navegador predeterminado en Windows:', error);
        return { name: 'Desconocido' };
      }
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execAsync('defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep -A 3 "http:" | grep "LSHandlerRoleAll" | awk \'{print $3}\' | sed \'s/;//\'');
        
        const bundleId = stdout.trim();
        let browserName = 'Desconocido';
        
        if (bundleId.includes('chrome')) browserName = 'Google Chrome';
        else if (bundleId.includes('firefox')) browserName = 'Mozilla Firefox';
        else if (bundleId.includes('safari')) browserName = 'Safari';
        else if (bundleId.includes('opera')) {
          // Verificar si es Opera GX
          if (fs.existsSync('/Applications/Opera GX.app')) {
            browserName = 'Opera GX';
          } else {
            browserName = 'Opera';
          }
        }
        else if (bundleId.includes('brave')) browserName = 'Brave';
        else if (bundleId.includes('vivaldi')) browserName = 'Vivaldi';
        else if (bundleId.includes('edge')) browserName = 'Microsoft Edge';
        
        return {
          name: browserName,
          bundleId
        };
      } catch (error) {
        console.error('Error obteniendo navegador predeterminado en macOS:', error);
        return { name: 'Desconocido' };
      }
    } else {
      try {
        const { stdout } = await execAsync('xdg-settings get default-web-browser');
        
        const browserDesktop = stdout.trim();
        let browserName = 'Desconocido';
        
        if (browserDesktop.includes('chrome')) browserName = 'Google Chrome';
        else if (browserDesktop.includes('chromium')) browserName = 'Chromium';
        else if (browserDesktop.includes('firefox')) browserName = 'Mozilla Firefox';
        else if (browserDesktop.includes('opera')) browserName = 'Opera';
        else if (browserDesktop.includes('brave')) browserName = 'Brave';
        else if (browserDesktop.includes('vivaldi')) browserName = 'Vivaldi';
        else if (browserDesktop.includes('edge')) browserName = 'Microsoft Edge';
        
        return {
          name: browserName,
          desktop: browserDesktop
        };
      } catch (error) {
        console.error('Error obteniendo navegador predeterminado en Linux:', error);
        return { name: 'Desconocido' };
      }
    }
  } catch (error) {
    console.error('Error en getDefaultBrowser:', error);
    return { name: 'Desconocido' };
  }
}

/**
 * Abre el historial del navegador
 */
async function openBrowserHistory() {
  try {
    const browsers = await detectBrowsers();
    const result = {
      success: false,
      browserFound: false,
      details: []
    };
    
    if (browsers.length === 0) {
      return {
        success: false,
        browserFound: false,
        message: 'No se encontraron navegadores instalados'
      };
    }
    
    // Buscar el navegador predeterminado o el primero disponible
    const defaultBrowser = browsers.find(b => b.default) || browsers[0];
    result.browserFound = true;
    
    // Intentar abrir el historial del navegador predeterminado
    const defaultResult = await openSpecificBrowserHistory(defaultBrowser);
    result.details.push({
      browser: defaultBrowser.name,
      result: defaultResult
    });
    
    if (defaultResult.success) {
      result.success = true;
    } else {
      // Si falla, intentar con otros navegadores
      for (const browser of browsers) {
        if (browser.name !== defaultBrowser.name) {
          const specificResult = await openSpecificBrowserHistory(browser);
          result.details.push({
            browser: browser.name,
            result: specificResult
          });
          
          if (specificResult.success) {
            result.success = true;
            break;
          }
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en openBrowserHistory:', error);
    throw error;
  }
}

/**
 * Abre el historial de un navegador específico
 */
async function openSpecificBrowserHistory(browser) {
  try {
    const result = {
      success: false,
      message: ''
    };
    
    const browserName = browser.name.toLowerCase();
    
    if (browserName.includes('chrome')) {
      await shell.openExternal('chrome://history');
      result.success = true;
      result.message = 'Historial de Chrome abierto';
    } else if (browserName.includes('firefox')) {
      await shell.openExternal('about:history');
      result.success = true;
      result.message = 'Historial de Firefox abierto';
    } else if (browserName.includes('edge')) {
      await shell.openExternal('edge://history');
      result.success = true;
      result.message = 'Historial de Edge abierto';
    } else if (browserName.includes('opera gx')) {
      // Método específico para Opera GX
      if (process.platform === 'win32') {
        try {
          // Intentar abrir Opera GX con su historial
          await execAsync(`"${browser.path}" --new-window opera://history`);
          result.success = true;
          result.message = 'Historial de Opera GX abierto';
        } catch (error) {
          console.error('Error abriendo historial de Opera GX:', error);
          result.message = 'Error abriendo Opera GX: ' + error.message;
        }
      } else {
        await shell.openExternal('opera://history');
        result.success = true;
        result.message = 'Historial de Opera GX abierto';
      }
    } else if (browserName.includes('opera')) {
      await shell.openExternal('opera://history');
      result.success = true;
      result.message = 'Historial de Opera abierto';
    } else if (browserName.includes('brave')) {
      await shell.openExternal('brave://history');
      result.success = true;
      result.message = 'Historial de Brave abierto';
    } else if (browserName.includes('vivaldi')) {
      await shell.openExternal('vivaldi://history');
      result.success = true;
      result.message = 'Historial de Vivaldi abierto';
    } else if (browserName.includes('safari')) {
      if (process.platform === 'darwin') {
        try {
          await execAsync('open -a Safari "safari://history"');
          result.success = true;
          result.message = 'Historial de Safari abierto';
        } catch (error) {
          console.error('Error abriendo historial de Safari:', error);
          result.message = 'Error abriendo Safari: ' + error.message;
        }
      } else {
        result.message = 'Safari no disponible en esta plataforma';
      }
    } else if (browserName.includes('yandex')) {
      await shell.openExternal('browser://history');
      result.success = true;
      result.message = 'Historial de Yandex abierto';
    } else {
      result.message = 'Navegador no soportado para abrir historial';
    }
    
    return result;
  } catch (error) {
    console.error('Error en openSpecificBrowserHistory:', error);
    return {
      success: false,
      message: 'Error: ' + error.message
    };
  }
}

/**
 * Detecta visitas a sitios web relacionados con cheats de Minecraft
 */
async function detectMinecraftCheats() {
  try {
    const result = {
      sitesDetected: [],
      historyFound: false,
      modFiles: []
    };
    
    // Lista de dominios conocidos de cheats para Minecraft
    const cheatDomains = [
      { domain: 'hackclient', name: 'Cliente de Hack Genérico', severity: 'high' },
      { domain: 'wurst-client', name: 'Wurst Client', severity: 'high' },
      { domain: 'liquidbounce', name: 'LiquidBounce', severity: 'high' },
      { domain: 'impact-client', name: 'Impact Client', severity: 'high' },
      { domain: 'aristois', name: 'Aristois', severity: 'high' },
      { domain: 'meteor-client', name: 'Meteor Client', severity: 'high' },
      { domain: 'inertiaclient', name: 'Inertia Client', severity: 'high' },
      { domain: 'minecraftcheats', name: 'Minecraft Cheats', severity: 'medium' },
      { domain: 'minecrafthacks', name: 'Minecraft Hacks', severity: 'medium' },
      { domain: 'cheatbreaker', name: 'CheatBreaker', severity: 'medium' },
      { domain: 'badlion', name: 'Badlion Client', severity: 'low' },
      { domain: 'lunarclient', name: 'Lunar Client', severity: 'low' },
      { domain: 'cheatengine', name: 'Cheat Engine', severity: 'medium' },
      { domain: 'wizardhax', name: 'WizardHax', severity: 'high' },
      { domain: 'xray', name: 'XRay Mod', severity: 'medium' },
      { domain: 'autoclicker', name: 'AutoClicker', severity: 'medium' },
      { domain: 'bhop', name: 'BHop Hack', severity: 'high' },
      { domain: 'killaura', name: 'KillAura', severity: 'high' },
      { domain: 'baritone', name: 'Baritone', severity: 'medium' },
      { domain: 'ghostclient', name: 'Ghost Client', severity: 'high' },
      { domain: 'sigma', name: 'Sigma Client', severity: 'high' },
      { domain: 'horion', name: 'Horion Client', severity: 'high' },
      { domain: 'fluxclient', name: 'Flux Client', severity: 'high' },
      { domain: 'nodus', name: 'Nodus Client', severity: 'high' },
      { domain: 'huzuni', name: 'Huzuni Client', severity: 'high' },
      { domain: 'wolfram', name: 'Wolfram Client', severity: 'high' },
      { domain: 'skillclient', name: 'Skill Client', severity: 'high' },
      { domain: 'weepcraft', name: 'Weepcraft', severity: 'high' }
    ];
    
    // 1. Verificar archivos de historial de navegación directamente
    await checkBrowserHistoryFiles(result, cheatDomains);
    
    // 2. Verificar carpetas de Minecraft en busca de mods sospechosos
    await checkMinecraftModFolders(result);
    
    // 3. Buscar procesos sospechosos
    const suspiciousProcesses = await detectSuspiciousProcesses();
    if (suspiciousProcesses.length > 0) {
      result.suspiciousProcesses = suspiciousProcesses;
    }
    
    return result;
  } catch (error) {
    console.error('Error en detectMinecraftCheats:', error);
    throw error;
  }
}

/**
 * Verifica archivos de historial de navegadores
 */
async function checkBrowserHistoryFiles(result, cheatDomains) {
  try {
    // Rutas de historial para navegadores comunes
    const historyPaths = [];
    const homeDir = os.homedir();
    
    // Chrome
    const chromeProfilesDir = path.join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    if (fs.existsSync(chromeProfilesDir)) {
      try {
        const profiles = fs.readdirSync(chromeProfilesDir, { withFileTypes: true });
        for (const profile of profiles) {
          if (profile.isDirectory() && (profile.name.startsWith('Profile') || profile.name === 'Default')) {
            const historyPath = path.join(chromeProfilesDir, profile.name, 'History');
            if (fs.existsSync(historyPath)) {
              historyPaths.push({ browser: 'Chrome', profile: profile.name, path: historyPath });
            }
          }
        }
      } catch (error) {
        console.error('Error leyendo perfiles de Chrome:', error);
      }
    }
    
    // Firefox
    const firefoxProfilesPath = path.join(homeDir, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
    if (fs.existsSync(firefoxProfilesPath)) {
      try {
        const profiles = fs.readdirSync(firefoxProfilesPath, { withFileTypes: true });
        for (const profile of profiles) {
          if (profile.isDirectory() && profile.name.includes('.default')) {
            const historyPath = path.join(firefoxProfilesPath, profile.name, 'places.sqlite');
            if (fs.existsSync(historyPath)) {
              historyPaths.push({ browser: 'Firefox', profile: profile.name, path: historyPath });
            }
          }
        }
      } catch (error) {
        console.error('Error leyendo perfiles de Firefox:', error);
      }
    }
    
    // Edge
    const edgeProfilesDir = path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data');
    if (fs.existsSync(edgeProfilesDir)) {
      try {
        const profiles = fs.readdirSync(edgeProfilesDir, { withFileTypes: true });
        for (const profile of profiles) {
          if (profile.isDirectory() && (profile.name.startsWith('Profile') || profile.name === 'Default')) {
            const historyPath = path.join(edgeProfilesDir, profile.name, 'History');
            if (fs.existsSync(historyPath)) {
              historyPaths.push({ browser: 'Edge', profile: profile.name, path: historyPath });
            }
          }
        }
      } catch (error) {
        console.error('Error leyendo perfiles de Edge:', error);
      }
    }
    
    // Opera y Opera GX
    const operaPaths = [
      { dir: path.join(homeDir, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable'), browser: 'Opera' },
      { dir: path.join(homeDir, 'AppData', 'Roaming', 'Opera Software', 'Opera GX Stable'), browser: 'Opera GX' }
    ];
    
    for (const operaPath of operaPaths) {
      if (fs.existsSync(operaPath.dir)) {
        const historyPath = path.join(operaPath.dir, 'History');
        if (fs.existsSync(historyPath)) {
          historyPaths.push({ browser: operaPath.browser, profile: 'Default', path: historyPath });
        }
      }
    }
    
    // Brave
    const braveProfilesDir = path.join(homeDir, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data');
    if (fs.existsSync(braveProfilesDir)) {
      try {
        const profiles = fs.readdirSync(braveProfilesDir, { withFileTypes: true });
        for (const profile of profiles) {
          if (profile.isDirectory() && (profile.name.startsWith('Profile') || profile.name === 'Default')) {
            const historyPath = path.join(braveProfilesDir, profile.name, 'History');
            if (fs.existsSync(historyPath)) {
              historyPaths.push({ browser: 'Brave', profile: profile.name, path: historyPath });
            }
          }
        }
      } catch (error) {
        console.error('Error leyendo perfiles de Brave:', error);
      }
    }
    
    // Vivaldi
    const vivaldiProfilesDir = path.join(homeDir, 'AppData', 'Local', 'Vivaldi', 'User Data');
    if (fs.existsSync(vivaldiProfilesDir)) {
      try {
        const profiles = fs.readdirSync(vivaldiProfilesDir, { withFileTypes: true });
        for (const profile of profiles) {
          if (profile.isDirectory() && (profile.name.startsWith('Profile') || profile.name === 'Default')) {
            const historyPath = path.join(vivaldiProfilesDir, profile.name, 'History');
            if (fs.existsSync(historyPath)) {
              historyPaths.push({ browser: 'Vivaldi', profile: profile.name, path: historyPath });
            }
          }
        }
      } catch (error) {
        console.error('Error leyendo perfiles de Vivaldi:', error);
      }
    }
    
    // Verificar los archivos de historial
    if (historyPaths.length > 0) {
      result.historyFound = true;
      
      // En Windows, podemos usar PowerShell para buscar en los historiales sin necesidad de bibliotecas adicionales
      if (process.platform === 'win32') {
        for (const historyFile of historyPaths) {
          try {
            // Crear una copia temporal del archivo de historial para no bloquear el original
            const tempDir = os.tmpdir();
            const tempHistoryPath = path.join(tempDir, `history_${Date.now()}.db`);
            
            fs.copyFileSync(historyFile.path, tempHistoryPath);
            
            // Usar PowerShell para buscar en el historial
            const cheatDomainsString = cheatDomains.map(d => d.domain).join('|');
            const command = `powershell -Command "& {
              Add-Type -Path '${path.join(__dirname, 'System.Data.SQLite.dll')}';
              $con = New-Object System.Data.SQLite.SQLiteConnection('Data Source=${tempHistoryPath.replace(/\\/g, '\\\\')}');
              try {
                $con.Open();
                $cmd = $con.CreateCommand();
                $cmd.CommandText = 'SELECT url, title, last_visit_time FROM urls WHERE url LIKE \\'%${cheatDomainsString}%\\' ORDER BY last_visit_time DESC LIMIT 100';
                $reader = $cmd.ExecuteReader();
                $results = @();
                while($reader.Read()) {
                  $results += [PSCustomObject]@{
                    Url = $reader.GetString(0);
                    Title = $reader.GetString(1);
                    Time = $reader.GetValue(2);
                  }
                }
                $reader.Close();
                $results | ConvertTo-Json;
              } finally {
                $con.Close();
              }
            }"`;
            
            const { stdout } = await execAsync(command);
            
            // Eliminar el archivo temporal
            try {
              fs.unlinkSync(tempHistoryPath);
            } catch (e) {
              // Ignorar errores al eliminar
            }
            
            if (stdout.trim()) {
              try {
                let historyEntries = JSON.parse(stdout);
                // Asegurar que sea un array
                if (!Array.isArray(historyEntries)) {
                  historyEntries = [historyEntries];
                }
                
                for (const entry of historyEntries) {
                  const url = entry.Url;
                  const title = entry.Title;
                  // Convertir el timestamp de Chrome (microsegundos desde 1601-01-01) a fecha JS
                  let visitTime;
                  try {
                    const microsecondsFrom1601 = entry.Time;
                    const microsecondsFrom1970 = microsecondsFrom1601 - 11644473600000000;
                    visitTime = new Date(microsecondsFrom1970 / 1000);
                  } catch (e) {
                    visitTime = new Date();
                  }
                  
                  // Determinar la severidad
                  const matchedDomain = cheatDomains.find(d => url.toLowerCase().includes(d.domain.toLowerCase()));
                  const severity = matchedDomain ? matchedDomain.severity : 'medium';
                  const cheatName = matchedDomain ? matchedDomain.name : 'Cheat desconocido';
                  
                  result.sitesDetected.push({
                    url,
                    title,
                    visitTime: visitTime.toLocaleString(),
                    browser: historyFile.browser,
                    profile: historyFile.profile,
                    severity,
                    cheatName
                  });
                }
              } catch (error) {
                console.error('Error parseando resultados de historial:', error);
              }
            }
          } catch (error) {
            console.error(`Error procesando historial de ${historyFile.browser}:`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error en checkBrowserHistoryFiles:', error);
  }
}

/**
 * Verifica carpetas de mods de Minecraft
 */
async function checkMinecraftModFolders(result) {
  try {
    const homeDir = os.homedir();
    const minecraftFolders = [
      path.join(homeDir, 'AppData', 'Roaming', '.minecraft'),
      path.join(homeDir, '.minecraft'),
      path.join(homeDir, 'Library', 'Application Support', 'minecraft')
    ];
    
    // Lista de firmas sospechosas en mods
    const suspiciousKeywords = [
      'hack', 'cheat', 'xray', 'autoclicker', 'killaura', 'bhop', 'flight',
      'wallhack', 'noclip', 'speed', 'aimbot', 'esp', 'tracers', 'reach',
      'bypass', 'ghostclient', 'baritone', 'nuker', 'autotool', 'blink',
      'fastplace', 'nofall', 'antiknockback', 'criticals', 'scaffold',
      'timer', 'freecam', 'fullbright', 'jesus', 'phase', 'spoofer'
    ];
    
    for (const minecraftFolder of minecraftFolders) {
      if (fs.existsSync(minecraftFolder)) {
        // Verificar carpeta de mods
        const modsFolder = path.join(minecraftFolder, 'mods');
        if (fs.existsSync(modsFolder)) {
          const modFiles = await fs.promises.readdir(modsFolder, { withFileTypes: true });
          
          for (const modFile of modFiles) {
            if (modFile.isFile() && modFile.name.endsWith('.jar')) {
              try {
                const modPath = path.join(modsFolder, modFile.name);
                const modStats = await fs.promises.stat(modPath);
                
                // Analizar el nombre del mod
                const modNameLower = modFile.name.toLowerCase();
                const suspiciousKeywordsFound = suspiciousKeywords.filter(keyword => 
                  modNameLower.includes(keyword)
                );
                
                let suspicious = false;
                let reason = '';
                
                if (suspiciousKeywordsFound.length > 0) {
                  suspicious = true;
                  reason = `Contiene palabras clave sospechosas: ${suspiciousKeywordsFound.join(', ')}`;
                }
                
                // Si el mod no parece sospechoso por el nombre, podríamos analizar su contenido
                if (!suspicious) {
                  // Aquí podríamos usar un módulo como "unzipper" para analizar el contenido,
                  // pero para simplificar, omitiremos ese análisis detallado.
                }
                
                result.modFiles.push({
                  name: modFile.name,
                  path: modPath,
                  size: modStats.size,
                  modifiedTime: modStats.mtime.toLocaleString(),
                  suspicious,
                  reason
                });
              } catch (error) {
                console.error(`Error procesando mod ${modFile.name}:`, error);
              }
            }
          }
        }
        
        // También verificar la carpeta versions por posibles clientes hackeados
        const versionsFolder = path.join(minecraftFolder, 'versions');
        if (fs.existsSync(versionsFolder)) {
          const versionDirs = await fs.promises.readdir(versionsFolder, { withFileTypes: true });
          
          for (const versionDir of versionDirs) {
            if (versionDir.isDirectory()) {
              const versionNameLower = versionDir.name.toLowerCase();
              const suspiciousKeywordsFound = suspiciousKeywords.filter(keyword => 
                versionNameLower.includes(keyword)
              );
              
              if (suspiciousKeywordsFound.length > 0) {
                const versionPath = path.join(versionsFolder, versionDir.name);
                const jarPath = path.join(versionPath, `${versionDir.name}.jar`);
                
                if (fs.existsSync(jarPath)) {
                  const jarStats = await fs.promises.stat(jarPath);
                  
                  result.modFiles.push({
                    name: `${versionDir.name}.jar (versión cliente)`,
                    path: jarPath,
                    size: jarStats.size,
                    modifiedTime: jarStats.mtime.toLocaleString(),
                    suspicious: true,
                    reason: `Versión de cliente potencialmente hackeada: ${suspiciousKeywordsFound.join(', ')}`
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error en checkMinecraftModFolders:', error);
  }
}

/**
 * Detecta procesos sospechosos en ejecución
 */
async function detectSuspiciousProcesses() {
  const suspiciousProcesses = [];
  const suspiciousKeywords = [
    'hack', 'cheat', 'autoclicker', 'xray', 'killaura', 'injector',
    'memory', 'modify', 'dll', 'bhop', 'esp', 'aimbot', 'minecraft'
  ];
  
  try {
    if (process.platform === 'win32') {
      // En Windows, usar tasklist para obtener procesos
      const { stdout } = await execAsync('tasklist /fo csv /v');
      
      const lines = stdout.split('\n').filter(line => line.trim() !== '');
      const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
      
      for (let i = 1; i < lines.length; i++) {
        try {
          const values = lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
          if (values) {
            const processName = values[0].replace(/"/g, '');
            const pid = values[1].replace(/"/g, '');
            const windowTitle = values[values.length - 1].replace(/"/g, '');
            
            const processNameLower = processName.toLowerCase();
            const windowTitleLower = windowTitle.toLowerCase();
            
            // Verificar si el proceso tiene palabras clave sospechosas
            const suspiciousNameKeywords = suspiciousKeywords.filter(keyword => 
              processNameLower.includes(keyword)
            );
            
            const suspiciousTitleKeywords = suspiciousKeywords.filter(keyword => 
              windowTitleLower.includes(keyword)
            );
            
            if (suspiciousNameKeywords.length > 0 || suspiciousTitleKeywords.length > 0) {
              suspiciousProcesses.push({
                name: processName,
                pid,
                windowTitle,
                suspiciousKeywords: [...new Set([...suspiciousNameKeywords, ...suspiciousTitleKeywords])]
              });
            }
          }
        } catch (error) {
          // Ignorar errores en líneas individuales
        }
      }
      
      // Buscar DLLs inyectadas en minecraft.exe
      try {
        const minecraftProcesses = stdout.split('\n').filter(line => line.toLowerCase().includes('minecraft.exe'));
        
        for (const process of minecraftProcesses) {
          try {
            const values = process.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
            if (values) {
              const pid = values[1].replace(/"/g, '');
              
              // Verificar módulos cargados en el proceso
              const { stdout: modulesOutput } = await execAsync(`powershell -Command "& { Get-Process -Id ${pid} -Module | Select-Object ModuleName | ConvertTo-Csv -NoTypeInformation }"`);
              
              const moduleLines = modulesOutput.split('\n').filter(line => line.trim() !== '' && !line.includes('ModuleName'));
              
              for (const line of moduleLines) {
                const match = line.match(/"([^"]+)"/);
                if (match) {
                  const moduleName = match[1].toLowerCase();
                  
                  // Verificar si el módulo parece sospechoso
                  const isSuspiciousModule = suspiciousKeywords.some(keyword => moduleName.includes(keyword)) ||
                    !moduleName.includes('minecraft') && !moduleName.includes('java') && 
                    !moduleName.startsWith('jvm') && !moduleName.startsWith('nt') &&
                    !moduleName.startsWith('api-ms-win') && !moduleName.includes('vcruntime') &&
                    !moduleName.includes('msvcp') && !moduleName.includes('system');
                  
                  if (isSuspiciousModule) {
                    suspiciousProcesses.push({
                      name: 'minecraft.exe',
                      pid,
                      injectedModule: moduleName,
                      type: 'DLL inyectado'
                    });
                  }
                }
              }
            }
          } catch (error) {
            // Ignorar errores en procesos individuales
          }
        }
      } catch (error) {
        console.error('Error verificando DLLs inyectados:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar ps para obtener procesos
      const { stdout } = await execAsync('ps -A -o pid,comm');
      
      const lines = stdout.split('\n').filter(line => line.trim() !== '');
      
      for (let i = 1; i < lines.length; i++) {
        try {
          const match = lines[i].match(/^\s*(\d+)\s+(.+)$/);
          if (match) {
            const pid = match[1];
            const processName = match[2];
            const processNameLower = processName.toLowerCase();
            
            // Verificar si el proceso tiene palabras clave sospechosas
            const suspiciousNameKeywords = suspiciousKeywords.filter(keyword => 
              processNameLower.includes(keyword)
            );
            
            if (suspiciousNameKeywords.length > 0) {
              suspiciousProcesses.push({
                name: processName,
                pid,
                suspiciousKeywords: suspiciousNameKeywords
              });
            }
          }
        } catch (error) {
          // Ignorar errores en líneas individuales
        }
      }
    } else {
      // En Linux, usar ps para obtener procesos
      const { stdout } = await execAsync('ps -e -o pid,comm');
      
      const lines = stdout.split('\n').filter(line => line.trim() !== '');
      
      for (let i = 1; i < lines.length; i++) {
        try {
          const match = lines[i].match(/^\s*(\d+)\s+(.+)$/);
          if (match) {
            const pid = match[1];
            const processName = match[2];
            const processNameLower = processName.toLowerCase();
            
            // Verificar si el proceso tiene palabras clave sospechosas
            const suspiciousNameKeywords = suspiciousKeywords.filter(keyword => 
              processNameLower.includes(keyword)
            );
            
            if (suspiciousNameKeywords.length > 0) {
              suspiciousProcesses.push({
                name: processName,
                pid,
                suspiciousKeywords: suspiciousNameKeywords
              });
            }
          }
        } catch (error) {
          // Ignorar errores en líneas individuales
        }
      }
    }
  } catch (error) {
    console.error('Error en detectSuspiciousProcesses:', error);
  }
  
  return suspiciousProcesses;
}

/**
 * Detecta servicios detenidos que pueden ser relevantes para detectar trampas
 */
async function detectStoppedServices() {
  try {
    const result = {
      stoppedServices: [],
      disabledServices: [],
      modifiedServices: []
    };
    
    // Lista de servicios que podrían ser detenidos para ocultar trampas
    const monitorServices = [
      { name: 'GameInput', description: 'Servicio de entrada de juegos de Windows' },
      { name: 'Audiosrv', description: 'Servicio de audio de Windows' },
      { name: 'Schedule', description: 'Programador de tareas' },
      { name: 'winmgmt', description: 'Administración de Windows' },
      { name: 'EventLog', description: 'Registro de eventos de Windows' },
      { name: 'PcaSvc', description: 'Compatibilidad de programas' },
      { name: 'AppInfo', description: 'Información de aplicaciones' },
      { name: 'DiagTrack', description: 'Experiencia y telemetría conectada' },
      { name: 'DPS', description: 'Servicio de directivas de diagnóstico' },
      { name: 'Sense', description: 'Servicio Windows Defender Advanced Threat Protection' },
      { name: 'WdFilter', description: 'Mini-filtro antimalware de Windows Defender' },
      { name: 'WdNisSvc', description: 'Servicio de inspección de red de Windows Defender' },
      { name: 'WinDefend', description: 'Antivirus de Windows Defender' },
      { name: 'SecurityHealthService', description: 'Servicio de seguridad de Windows' },
      { name: 'WerSvc', description: 'Informes de error de Windows' }
    ];
    
    if (process.platform === 'win32') {
      // En Windows, verificar estado de servicios
      try {
        const { stdout } = await execAsync('powershell -Command "& { Get-Service | Select-Object Name, DisplayName, Status, StartType | ConvertTo-Csv -NoTypeInformation }"');
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '' && !line.includes('Name,DisplayName'));
        
        for (const line of lines) {
          try {
            const match = line.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
            if (match) {
              const name = match[1];
              const displayName = match[2];
              const status = match[3];
              const startType = match[4];
              
              // Verificar si este servicio está en nuestra lista de monitoreo
              const monitorService = monitorServices.find(s => s.name.toLowerCase() === name.toLowerCase());
              
              if (monitorService) {
                if (status.toLowerCase() === 'stopped') {
                  result.stoppedServices.push({
                    name,
                    displayName,
                    description: monitorService.description,
                    status,
                    startType
                  });
                }
                
                if (startType.toLowerCase() === 'disabled') {
                  result.disabledServices.push({
                    name,
                    displayName,
                    description: monitorService.description,
                    status,
                    startType
                  });
                }
              }
            }
          } catch (error) {
            // Ignorar errores en líneas individuales
          }
        }
        
        // Verificar si se han modificado servicios de antivirus o seguridad
        try {
          const { stdout: securityOutput } = await execAsync('powershell -Command "& { Get-ItemProperty HKLM:\\SYSTEM\\CurrentControlSet\\Services\\*Defender* | Select-Object PSPath, Start | ConvertTo-Csv -NoTypeInformation }"');
          
          const securityLines = securityOutput.split('\n').filter(line => line.trim() !== '' && !line.includes('PSPath'));
          
          for (const line of securityLines) {
            const match = line.match(/"([^"]+)","([^"]+)"/);
            if (match) {
              const servicePath = match[1];
              const startValue = match[2];
              
              // Si el valor de inicio es 4, el servicio está deshabilitado
              if (startValue === '4') {
                const serviceName = servicePath.split('\\').pop();
                
                result.modifiedServices.push({
                  name: serviceName,
                  path: servicePath,
                  modification: 'Servicio de seguridad deshabilitado',
                  value: startValue
                });
              }
            }
          }
        } catch (error) {
          console.error('Error verificando modificaciones de servicios:', error);
        }
      } catch (error) {
        console.error('Error verificando servicios en Windows:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, verificar servicios
      try {
        const { stdout } = await execAsync('launchctl list');
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        const securityServices = lines.filter(line => 
          line.includes('com.apple.security') || 
          line.includes('com.apple.ProtectedService') ||
          line.includes('firewall') ||
          line.includes('antivirus')
        );
        
        if (securityServices.length > 0) {
          for (const serviceLine of securityServices) {
            const parts = serviceLine.trim().split(/\s+/);
            const status = parts[0];
            const name = parts[parts.length - 1];
            
            if (status.includes('-')) {
              result.stoppedServices.push({
                name,
                displayName: name,
                description: 'Servicio de seguridad de macOS',
                status: 'Stopped'
              });
            }
          }
        }
      } catch (error) {
        console.error('Error verificando servicios en macOS:', error);
      }
    } else {
      // En Linux, verificar servicios
      try {
        const { stdout } = await execAsync('systemctl list-units --type=service --state=inactive');
        
        const lines = stdout.split('\n').filter(line => 
          line.includes('security') || 
          line.includes('firewall') || 
          line.includes('audit') ||
          line.includes('apparmor') ||
          line.includes('selinux')
        );
        
        if (lines.length > 0) {
          for (const serviceLine of lines) {
            const name = serviceLine.trim().split(/\s+/)[0];
            
            result.stoppedServices.push({
              name,
              displayName: name,
              description: 'Servicio de seguridad de Linux',
              status: 'Inactive'
            });
          }
        }
      } catch (error) {
        console.error('Error verificando servicios en Linux:', error);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en detectStoppedServices:', error);
    throw error;
  }
}

/**
 * Obtiene historial de carpetas visitadas recientemente
 */
async function getFolderHistory() {
  try {
    const result = [];
    
    if (process.platform === 'win32') {
      // En Windows, buscar en los jumplist y Quick Access
      try {
        const homeDir = os.homedir();
        const quickAccessPath = path.join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Recent');
        
        if (fs.existsSync(quickAccessPath)) {
          const items = await fs.promises.readdir(quickAccessPath, { withFileTypes: true });
          
          for (const item of items) {
            try {
              if (item.isFile() && item.name.endsWith('.lnk')) {
                const fullPath = path.join(quickAccessPath, item.name);
                const stats = await fs.promises.stat(fullPath);
                
                // Obtener el destino del acceso directo usando PowerShell
                const command = `powershell -Command "& {
                  $shell = New-Object -ComObject WScript.Shell;
                  $shortcut = $shell.CreateShortcut('${fullPath.replace(/\\/g, '\\\\')}');
                  Write-Output $shortcut.TargetPath;
                }"`;
                
                const { stdout } = await execAsync(command);
                const targetPath = stdout.trim();
                
                if (targetPath && fs.existsSync(targetPath)) {
                  try {
                    const targetStats = await fs.promises.stat(targetPath);
                    
                    // Solo incluir directorios
                    if (targetStats.isDirectory()) {
                      result.push({
                        path: targetPath,
                        name: path.basename(targetPath),
                        accessTime: stats.mtime.toLocaleString(),
                        source: 'Acceso rápido'
                      });
                    }
                  } catch (error) {
                    // Ignorar errores al acceder al destino
                  }
                }
              }
            } catch (error) {
              // Ignorar errores individuales
            }
          }
        }
        
        // También verificar el historial de Explorer
        const explorerHistoryPath = path.join(homeDir, 'AppData', 'Local', 'Microsoft', 'Windows', 'Explorer');
        if (fs.existsSync(explorerHistoryPath)) {
          const command = `powershell -Command "& {
            $recentItems = (New-Object -ComObject Shell.Application).NameSpace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}').Items();
            foreach ($item in $recentItems) {
              if ($item.IsFolder -eq $true) {
                [PSCustomObject]@{
                  Name = $item.Name;
                  Path = $item.Path;
                  LastAccess = $item.ExtendedProperty('System.DateAccessed');
                }
              }
            }
          } | ConvertTo-Json"`;
          
          try {
            const { stdout } = await execAsync(command);
            
            if (stdout.trim()) {
              try {
                let explorerItems = JSON.parse(stdout);
                // Asegurar que sea un array
                if (!Array.isArray(explorerItems)) {
                  explorerItems = [explorerItems];
                }
                
                for (const item of explorerItems) {
                  result.push({
                    path: item.Path,
                    name: item.Name,
                    accessTime: item.LastAccess || 'Desconocido',
                    source: 'Historial de Explorer'
                  });
                }
              } catch (error) {
                console.error('Error parseando historial de Explorer:', error);
              }
            }
          } catch (error) {
            console.error('Error obteniendo historial de Explorer:', error);
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de carpetas en Windows:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, verificar archivos .DS_Store recientes
      try {
        const homeDir = os.homedir();
        const command = `find "${homeDir}" -name ".DS_Store" -type f -mtime -7 -print0 | xargs -0 -I {} dirname {}`;
        
        const { stdout } = await execAsync(command);
        
        const folders = stdout.split('\n').filter(folder => folder.trim() !== '');
        
        for (const folder of folders) {
          try {
            const stats = await fs.promises.stat(folder);
            
            result.push({
              path: folder,
              name: path.basename(folder),
              accessTime: stats.mtime.toLocaleString(),
              source: 'DS_Store reciente'
            });
          } catch (error) {
            // Ignorar errores individuales
          }
        }
        
        // También verificar historial reciente del Finder
        const finderPlist = path.join(homeDir, 'Library', 'Preferences', 'com.apple.finder.plist');
        if (fs.existsSync(finderPlist)) {
          const command = `plutil -convert xml1 -o - "${finderPlist}" | grep -A1 "<key>FXRecentFolders</key>"`;
          
          try {
            const { stdout } = await execAsync(command);
            
            if (stdout.includes('FXRecentFolders')) {
              // Extraer rutas de carpetas recientes (simplificado)
              const folderMatches = stdout.match(/<string>file:\/\/([^<]+)<\/string>/g);
              
              if (folderMatches) {
                for (const folderMatch of folderMatches) {
                  const match = folderMatch.match(/<string>file:\/\/([^<]+)<\/string>/);
                  if (match) {
                    const folderPath = decodeURIComponent(match[1]);
                    
                    result.push({
                      path: folderPath,
                      name: path.basename(folderPath),
                      accessTime: 'Reciente',
                      source: 'Historial del Finder'
                    });
                  }
                }
              }
            }
          } catch (error) {
            // Ignorar errores
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de carpetas en macOS:', error);
      }
    } else {
      // En Linux, verificar archivos recientes
      try {
        const homeDir = os.homedir();
        const recentFilesPath = path.join(homeDir, '.local', 'share', 'recently-used.xbel');
        
        if (fs.existsSync(recentFilesPath)) {
          const content = await fs.promises.readFile(recentFilesPath, 'utf8');
          
          // Extraer rutas de carpetas del archivo XML
          const folderMatches = content.match(/<bookmark href="file:\/\/([^"]+)"/g);
          
          if (folderMatches) {
            for (const folderMatch of folderMatches) {
              const match = folderMatch.match(/<bookmark href="file:\/\/([^"]+)"/);
              if (match) {
                const itemPath = decodeURIComponent(match[1]);
                
                try {
                  const stats = await fs.promises.stat(itemPath);
                  
                  if (stats.isDirectory()) {
                    // Buscar la fecha de acceso en el XML
                    const bookmarkSection = content.split('<bookmark').find(section => section.includes(itemPath));
                    let accessTime = 'Desconocido';
                    
                    if (bookmarkSection) {
                      const timeMatch = bookmarkSection.match(/<modified>([^<]+)<\/modified>/);
                      if (timeMatch) {
                        accessTime = new Date(timeMatch[1]).toLocaleString();
                      }
                    }
                    
                    result.push({
                      path: itemPath,
                      name: path.basename(itemPath),
                      accessTime,
                      source: 'Archivos recientes'
                    });
                  }
                } catch (error) {
                  // Ignorar errores individuales
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de carpetas en Linux:', error);
      }
    }
    
    // Ordenar por fecha de acceso, más reciente primero
    result.sort((a, b) => {
      const dateA = new Date(a.accessTime);
      const dateB = new Date(b.accessTime);
      
      // Si las fechas son válidas, ordenar por fecha
      if (!isNaN(dateA) && !isNaN(dateB)) {
        return dateB - dateA;
      }
      
      // Si no son fechas válidas, mantener el orden original
      return 0;
    });
    
    return result;
  } catch (error) {
    console.error('Error en getFolderHistory:', error);
    throw error;
  }
}

/**
 * Obtiene historial completo de ejecuciones
 */
async function getCompleteExecutionHistory(hours = 4) {
  try {
    const result = [];
    const now = Date.now();
    const timeThreshold = now - (hours * 60 * 60 * 1000);
    
    if (process.platform === 'win32') {
      // En Windows, obtener historial de prefetch
      try {
        const prefetchDir = 'C:\\Windows\\Prefetch';
        if (fs.existsSync(prefetchDir)) {
          const items = await fs.promises.readdir(prefetchDir, { withFileTypes: true });
          
          for (const item of items) {
            try {
              if (item.isFile() && item.name.endsWith('.pf')) {
                const fullPath = path.join(prefetchDir, item.name);
                const stats = await fs.promises.stat(fullPath);
                
                if (stats.mtime.getTime() >= timeThreshold) {
                  // Extraer nombre del programa del archivo prefetch
                  let programName = item.name.replace(/-[^-]+\.pf$/i, '');
                  
                  result.push({
                    name: programName,
                    path: fullPath,
                    startTime: stats.mtime.toLocaleString(),
                    source: 'Prefetch'
                  });
                }
              }
            } catch (error) {
              // Ignorar errores individuales
            }
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de prefetch:', error);
      }
      
      // Obtener ejecuciones recientes desde el registro
      try {
        const command = `powershell -Command "& {
          # UserAssist (programas ejecutados)
          try {
            $userAssist = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\*\\Count\\*' -ErrorAction SilentlyContinue;
            $results = @();
            foreach ($entry in $userAssist.PSObject.Properties) {
              if ($entry.Name -notlike 'PS*') {
                try {
                  # Decodificar el nombre (ROT13)
                  $encoded = $entry.Name;
                  $decoded = '';
                  for ($i = 0; $i -lt $encoded.Length; $i++) {
                    $c = $encoded[$i];
                    if ($c -ge 'a' -and $c -le 'z') {
                      $c = [char](($c - 'a' + 13) % 26 + [int][char]'a');
                    } elseif ($c -ge 'A' -and $c -le 'Z') {
                      $c = [char](($c - 'A' + 13) % 26 + [int][char]'A');
                    }
                    $decoded += $c;
                  }
                  
                  # Extraer ruta del programa si es posible
                  $programPath = '';
                  if ($decoded -match '([A-Z]:\\\\[^\\n]+\\.exe)') {
                    $programPath = $matches[1];
                  }
                  
                  # Obtener la última vez de ejecución
                  $value = $entry.Value;
                  $lastExecuted = 'Desconocido';
                  if ($value -is [byte[]]) {
                    # En algunos casos, el valor es un array de bytes con un timestamp
                    if ($value.Length -ge 60) {
                      # El timestamp suele estar en la posición 60
                      $timestamp = [BitConverter]::ToInt64($value, 60);
                      if ($timestamp -gt 0) {
                        $lastExecuted = [DateTime]::FromFileTime($timestamp);
                      }
                    }
                  }
                  
                  if ($decoded -notmatch 'UEME_') {
                    $results += [PSCustomObject]@{
                      Name = $decoded;
                      Path = $programPath;
                      LastExecuted = $lastExecuted;
                      Source = 'UserAssist';
                    }
                  }
                } catch {
                  # Ignorar errores individuales
                }
              }
            }
            $results | Where-Object { $_.LastExecuted -ne 'Desconocido' } | Sort-Object -Property LastExecuted -Descending;
          } catch {
            # Ignorar errores
          }
          
          # OpenSaveMRU (archivos abiertos)
          try {
            $openSavePath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\OpenSavePidlMRU';
            if (Test-Path $openSavePath) {
              Get-ChildItem $openSavePath | ForEach-Object {
                $extension = $_.PSChildName;
                Get-ItemProperty $_.PSPath | ForEach-Object {
                  $_.PSObject.Properties | Where-Object { $_.Name -match '^[0-9]+$' } | ForEach-Object {
                    try {
                      $shell = New-Object -ComObject Shell.Application;
                      $folder = $shell.NameSpace(0x0);
                      $fileName = '';
                      
                      # Intentar obtener el nombre del archivo a partir de los datos binarios
                      if ($_.Value -is [byte[]]) {
                        $hexString = [System.BitConverter]::ToString($_.Value) -replace '-', '';
                        if ($hexString -match '([0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F])00') {
                          $fileName = $matches[1];
                        }
                      }
                      
                      [PSCustomObject]@{
                        Extension = $extension;
                        FileName = $fileName;
                        LastUsed = (Get-Item $_.PSPath).LastWriteTime;
                        Source = 'OpenSaveMRU';
                      }
                    } catch {
                      # Ignorar errores individuales
                    }
                  }
                }
              }
            }
          } catch {
            # Ignorar errores
          }
          
          # AppCompatFlags (compatibilidad de programas)
          try {
            $compatFlags = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store' -ErrorAction SilentlyContinue;
            if ($compatFlags) {
              $compatFlags.PSObject.Properties | Where-Object { $_.Name -like '*.*' } | ForEach-Object {
                [PSCustomObject]@{
                  Path = $_.Name;
                  LastExecuted = (Get-Item $_.PSPath).LastWriteTime;
                  Source = 'AppCompatFlags';
                }
              }
            }
          } catch {
            # Ignorar errores
          }
        } | ConvertTo-Json -Depth 3"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          try {
            let executionHistory = JSON.parse(stdout);
            // Asegurar que sea un array
            if (!Array.isArray(executionHistory)) {
              executionHistory = [executionHistory];
            }
            
            for (const entry of executionHistory) {
              if (entry) {
                let startTime;
                if (entry.LastExecuted && entry.LastExecuted !== 'Desconocido') {
                  startTime = new Date(entry.LastExecuted);
                } else if (entry.LastUsed) {
                  startTime = new Date(entry.LastUsed);
                } else {
                  startTime = new Date();
                }
                
                // Solo incluir si está dentro del rango de tiempo
                if (startTime.getTime() >= timeThreshold) {
                  let name = entry.Name || entry.FileName || path.basename(entry.Path || '');
                  
                  if (!name && entry.Extension) {
                    name = `Archivo con extensión ${entry.Extension}`;
                  }
                  
                  result.push({
                    name,
                    path: entry.Path || '',
                    startTime: startTime.toLocaleString(),
                    source: entry.Source || 'Registro de Windows'
                  });
                }
              }
            }
          } catch (error) {
            console.error('Error parseando historial de ejecución:', error);
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial desde el registro:', error);
      }
      
      // Historial desde el Administrador de tareas (Event Log)
      try {
        const { stdout } = await execAsync(`powershell -Command "& {
          Get-WinEvent -FilterHashtable @{
            LogName='Application';
            Id=500;
            StartTime=[datetime]::Now.AddHours(-${hours})
          } -MaxEvents 100 -ErrorAction SilentlyContinue |
          Select-Object TimeCreated, Message |
          ForEach-Object {
            if ($_.Message -match 'Proceso nuevo creado|New process created') {
              $processInfo = $_.Message -replace '\\r\\n', ' ' -replace '\\s+', ' ';
              $processName = if ($processInfo -match 'Nombre de aplicación: ([^,]+)') { $matches[1] } else { 'Desconocido' };
              
              [PSCustomObject]@{
                Name = $processName;
                Time = $_.TimeCreated;
                Source = 'Event Log';
              }
            }
          } | ConvertTo-Json
        }"`);
        
        if (stdout.trim()) {
          try {
            let eventLogEntries = JSON.parse(stdout);
            // Asegurar que sea un array
            if (!Array.isArray(eventLogEntries)) {
              eventLogEntries = [eventLogEntries];
            }
            
            for (const entry of eventLogEntries) {
              if (entry) {
                result.push({
                  name: entry.Name,
                  startTime: new Date(entry.Time).toLocaleString(),
                  source: entry.Source
                });
              }
            }
          } catch (error) {
            console.error('Error parseando eventos del registro:', error);
          }
        }
      } catch (error) {
        console.error('Error obteniendo eventos del registro:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, verificar historial de ejecuciones
      try {
        // Obtener historial reciente desde ~/Library/Application Support/com.apple.sharedfilelist/
        const homeDir = os.homedir();
        const recentItemsPath = path.join(homeDir, 'Library', 'Application Support', 'com.apple.sharedfilelist', 'com.apple.LSSharedFileList.RecentApplications');
        
        if (fs.existsSync(recentItemsPath)) {
          const command = `plutil -convert xml1 -o - "${recentItemsPath}" | grep -A2 "<key>Bookmark</key>"`;
          
          try {
            const { stdout } = await execAsync(command);
            
            // Extraer información de aplicaciones recientes (simplificado)
            const sectionMatches = stdout.split('<key>Bookmark</key>');
            
            for (const section of sectionMatches) {
              if (section.includes('<data>')) {
                const nameMatch = section.match(/<string>([^<]+)<\/string>/);
                if (nameMatch) {
                  const appName = nameMatch[1];
                  
                  result.push({
                    name: appName,
                    startTime: 'Reciente',
                    source: 'macOS Recent Applications'
                  });
                }
              }
            }
          } catch (error) {
            // Ignorar errores
          }
        }
        
        // También verificar los logs del sistema
        const { stdout } = await execAsync(`log show --predicate 'process == "launchd"' --style compact --last ${hours}h | grep 'launched'`);
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          // Extraer información de proceso lanzado
          const timeMatch = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
          const processMatch = line.match(/launched '([^']+)'/);
          
          if (timeMatch && processMatch) {
            const time = timeMatch[1];
            const processName = processMatch[1];
            
            result.push({
              name: processName,
              startTime: new Date(time).toLocaleString(),
              source: 'launchd log'
            });
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de ejecuciones en macOS:', error);
      }
    } else {
      // En Linux, verificar historial de ejecuciones
      try {
        const homeDir = os.homedir();
        
        // Verificar historial de bash
        const bashHistoryPath = path.join(homeDir, '.bash_history');
        if (fs.existsSync(bashHistoryPath)) {
          const bashHistory = await fs.promises.readFile(bashHistoryPath, 'utf8');
          
          const lines = bashHistory.split('\n').filter(line => line.trim() !== '');
          
          // Extraer comandos que inician programas
          const programLines = lines.filter(line => 
            !line.startsWith('cd ') && 
            !line.startsWith('ls ') && 
            !line.startsWith('cat ') && 
            !line.startsWith('echo ') && 
            !line.startsWith('grep ') && 
            !line.startsWith('rm ') && 
            !line.startsWith('mv ')
          );
          
          // Obtener la fecha de modificación del archivo de historial
          const stats = await fs.promises.stat(bashHistoryPath);
          
          for (const command of programLines.slice(-50)) {  // Tomar los últimos 50 comandos
            // Extraer el nombre del programa
            const programName = command.split(' ')[0];
            
            result.push({
              name: programName,
              command: command,
              startTime: stats.mtime.toLocaleString(),
              source: 'bash_history'
            });
          }
        }
        
        // Verificar historial de zsh
        const zshHistoryPath = path.join(homeDir, '.zsh_history');
        if (fs.existsSync(zshHistoryPath)) {
          const zshHistory = await fs.promises.readFile(zshHistoryPath, 'utf8');
          
          const lines = zshHistory.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines.slice(-50)) {  // Tomar los últimos 50 comandos
            // Extraer el comando y posiblemente la fecha
            const timeMatch = line.match(/:\s+(\d+):/);
            let timeStamp;
            let command = line;
            
            if (timeMatch) {
              timeStamp = parseInt(timeMatch[1]) * 1000;  // Convertir a milisegundos
              command = line.split(';')[1] || line;
            }
            
            // Filtrar comandos comunes que no son relevantes
            if (!command.startsWith('cd ') && 
                !command.startsWith('ls ') && 
                !command.startsWith('cat ')) {
              
              const programName = command.split(' ')[0];
              
              result.push({
                name: programName,
                command: command,
                startTime: timeStamp ? new Date(timeStamp).toLocaleString() : 'Reciente',
                source: 'zsh_history'
              });
            }
          }
        }
        
        // Verificar journalctl para servicios iniciados
        try {
          const { stdout } = await execAsync(`journalctl --since "${hours} hours ago" | grep -i "started" | grep -v "systemd"`);
          
          const lines = stdout.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            const timeMatch = line.match(/(\w+\s+\d+\s+\d+:\d+:\d+)/);
            const serviceMatch = line.match(/Starting\s+([^\.]+)/i) || line.match(/Started\s+([^\.]+)/i);
            
            if (timeMatch && serviceMatch) {
              const timeStr = timeMatch[1];
              const serviceName = serviceMatch[1].trim();
              
              // Añadir el año actual para obtener una fecha completa
              const currentYear = new Date().getFullYear();
              const fullTimeStr = `${timeStr} ${currentYear}`;
              
              result.push({
                name: serviceName,
                startTime: new Date(fullTimeStr).toLocaleString(),
                source: 'journalctl'
              });
            }
          }
        } catch (error) {
          // Ignorar errores
        }
        
        // Verificar registros X11
        const xorgLogPath = '/var/log/Xorg.0.log';
        if (fs.existsSync(xorgLogPath)) {
          try {
            const { stdout } = await execAsync(`grep -i "client connected" ${xorgLogPath} | tail -n 50`);
            
            const lines = stdout.split('\n').filter(line => line.trim() !== '');
            
            for (const line of lines) {
              const clientMatch = line.match(/client connected: ([^\(]+)/i);
              
              if (clientMatch) {
                const clientName = clientMatch[1].trim();
                
                result.push({
                  name: clientName,
                  startTime: 'Sesión actual',
                  source: 'Xorg.log'
                });
              }
            }
          } catch (error) {
            // Ignorar errores
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de ejecuciones en Linux:', error);
      }
    }
    
    // Ordenar por fecha de inicio, más reciente primero
    result.sort((a, b) => {
      const dateA = a.startTime ? new Date(a.startTime) : new Date(0);
      const dateB = b.startTime ? new Date(b.startTime) : new Date(0);
      
      // Si alguna de las fechas no es válida, usamos orden lexicográfico
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
        return String(b.startTime).localeCompare(String(a.startTime));
      }
      
      return dateB.getTime() - dateA.getTime();
    });
    
    // Eliminar duplicados basados en el nombre
    const uniqueResults = [];
    const seenNames = new Set();
    
    for (const item of result) {
      const normalizedName = item.name.toLowerCase();
      if (!seenNames.has(normalizedName)) {
        seenNames.add(normalizedName);
        uniqueResults.push(item);
      }
    }
    
    return uniqueResults;
  } catch (error) {
    console.error('Error en getCompleteExecutionHistory:', error);
    throw error;
  }
}

/**
 * Abre los archivos de Minecraft para análisis
 */
async function openMinecraftFiles() {
  try {
    const result = {
      opened: false,
      files: []
    };
    
    const homeDir = os.homedir();
    const minecraftPaths = [
      path.join(homeDir, 'AppData', 'Roaming', '.minecraft'),  // Windows
      path.join(homeDir, '.minecraft'),                         // Linux
      path.join(homeDir, 'Library', 'Application Support', 'minecraft')  // macOS
    ];
    
    let minecraftFolder = null;
    
    for (const mcPath of minecraftPaths) {
      if (fs.existsSync(mcPath)) {
        minecraftFolder = mcPath;
        break;
      }
    }
    
    if (!minecraftFolder) {
      return {
        opened: false,
        error: 'No se encontró la carpeta de Minecraft'
      };
    }
    
    // Abrir la carpeta de Minecraft
    await shell.openPath(minecraftFolder);
    result.opened = true;
    
    // Analizar la carpeta para obtener información relevante
    const stats = await fs.promises.stat(minecraftFolder);
    
    // Añadir la carpeta principal
    result.files.push({
      name: path.basename(minecraftFolder),
      path: minecraftFolder,
      type: 'Carpeta principal',
      lastModified: stats.mtime.getTime(),
      isDirectory: true
    });
    
    // Buscar carpetas clave dentro de Minecraft
    const keyCatalogs = [
      { name: 'mods', type: 'Carpeta de mods' },
      { name: 'versions', type: 'Carpeta de versiones' },
      { name: 'logs', type: 'Carpeta de logs' },
      { name: 'config', type: 'Carpeta de configuración' },
      { name: 'saves', type: 'Carpeta de mundos' },
      { name: 'screenshots', type: 'Carpeta de capturas' }
    ];
    
    for (const catalog of keyCatalogs) {
      const catalogPath = path.join(minecraftFolder, catalog.name);
      
      if (fs.existsSync(catalogPath)) {
        const catalogStats = await fs.promises.stat(catalogPath);
        
        result.files.push({
          name: catalog.name,
          path: catalogPath,
          type: catalog.type,
          lastModified: catalogStats.mtime.getTime(),
          isDirectory: true
        });
        
        // Si es la carpeta de mods, analizar mods instalados
        if (catalog.name === 'mods' && catalogStats.isDirectory()) {
          try {
            const modFiles = await fs.promises.readdir(catalogPath);
            
            // Crear un objeto específico para la lista de mods
            const modsList = {
              name: 'Lista de mods instalados',
              path: catalogPath,
              type: 'Lista de Mods',
              files: []
            };
            
            for (const modFile of modFiles) {
              if (modFile.endsWith('.jar') || modFile.endsWith('.zip')) {
                const modPath = path.join(catalogPath, modFile);
                const modStats = await fs.promises.stat(modPath);
                
                modsList.files.push({
                  name: modFile,
                  path: modPath,
                  lastModified: modStats.mtime.getTime(),
                  size: modStats.size
                });
              }
            }
            
            // Ordenar mods por fecha de modificación, más reciente primero
            modsList.files.sort((a, b) => b.lastModified - a.lastModified);
            
            result.files.push(modsList);
          } catch (error) {
            console.error('Error analizando mods:', error);
          }
        }
        
        // Si es la carpeta de logs, analizar el último log
        if (catalog.name === 'logs' && catalogStats.isDirectory()) {
          try {
            const logFiles = await fs.promises.readdir(catalogPath);
            
            // Buscar el archivo latest.log
            const latestLogPath = path.join(catalogPath, 'latest.log');
            
            if (fs.existsSync(latestLogPath)) {
              const logStats = await fs.promises.stat(latestLogPath);
              
              // Leer el archivo de log y extraer líneas relevantes
              const logContent = await fs.promises.readFile(latestLogPath, 'utf8');
              const logLines = logContent.split('\n');
              
              // Buscar líneas que indiquen carga de mods, errores o warnings
              const relevantLines = logLines.filter(line => 
                line.includes('ERROR') || 
                line.includes('WARN') || 
                line.includes('Exception') || 
                line.includes('Loaded mod') || 
                line.includes('Forge') || 
                line.includes('Fabric') ||
                line.includes('initializing')
              );
              
              // Limitar a las 100 líneas más relevantes para no sobrecargar la UI
              const limitedLines = relevantLines.slice(0, 100);
              
              result.files.push({
                name: 'latest.log',
                path: latestLogPath,
                type: 'Contenido de Log',
                lastModified: logStats.mtime.getTime(),
                size: logStats.size,
                lines: limitedLines
              });
            }
          } catch (error) {
            console.error('Error analizando logs:', error);
          }
        }
      }
    }
    
    // Buscar archivos de configuración importantes
    const keyConfigFiles = [
      { name: 'options.txt', type: 'Archivo de opciones' },
      { name: 'launcher_profiles.json', type: 'Perfiles del launcher' },
      { name: 'launcher_accounts.json', type: 'Cuentas del launcher' }
    ];
    
    for (const configFile of keyConfigFiles) {
      const filePath = path.join(minecraftFolder, configFile.name);
      
      if (fs.existsSync(filePath)) {
        const fileStats = await fs.promises.stat(filePath);
        
        result.files.push({
          name: configFile.name,
          path: filePath,
          type: configFile.type,
          lastModified: fileStats.mtime.getTime(),
          size: fileStats.size,
          isDirectory: false
        });
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en openMinecraftFiles:', error);
    throw error;
  }
}

/**
 * Abre la ubicación de un archivo en el explorador
 */
async function openFileLocation(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`La ruta no existe: ${filePath}`);
    }
    
    // Si es un archivo, abrir la carpeta contenedora y seleccionar el archivo
    const stats = await fs.promises.stat(filePath);
    
    if (stats.isFile()) {
      if (process.platform === 'win32') {
        // En Windows, podemos seleccionar el archivo en el explorador
        await execAsync(`explorer.exe /select,"${filePath}"`);
      } else {
        // En otros sistemas, simplemente abrimos la carpeta contenedora
        const dirPath = path.dirname(filePath);
        await shell.openPath(dirPath);
      }
    } else {
      // Si es un directorio, abrirlo directamente
      await shell.openPath(filePath);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error en openFileLocation:', error);
    throw error;
  }
}

/**
 * Obtiene el historial de comandos de terminal
 */
async function getCommandHistory() {
  try {
    const result = [];
    
    if (process.platform === 'win32') {
      // En Windows, obtener historial de PowerShell y CMD
      
      // Historial de PowerShell
      try {
        const psHistoryPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'PowerShell', 'PSReadline', 'ConsoleHost_history.txt');
        
        if (fs.existsSync(psHistoryPath)) {
          const psHistory = await fs.promises.readFile(psHistoryPath, 'utf8');
          
          const lines = psHistory.split('\n').filter(line => line.trim() !== '');
          
          // Obtener los últimos 50 comandos
          const recentCommands = lines.slice(-50);
          
          // Obtener la fecha de modificación del archivo de historial
          const stats = await fs.promises.stat(psHistoryPath);
          const modTime = stats.mtime.getTime();
          
          for (const command of recentCommands) {
            result.push({
              source: 'PowerShell',
              command,
              timestamp: modTime
            });
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de PowerShell:', error);
      }
      
      // Historial de CMD usando doskey
      try {
        // Crear un archivo temporal para guardar el historial
        const tempHistoryPath = path.join(os.tmpdir(), `cmd_history_${Date.now()}.txt`);
        
        // Ejecutar doskey /history y guardar en el archivo temporal
        await execAsync(`cmd.exe /c doskey /history > "${tempHistoryPath}"`);
        
        if (fs.existsSync(tempHistoryPath)) {
          const cmdHistory = await fs.promises.readFile(tempHistoryPath, 'utf8');
          
          // Eliminar el archivo temporal
          fs.unlink(tempHistoryPath, () => {});
          
          const lines = cmdHistory.split('\n').filter(line => line.trim() !== '');
          
          for (const command of lines) {
            result.push({
              source: 'CMD',
              command,
              timestamp: Date.now()
            });
          }
        }
      } catch (error) {
        console.error('Error obteniendo historial de CMD:', error);
      }
      
      // También verificar historial de comandos en el Registro de Windows
      try {
        const command = `powershell -Command "& {
          $commands = @();
          
          # Buscar en AppCompatFlags para comandos recientes
          $compatFlags = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU' -ErrorAction SilentlyContinue;
          if ($compatFlags) {
            $compatFlags.PSObject.Properties | Where-Object { $_.Name -match '^[a-z]$' } | ForEach-Object {
              $commands += [PSCustomObject]@{
                Command = $_.Value -replace '\\\\1$', '';
                Source = 'RunMRU';
                Time = (Get-Item $_.PSPath).LastWriteTime;
              }
            }
          }
          
          # Comandos ejecutados desde la barra de búsqueda/ejecución
          $searchHistory = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\WordWheelQuery' -ErrorAction SilentlyContinue;
          if ($searchHistory -and $searchHistory.MRUListEx) {
            $searchHistory.PSObject.Properties | Where-Object { $_.Name -match '^[0-9]+$' } | ForEach-Object {
              if ($_.Value -is [byte[]]) {
                try {
                  $text = [System.Text.Encoding]::Unicode.GetString($_.Value).Trim('\\u0000');
                  if ($text) {
                    $commands += [PSCustomObject]@{
                      Command = $text;
                      Source = 'Búsqueda';
                      Time = (Get-Item $_.PSPath).LastWriteTime;
                    }
                  }
                } catch {}
              }
            }
          }
          
          $commands | ConvertTo-Json;
        }"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          try {
            let registryCommands = JSON.parse(stdout);
            // Asegurar que sea un array
            if (!Array.isArray(registryCommands)) {
              registryCommands = [registryCommands];
            }
            
            for (const entry of registryCommands) {
              if (entry && entry.Command) {
                result.push({
                  source: entry.Source,
                  command: entry.Command,
                  timestamp: new Date(entry.Time).getTime()
                });
              }
            }
          } catch (error) {
            console.error('Error parseando comandos del registro:', error);
          }
        }
      } catch (error) {
        console.error('Error obteniendo comandos del registro:', error);
      }
    } else {
      // En Unix-like (macOS/Linux)
      const homeDir = os.homedir();
      
      // Array de posibles archivos de historial
      const historyFiles = [
        { path: path.join(homeDir, '.bash_history'), source: 'Bash' },
        { path: path.join(homeDir, '.zsh_history'), source: 'Zsh' },
        { path: path.join(homeDir, '.sh_history'), source: 'Shell' },
        { path: path.join(homeDir, '.history'), source: 'Shell' },
        { path: path.join(homeDir, '.local', 'share', 'fish', 'fish_history'), source: 'Fish' }
      ];
      
      for (const historyFile of historyFiles) {
        if (fs.existsSync(historyFile.path)) {
          try {
            const content = await fs.promises.readFile(historyFile.path, 'utf8');
            const stats = await fs.promises.stat(historyFile.path);
            const lines = content.split('\n').filter(line => line.trim() !== '');
            
            // Obtener los últimos 50 comandos
            const recentCommands = lines.slice(-50);
            
            for (const line of recentCommands) {
              // Limpiar el comando (algunas shells incluyen timestamps o metadatos)
              let command = line;
              let timestamp = stats.mtime.getTime();
              
              // En zsh, los comandos pueden tener timestamp en formato ': 1234567890:0;comando'
              if (historyFile.source === 'Zsh' && line.match(/^:\s*\d+:\d+;/)) {
                const match = line.match(/^:\s*(\d+):\d+;(.+)$/);
                if (match) {
                  timestamp = parseInt(match[1]) * 1000;  // Convertir a milisegundos
                  command = match[2];
                }
              }
              
              result.push({
                source: historyFile.source,
                command,
                timestamp
              });
            }
          } catch (error) {
            console.error(`Error leyendo archivo de historial ${historyFile.path}:`, error);
          }
        }
      }
    }
    
    // Ordenar por timestamp, más reciente primero
    result.sort((a, b) => b.timestamp - a.timestamp);
    
    // Convertir timestamps a fechas legibles
    for (const entry of result) {
      entry.timestamp = new Date(entry.timestamp).toLocaleString();
    }
    
    return result;
  } catch (error) {
    console.error('Error en getCommandHistory:', error);
    throw error;
  }
}

/**
 * Función para el auto-eliminado del programa cuando se cierre
 */
function registerSelfDestruct() {
  const appPath = app.getPath('exe');
  const tempBatPath = path.join(os.tmpdir(), `delete_${Date.now()}.bat`);
  
  // Crear un script BAT que esperará hasta que el proceso termine y luego eliminará el archivo
  const batContent = `
@echo off
:check
tasklist /FI "IMAGENAME eq ${path.basename(appPath)}" | find /I "${path.basename(appPath)}" > nul
if not errorlevel 1 (
  timeout /t 1 > nul
  goto check
)
del /F /Q "${appPath}"
del /F /Q "%~f0"
`;
  
  fs.writeFileSync(tempBatPath, batContent);
  
  // Ejecutar el script BAT en una nueva ventana oculta
  const startInfo = {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  };
  
  const childProcess = require('child_process').spawn('cmd', ['/c', tempBatPath], startInfo);
  childProcess.unref();
}

// Analiza procesos en busca de programas sospechosos
async function analyzeProcesses() {
  try {
    const result = {
      suspiciousProcesses: [],
      injections: [],
      hiddenProcesses: []
    };
    
    // Lista de nombres de procesos potencialmente sospechosos
    const suspiciousKeywords = [
      'cheat', 'hack', 'inject', 'memory', 'dll', 'mod', 
      'trainer', 'autoclicker', 'macro', 'bypass', 'spoof'
    ];
    
    if (process.platform === 'win32') {
      // En Windows, usar métodos avanzados para detectar procesos
      try {
        // Usar PowerShell para obtener información detallada de procesos
        const command = `powershell -Command "& {
          # Obtener todos los procesos con información detallada
          Get-Process | Select-Object Name, Id, Path, Company, Description, 
                                     @{Name='StartTime';Expression={$_.StartTime}},
                                     @{Name='CommandLine';Expression={
                                       (Get-WmiObject -Class Win32_Process -Filter \"ProcessId = '$($_.Id)'\").CommandLine
                                     }} |
          ConvertTo-Json -Depth 1
        }"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          let processes;
          try {
            processes = JSON.parse(stdout);
            // Asegurar que sea un array
            if (!Array.isArray(processes)) {
              processes = [processes];
            }
            
            for (const process of processes) {
              // Normalizar propiedades para evitar problemas con valores null
              const processName = (process.Name || '').toLowerCase();
              const processPath = (process.Path || '').toLowerCase();
              const processDesc = (process.Description || '').toLowerCase();
              const processCmd = (process.CommandLine || '').toLowerCase();
              
              // Verificar si el proceso coincide con palabras clave sospechosas
              const isSuspicious = suspiciousKeywords.some(keyword => 
                processName.includes(keyword) || 
                processPath.includes(keyword) || 
                processDesc.includes(keyword) || 
                processCmd.includes(keyword)
              );
              
              // También marcar procesos sin ruta o información como sospechosos
              const isUnknown = !process.Path && !process.Company && !process.Description;
              
              if (isSuspicious || isUnknown) {
                result.suspiciousProcesses.push({
                  name: process.Name,
                  pid: process.Id,
                  path: process.Path || 'Desconocida',
                  company: process.Company || 'Desconocida',
                  startTime: process.StartTime ? new Date(process.StartTime).toLocaleString() : 'Desconocida',
                  commandLine: process.CommandLine || 'Desconocida',
                  reason: isSuspicious ? 'Nombre/ruta sospechosa' : 'Información limitada'
                });
              }
            }
          } catch (error) {
            console.error('Error parseando información de procesos:', error);
          }
        }
      } catch (error) {
        console.error('Error obteniendo información de procesos:', error);
      }
      
      // Detectar inyecciones de DLL
      try {
        // Especialmente enfocado en el proceso de Minecraft
        const command = `powershell -Command "& {
          $minecraftProcesses = Get-Process | Where-Object { $_.ProcessName -eq 'javaw' -or $_.ProcessName -eq 'java' -or $_.ProcessName -eq 'minecraft' };
          
          foreach ($process in $minecraftProcesses) {
            $modules = $process.Modules;
            $suspiciousModules = $modules | Where-Object { 
              $_.ModuleName -notlike '*java*' -and 
              $_.ModuleName -notlike '*jvm*' -and
              $_.ModuleName -notlike '*minecraft*' -and
              $_.ModuleName -notlike 'ntdll.dll' -and
              $_.ModuleName -notlike 'kernel32.dll' -and
              $_.ModuleName -notlike 'user32.dll' -and
              $_.ModuleName -notlike 'nt*' -and
              $_.ModuleName -notlike 'win*' -and
              $_.ModuleName -notlike 'system*'
            };
            
            foreach ($module in $suspiciousModules) {
              [PSCustomObject]@{
                ProcessName = $process.ProcessName;
                ProcessId = $process.Id;
                ModuleName = $module.ModuleName;
                ModulePath = $module.FileName;
              }
            }
          }
        } | ConvertTo-Json"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          try {
            let injectedModules = JSON.parse(stdout);
            // Asegurar que sea un array
            if (!Array.isArray(injectedModules)) {
              injectedModules = [injectedModules];
            }
            
            for (const module of injectedModules) {
              result.injections.push({
                processName: module.ProcessName,
                pid: module.ProcessId,
                moduleName: module.ModuleName,
                modulePath: module.ModulePath
              });
            }
          } catch (error) {
            console.error('Error parseando módulos inyectados:', error);
          }
        }
      } catch (error) {
        console.error('Error detectando inyecciones de DLL:', error);
      }
      
      // Detectar procesos ocultos
      try {
        // Comparar procesos listados por diferentes métodos para encontrar inconsistencias
        const command = `powershell -Command "& {
          $tasklistProcesses = tasklist /fo csv | ConvertFrom-Csv | Select-Object -ExpandProperty 'Image Name';
          $getProcessProcesses = Get-Process | Select-Object -ExpandProperty ProcessName;
          
          # Encontrar procesos que aparecen en uno pero no en otro
          $missingInTasklist = $getProcessProcesses | Where-Object { $tasklistProcesses -notcontains ($_ + '.exe') -and $tasklistProcesses -notcontains $_ };
          $missingInGetProcess = $tasklistProcesses | ForEach-Object { $_ -replace '.exe$', '' } | Where-Object { $getProcessProcesses -notcontains $_ };
          
          [PSCustomObject]@{
            MissingInTasklist = $missingInTasklist;
            MissingInGetProcess = $missingInGetProcess;
          } | ConvertTo-Json
        }"`;
        
        const { stdout } = await execAsync(command);
        
        if (stdout.trim()) {
          try {
            const hiddenInfo = JSON.parse(stdout);
            
            if (hiddenInfo.MissingInTasklist && hiddenInfo.MissingInTasklist.length > 0) {
              for (const processName of hiddenInfo.MissingInTasklist) {
                result.hiddenProcesses.push({
                  name: processName,
                  method: 'No aparece en tasklist pero sí en Get-Process',
                  reason: 'Posible ocultamiento'
                });
              }
            }
            
            if (hiddenInfo.MissingInGetProcess && hiddenInfo.MissingInGetProcess.length > 0) {
              for (const processName of hiddenInfo.MissingInGetProcess) {
                result.hiddenProcesses.push({
                  name: processName,
                  method: 'No aparece en Get-Process pero sí en tasklist',
                  reason: 'Posible ocultamiento'
                });
              }
            }
          } catch (error) {
            console.error('Error parseando información de procesos ocultos:', error);
          }
        }
      } catch (error) {
        console.error('Error detectando procesos ocultos:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, usar ps para información de procesos
      try {
        const { stdout } = await execAsync('ps -axo pid,comm');
        
        const lines = stdout.split('\n').slice(1); // Omitir encabezado
        
        for (const line of lines) {
          const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
          
          if (match) {
            const pid = match[1];
            const processName = match[2];
            
            // Verificar si el proceso coincide con palabras clave sospechosas
            const isSuspicious = suspiciousKeywords.some(keyword => 
              processName.toLowerCase().includes(keyword)
            );
            
            if (isSuspicious) {
              result.suspiciousProcesses.push({
                name: processName,
                pid,
                reason: 'Nombre sospechoso'
              });
            }
          }
        }
        
        // Buscar DLL inyectadas en procesos relacionados con Minecraft
        const { stdout: javaProcs } = await execAsync('ps -axo pid,comm | grep -i java');
        
        const javaPids = javaProcs.split('\n').map(line => {
          const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
          return match ? match[1] : null;
        }).filter(Boolean);
        
        for (const pid of javaPids) {
          try {
            // Obtener información de librerías cargadas
            const { stdout: libInfo } = await execAsync(`lsof -p ${pid} | grep -i '\\\.dylib'`);
            
            const libs = libInfo.split('\n').filter(line => line.trim() !== '');
            
            for (const lib of libs) {
              const libPath = lib.split(/\s+/).pop();
              
              // Ignorar librerías del sistema
              if (libPath && !libPath.includes('/System/') && !libPath.includes('/usr/lib/')) {
                result.injections.push({
                  processName: 'java',
                  pid,
                  moduleName: path.basename(libPath),
                  modulePath: libPath
                });
              }
            }
          } catch (error) {
            // Ignorar errores individuales
          }
        }
      } catch (error) {
        console.error('Error analizando procesos en macOS:', error);
      }
    } else {
      // En Linux, usar ps para información de procesos
      try {
        const { stdout } = await execAsync('ps -axo pid,comm');
        
        const lines = stdout.split('\n').slice(1); // Omitir encabezado
        
        for (const line of lines) {
          const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
          
          if (match) {
            const pid = match[1];
            const processName = match[2];
            
            // Verificar si el proceso coincide con palabras clave sospechosas
            const isSuspicious = suspiciousKeywords.some(keyword => 
              processName.toLowerCase().includes(keyword)
            );
            
            if (isSuspicious) {
              result.suspiciousProcesses.push({
                name: processName,
                pid,
                reason: 'Nombre sospechoso'
              });
            }
          }
        }
        
        // Buscar librerías sospechosas en procesos Java
        try {
          const { stdout: javaProcs } = await execAsync('ps -axo pid,comm | grep -i java');
          
          const javaPids = javaProcs.split('\n').map(line => {
            const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
            return match ? match[1] : null;
          }).filter(Boolean);
          
          for (const pid of javaPids) {
            try {
              const { stdout: mapsInfo } = await execAsync(`cat /proc/${pid}/maps | grep -i '\\\.so'`);
              
              const libs = mapsInfo.split('\n').filter(line => line.trim() !== '');
              
              for (const lib of libs) {
                const libPath = lib.split(/\s+/).pop();
                
                // Ignorar librerías del sistema
                if (libPath && !libPath.includes('/lib/') && !libPath.includes('/usr/lib/')) {
                  result.injections.push({
                    processName: 'java',
                    pid,
                    moduleName: path.basename(libPath),
                    modulePath: libPath
                  });
                }
              }
            } catch (error) {
              // Ignorar errores individuales
            }
          }
        } catch (error) {
          // Ignorar error si no hay procesos Java
        }
      } catch (error) {
        console.error('Error analizando procesos en Linux:', error);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en analyzeProcesses:', error);
    throw error;
  }
}

// Escanea mods de Minecraft para detectar potenciales cheats
async function scanMinecraftMods() {
  try {
    const result = {
      suspiciousMods: [],
      recentlyModifiedMods: [],
      modFolders: []
    };
    
    const homeDir = os.homedir();
    const minecraftPaths = [
      path.join(homeDir, 'AppData', 'Roaming', '.minecraft'),  // Windows
      path.join(homeDir, '.minecraft'),                         // Linux
      path.join(homeDir, 'Library', 'Application Support', 'minecraft')  // macOS
    ];
    
    // Lista de firmas sospechosas en mods
    const suspiciousKeywords = [
      'hack', 'cheat', 'xray', 'autoclicker', 'killaura', 'bhop', 'flight',
      'wallhack', 'noclip', 'speed', 'aimbot', 'esp', 'tracers', 'reach',
      'bypass', 'ghostclient', 'baritone', 'nuker', 'autotool', 'blink',
      'fastplace', 'nofall', 'antiknockback', 'criticals', 'scaffold',
      'timer', 'freecam', 'fullbright', 'jesus', 'phase', 'spoofer',
      'macro', 'bot', 'inject', 'pvp', 'autofish', 'aura', 'client'
    ];
    
    // Listas blancas de mods legítimos que podrían dar falsos positivos
    const whitelistedMods = [
      'optifine', 'sodium', 'phosphor', 'lithium', 'fabric-api',
      'forge', 'jei', 'rei', 'worldedit', 'performance', 'mod-menu',
      'shulkertooltip', 'shaders', 'dynamiclights', 'appleskin',
      'journeymap', 'voxelmap', 'xaero', 'minimap', 'inventory',
      'craftguide', 'craftpresence', 'ding', 'sound', 'loot', 'voicechat',
      'terralith', 'biomes', 'better', 'durability', 'mouse', 'tweaks',
      'curios', 'baubles', 'gadget', 'utility', 'ftb', 'mekanism',
      'thermal', 'tinkers', 'blood', 'botania', 'computercraft',
      'chisel', 'create', 'refined', 'storage', 'applied'
    ];
    
    let minecraftFolder = null;
    
    // Encontrar la primera carpeta de Minecraft que exista
    for (const mcPath of minecraftPaths) {
      if (fs.existsSync(mcPath)) {
        minecraftFolder = mcPath;
        break;
      }
    }
    
    if (!minecraftFolder) {
      return result;
    }
    
    // Buscar carpetas de mods
    const potentialModFolders = [
      path.join(minecraftFolder, 'mods'),
      path.join(minecraftFolder, 'config')
    ];
    
    // Buscar también carpetas de mods en carpetas de instancias
    const instanceFolders = [
      path.join(homeDir, 'AppData', 'Roaming', 'MultiMC', 'instances'),
      path.join(homeDir, 'curseforge', 'minecraft', 'Instances'),
      path.join(homeDir, 'twitch', 'minecraft', 'Instances'),
      path.join(homeDir, '.techniclauncher', 'modpacks'),
      path.join(homeDir, 'Documents', 'Curse', 'Minecraft', 'Instances'),
      path.join(homeDir, 'GDLauncher', 'instances')
    ];
    
    // Buscar instancias de Minecraft
    for (const instanceFolder of instanceFolders) {
      if (fs.existsSync(instanceFolder)) {
        try {
          const instances = await fs.promises.readdir(instanceFolder, { withFileTypes: true });
          
          for (const instance of instances) {
            if (instance.isDirectory()) {
              const instanceModsPath = path.join(instanceFolder, instance.name, 'mods');
              if (fs.existsSync(instanceModsPath)) {
                potentialModFolders.push(instanceModsPath);
              }
            }
          }
        } catch (error) {
          console.error(`Error al buscar instancias en ${instanceFolder}:`, error);
        }
      }
    }
    
    // Procesar cada carpeta de mods
    for (const modFolder of potentialModFolders) {
      if (fs.existsSync(modFolder)) {
        try {
          const folderStats = await fs.promises.stat(modFolder);
          
          result.modFolders.push({
            path: modFolder,
            lastModified: folderStats.mtime.toLocaleString()
          });
          
          const files = await fs.promises.readdir(modFolder, { withFileTypes: true });
          
          for (const file of files) {
            if (file.isFile() && (file.name.endsWith('.jar') || file.name.endsWith('.zip'))) {
              const modPath = path.join(modFolder, file.name);
              const stats = await fs.promises.stat(modPath);
              
              const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
              const isRecent = stats.mtime.getTime() >= oneWeekAgo;
              
              // Verificar si el nombre del mod contiene palabras clave sospechosas
              const nameLower = file.name.toLowerCase();
              
              const suspiciousNameKeywords = suspiciousKeywords.filter(keyword => 
                nameLower.includes(keyword)
              );
              
              // Verificar si el mod está en la lista blanca
              const isWhitelisted = whitelistedMods.some(whiteMod => 
                nameLower.includes(whiteMod)
              );
              
              // Si el mod tiene palabras clave sospechosas y no está en la lista blanca
              if (suspiciousNameKeywords.length > 0 && !isWhitelisted) {
                result.suspiciousMods.push({
                  name: file.name,
                  path: modPath,
                  size: stats.size,
                  lastModified: stats.mtime.toLocaleString(),
                  suspiciousKeywords: suspiciousNameKeywords,
                  reason: `Contiene palabras clave sospechosas: ${suspiciousNameKeywords.join(', ')}`
                });
              }
              
              // Si el mod fue modificado recientemente
              if (isRecent) {
                result.recentlyModifiedMods.push({
                  name: file.name,
                  path: modPath,
                  size: stats.size,
                  lastModified: stats.mtime.toLocaleString()
                });
              }
              
              // TODO: Implementar análisis del contenido del JAR para detectar firmas de cheat
              // (Requeriría extraer el JAR y examinar clases específicas)
            }
          }
        } catch (error) {
          console.error(`Error procesando carpeta de mods ${modFolder}:`, error);
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en scanMinecraftMods:', error);
    throw error;
  }
}

// Detecta inyecciones de código malicioso en el cliente
async function detectInjections() {
  try {
    const result = {
      injectedDLLs: [],
      suspiciousModifications: [],
      memoryScans: []
    };
    
    if (process.platform === 'win32') {
      // Buscar procesos de Minecraft
      try {
        const { stdout } = await execAsync('tasklist /fi "imagename eq java.exe" /fi "imagename eq javaw.exe" /fo csv');
        
        const lines = stdout.split('\n').filter(line => line.includes('java'));
        
        for (const line of lines) {
          try {
            const match = line.match(/"([^"]+)","([^"]+)"/);
            if (match) {
              const processName = match[1];
              const pid = match[2];
              
              // Obtener módulos DLL cargados en este proceso
              const command = `powershell -Command "& {
                Get-Process -Id ${pid} -Module | 
                Where-Object { 
                  $_.ModuleName -notlike '*jvm*' -and
                  $_.ModuleName -notlike '*java*' -and
                  $_.ModuleName -notlike '*minecraft*' -and
                  $_.ModuleName -notlike 'ntdll.dll' -and
                  $_.ModuleName -notlike 'kernel32.dll' -and
                  $_.ModuleName -notlike 'user32.dll' -and
                  $_.ModuleName -notlike 'nt*' -and
                  $_.ModuleName -notlike 'win*' -and
                  $_.ModuleName -notlike 'system*'
                } | 
                Select-Object ModuleName, FileName, Company, Description |
                ConvertTo-Json
              }"`;
              
              const { stdout: modulesJson } = await execAsync(command);
              
              if (modulesJson.trim()) {
                try {
                  let modules = JSON.parse(modulesJson);
                  
                  // Asegurar que sea un array
                  if (!Array.isArray(modules)) {
                    modules = [modules];
                  }
                  
                  for (const module of modules) {
                    result.injectedDLLs.push({
                      processName: processName,
                      pid: pid,
                      moduleName: module.ModuleName,
                      filePath: module.FileName,
                      company: module.Company || 'Desconocida',
                      description: module.Description || 'Desconocida'
                    });
                  }
                } catch (error) {
                  console.error('Error parseando módulos:', error);
                }
              }
              
              // Buscar modificaciones sospechosas en las regiones de memoria
              const memoryCommand = `powershell -Command "& {
                $process = Get-Process -Id ${pid};
                $baseAddress = $process.MainModule.BaseAddress;
                $size = $process.MainModule.ModuleMemorySize;
                
                # Esta parte simplemente indica que realizamos el análisis
                # Un análisis de memoria real requeriría acceso más profundo
                [PSCustomObject]@{
                  ProcessName = '${processName}';
                  PID = ${pid};
                  BaseAddress = '0x' + $baseAddress.ToString('X');
                  MemorySize = $size;
                  Analyzed = $true;
                }
              } | ConvertTo-Json"`;
              
              try {
                const { stdout: memoryJson } = await execAsync(memoryCommand);
                
                if (memoryJson.trim()) {
                  const memoryInfo = JSON.parse(memoryJson);
                  
                  result.memoryScans.push({
                    processName: memoryInfo.ProcessName,
                    pid: memoryInfo.PID,
                    baseAddress: memoryInfo.BaseAddress,
                    memorySize: memoryInfo.MemorySize,
                    analyzed: memoryInfo.Analyzed,
                    findings: 'Análisis básico completado'
                  });
                }
              } catch (error) {
                console.error('Error en análisis de memoria:', error);
              }
            }
          } catch (error) {
            console.error('Error procesando proceso Java:', error);
          }
        }
      } catch (error) {
        console.error('Error buscando procesos Java:', error);
      }
      
      // Buscar modificaciones sospechosas en archivos de Minecraft
      try {
        const homeDir = os.homedir();
        const minecraftPath = path.join(homeDir, 'AppData', 'Roaming', '.minecraft');
        
        if (fs.existsSync(minecraftPath)) {
          // Verificar versiones de Minecraft modificadas
          const versionsPath = path.join(minecraftPath, 'versions');
          
          if (fs.existsSync(versionsPath)) {
            const versions = await fs.promises.readdir(versionsPath, { withFileTypes: true });
            
            for (const version of versions) {
              if (version.isDirectory()) {
                const versionName = version.name;
                const versionJsonPath = path.join(versionsPath, versionName, `${versionName}.json`);
                
                if (fs.existsSync(versionJsonPath)) {
                  try {
                    const jsonContent = await fs.promises.readFile(versionJsonPath, 'utf8');
                    const versionData = JSON.parse(jsonContent);
                    
                    // Verificar si esta versión está modificada
                    if (versionData.mainClass && !versionData.mainClass.includes('net.minecraft.client.main.Main')) {
                      result.suspiciousModifications.push({
                        type: 'Version modificada',
                        name: versionName,
                        path: versionJsonPath,
                        mainClass: versionData.mainClass,
                        reason: 'MainClass no estándar'
                      });
                    }
                    
                    // Verificar librerías sospechosas
                    if (versionData.libraries && Array.isArray(versionData.libraries)) {
                      for (const library of versionData.libraries) {
                        if (library.name && typeof library.name === 'string') {
                          const libraryName = library.name.toLowerCase();
                          
                          // Detectar librerías sospechosas
                          if (libraryName.includes('inject') || 
                              libraryName.includes('hack') || 
                              libraryName.includes('cheat') || 
                              libraryName.includes('xray')) {
                            
                            result.suspiciousModifications.push({
                              type: 'Librería sospechosa',
                              name: library.name,
                              version: versionName,
                              path: versionJsonPath,
                              reason: 'Nombre de librería sospechoso'
                            });
                          }
                        }
                      }
                    }
                  } catch (error) {
                    console.error(`Error procesando archivo de versión ${versionJsonPath}:`, error);
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error verificando modificaciones de archivo:', error);
      }
    } else if (process.platform === 'darwin') {
      // En macOS, buscar procesos de Java que podrían ser Minecraft
      try {
        const { stdout } = await execAsync('ps -ax | grep -i java | grep -v grep');
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          const match = line.match(/^\s*(\d+)\s+/);
          
          if (match) {
            const pid = match[1];
            
            // Obtener librerías cargadas
            const { stdout: libsOutput } = await execAsync(`lsof -p ${pid} | grep -i '\\\.dylib'`);
            
            const libs = libsOutput.split('\n').filter(line => line.trim() !== '');
            
            for (const lib of libs) {
              const libPath = lib.split(/\s+/).pop();
              
              // Ignorar librerías del sistema
              if (libPath && !libPath.includes('/System/') && !libPath.includes('/usr/lib/')) {
                result.injectedDLLs.push({
                  processName: 'java',
                  pid: pid,
                  moduleName: path.basename(libPath),
                  filePath: libPath,
                  company: 'Desconocida',
                  description: 'Librería cargada en proceso Java'
                });
              }
            }
          }
        }
      } catch (error) {
        console.error('Error buscando procesos Java en macOS:', error);
      }
    } else {
      // En Linux, buscar procesos de Java que podrían ser Minecraft
      try {
        const { stdout } = await execAsync('ps -ax | grep -i java | grep -v grep');
        
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          const match = line.match(/^\s*(\d+)\s+/);
          
          if (match) {
            const pid = match[1];
            
            // Verificar si es Minecraft buscando en los argumentos
            if (line.includes('minecraft')) {
              // Obtener librerías cargadas
              try {
                const { stdout: mapsOutput } = await execAsync(`cat /proc/${pid}/maps | grep -i '\\\.so'`);
                
                const libs = mapsOutput.split('\n').filter(line => line.trim() !== '');
                
                for (const lib of libs) {
                  const libPath = lib.split(/\s+/).pop();
                  
                  // Ignorar librerías del sistema
                  if (libPath && !libPath.includes('/lib/') && !libPath.includes('/usr/lib/')) {
                    result.injectedDLLs.push({
                      processName: 'java',
                      pid: pid,
                      moduleName: path.basename(libPath),
                      filePath: libPath,
                      company: 'Desconocida',
                      description: 'Librería cargada en proceso Java'
                    });
                  }
                }
              } catch (error) {
                // Ignorar errores individuales
              }
            }
          }
        }
      } catch (error) {
        console.error('Error buscando procesos Java en Linux:', error);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error en detectInjections:', error);
    throw error;
  }
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
  registerSelfDestruct,
  analyzeProcesses,
  scanMinecraftMods,
  detectInjections
};