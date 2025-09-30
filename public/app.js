/**
 * Task Manager - Client Side App (CSR)
 * 
 * Características:
 * - IndexedDB para almacenamiento local offline-first
 * - Sincronización bidireccional con servidor
 * - Cámara, geolocalización, notificaciones
 * - Manejo automático de conexión/desconexión
 * - Push notifications con VAPID
 */

// ==================== CONFIGURACIÓN ====================
const DB_NAME = 'task-manager-db';
const DB_VERSION = 1;
const DB_STORE = 'tasks';

// ==================== INDEXEDDB HELPERS ====================

/**
 * Abre o crea la base de datos IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Crear object store si no existe
      if (!db.objectStoreNames.contains(DB_STORE)) {
        const store = db.createObjectStore(DB_STORE, { keyPath: 'clientId' });
        store.createIndex('by_createdAt', 'createdAt', { unique: false });
        store.createIndex('by_dirty', 'dirty', { unique: false });
        console.log('IndexedDB inicializado');
      }
    };
    
    request.onsuccess = () => {
      resolve(request.result);
    };
    
    request.onerror = () => {
      console.error('Error abriendo IndexedDB:', request.error);
      reject(request.error);
    };
  });
}

/**
 * Guarda una tarea localmente y la marca como "dirty" para sincronización
 * @param {Object} task - Tarea a guardar
 */
async function saveTaskLocal(task) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  
  // Asignar ID temporal si es tarea nueva
  if (!task.clientId) {
    task.clientId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    task._localId = task.clientId;
  }
  
  task.dirty = true; // Marcar para sincronización
  task.createdAt = task.createdAt || Date.now();
  task.updatedAt = Date.now();
  
  store.put(task);
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      console.log('💾 Tarea guardada localmente:', task.clientId);
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Actualiza una tarea sin marcarla como dirty
 * @param {Object} task - Tarea a actualizar
 */
async function putTaskLocalClean(task) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  
  task.dirty = false;
  task.updatedAt = Date.now();
  store.put(task);
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Verifica si hay tareas pendientes de sincronizar
 * @returns {Promise<boolean>}
 */
async function hasPendingSync() {
  const tasks = await getAllTasksLocal();
  return tasks.some(t => 
    t.dirty || 
    t.deleted || 
    t.clientId.startsWith('local_')
  );
}

/**
 * Obtiene todas las tareas del almacenamiento local
 * @returns {Promise<Array>}
 */
