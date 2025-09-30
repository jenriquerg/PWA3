/**
 * Service Worker - Task Manager PWA
 * Estrategias: Network-first para API, Cache-first para assets
 * Soporte: Offline, Push notifications, Background sync
 */

const CACHE_NAME = 'task-manager-v1';
const API_CACHE = 'task-api-v1';

const CORE_ASSETS = [
  '/',
  '/app',
  '/splash',
  '/public/app.html',
  '/public/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: cachear assets core
self.addEventListener('install', event => {
  console.log('[SW] Instalando service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Assets core cacheados');
        return cache.addAll(CORE_ASSETS);
      })
      .catch(err => console.error('[SW] Error en install:', err))
  );
  self.skipWaiting();
});

// Activate: limpiar caches antiguos
self.addEventListener('activate', event => {
  console.log('[SW] Activando service worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME && name !== API_CACHE)
          .map(name => {
            console.log('[SW] Eliminando cache antiguo:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: estrategia según tipo de recurso
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API: Network-first con cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstStrategy(request, API_CACHE));
    return;
  }

  // Assets: Cache-first con network fallback
  event.respondWith(cacheFirstStrategy(request));
});

// Network-first: intenta red, luego cache
async function networkFirstStrategy(request, cacheName) {
  try {
    const response = await fetch(request);
    // Solo cachear respuestas exitosas
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Red falló, usando cache:', request.url);
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // Si no hay cache, retornar respuesta offline
    return new Response(
      JSON.stringify({ 
        offline: true, 
        error: 'Sin conexión', 
        data: [] 
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 503
      }
    );
  }
}

// Cache-first: intenta cache, luego red
async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Cachear nuevos assets si son exitosos
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Error fetch:', request.url);
    // Fallback a páginas offline si existen
    if (request.mode === 'navigate') {
      return caches.match('/app') || caches.match('/');
    }
    throw error;
  }
}

// Push: mostrar notificación
self.addEventListener('push', event => {
  console.log('[SW] Push recibido');
  let data = { 
    title: 'Task Manager', 
    body: 'Tienes una actualización',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    tag: 'task-notification',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/app' },
    actions: [
      { action: 'open', title: 'Ver' },
      { action: 'close', title: 'Cerrar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Click en notificación
self.addEventListener('notificationclick', event => {
  console.log('[SW] Click en notificación:', event.action);
  event.notification.close();

  if (event.action === 'close') return;

  const urlToOpen = event.notification.data?.url || '/app';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Si ya hay ventana abierta, enfocarla
        for (const client of clientList) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        // Si no, abrir nueva ventana
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Background Sync (opcional, para sincronizar tareas offline)
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-tasks') {
    event.waitUntil(syncTasks());
  }
});

async function syncTasks() {
  console.log('[SW] Sincronizando tareas...');
}