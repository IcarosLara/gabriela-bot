const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');

// 1. CONFIGURACIÓN GENERAL CON TUS DATOS CARGADOS
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';

// Configuración de teléfonos (Formato internacional sin +)
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 

// Método de vinculación: 'CODE' para código de 8 dígitos, 'QR' para código QR
const METODO_VINCULACION = process.env.METODO_VINCULACION || 'CODE'; 

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: METODO_VINCULACION === 'QR',
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. PROCESO DE VINCULACIÓN (SI NO ESTÁ REGISTRADO)
    if (!sock.authState.creds.registered) {
        if (METODO_VINCULACION === 'CODE') {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(NUMERO_BOT_WHATSAPP);
                    console.log('\n======================================================');
                    console.log(`📱 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ${code}`);
                    console.log('======================================================\n');
                } catch (err) {
                    console.error('Error al solicitar el código de vinculación:', err.message);
                }
            }, 3000);
        }
    }

    // 3. CONTROL DE CONEXIÓN
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && METODO_VINCULACION === 'QR') {
            console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP BUSINESS:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                iniciarBot();
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Gabriela 1.5 está conectada 24/7 y vinculada a la API de Railway!');
        }
    });

    // 4. PROCESAMIENTO Y REENVIÓ DE MENSAJES (WEBHOOK A PYTHON)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Ignorar mensajes enviados por el propio bot o sin contenido
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const textMessage = msg.message?.conversation || 
                                msg.message?.extendedTextMessage?.text || '';

            if (!textMessage) continue;

            console.log(`💬 Mensaje entrante de ${sender}: ${textMessage}`);

            try {
                // Enviar el mensaje a la API de Gabriela (Python/FastAPI) en Railway
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;

                // Responderle al cliente con el mensaje procesado por Gabriela
                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                }

                // SI EL CLIENTE LLEGÓ AL ESTADO 4 (DISPARO DE ALERTA A TU WHATSAPP PERSONAL)
                if (data && data.estado_siguiente === 5) {
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Firmado y Auditado por Julián 1.5\n` +
                              `📍 *Comercio:* Foto de fachada validada\n` +
                              `📲 *Alias/Datos:* Procesados por la API\n\n` +
                              `*(Realizá la transferencia desde Mercado Pago y confirmá la acreditación al cliente)*`
                    });
                }

            } catch (error) {
                console.error('Error comunicándose con la API en Railway:', error.message);
            }
        }
    });
}

iniciarBot();
