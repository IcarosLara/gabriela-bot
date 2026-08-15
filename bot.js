const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT = "5493812385889"; 

// Lista blanca de los 3 grupos de WhatsApp autorizados para Gabriela-Bot
const GRUPOS_AUTORIZADOS = [
    "120363000000000000@g.us", // [Reemplazar con el JID del Grupo 1]
    "120363000000000001@g.us", // [Reemplazar con el JID del Grupo 2]
    "120363000000000002@g.us"  // [Reemplazar con el JID del Grupo 3]
];

// Enlace oficial del Google Forms (Contrato de Mutuo Blindado - Ley Argentina)
const LINK_CONTRATO_MUTUO = "https://docs.google.com/forms/d/1xMQwxWzehYW2NbYt87lreaATKHyWYkp2fMuBgXvJBXE/viewform";

// MÓDULO CONTABLE DE LÍMITES SEMANALES (Brunilda S.A.S.)
const LIMITE_SEMANAL_TOTAL = 50000;
let dineroPrestadoActual = 10000; // Arranca en 10.000 por el caso de Gabo ya aprobado

async function iniciarBot() {
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
                console.log(`🔑 CÓDIGO DE VINCULACIÓN DE 8 CARACTERES: ${code}`);
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
            
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                setTimeout(() => iniciarBot(), 6000);
            } else {
                console.log('[CRÍTICO]: Sesión invalidada. Limpie volúmenes y reinicie el contenedor en Railway.');
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡CONEXIÓN ESTABLECIDA CON ÉXITO ABSOLUTO (BRUNILDA S.A.S.)!\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            
            const senderJid = msg.key.remoteJid;
            const isGroup = senderJid.endsWith('@g.us');
            const textMessage = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            
            if (!textMessage || msg.key.fromMe) continue;

            // REGLA DE ORO DE SEGURIDAD: Bloquear chats privados y exigir lista blanca de grupos
            if (!isGroup || !GRUPOS_AUTORIZADOS.includes(senderJid)) {
                continue;
            }

            console.log(`[MENSAJE AUTORIZADO EN GRUPO]: ${textMessage}`);

            let respuestaAutomatica = null;
            const lowerMsg = textMessage.toLowerCase();

            // 1. Presentación magnética de la IA
            if (lowerMsg.includes('hola gabriela') || lowerMsg.includes('quien sos') || lowerMsg.includes('que haces') || lowerMsg.includes('bot')) {
                respuestaAutomatica = `🤖 *Hola, soy Gabriela, IA de asistencia para Brunilda S.A.S.*\n\nMi trabajo es asegurar que ningún emprendedor o dueño de local se quede sin mercadería o insumos por falta de liquidez momentánea (operando para Argentina).\n\nSi necesitas capital rápido para comprar lo que te hace falta, escríbeme al privado (DM) y te explico cómo calificar al cupo inicial. ¡Hablemos por privado!`;
            } 
            // 2. Disparador de microcréditos con control de cupo semanal ($40.000 disponibles)
            else if (lowerMsg.includes('credito') || lowerMsg.includes('prestamo') || lowerMsg.includes('plata') || lowerMsg.includes('quiero') || lowerMsg.includes('insumos')) {
                
                const cupoDisponible = LIMITE_SEMANAL_TOTAL - dineroPrestadoActual;

                if (cupoDisponible <= 0) {
                    respuestaAutomatica = `🤖 *Sistema de Microcréditos - Brunilda S.A.S.*\n\n⚠️ Cupo semanal de fondeo completo ($50.000). No hay disponibilidad de nuevos préstamos por esta semana hasta el reinicio del ciclo.`;
                } else {
                    respuestaAutomatica = `🤖 *Sistema de Microcréditos - Brunilda S.A.S.*\n\nCupo semanal disponible: $${cupoDisponible} ARS.\n\nPara iniciar tu legajo comercial, debes firmar digitalmente el Contrato de Mutuo (plazo estricto de 168 horas con 2% de interés).\n\n📄 Completa el formulario legal aquí:\n${LINK_CONTRATO_MUTUO}\n\nUna vez firmado, envíame por mensaje privado tu CUIT, foto del local y el Alias para validación.`;
                }
            }

            if (respuestaAutomatica) {
                await sock.sendMessage(senderJid, { text: respuestaAutomatica });
                continue;
            }

            // Derivación al Webhook general
            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: senderJid,
                    message: textMessage
                }, { timeout: 8000 });

                if (response.data && response.data.respuesta_bot) {
                    await sock.sendMessage(senderJid, { text: response.data.respuesta_bot });
                }
            } catch (err) {
                console.error('[API WEBHOOK ERROR]:', err.message);
            }
        }
    });
}

iniciarBot();

// Healthcheck institucional para Railway en puerto 8080
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela Stable Core v1.5 - Brunilda S.A.S. Online');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