async function getAllTasksLocal() {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.getAll();
    
    request.onsuccess = () => {
      const tasks = request.result
        .filter(t => !t.deleted) // Excluir eliminadas
        .sort((a, b) => b.createdAt - a.createdAt);
      resolve(tasks);
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Elimina una tarea localmente (marca como deleted si viene del servidor)
 * @param {string} clientId - ID de la tarea
 */
async function deleteTaskLocal(clientId) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  
  const getRequest = store.get(clientId);
  
  return new Promise((resolve, reject) => {
    getRequest.onsuccess = () => {
      const task = getRequest.result;
      if (!task) {
        console.warn(' Tarea no encontrada:', clientId);
        resolve();
        return;
      }
      
      // Si viene del servidor, marcar como deleted para sincronizar
      if (clientId.startsWith('server_')) {
        task.deleted = true;
        task.dirty = true;
        task.updatedAt = Date.now();
        store.put(task);
        console.log('  Tarea marcada para eliminación:', clientId);
      } else {
        // Tarea solo local: eliminar directamente
        store.delete(clientId);
        console.log('  Tarea eliminada localmente:', clientId);
      }
    };
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Reemplaza una tarea local con una del servidor
 * @param {string} localClientId - ID local temporal
 * @param {Object} serverTask - Tarea del servidor
 */
async function replaceLocalWithServer(localClientId, serverTask) {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  
  // Eliminar entrada local temporal
  store.delete(localClientId);
  
  // Crear nueva entrada con ID del servidor
  const clientId = `server_${serverTask.id}`;
  const newTask = {
    ...serverTask,
    clientId,
    dirty: false,
    _localId: null
  };
  
  store.put(newTask);
  console.log('Tarea sincronizada:', localClientId, '→', clientId);
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Limpia todas las tareas locales
 */
async function clearAllTasksLocal() {
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  const store = tx.objectStore(DB_STORE);
  
  store.clear();
  console.log('  Todas las tareas locales eliminadas');
  
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ==================== ELEMENTOS DEL DOM ====================
const titleInput = document.getElementById('titleInput');
const descInput = document.getElementById('descInput');
const createTaskBtn = document.getElementById('createTask');
const tasksList = document.getElementById('tasksList');
const taskCount = document.getElementById('taskCount');
const syncBtn = document.getElementById('syncBtn');
const clearAllBtn = document.getElementById('clearAll');
const statusEl = document.getElementById('status');
const syncStatus = document.getElementById('syncStatus');
const getLocationBtn = document.getElementById('getLocation');
const openCameraBtn = document.getElementById('openCamera');
const cameraPreview = document.getElementById('cameraPreview');
const photoCanvas = document.getElementById('photoCanvas');
const photoPreview = document.getElementById('photoPreview');
const createResult = document.getElementById('createResult');
const installBtn = document.getElementById('installBtn');

// Push notification elements
const notifBtn = document.getElementById('notifBtn');
const subscribePushBtn = document.getElementById('subscribePush');
const triggerServerPushBtn = document.getElementById('triggerServerPush');
const pushResult = document.getElementById('pushResult');

// ==================== ESTADO DE LA APLICACIÓN ====================
let currentLocation = null;
let mediaStream = null;
let latestPhotoDataUrl = null;
let isCameraOpen = false;
let deferredInstallPrompt = null;

// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('Service Worker registrado:', reg.scope);
    })
    .catch(err => {
      console.error('Error registrando Service Worker:', err);
    });
}

// Detectar evento de instalación PWA
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  
  if (installBtn) {
    installBtn.style.display = 'inline-flex';
  }
  
  console.log('📥 PWA lista para instalar');
});

// Manejar clic en botón de instalación
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      showMessage(createResult, 'La app ya está instalada o no se puede instalar', 'info');
      return;
    }
    
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    
    console.log(`👤 Usuario ${outcome === 'accepted' ? 'aceptó' : 'rechazó'} la instalación`);
    
    deferredInstallPrompt = null;
    installBtn.style.display = 'none';
  });
}

// ==================== RENDERIZADO DE UI ====================

/**
 * Renderiza la lista de tareas en el DOM
 */
async function renderTasks() {
  const tasks = await getAllTasksLocal();
  
  tasksList.innerHTML = '';
  
  if (taskCount) {
    taskCount.textContent = tasks.length;
  }
  
  if (tasks.length === 0) {
    tasksList.innerHTML = `
      <div class="empty">
        <p>📭 No tienes tareas aún</p>
        <p class="muted">Crea tu primera tarea arriba</p>
      </div>
    `;
    return;
  }
  
  tasks.forEach(task => {
    const taskEl = createTaskElement(task);
    tasksList.appendChild(taskEl);
  });
}

/**
 * Crea el elemento DOM para una tarea
 * @param {Object} task - Tarea a renderizar
 * @returns {HTMLElement}
 */
