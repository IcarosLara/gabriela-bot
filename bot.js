const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT = "5493812385889"; // Tu número institucional blindado

async function iniciarBot() {
    const authFolder = path.join(__dirname, 'auth_info_v2');
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        // Forzamos un navegador de escritorio para mayor compatibilidad
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    // ==========================================================================
    // 🔑 FORZADO DE PAIRING CODE (BYPASS QR)
    // ==========================================================================
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = NUMERO_BOT.replace(/[^0-9]/g, '');
                console.log(`\n⏳ Solicitando Código de Vinculación para: +${phoneNumber}...\n`);
                
                // Esta línea genera el código de 8 caracteres que verás en los logs
                const code = await sock.requestPairingCode(phoneNumber);
                
                console.log(`\n==================================================`);
                console.log(`🔑 TU CÓDIGO DE 8 CARACTERES: ${code}`);
                console.log(`==================================================\n`);
                console.log(`👉 EN TU CELULAR: WhatsApp > Dispositivos Vinculados > Vincular con número.`);
            } catch (err) {
                console.error('[ERROR AL SOLICITAR CÓDIGO]:', err.message);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) {
                console.log(`[401] Sesión inválida. Purgando auth_info_v2...`);
                fs.rmSync(authFolder, { recursive: true, force: true });
            }
            setTimeout(() => iniciarBot(), 5000);
        } else if (connection === 'open') {
            console.log('\n🚀 ¡CONEXIÓN ESTABLECIDA EXITOSAMENTE!\n');
        }
    });
    
    // Aquí iría tu lógica de mensajes...
}

iniciarBot();

// Healthcheck minimalista para Railway
http.createServer((req, res) => { res.end('OK'); }).listen(process.env.PORT || 8080);
