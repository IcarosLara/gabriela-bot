const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';

// ==============================================================================
// 🛡️ MURALLA DE CONTENCIÓN Y ESCUDO ANTIPHISHING INSTITUCIONAL (LÍNEA C)
// ==============================================================================
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

// 🛑 DETECTOR DE PHISHING Y ENLACES MALICIOSOS (FILTRO ELÍAS CENTINELA)
function contieneLinkSospechoso(texto) {
    const patronesPeligrosos = [
        'http://', 'https://', 'bit.ly', 'goo.gl', 't.me', 'whatsapp-', 
        'mercadopago-', 'login-', 'verify-', 'seguridad-', 'actualizar-datos'
    ];
    const textoLower = texto.toLowerCase();
    // Excluimos dominios oficiales seguros si fuera necesario, o detectamos patrones de estafa
    const tieneUrl = patronesPeligrosos.some(patron => textoLower.includes(patron));
    return tieneUrl;
}

const chatsEnEvaluacion = new Set();

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
        
        if (qr) {
            console.log('\n📱 ESCANEA EL CÓDIGO QR DESDE TU CELULAR (ESCUDO ELÍAS ACTIVO):\n');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('[RED]: Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) setTimeout(() => iniciarBot(), 5000);
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Escudo Antiphishing Elías-Elena y Gabriela 1.5 operativos en la Línea C!\n');
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

            // ==================================================================
            // 🛡️ 1. ESCUDO CENTINELA ANTIPHISHING (INTERCEPTOR UNIDIRECCIONAL)
            // ==================================================================
            if (contieneLinkSospechoso(textMessage)) {
                console.warn(`🚨 [ALERTA ELÍAS]: Intento de enlace sospechoso / phishing interceptado de: ${sender}`);
                
                // Si el mensaje sospechoso proviene de un chat externo o intento de estafa, neutralizamos y avisamos al operador
                if (!fromMe) {
                    await sock.sendMessage(sender, { 
                        text: `⚠️ *PROTOCOLO DE SEGURIDAD ELÍAS S.A.S.*\n\nEste enlace ha sido interceptado y bloqueado preventivamente por motivos de seguridad institucional. No se permitirá la ejecución de scripts o redirecciones externas.` 
                    });
                }
                continue; // Cancelamos cualquier procesamiento adicional de este mensaje
            }

            // ==================================================================
            // 🛑 2. FILTROS DE SEGURIDAD CLásica (CERO GRUPOS / CERO CONTACTOS ÍNTIMOS)
            // ==================================================================
            if (esGrupo) continue;                          
            if (!fromMe && esNumeroExcluido(sender)) continue; 
            if (fromMe) continue;                           

            // ==================================================================
            // 🧠 3. NÚCLEO ANALÍTICO DE CRÉDITO Y PERFILACIÓN (GABRIELA)
            // ==================================================================
            const textoMinuscula = textMessage.toLowerCase();
            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsEnEvaluacion.has(sender) && !esConsultaValida) continue;

            console.log(`🧠 [Cerebro Elías-Elena] Procesando consulta analítica de: ${sender}`);

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
                        text: `¡Hola! Soy Gabriela, bajo el protocolo analítico de Elías-Elena (Brunilda S.A.S.).\n\n` +
                              `📌 *Condiciones Operativas Express:*\n` +
                              `• *Plazo:* Exactamente **168 horas** (7 días corridos).\n` +
                              `• *Tasa:* **2% de interés** sobre el capital.\n\n` +
                              `Para evaluar tu perfil y cupo, respondeme estas 3 preguntas:\n\n` +
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
    res.end('Elias-Elena Secure Shield + Gabriela Bridge - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