function createTaskElement(task) {
  const div = document.createElement('div');
  div.className = 'task';
  
  // Parte izquierda: checkbox + contenido
  const leftDiv = document.createElement('div');
  leftDiv.className = 'task-left';
  
  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!task.completed;
  checkbox.addEventListener('change', () => handleTaskToggle(task, checkbox.checked));
  
  // Contenido de la tarea
  const contentDiv = document.createElement('div');
  contentDiv.className = 'task-content';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'task-title';
  titleDiv.textContent = task.title;
  if (task.completed) {
    titleDiv.style.textDecoration = 'line-through';
    titleDiv.style.opacity = '0.6';
  }
  
  contentDiv.appendChild(titleDiv);
  
  if (task.description) {
    const descDiv = document.createElement('div');
    descDiv.className = 'task-desc';
    descDiv.textContent = task.description;
    contentDiv.appendChild(descDiv);
  }
  
  // Metadatos
  const metaDiv = document.createElement('div');
  metaDiv.className = 'task-meta';
  
  const timeStr = new Date(task.createdAt).toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
  metaDiv.textContent = timeStr;
  
  contentDiv.appendChild(metaDiv);
  
  leftDiv.appendChild(checkbox);
  leftDiv.appendChild(contentDiv);
  
  // Parte derecha: acciones
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'task-actions';
  
  // Badge de estado de sincronización
  const syncBadge = document.createElement('span');
  syncBadge.className = 'muted';
  syncBadge.style.fontSize = '0.75rem';
  
  if (task.clientId.startsWith('local_')) {
    syncBadge.textContent = 'Offline';
    syncBadge.title = 'Pendiente de sincronizar';
  } else if (task.dirty) {
    syncBadge.textContent = 'Sync';
    syncBadge.title = 'Pendiente de sincronizar';
  } else {
    syncBadge.textContent = 'OK';
    syncBadge.title = 'Sincronizado';
  }
  
  actionsDiv.appendChild(syncBadge);
  
  // Preview de foto si existe
  if (task.photo) {
    const img = document.createElement('img');
    img.src = task.photo;
    img.style.maxWidth = '48px';
    img.style.height = '48px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    img.style.cursor = 'pointer';
    img.title = 'Click para ver';
    img.addEventListener('click', () => {
      window.open(task.photo, '_blank');
    });
    actionsDiv.appendChild(img);
  }
  
  // Botón eliminar
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-secondary btn-small';
  deleteBtn.textContent = '';
  deleteBtn.title = 'Eliminar tarea';
  deleteBtn.addEventListener('click', () => handleTaskDelete(task));
  
  actionsDiv.appendChild(deleteBtn);
  
  div.appendChild(leftDiv);
  div.appendChild(actionsDiv);
  
  return div;
}

// ==================== MANEJO DE EVENTOS ====================

/**
 * Maneja el toggle del checkbox de tarea
 */
async function handleTaskToggle(task, completed) {
  task.completed = completed;
  task.dirty = true;
  task.updatedAt = Date.now();
  
  const db = await openDB();
  const tx = db.transaction(DB_STORE, 'readwrite');
  tx.objectStore(DB_STORE).put(task);
  
  await new Promise(resolve => tx.oncomplete = resolve);
  
  updateStatus('Sincronizando...');
  renderTasks();
  
  // Vibrar si está disponible
  if (navigator.vibrate) {
    navigator.vibrate(50);
  }
  
  // Intentar sincronizar
  if (navigator.onLine) {
    try {
      await syncPendingTasks();
      updateStatus('Sincronizado', 'success');
    } catch (err) {
      updateStatus('Sincronización pendiente', 'info');
    }
  } else {
    updateStatus('Offline - Cambio guardado localmente', 'info');
  }
}

/**
 * Maneja la eliminación de una tarea
 */
async function handleTaskDelete(task) {
  if (!confirm(`¿Eliminar "${task.title}"?`)) return;
  
  await deleteTaskLocal(task.clientId);
  updateStatus(' Tarea eliminada');
  renderTasks();
  
  // Intentar sincronizar eliminación
  if (navigator.onLine) {
    try {
      await syncPendingTasks();
      updateStatus('Sincronizado', 'success');
    } catch (err) {
      updateStatus('Eliminación pendiente de sincronizar', 'info');
    }
  }
}

/**
 * Crea una nueva tarea
 */
createTaskBtn.addEventListener('click', async () => {
  const title = titleInput.value.trim();
  const description = descInput.value.trim();
  
  if (!title) {
    showMessage(createResult, 'Por favor escribe un título', 'error');
    titleInput.focus();
    return;
  }
  
  const task = {
    title,
    description,
    completed: false,
    location: currentLocation,
    photo: latestPhotoDataUrl,
    createdAt: Date.now()
  };
  
  await saveTaskLocal(task);
  
  // Limpiar formulario
  titleInput.value = '';
  descInput.value = '';
  currentLocation = null;
  latestPhotoDataUrl = null;
  if (photoPreview) photoPreview.style.display = 'none';
  
  showMessage(createResult, 'Tarea creada localmente', 'success');
  renderTasks();
  
  // Intentar sincronizar inmediatamente si hay conexión
  if (navigator.onLine) {
    updateStatus('Sincronizando...');
    try {
      await syncPendingTasks();
      updateStatus('Sincronizado', 'success');
      showMessage(createResult, 'Tarea creada y sincronizada', 'success');
    } catch (err) {
      updateStatus('Sincronización pendiente', 'info');
      showMessage(createResult, 'Tarea creada (sincronización pendiente)', 'info');
    }
  } else {
    updateStatus('Offline - Tarea guardada localmente', 'info');
  }
});

