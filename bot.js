const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 

const NUMEROS_EXCLUIDOS_GLOBALES = [
    "5493815115726", "5493815201497", "5493813218727", "5493815464065",
    "5493813495051", "5493854868483", "5493816876445", "5493812436722",
    "5493812143182", "5493816990027", "5493816605072", "5493815290915",
    "5493815972000", "5493813301753", "5493854115251", "4917679792358"
];

function esNumeroExcluido(sender) {
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

const chatsEnEvaluacion = new Set();

async function iniciarBot() {
    // Limpieza preventiva de sesión corrupta si existe el flag de error 401
    const authFolder = path.join(__dirname, 'auth_info_v2');

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: true,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const phoneNumber = NUMERO_BOT_WHATSAPP.replace(/[^0-9]/g, '');
                console.log(`\n⏳ Solicitando código de emparejamiento de 8 dígitos para el número: +${phoneNumber}...\n`);
                
                const code = await sock.requestPairingCode(phoneNumber);
                
                console.log(`\n==================================================`);
                console.log(`🔑 TU CÓDIGO DE VINCULACIÓN DE WHATSAPP ES: ${code}`);
                console.log(`==================================================\n`);
                console.log(`👉 Ingresa este código inmediatamente en WhatsApp -> Dispositivos vinculados -> Vincular con número.`);
            } catch (err) {
                console.error('[ERROR AL GENERAR CÓDIGO DE EMPAREJAMIENTO]:', err.message);
            }
        }, 6000);
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`[RED]: Conexión cerrada (Código: ${statusCode}).`);

            // Si recibimos 401 (Logged Out / Credencial inválida), barajamos borrando la carpeta de auth
            if (statusCode === 401) {
                console.log(`[ALERTA 401]: Credencial rechazada por WhatsApp. Purgando carpeta de sesión corrupta...`);
                try {
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                        console.log(`🧹 Carpeta auth_info_v2 purgada con éxito. Reiniciando ciclo limpio...`);
                    }
                } catch (cleanErr) {
                    console.error('[ERROR AL PURGAR SESIÓN]:', cleanErr.message);
                }
            }

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            setTimeout(() => iniciarBot(), 5000);
            
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 conectada con éxito absoluto y lista para operar!\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;
            const esGrupo = sender.endsWith('@g.us');
            const fromMe = msg.key.fromMe;
            
            const textMessage = (
                msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text || 
                ''
            ).trim();

            if (!textMessage) continue;

            if (esGrupo) continue; 
            if (!fromMe && esNumeroExcluido(sender)) continue; 
            if (fromMe) continue; 

            const textoMinuscula = textMessage.toLowerCase();
            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsEnEvaluacion.has(sender) && !esConsultaValida) continue;

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                }, { timeout: 8000 });

                const data = response.data;
                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                    chatsEnEvaluacion.add(sender);
                } else if (!chatsEnEvaluacion.has(sender)) {
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                              `📌 *Condiciones Operativas Express:*\n` +
                              `• *Plazo:* Exactamente **168 horas** (7 días corridos).\n` +
                              `• *Tasa:* **2% de interés** sobre el capital.\n\n` +
                              `Para evaluar tu cupo, respondeme estas 3 preguntas:\n\n` +
                              `1️⃣ ¿Qué materiales o mercadería necesitás comprar?\n` +
                              `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                              `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 168 hs?` 
                    });
                    chatsEnEvaluacion.add(sender);
                }
            } catch (err) {
                console.error('[API WEBHOOK ERROR]:', err.message);
            }
        }
    });
}

iniciarBot();

const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela WhatsApp Bridge Purge Core - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
