/**
 * Server Express para Task Manager PWA
 * 
 * Características:
 * - SSR (EJS): Splash y Home con renderizado servidor
 * - CSR (SPA): App cliente con funcionalidad completa
 * - API REST: CRUD de tareas con sincronización
 * - Push Notifications: Suscripciones y envío
 * - Almacenamiento: En memoria (migrar a DB en producción)
 * - Offline-first: Compatible con Service Worker
 */

require('dotenv').config(); // Cargar variables de entorno
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(bodyParser.json({ limit: '10mb' })); // Para fotos base64
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// Logs de requests (útil para desarrollo)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ==================== DATA STORE (En memoria - Demo) ====================
let TASKS = [
  { 
    id: 1, 
    title: 'Comprar leche', 
    description: 'Leche entera 1L', 
    completed: false, 
    location: null,
    photo: null,
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 3600000
  },
  { 
    id: 2, 
    title: 'Enviar reporte', 
    description: 'Reporte semanal al equipo', 
    completed: false,
    location: null,
    photo: null,
    createdAt: Date.now() - 7200000,
    updatedAt: Date.now() - 7200000
  }
];

let NEXT_ID = TASKS.length + 1;
const subscriptions = new Map(); // endpoint -> subscription object

// ==================== CONFIGURACIÓN VAPID ====================
const VAPID_PUBLIC = process.env.VAPID_PUBLIC || null;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || null;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@taskmanager.app';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log('✅ Web-push VAPID configurado correctamente');
} else {
  console.warn('⚠️  VAPID keys no encontradas. Push notifications deshabilitadas.');
  console.warn('   Ejecuta: npm run generate-vapid');
}

// ==================== RUTAS SSR ====================

// Splash screen
app.get('/splash', (req, res) => {
  res.render('splash');
});

// Home (SSR) - Lista de tareas desde servidor
app.get('/', (req, res) => {
  res.render('home', { 
    tasks: TASKS.sort((a, b) => b.createdAt - a.createdAt) 
  });
});

// ==================== RUTAS CSR ====================

// SPA Cliente
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Manifest y Service Worker (asegurar que se sirvan correctamente)
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// ==================== API REST - TASKS ====================

// GET /api/tasks - Obtener todas las tareas
app.get('/api/tasks', (req, res) => {
  // Simular latencia de red
  setTimeout(() => {
    res.json({ 
      ok: true, 
      tasks: TASKS.sort((a, b) => b.createdAt - a.createdAt),
      count: TASKS.length,
      timestamp: Date.now() 
    });
  }, 200);
});

// POST /api/tasks - Crear nueva tarea
app.post('/api/tasks', (req, res) => {
  const { title, description, completed, location, photo } = req.body;
  
  if (!title || title.trim() === '') {
    return res.status(400).json({ 
      ok: false, 
      error: 'El título es requerido' 
    });
  }

  const now = Date.now();
  const task = {
    id: NEXT_ID++,
    title: title.trim(),
    description: description ? description.trim() : '',
    completed: !!completed,
    location: location || null,
    photo: photo || null,
    createdAt: now,
    updatedAt: now
  };

  TASKS.push(task);
  console.log(`✅ Tarea creada: #${task.id} - ${task.title}`);

  res.status(201).json({ 
    ok: true, 
    task,
    message: 'Tarea creada exitosamente' 
  });
});

// PUT /api/tasks/:id - Actualizar tarea existente
app.put('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = TASKS.find(t => t.id === id);

  if (!task) {
    return res.status(404).json({ 
      ok: false, 
      error: 'Tarea no encontrada' 
    });
  }

  const { title, description, completed, location, photo } = req.body;

  if (typeof title !== 'undefined') task.title = title.trim();
  if (typeof description !== 'undefined') task.description = description.trim();
  if (typeof completed !== 'undefined') task.completed = !!completed;
  if (typeof location !== 'undefined') task.location = location;
  if (typeof photo !== 'undefined') task.photo = photo;
  
  task.updatedAt = Date.now();

  console.log(`✏️  Tarea actualizada: #${task.id} - ${task.title}`);

  res.json({ 
    ok: true, 
    task,
    message: 'Tarea actualizada exitosamente' 
  });
});

// DELETE /api/tasks/:id - Eliminar tarea
app.delete('/api/tasks/:id', (req, res) => {
  const id = Number(req.params.id);
  const initialLength = TASKS.length;
  
  TASKS = TASKS.filter(t => t.id !== id);
  const deleted = TASKS.length < initialLength;

  if (deleted) {
    console.log(`🗑️  Tarea eliminada: #${id}`);
  }

  res.json({ 
    ok: true, 
    deleted,
    message: deleted ? 'Tarea eliminada' : 'Tarea no encontrada'
  });
});

// DELETE /api/tasks - Eliminar todas las tareas
app.delete('/api/tasks', (req, res) => {
  const count = TASKS.length;
  TASKS = [];
  console.log(`🗑️  ${count} tareas eliminadas`);
  
  res.json({ 
    ok: true, 
    deleted: count,
    message: `${count} tareas eliminadas` 
  });
});

// ==================== API - SINCRONIZACIÓN ====================

