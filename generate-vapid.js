/**
 * Generador de claves VAPID para notificaciones Push
 * 
 * Uso:
 *   node generate-vapid.js
 *   o
 *   npm run generate-vapid
 * 
 * Guarda las claves generadas en un archivo .env:
 *   VAPID_PUBLIC=tu_clave_publica
 *   VAPID_PRIVATE=tu_clave_privada
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

console.log('🔑 Generando claves VAPID para Push Notifications...\n');

const vapidKeys = webpush.generateVAPIDKeys();

console.log('✅ Claves VAPID generadas exitosamente:\n');
console.log('📋 Copia estas líneas a tu archivo .env:');
console.log('─'.repeat(60));
console.log(`VAPID_PUBLIC=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE=${vapidKeys.privateKey}`);
console.log('─'.repeat(60));
console.log('');

// Intentar crear/actualizar archivo .env automáticamente
const envPath = path.join(__dirname, '.env');
const envContent = `# Claves VAPID para Push Notifications
# Generadas: ${new Date().toLocaleString()}
VAPID_PUBLIC=${vapidKeys.publicKey}
VAPID_PRIVATE=${vapidKeys.privateKey}
`;

try {
  if (fs.existsSync(envPath)) {
    console.log('El archivo .env ya existe.');
    console.log('Si quieres usar estas nuevas claves, agrégalas manualmente.');
  } else {
    fs.writeFileSync(envPath, envContent);
    console.log('Archivo .env creado automáticamente');
    console.log(`Ubicación: ${envPath}`);
  }
} catch (err) {
  console.log('No se pudo crear .env automáticamente:', err.message);
  console.log('Crea el archivo manualmente con las claves de arriba');
}

console.log('\nDocumentación:');
console.log('   - Reinicia el servidor después de configurar las claves');
console.log('   - No compartas tu VAPID_PRIVATE en repositorios públicos');
console.log('   - Usa VAPID_PUBLIC en el cliente (app.js)\n');