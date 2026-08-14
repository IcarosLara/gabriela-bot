const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) setTimeout(() => iniciarBot(), 5000);
        } else if (connection === 'open') {
            console.log('🚀 ¡Gabriela 1.5 en línea!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const textMessage = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            if (!textMessage) continue;
            
            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: msg.key.remoteJid,
                    message: textMessage
                });
                if (response.data && response.data.respuesta_bot) {
                    await sock.sendMessage(msg.key.remoteJid, { text: response.data.respuesta_bot });
                }
            } catch (err) { console.error('Error procesando mensaje:', err.message); }
        }
    });
}

iniciarBot();

// Healthcheck minimalista
http.createServer((req, res) => { res.end('OK'); }).listen(process.env.PORT || 3000);