// POST /api/sync - Sincronizar tareas desde cliente
app.post('/api/sync', (req, res) => {
  const incoming = req.body.tasks || [];
  const created = [];
  const updated = [];
  const mapping = []; // { localId, serverId }

  incoming.forEach(task => {
    // Tarea nueva desde cliente (sin ID o con _localId temporal)
    if (task._localId && !task.id) {
      const now = Date.now();
      const newTask = {
        id: NEXT_ID++,
        title: task.title || 'Sin título',
        description: task.description || '',
        completed: !!task.completed,
        location: task.location || null,
        photo: task.photo || null,
        createdAt: task.createdAt || now,
        updatedAt: now
      };
      TASKS.push(newTask);
      created.push(newTask);
      mapping.push({ localId: task._localId, serverId: newTask.id });
      console.log(`📤 Sincronizado (nuevo): ${task._localId} -> #${newTask.id}`);
    } 
    // Actualizar tarea existente
    else if (task.id) {
      const existing = TASKS.find(t => t.id === Number(task.id));
      if (existing) {
        existing.title = task.title !== undefined ? task.title : existing.title;
        existing.description = task.description !== undefined ? task.description : existing.description;
        existing.completed = task.completed !== undefined ? task.completed : existing.completed;
        existing.location = task.location !== undefined ? task.location : existing.location;
        existing.photo = task.photo !== undefined ? task.photo : existing.photo;
        existing.updatedAt = Date.now();
        updated.push(existing);
        console.log(`📤 Sincronizado (actualizado): #${existing.id}`);
      }
    }
  });

  res.json({ 
    ok: true, 
    created, 
    updated, 
    mapping,
    serverTasks: TASKS,
    message: `Sincronizadas: ${created.length} nuevas, ${updated.length} actualizadas`
  });
});

// ==================== API - PUSH NOTIFICATIONS ====================

// GET /api/vapid-public - Obtener clave pública VAPID
app.get('/api/vapid-public', (req, res) => {
  if (!VAPID_PUBLIC) {
    return res.status(503).json({ 
      ok: false, 
      error: 'VAPID no configurado en el servidor' 
    });
  }
  res.json({ ok: true, publicKey: VAPID_PUBLIC });
});

// POST /api/save-subscription - Guardar suscripción push del cliente
app.post('/api/save-subscription', (req, res) => {
  const sub = req.body;
  
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Suscripción inválida' 
    });
  }

  subscriptions.set(sub.endpoint, sub);
  console.log(`📬 Suscripción guardada: ${subscriptions.size} activas`);

  res.json({ 
    ok: true, 
    message: 'Suscripción guardada correctamente',
    totalSubscriptions: subscriptions.size
  });
});

// POST /api/send-notification - Enviar push a todas las suscripciones
app.post('/api/send-notification', async (req, res) => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return res.status(503).json({ 
      ok: false, 
      error: 'VAPID no configurado. Ejecuta: npm run generate-vapid' 
    });
  }

  if (subscriptions.size === 0) {
    return res.status(400).json({ 
      ok: false, 
      error: 'No hay suscripciones activas' 
    });
  }

  const payload = JSON.stringify({
    title: req.body.title || 'Task Manager',
    body: req.body.body || 'Tienes una notificación nueva',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: req.body.url || '/app'
  });

  const results = [];
  const failed = [];

  for (const [endpoint, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(sub, payload);
      results.push({ endpoint, status: 'sent' });
      console.log(`📤 Push enviado a: ${endpoint.substring(0, 50)}...`);
    } catch (err) {
      console.error(`❌ Error enviando push: ${err.message}`);
      results.push({ endpoint, status: 'failed', error: err.message });
      failed.push(endpoint);
      
      // Si la suscripción expiró (410 Gone), eliminarla
      if (err.statusCode === 410) {
        subscriptions.delete(endpoint);
        console.log(`🗑️  Suscripción expirada eliminada`);
      }
    }
  }

  res.json({ 
    ok: true, 
    results,
    total: subscriptions.size,
    sent: results.length - failed.length,
    failed: failed.length,
    message: `Push enviado a ${results.length - failed.length}/${subscriptions.size} suscripciones`
  });
});

// ==================== MANEJO DE ERRORES ====================

// 404 - Ruta no encontrada
app.use((req, res) => {
  res.status(404).json({ 
    ok: false, 
    error: 'Ruta no encontrada',
    path: req.path 
  });
});

// Error handler general
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ 
    ok: false, 
    error: 'Error interno del servidor',
    message: err.message 
  });
});

// ==================== INICIO DEL SERVIDOR ====================

app.listen(PORT, () => {
  console.log('\n🚀 Task Manager PWA Server');
  console.log('─'.repeat(50));
  console.log(`📡 Servidor ejecutándose en: http://localhost:${PORT}`);
  console.log('');
  console.log('📄 Rutas disponibles:');
  console.log(`   🌐 SSR Splash:    http://localhost:${PORT}/splash`);
  console.log(`   🌐 SSR Home:      http://localhost:${PORT}/`);
  console.log(`   ⚡ CSR App:       http://localhost:${PORT}/app`);
  console.log('');
  console.log('🔌 API Endpoints:');
  console.log(`   GET    /api/tasks           - Listar tareas`);
  console.log(`   POST   /api/tasks           - Crear tarea`);
  console.log(`   PUT    /api/tasks/:id       - Actualizar tarea`);
  console.log(`   DELETE /api/tasks/:id       - Eliminar tarea`);
  console.log(`   POST   /api/sync            - Sincronizar`);
  console.log(`   POST   /api/save-subscription - Guardar push`);
  console.log(`   POST   /api/send-notification - Enviar push`);
  console.log('─'.repeat(50));
  
  if (VAPID_PUBLIC) {
    console.log('✅ Push Notifications: Habilitadas');
  } else {
    console.log('⚠️  Push Notifications: Deshabilitadas (falta VAPID)');
  }
  console.log('');
});