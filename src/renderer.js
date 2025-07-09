// Renderer.js - Maneja la lógica del lado del cliente

document.addEventListener('DOMContentLoaded', () => {
    // Variables para almacenar los resultados globales (para exportación)
    const globalResults = {};
    
    // Elementos de la UI
    const findJarBtn = document.getElementById('findJarBtn');
    const jarList = document.getElementById('jarList');
    
    const checkExtensionsBtn = document.getElementById('checkExtensionsBtn');
    const extensionsList = document.getElementById('extensionsList');
    
    const deletedFiles30Btn = document.getElementById('deletedFiles30Btn');
    const deletedFiles60Btn = document.getElementById('deletedFiles60Btn');
    const deletedFiles120Btn = document.getElementById('deletedFiles120Btn');
    const deletedList = document.getElementById('deletedList');
    
    const executedJars1Btn = document.getElementById('executedJars1Btn');
    const executedJars4Btn = document.getElementById('executedJars4Btn');
    const executedJars24Btn = document.getElementById('executedJars24Btn');
    const executedList = document.getElementById('executedList');
    
    const usbStatusBtn = document.getElementById('usbStatusBtn');
    const usbStatus = document.getElementById('usbStatus');
    
    const screenRecordingBtn = document.getElementById('screenRecordingBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    
    const browserHistoryBtn = document.getElementById('browserHistoryBtn');
    const historyStatus = document.getElementById('historyStatus');
    
    const minecraftCheatsBtn = document.getElementById('minecraftCheatsBtn');
    const cheatsList = document.getElementById('cheatsList');
    
    const stoppedServicesBtn = document.getElementById('stoppedServicesBtn');
    const servicesList = document.getElementById('servicesList');
    
    const folderHistoryBtn = document.getElementById('folderHistoryBtn');
    const folderList = document.getElementById('folderList');
    
    const executionHistory1Btn = document.getElementById('executionHistory1Btn');
    const executionHistory4Btn = document.getElementById('executionHistory4Btn');
    const executionHistory12Btn = document.getElementById('executionHistory12Btn');
    const executionList = document.getElementById('executionList');
    
    const minecraftFilesBtn = document.getElementById('minecraftFilesBtn');
    const minecraftFilesList = document.getElementById('minecraftFilesList');
    
    const commandHistoryBtn = document.getElementById('commandHistoryBtn');
    const commandHistoryList = document.getElementById('commandHistoryList');
    
    const exportResultsBtn = document.getElementById('exportResultsBtn');
    
    // Función para mostrar un indicador de carga
    function showLoading(element) {
        element.innerHTML = '<div class="loading">Cargando...</div>';
    }
    
    // Función para mostrar un error
    function showError(element, message) {
        element.innerHTML = `<div class="error">${message}</div>`;
    }
    
    // Función para formatear el tamaño en bytes a una forma legible
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // Función para manejar los botones de grupo
    function setupButtonGroup(buttons, callback) {
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                // Desactivar todos los botones en el grupo
                buttons.forEach(b => b.classList.remove('active'));
                // Activar el botón clickeado
                button.classList.add('active');
                // Llamar al callback con el valor del botón
                callback();
            });
        });
    }
    
    // Función para abrir la ubicación de un archivo
    function setupFileLocationLinks() {
        document.querySelectorAll('.open-location-link').forEach(link => {
            link.addEventListener('click', async (event) => {
                event.preventDefault();
                const filePath = link.getAttribute('data-path');
                
                if (filePath) {
                    try {
                        await window.keniboxAPI.openFileLocation(filePath);
                        link.innerText = '✓ Abierto';
                        setTimeout(() => {
                            link.innerText = 'Abrir ubicación';
                        }, 2000);
                    } catch (error) {
                        console.error('Error opening file location:', error);
                        link.innerText = '✗ Error';
                        setTimeout(() => {
                            link.innerText = 'Abrir ubicación';
                        }, 2000);
                    }
                }
            });
        });
    }
    
    // Función para detectar el navegador actual
    async function detectCurrentBrowser() {
        try {
            const browsers = await window.keniboxAPI.detectBrowsers();
            const defaultBrowser = browsers.find(b => b.default);
            
            if (defaultBrowser) {
                const browserInfoElement = document.getElementById('browserInfo');
                if (browserInfoElement) {
                    browserInfoElement.innerText = `Navegador detectado: ${defaultBrowser.name}`;
                    browserInfoElement.classList.add('active');
                }
            }
        } catch (error) {
            console.error('Error detecting browsers:', error);
        }
    }
    
    // Detectar navegador al inicio
    detectCurrentBrowser();
    
    // Encontrar archivos JAR
    if (findJarBtn) {
        findJarBtn.addEventListener('click', async () => {
            showLoading(jarList);
            
            try {
                const jarFiles = await window.keniboxAPI.findJarFiles();
                globalResults.jarFiles = jarFiles;
                
                if (jarFiles.error) {
                    showError(jarList, `Error: ${jarFiles.error}`);
                    return;
                }
                
                if (jarFiles.length === 0) {
                    jarList.innerHTML = '<div class="info">No se encontraron archivos JAR.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                jarFiles.forEach(file => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${file.name}</div>
                            <div class="item-details">
                                <span>Ubicación: ${file.path}</span>
                                <span>Tamaño: ${formatFileSize(file.size)}</span>
                                <span>Última modificación: ${new Date(file.lastModified).toLocaleString()}</span>
                                <a href="#" class="open-location-link" data-path="${file.path}">Abrir ubicación</a>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                jarList.innerHTML = html;
                setupFileLocationLinks();
            } catch (error) {
                showError(jarList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Verificar cambios de extensión
    if (checkExtensionsBtn) {
        checkExtensionsBtn.addEventListener('click', async () => {
            showLoading(extensionsList);
            
            try {
                const changes = await window.keniboxAPI.checkExtensionChanges();
                globalResults.extensionChanges = changes;
                
                if (changes.error) {
                    showError(extensionsList, `Error: ${changes.error}`);
                    return;
                }
                
                if (changes.length === 0) {
                    extensionsList.innerHTML = '<div class="info">No se detectaron cambios sospechosos de extensión.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                changes.forEach(file => {
                    html += `
                        <div class="result-item suspicious">
                            <div class="item-title">${file.name}</div>
                            <div class="item-details">
                                <span>Ubicación: ${file.path}</span>
                                <span>Última modificación: ${new Date(file.modifiedTime).toLocaleString()}</span>
                                <span class="warning">⚠️ ${file.reason}</span>
                                <a href="#" class="open-location-link" data-path="${file.path}">Abrir ubicación</a>
                            </div>
                        </div>
                    `;
                    
                    if (file.similarFiles && file.similarFiles.length > 0) {
                        html += `
                            <div class="item-sublist">
                                <div class="sublist-title">Archivos similares:</div>
                        `;
                        
                        file.similarFiles.forEach(similar => {
                            html += `
                                <div class="sublist-item">
                                    <span>${similar.name}</span>
                                    <span class="sublist-detail">Modificado: ${new Date(similar.modifiedTime).toLocaleString()}</span>
                                    <a href="#" class="open-location-link" data-path="${similar.path}">Abrir ubicación</a>
                                </div>
                            `;
                        });
                        
                        html += `</div>`;
                    }
                });
                html += '</div>';
                
                extensionsList.innerHTML = html;
                setupFileLocationLinks();
            } catch (error) {
                showError(extensionsList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Obtener archivos eliminados
    if (deletedFiles30Btn && deletedFiles60Btn && deletedFiles120Btn) {
        const deletedFilesButtons = [deletedFiles30Btn, deletedFiles60Btn, deletedFiles120Btn];
        
        const getDeletedFiles = async () => {
            showLoading(deletedList);
            
            let minutes = 60; // Valor predeterminado
            
            if (deletedFiles30Btn.classList.contains('active')) {
                minutes = 30;
            } else if (deletedFiles120Btn.classList.contains('active')) {
                minutes = 120;
            }
            
            try {
                const deletedFiles = await window.keniboxAPI.getDeletedFiles(minutes);
                globalResults.deletedFiles = deletedFiles;
                
                if (deletedFiles.error) {
                    showError(deletedList, `Error: ${deletedFiles.error}`);
                    return;
                }
                
                if (deletedFiles.length === 0) {
                    deletedList.innerHTML = `<div class="info">No se encontraron archivos eliminados en los últimos ${minutes} minutos.</div>`;
                    return;
                }
                
                let html = '<div class="result-list">';
                deletedFiles.forEach(file => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${file.name}</div>
                            <div class="item-details">
                                <span>Ubicación: ${file.path}</span>
                                <span>Eliminado en: ${new Date(file.deletedTime).toLocaleString()}</span>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                deletedList.innerHTML = html;
            } catch (error) {
                showError(deletedList, `Error inesperado: ${error.message}`);
            }
        };
        
        setupButtonGroup(deletedFilesButtons, getDeletedFiles);
        
        // Inicialmente, cargar con el valor predeterminado (60 minutos)
        deletedFiles60Btn.addEventListener('click', getDeletedFiles);
    }
    
    // Obtener JARs ejecutados
    if (executedJars1Btn && executedJars4Btn && executedJars24Btn) {
        const executedJarsButtons = [executedJars1Btn, executedJars4Btn, executedJars24Btn];
        
        const getExecutedJars = async () => {
            showLoading(executedList);
            
            let hours = 4; // Valor predeterminado
            
            if (executedJars1Btn.classList.contains('active')) {
                hours = 1;
            } else if (executedJars24Btn.classList.contains('active')) {
                hours = 24;
            }
            
            try {
                const executedJars = await window.keniboxAPI.getExecutedJars(hours);
                globalResults.executedJars = executedJars;
                
                if (executedJars.error) {
                    showError(executedList, `Error: ${executedJars.error}`);
                    return;
                }
                
                if (executedJars.length === 0) {
                    executedList.innerHTML = `<div class="info">No se encontraron archivos JAR ejecutados en las últimas ${hours} horas.</div>`;
                    return;
                }
                
                let html = '<div class="result-list">';
                executedJars.forEach(jar => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${jar.name}</div>
                            <div class="item-details">
                                <span>Ubicación: ${jar.path}</span>
                                <span>Iniciado en: ${jar.startTime}</span>
                                ${jar.source ? `<span>Fuente: ${jar.source}</span>` : ''}
                                ${jar.size ? `<span>Tamaño: ${formatFileSize(jar.size)}</span>` : ''}
                                <a href="#" class="open-location-link" data-path="${jar.path}">Abrir ubicación</a>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                executedList.innerHTML = html;
                setupFileLocationLinks();
            } catch (error) {
                showError(executedList, `Error inesperado: ${error.message}`);
            }
        };
        
        setupButtonGroup(executedJarsButtons, getExecutedJars);
        
        // Inicialmente, cargar con el valor predeterminado (4 horas)
        executedJars4Btn.addEventListener('click', getExecutedJars);
    }
    
    // Verificar desconexión de USB
    if (usbStatusBtn) {
        usbStatusBtn.addEventListener('click', async () => {
            showLoading(usbStatus);
            
            try {
                const status = await window.keniboxAPI.checkUSBDisconnection();
                globalResults.usbStatus = status;
                
                if (status.error) {
                    showError(usbStatus, `Error: ${status.error}`);
                    return;
                }
                
                if (!status.disconnected || status.details.length === 0) {
                    usbStatus.innerHTML = '<div class="info">No se detectaron dispositivos USB desconectados recientemente.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                html += '<div class="warning-box">⚠️ Se detectaron dispositivos USB desconectados recientemente</div>';
                
                status.details.forEach(device => {
                    html += `
                        <div class="result-item suspicious">
                            <div class="item-title">${device.device}</div>
                            <div class="item-details">
                                <span>Desconectado en: ${device.time}</span>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                usbStatus.innerHTML = html;
            } catch (error) {
                showError(usbStatus, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Verificar grabación de pantalla
    if (screenRecordingBtn) {
        screenRecordingBtn.addEventListener('click', async () => {
            showLoading(recordingStatus);
            
            try {
                const status = await window.keniboxAPI.checkScreenRecording();
                globalResults.screenRecording = status;
                
                if (status.error) {
                    showError(recordingStatus, `Error: ${status.error}`);
                    return;
                }
                
                if (!status.recording || status.applications.length === 0) {
                    recordingStatus.innerHTML = '<div class="info">No se detectaron aplicaciones de grabación activas.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                html += '<div class="warning-box">⚠️ Se detectaron aplicaciones de grabación de pantalla activas</div>';
                
                status.applications.forEach(app => {
                    html += `
                        <div class="result-item suspicious">
                            <div class="item-title">${app}</div>
                            <div class="item-details">
                                <span>Estado: Activa</span>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                recordingStatus.innerHTML = html;
            } catch (error) {
                showError(recordingStatus, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Abrir historial del navegador
    if (browserHistoryBtn) {
        browserHistoryBtn.addEventListener('click', async () => {
            historyStatus.innerHTML = '<div class="info">Abriendo historial del navegador...</div>';
            
            try {
                const result = await window.keniboxAPI.openBrowserHistory();
                
                if (result.error) {
                    showError(historyStatus, `Error: ${result.error}`);
                    return;
                }
                
                let message = 'Historial del navegador abierto correctamente.';
                if (result.browser) {
                    message += ` (${result.browser})`;
                }
                
                historyStatus.innerHTML = `<div class="success">${message}</div>`;
                
                // Resetear el mensaje después de unos segundos
                setTimeout(() => {
                    historyStatus.innerHTML = '<div class="placeholder">El historial se abrirá en el navegador</div>';
                }, 3000);
            } catch (error) {
                showError(historyStatus, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Detectar cheats de Minecraft
    if (minecraftCheatsBtn) {
        minecraftCheatsBtn.addEventListener('click', async () => {
            showLoading(cheatsList);
            
            try {
                const cheatsData = await window.keniboxAPI.detectMinecraftCheats();
                globalResults.minecraftCheats = cheatsData;
                
                if (cheatsData.error) {
                    showError(cheatsList, `Error: ${cheatsData.error}`);
                    return;
                }
                
                // Crear pestañas para Sitios Visitados y Lista de Cheats
                let html = `
                    <div class="tabs">
                        <button class="tab-button active" data-tab="visitedSites">Sitios de cheats visitados</button>
                        <button class="tab-button" data-tab="cheatsList">Lista de cheats conocidos</button>
                    </div>
                    <div class="tab-content">
                `;
                
                // Contenido de la pestaña Sitios Visitados
                html += `<div class="tab-panel active" id="visitedSites">`;
                
                if (cheatsData.cheatSites && cheatsData.cheatSites.length > 0) {
                    html += `<div class="warning-box">⚠️ Se detectaron visitas a sitios relacionados con cheats de Minecraft</div>`;
                    html += `<div class="result-list">`;
                    
                    cheatsData.cheatSites.forEach(site => {
                        html += `
                            <div class="result-item suspicious">
                                <div class="item-title">${site.title || 'Sitio sin título'}</div>
                                <div class="item-details">
                                    <span>URL: <a class="link" title="${site.url}">${site.url.substring(0, 50)}${site.url.length > 50 ? '...' : ''}</a></span>
                                    <span>Visitado: ${new Date(site.visitTime).toLocaleString()}</span>
                                    ${site.browser ? `<span>Navegador: ${site.browser}</span>` : ''}
                                </div>
                            </div>
                        `;
                    });
                    
                    html += `</div>`;
                } else {
                    html += `<div class="info">No se encontraron visitas a sitios de cheats de Minecraft.</div>`;
                }
                
                html += `</div>`;
                
                // Contenido de la pestaña Lista de Cheats
                html += `<div class="tab-panel" id="cheatsList">`;
                
                if (cheatsData.cheatsList && cheatsData.cheatsList.length > 0) {
                    // Agrupar por categoría
                    const categoryGroups = {};
                    
                    cheatsData.cheatsList.forEach(cheat => {
                        if (!categoryGroups[cheat.category]) {
                            categoryGroups[cheat.category] = [];
                        }
                        categoryGroups[cheat.category].push(cheat);
                    });
                    
                    // Construir la lista por categorías
                    Object.keys(categoryGroups).forEach(category => {
                        html += `<div class="category-section">
                            <h3 class="category-title">${category}</h3>
                            <div class="result-list">`;
                            
                        categoryGroups[category].forEach(cheat => {
                            html += `
                                <div class="result-item">
                                    <div class="item-title">${cheat.name}</div>
                                    <div class="item-details">
                                        <span>Tipo: ${cheat.type}</span>
                                        <span>Descripción: ${cheat.description}</span>
                                    </div>
                                </div>
                            `;
                        });
                        
                        html += `</div></div>`;
                    });
                } else {
                    html += `<div class="info">No se encontró información sobre cheats conocidos.</div>`;
                }
                
                html += `</div></div>`;
                
                cheatsList.innerHTML = html;
                
                // Configurar funcionalidad de pestañas
                document.querySelectorAll('.tab-button').forEach(button => {
                    button.addEventListener('click', () => {
                        // Desactivar todas las pestañas
                        document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
                        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                        
                        // Activar la pestaña seleccionada
                        button.classList.add('active');
                        const tabId = button.getAttribute('data-tab');
                        document.getElementById(tabId).classList.add('active');
                    });
                });
            } catch (error) {
                showError(cheatsList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Verificar servicios detenidos
    if (stoppedServicesBtn) {
        stoppedServicesBtn.addEventListener('click', async () => {
            showLoading(servicesList);
            
            try {
                const services = await window.keniboxAPI.detectStoppedServices();
                globalResults.stoppedServices = services;
                
                if (services.error) {
                    showError(servicesList, `Error: ${services.error}`);
                    return;
                }
                
                if (services.length === 0) {
                    servicesList.innerHTML = '<div class="info">No se detectaron servicios relacionados detenidos.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                
                services.forEach(service => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${service.name}</div>
                            <div class="item-details">
                                <span>ID: ${service.id}</span>
                                <span>Estado: ${service.status}</span>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                servicesList.innerHTML = html;
            } catch (error) {
                showError(servicesList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Obtener historial de carpetas
    if (folderHistoryBtn) {
        folderHistoryBtn.addEventListener('click', async () => {
            showLoading(folderList);
            
            try {
                const folders = await window.keniboxAPI.getFolderHistory();
                globalResults.folderHistory = folders;
                
                if (folders.error) {
                    showError(folderList, `Error: ${folders.error}`);
                    return;
                }
                
                if (folders.length === 0) {
                    folderList.innerHTML = '<div class="info">No se encontró historial de carpetas.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                
                folders.forEach(folder => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${folder.name}</div>
                            <div class="item-details">
                                <span>Tipo: ${folder.type}</span>
                                ${folder.lastAccess ? `<span>Último acceso: ${new Date(folder.lastAccess).toLocaleString()}</span>` : ''}
                                <a href="#" class="open-location-link" data-path="${folder.name}">Abrir ubicación</a>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                folderList.innerHTML = html;
                setupFileLocationLinks();
            } catch (error) {
                showError(folderList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Obtener historial de ejecuciones
    if (executionHistory1Btn && executionHistory4Btn && executionHistory12Btn) {
        const executionHistoryButtons = [executionHistory1Btn, executionHistory4Btn, executionHistory12Btn];
        
        const getExecutionHistory = async () => {
            showLoading(executionList);
            
            let hours = 4; // Valor predeterminado
            
            if (executionHistory1Btn.classList.contains('active')) {
                hours = 1;
            } else if (executionHistory12Btn.classList.contains('active')) {
                hours = 12;
            }
            
            try {
                const history = await window.keniboxAPI.getExecutionHistory(hours);
                globalResults.executionHistory = history;
                
                if (history.error) {
                    showError(executionList, `Error: ${history.error}`);
                    return;
                }
                
                if (history.length === 0) {
                    executionList.innerHTML = `<div class="info">No se encontraron ejecuciones en las últimas ${hours} horas.</div>`;
                    return;
                }
                
                let html = '<div class="result-list">';
                
                history.forEach(execution => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${execution.name}</div>
                            <div class="item-details">
                                <span>Iniciado: ${execution.startTime}</span>
                                ${execution.pid ? `<span>PID: ${execution.pid}</span>` : ''}
                                ${execution.source ? `<span>Fuente: ${execution.source}</span>` : ''}
                                ${execution.command ? `<span class="command" title="${execution.command}">Comando: ${execution.command.substring(0, 100)}${execution.command.length > 100 ? '...' : ''}</span>` : ''}
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                executionList.innerHTML = html;
            } catch (error) {
                showError(executionList, `Error inesperado: ${error.message}`);
            }
        };
        
        setupButtonGroup(executionHistoryButtons, getExecutionHistory);
        
        // Inicialmente, cargar con el valor predeterminado (4 horas)
        executionHistory4Btn.addEventListener('click', getExecutionHistory);
    }
    
    // Obtener historial de comandos
    if (commandHistoryBtn) {
        commandHistoryBtn.addEventListener('click', async () => {
            showLoading(commandHistoryList);
            
            try {
                const commands = await window.keniboxAPI.getCommandHistory();
                globalResults.commandHistory = commands;
                
                if (commands.error) {
                    showError(commandHistoryList, `Error: ${commands.error}`);
                    return;
                }
                
                if (commands.length === 0) {
                    commandHistoryList.innerHTML = '<div class="info">No se encontró historial de comandos.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                
                commands.forEach(cmd => {
                    html += `
                        <div class="result-item">
                            <div class="item-title">${cmd.source}</div>
                            <div class="item-details">
                                <span class="command">${cmd.command}</span>
                                ${cmd.timestamp ? `<span>Ejecutado: ${new Date(cmd.timestamp).toLocaleString()}</span>` : ''}
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                commandHistoryList.innerHTML = html;
            } catch (error) {
                showError(commandHistoryList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Abrir archivos de Minecraft
    if (minecraftFilesBtn) {
        minecraftFilesBtn.addEventListener('click', async () => {
            showLoading(minecraftFilesList);
            
            try {
                const result = await window.keniboxAPI.openMinecraftFiles();
                globalResults.minecraftFiles = result;
                
                if (result.error) {
                    showError(minecraftFilesList, `Error: ${result.error}`);
                    return;
                }
                
                if (!result.files || result.files.length === 0) {
                    minecraftFilesList.innerHTML = '<div class="info">No se encontraron archivos de Minecraft.</div>';
                    return;
                }
                
                let html = '<div class="result-list">';
                html += '<div class="success">✅ Carpeta de Minecraft abierta correctamente</div>';
                
                // Mostrar archivos encontrados
                html += '<div class="section-title">Archivos encontrados:</div>';
                
                result.files.forEach(file => {
                    if (file.type !== 'Lista de Mods' && file.type !== 'Contenido de Log') {
                        html += `
                            <div class="result-item">
                                <div class="item-title">${file.name}</div>
                                <div class="item-details">
                                    <span>Tipo: ${file.type}</span>
                                    <span>Ubicación: ${file.path}</span>
                                    ${file.lastModified ? `<span>Última modificación: ${new Date(file.lastModified).toLocaleString()}</span>` : ''}
                                    ${!file.isDirectory && file.size ? `<span>Tamaño: ${formatFileSize(file.size)}</span>` : ''}
                                    <a href="#" class="open-location-link" data-path="${file.path}">Abrir ubicación</a>
                                </div>
                            </div>
                        `;
                    }
                });
                
                // Mostrar mods si hay
                const modsList = result.files.find(f => f.type === 'Lista de Mods');
                if (modsList && modsList.files && modsList.files.length > 0) {
                    html += '<div class="section-title">Mods instalados:</div>';
                    
                    modsList.files.forEach(mod => {
                        html += `
                            <div class="result-item">
                                <div class="item-title">${mod.name}</div>
                                <div class="item-details">
                                    <span>Ubicación: ${mod.path}</span>
                                    <span>Última modificación: ${new Date(mod.lastModified).toLocaleString()}</span>
                                    <span>Tamaño: ${formatFileSize(mod.size)}</span>
                                    <a href="#" class="open-location-link" data-path="${mod.path}">Abrir ubicación</a>
                                </div>
                            </div>
                        `;
                    });
                }
                
                // Mostrar líneas relevantes del log
                const logLines = result.files.find(f => f.type === 'Contenido de Log');
                if (logLines && logLines.lines && logLines.lines.length > 0) {
                    html += '<div class="section-title">Líneas relevantes del log:</div>';
                    
                    html += '<div class="log-content">';
                    logLines.lines.forEach(line => {
                        let lineClass = 'log-line';
                        if (line.includes('ERROR') || line.includes('Exception')) {
                            lineClass += ' log-error';
                        } else if (line.includes('WARN')) {
                            lineClass += ' log-warning';
                        }
                        
                        html += `<div class="${lineClass}">${line}</div>`;
                    });
                    html += '</div>';
                }
                
                html += '</div>';
                
                minecraftFilesList.innerHTML = html;
                setupFileLocationLinks();
            } catch (error) {
                showError(minecraftFilesList, `Error inesperado: ${error.message}`);
            }
        });
    }
    
    // Exportar resultados
    if (exportResultsBtn) {
        exportResultsBtn.addEventListener('click', async () => {
            // Agregar una marca de tiempo a los resultados
            const exportData = {
                timestamp: window.keniboxAPI.getCurrentTime(),
                system: {
                    platform: navigator.platform,
                    userAgent: navigator.userAgent
                },
                results: { ...globalResults }
            };
            
            try {
                const result = await window.keniboxAPI.exportResults(exportData);
                
                if (result.error) {
                    alert(`Error al exportar: ${result.error}`);
                } else if (result.success) {
                    alert(`Resultados exportados correctamente a: ${result.path}`);
                }
            } catch (error) {
                alert(`Error al exportar resultados: ${error.message}`);
            }
        });
    }
    
    // Inicializar funciones automáticas
    const initAutomaticFunctions = async () => {
        // Detectar navegador al inicio
        await detectCurrentBrowser();
    };
    
    // Ejecutar funciones automáticas
    initAutomaticFunctions();
});