// ==================== GEOLOCALIZACIÓN ====================
getLocationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showMessage(createResult, 'Geolocalización no soportada', 'error');
    return;
  }
  
  getLocationBtn.disabled = true;
  getLocationBtn.textContent = ' Obteniendo...';
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      
      showMessage(
        createResult,
        ` Ubicación: ${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}`,
        'success'
      );
      
      getLocationBtn.textContent = 'Ubicación agregada';
      setTimeout(() => {
        getLocationBtn.textContent = ' Ubicación';
        getLocationBtn.disabled = false;
      }, 2000);
    },
    (error) => {
      console.error('Error de geolocalización:', error);
      showMessage(createResult, `Error: ${error.message}`, 'error');
      getLocationBtn.textContent = ' Ubicación';
      getLocationBtn.disabled = false;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
});

// ==================== CÁMARA ====================
openCameraBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMessage(createResult, 'Cámara no soportada en este dispositivo', 'error');
    return;
  }
  
  if (!isCameraOpen) {
    // Abrir cámara
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      
      cameraPreview.srcObject = mediaStream;
      cameraPreview.style.display = 'block';
      photoCanvas.style.display = 'none';
      if (photoPreview) photoPreview.style.display = 'none';
      
      openCameraBtn.textContent = '📸 Capturar';
      openCameraBtn.classList.add('btn-success');
      isCameraOpen = true;
      
      showMessage(createResult, '📷 Cámara abierta - Presiona "Capturar"', 'info');
    } catch (err) {
      console.error('Error abriendo cámara:', err);
      showMessage(createResult, `No se pudo abrir la cámara: ${err.message}`, 'error');
    }
  } else {
    // Capturar foto
    const video = cameraPreview;
    photoCanvas.width = video.videoWidth || 640;
    photoCanvas.height = video.videoHeight || 480;
    
    const ctx = photoCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, photoCanvas.width, photoCanvas.height);
    
    latestPhotoDataUrl = photoCanvas.toDataURL('image/jpeg', 0.7);
    
    // Mostrar preview
    if (photoPreview) {
      photoPreview.src = latestPhotoDataUrl;
      photoPreview.style.display = 'block';
    }
    
    // Cerrar cámara
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    
    cameraPreview.style.display = 'none';
    openCameraBtn.textContent = '📸 Foto';
    openCameraBtn.classList.remove('btn-success');
    isCameraOpen = false;
    
    showMessage(createResult, 'Foto capturada', 'success');
  }
});

// ==================== SINCRONIZACIÓN ====================

/**
 * Sincroniza tareas pendientes con el servidor
 */
