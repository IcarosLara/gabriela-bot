const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT = "5493812385889"; 

async function iniciarBot() {
    // Usamos el gestor de estado nativo sin borrados forzados que rompan el hilo
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = NUMERO_BOT.replace(/[^0-9]/g, '');
                console.log(`\n⏳ Solicitando Código de Vinculación para: +${phoneNumber}...\n`);
                
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
            console.log(`[RED]: Conexión cerrada. Código de salida: ${statusCode}`);
            
            // Reconexión limpia sin colisionar archivos
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => iniciarBot(), 6000);
            } else {
                console.log('[CRÍTICO]: Sesión invalidada por el servidor. Reinicie el contenedor en Railway tras limpiar volúmenes.');
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡CONEXIÓN ESTABLECIDA CON ÉXITO ABSOLUTO!\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const sender = msg.key.remoteJid;
            const textMessage = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            if (!textMessage || msg.key.fromMe) continue;

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                }, { timeout: 8000 });

                if (response.data && response.data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: response.data.respuesta_bot });
                }
            } catch (err) {
                console.error('[API WEBHOOK ERROR]:', err.message);
            }
        }
    });
}

iniciarBot();

// Healthcheck blindado para Railway en puerto 8080
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela Stable Core - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