async function syncPendingTasks() {
  if (!navigator.onLine) {
    throw new Error('Sin conexión a internet');
  }
  
  console.log('Iniciando sincronización...');
  
  const allTasks = await getAllTasksLocal();
  let syncedCount = 0;
  
  // 1. CREAR tareas nuevas (que empiezan con 'local_')
  const localTasks = allTasks.filter(t => !t.deleted && t.clientId.startsWith('local_'));
  
  for (const task of localTasks) {
    try {
      console.log('Creando tarea en servidor:', task.title);
      
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: task.title,
          description: task.description,
          completed: task.completed,
          location: task.location,
          photo: task.photo
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.ok && data.task) {
        console.log('Tarea creada en servidor con ID:', data.task.id);
        await replaceLocalWithServer(task.clientId, data.task);
        syncedCount++;
      }
    } catch (err) {
      console.error('Error creando tarea en servidor:', err);
      throw err;
    }
  }
  
  // Refrescar tareas después de crear
  const updatedTasks = await getAllTasksLocal();
  
  // 2. ACTUALIZAR tareas modificadas del servidor (que empiezan con 'server_')
  const serverTasks = updatedTasks.filter(t => t.clientId.startsWith('server_'));
  
  for (const task of serverTasks) {
    const serverId = parseInt(task.clientId.split('_')[1]);
    
    // 2a. Eliminar si está marcada como deleted
    if (task.deleted) {
      try {
        console.log('Eliminando tarea en servidor:', serverId);
        
        const response = await fetch(`/api/tasks/${serverId}`, { 
          method: 'DELETE' 
        });
        
        if (response.ok) {
          // Eliminar localmente
          const db = await openDB();
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(task.clientId);
          await new Promise(resolve => tx.oncomplete = resolve);
          console.log('Tarea eliminada');
          syncedCount++;
        }
      } catch (err) {
        console.error('Error eliminando tarea en servidor:', err);
        throw err;
      }
    } 
    // 2b. Actualizar si está marcada como dirty
    else if (task.dirty) {
      try {
        console.log('Actualizando tarea en servidor:', serverId);
        
        const response = await fetch(`/api/tasks/${serverId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            completed: task.completed,
            location: task.location,
            photo: task.photo
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.ok) {
          await putTaskLocalClean(task);
          console.log('Tarea actualizada');
          syncedCount++;
        }
      } catch (err) {
        console.error('Error actualizando tarea en servidor:', err);
        throw err;
      }
    }
  }
  
  // 3. PULL: Obtener todas las tareas del servidor y mergear
  try {
    console.log('Obteniendo tareas del servidor...');
    
    const response = await fetch('/api/tasks');
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ok && data.tasks) {
      console.log(`📋 Recibidas ${data.tasks.length} tareas del servidor`);
      
      // Obtener IDs locales actuales
      const localTaskIds = new Set(
        (await getAllTasksLocal()).map(t => t.clientId)
      );
      
      // Mergear tareas del servidor
      for (const serverTask of data.tasks) {
        const clientId = `server_${serverTask.id}`;
        
        // Solo agregar/actualizar si no existe localmente o no está dirty
        const db = await openDB();
        const tx = db.transaction(DB_STORE, 'readonly');
        const existing = await new Promise(resolve => {
          const req = tx.objectStore(DB_STORE).get(clientId);
          req.onsuccess = () => resolve(req.result);
        });
        
        // Si no existe o no está dirty, actualizar con datos del servidor
        if (!existing || !existing.dirty) {
          await putTaskLocalClean({ ...serverTask, clientId });
        }
      }
      
      console.log('Tareas del servidor mergeadas');
    }
  } catch (err) {
    console.warn('Error obteniendo tareas del servidor:', err);
    // No lanzar error aquí, la sincronización local ya se hizo
  }
  
  await renderTasks();
  console.log(`Sincronización completada: ${syncedCount} cambios`);
  
  return syncedCount;
}

// Botón de sincronización manual
syncBtn.addEventListener('click', async () => {
  if (!navigator.onLine) {
    showMessage(syncStatus, 'Sin conexión a internet', 'error');
    return;
  }
  
  syncBtn.disabled = true;
  syncBtn.textContent = 'Sincronizando...';
  updateStatus('Sincronizando manualmente...');
  
  try {
    await syncPendingTasks();
    updateStatus('Sincronización completada', 'success');
    showMessage(syncStatus, 'Sincronizado correctamente', 'success');
  } catch (err) {
    console.error('Error en sincronización:', err);
    updateStatus('Error en sincronización', 'error');
    showMessage(syncStatus, 'Error al sincronizar', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sincronizar';
  }
});

// Botón limpiar todo
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar TODAS las tareas locales? Esta acción no se puede deshacer.')) {
      return;
    }
    
    try {
      // Si hay conexión, eliminar también en el servidor
      if (navigator.onLine) {
        await fetch('/api/tasks', { method: 'DELETE' });
      }
      
      await clearAllTasksLocal();
      await renderTasks();
      updateStatus(' Todas las tareas eliminadas', 'success');
    } catch (err) {
      console.error('Error limpiando tareas:', err);
      updateStatus('Error al eliminar tareas', 'error');
    }
  });
}

// ==================== EVENTOS DE CONEXIÓN ====================

window.addEventListener('online', async () => {
  updateStatus('🟢 Conexión restaurada - Sincronizando...');
  
  try {
    await syncPendingTasks();
    updateStatus('Sincronizado', 'success');
  } catch (err) {
    updateStatus('Sincronización incompleta', 'info');
  }
});

window.addEventListener('offline', () => {
  updateStatus('Sin conexión - Modo offline activado', 'info');
});

// ==================== NOTIFICACIONES ====================

// Pedir permiso y mostrar notificación local
notifBtn.addEventListener('click', async () => {
  if (!('Notification' in window)) {
    showMessage(pushResult, 'Notificaciones no soportadas', 'error');
    return;
  }
  
  let permission = Notification.permission;
  
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  
  if (permission === 'granted') {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('Task Manager', {
        body: 'Notificaciones habilitadas correctamente',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'test-notification',
        vibrate: [200, 100, 200]
      });
    } else {
      new Notification('Task Manager', {
        body: 'Notificaciones habilitadas',
        icon: '/icons/icon-192.png'
      });
    }
    
    showMessage(pushResult, 'Notificaciones habilitadas', 'success');
  } else {
    showMessage(pushResult, 'Permiso de notificaciones denegado', 'error');
  }
});

// Suscribirse a Push Notifications
subscribePushBtn.addEventListener('click', async () => {
  if (!('serviceWorker' in navigator)) {
    showMessage(pushResult, 'Service Worker requerido', 'error');
    return;
  }
  
  if (!('PushManager' in window)) {
    showMessage(pushResult, 'Push no soportado en este navegador', 'error');
    return;
  }
  
  try {
    // Obtener clave pública VAPID del servidor
    const vapidResponse = await fetch('/api/vapid-public');
    const vapidData = await vapidResponse.json();
    
    if (!vapidData.ok) {
      showMessage(pushResult, 'VAPID no configurado en el servidor', 'error');
      return;
    }
    
    const publicKey = vapidData.publicKey;
    
    // Pedir permiso
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showMessage(pushResult, 'Permiso de notificaciones denegado', 'error');
      return;
    }
    
    // Suscribirse
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    
  const saveResponse = await fetch('/api/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    
    const saveData = await saveResponse.json();
    
    if (saveData.ok) {
      showMessage(pushResult, 'Suscripción a Push guardada correctamente', 'success');
      console.log('📬 Suscrito a Push Notifications');
    } else {
      showMessage(pushResult, 'Error guardando suscripción', 'error');
    }
  } catch (err) {
    console.error('Error suscribiendo a push:', err);
    showMessage(pushResult, `Error: ${err.message}`, 'error');
  }
});

// Enviar notificación push de prueba desde el servidor
triggerServerPushBtn.addEventListener('click', async () => {
  const title = prompt('Título de la notificación:', 'Task Manager');
  const body = prompt('Mensaje:', 'Tienes tareas pendientes');
  
  if (!title || !body) return;
  
  try {
    const response = await fetch('/api/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, url: '/app' })
    });
    
    const data = await response.json();
    
    if (data.ok) {
      showMessage(
        pushResult,
        `Push enviado: ${data.sent}/${data.total} suscripciones`,
        'success'
      );
      console.log('Push enviado:', data);
    } else {
      showMessage(pushResult, `Error: ${data.error}`, 'error');
    }
  } catch (err) {
    console.error('Error enviando push:', err);
    showMessage(pushResult, `Error: ${err.message}`, 'error');
  }
});

// ==================== HELPERS ====================

/**
 * Actualiza el indicador de estado de conexión
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo de estado (success, error, info)
 */
function updateStatus(message, type = 'info') {
  if (!statusEl) return;
  
  // Actualizar clase de estado
  statusEl.className = 'status-indicator';
  
  if (navigator.onLine) {
    statusEl.classList.add('status-online');
    if (type === 'success') {
      statusEl.innerHTML = '🟢 ' + message;
    } else if (type === 'error') {
      statusEl.innerHTML = '🔴 ' + message;
    } else {
      statusEl.innerHTML = '🟡 ' + message;
    }
  } else {
    statusEl.classList.add('status-offline');
    statusEl.innerHTML = 'Offline';
  }
  
  // Limpiar mensaje después de 5 segundos si es success o info
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      if (navigator.onLine) {
        statusEl.innerHTML = '🟢 Online';
      } else {
        statusEl.innerHTML = 'Offline';
      }
    }, 5000);
  }
}

/**
 * Muestra un mensaje temporal en un elemento
 * @param {HTMLElement} element - Elemento donde mostrar el mensaje
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo (success, error, info)
 */
function showMessage(element, message, type = 'info') {
  if (!element) return;
  
  element.textContent = message;
  element.className = `result-msg result-${type}`;
  element.style.display = 'block';
  
  // Ocultar después de 5 segundos
  setTimeout(() => {
    element.style.display = 'none';
  }, 5000);
}

/**
 * Convierte clave VAPID base64 a Uint8Array
 * @param {string} base64String - Clave en formato base64
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  if (!base64String) return undefined;
  
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  
  return outputArray;
}

/**
 * Escapa caracteres HTML para prevenir XSS
 * @param {string} str - String a escapar
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== INICIALIZACIÓN ====================

/**
 * Inicializa la aplicación
 */
/**
 * Inicializa la aplicación
 */
async function init() {
  console.log('Inicializando Task Manager...');
  
  // Renderizar tareas existentes
  await renderTasks();
  
  // Actualizar estado de conexión
  updateStatus(navigator.onLine ? 'Online' : 'Offline');
  
  // Verificar si hay tareas pendientes de sincronizar
  const pending = await hasPendingSync();
  
  if (pending) {
    console.log('Hay tareas pendientes de sincronizar');
  }
  
  // Sincronizar si hay conexión
  if (navigator.onLine) {
    updateStatus('Sincronizando con servidor...');
    try {
      const syncedCount = await syncPendingTasks();
      
      if (syncedCount > 0) {
        updateStatus(`${syncedCount} cambios sincronizados`, 'success');
      } else {
        updateStatus('Todo sincronizado', 'success');
      }
    } catch (err) {
      console.error('Error en sincronización inicial:', err);
      updateStatus('Sincronización pendiente', 'info');
    }
  } else {
    updateStatus('Modo offline - Datos locales', 'info');
  }
  
  console.log('App inicializada');
}

// ==================== EVENTOS GLOBALES ====================

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Sincronizar antes de cerrar/recargar página
window.addEventListener('beforeunload', async (e) => {
  if (navigator.onLine) {
    const tasks = await getAllTasksLocal();
    const hasPending = tasks.some(t => t.dirty || t.deleted);
    
    if (hasPending) {
      e.preventDefault();
      e.returnValue = 'Tienes cambios sin sincronizar. ¿Seguro que quieres salir?';
      
      // Intentar sincronizar en background
      try {
        await syncPendingTasks();
      } catch (err) {
        console.warn('No se pudo sincronizar antes de salir');
      }
    }
  }
});

// Manejar visibilidad de la página (sincronizar al volver)
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && navigator.onLine) {
    console.log('  Página visible - Verificando sincronización...');
    try {
      await syncPendingTasks();
      updateStatus('Sincronizado', 'success');
    } catch (err) {
      console.warn('Sincronización automática falló:', err);
    }
  }
});

// Detectar cambios en el almacenamiento (tabs múltiples)
window.addEventListener('storage', (e) => {
  if (e.key === 'tasks-updated') {
    console.log(' Cambios detectados en otra pestaña');
    renderTasks();
  }
});

// ==================== DEBUG (solo desarrollo) ====================

// Exponer funciones útiles en consola para desarrollo
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window.TaskManagerDebug = {
    openDB,
    getAllTasksLocal,
    clearAllTasksLocal,
    syncPendingTasks,
    renderTasks,
    version: '1.0.0'
  };
  
  console.log(' Debug mode activo. Usa window.TaskManagerDebug para inspeccionar.');
}

// ==================== EXPORT (si se usa como módulo) ====================

// Si se carga como módulo ES6
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openDB,
    saveTaskLocal,
    getAllTasksLocal,
    deleteTaskLocal,
    syncPendingTasks
  };
}