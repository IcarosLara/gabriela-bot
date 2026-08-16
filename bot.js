/**
 * ============================================================================
 * BRUNILDA S.A.S. - NÚCLEO UNIFICADO GABRIELA-BOT V1.5 (SUPER CÓDIGO)
 * Integración: Baileys + Difusión Diaria Controlada + Whitelist Absoluta
 * ============================================================================
 */

const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const LINK_CONTRATO = "https://docs.google.com/forms/d/1xMQwxWzehYW2NbYt87lreaATKHyWYkp2fMuBgXvJBXE/viewform";
const DB_FILE = './clientes_db.json';

// ==============================================================================
// 🛡️ LISTA BLANCA DE EXCLUSIÓN TOTAL (CÍRCULO ÍNTIMO Y FAMILIA)
// ==============================================================================
const NUMEROS_EXCLUIDOS_GLOBALES = [
    "5493815115726", // Mariana Pereyra
    "5493815201497", // Cecy Lara
    "5493813218727", // Sofia Orellana
    "5493815464065", // Lucas Pedraza
    "5493813495051", // Daniel Aracena / Matias Lara
    "5493854868483", // Mamá
    "5493816876445", // Noelia Hunco
    "5493812436722", // Claudia Sierra
    "5493812143182", // Nelson Sebastian
    "5493816990027", // Lourdes Sánchez
    "5493816605072", // Jorge Navarro
    "5493815290915", // Carlos Director
    "5493815972000", // Martin Alvarado MH
    "5493813301753", // Silvia Moran
    "5493854115251", // Maw Bischoff
    "4917679792358"   // Internacional
];

function esNumeroExcluido(sender) {
    if (!sender) return false;
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

// Grupos autorizados para difusión controlada (1 vez al día)
const NOMBRES_GRUPOS_AUTORIZADOS = [
    "Impulso universitario",
    "EMPRENDIMIENTOS",
    "Activando las Ventas en Feria"
];

const PLANTILLA_DIFUSION = `📢 *SISTEMA DE MICROCRÉDITOS DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
    `🚀 ¿Necesitás stock o mercadería para tu emprendimiento en Tucumán?\n\n` +
    `🌐 *Visitá nuestra web oficial:* https://icaroslara.github.io/gabriela-bot/\n\n` +
    `• Financiación directa sin bancos.\n` +
    `• Pagamos directo al comercio y retirás al instante.\n` +
    `• Plazo: 168 horas (7 días) con tasa del 2%.\n\n` +
    `👉 *Escribime por privado para evaluar tu cupo.*`;

// --- PERSISTENCIA LOCAL (NOTEBOOK MML) ---
function inicializarBaseDeDatos() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ clientes: [] }, null, 2), 'utf8');
    }
}

function registrarCliente(datosCliente) {
    inicializarBaseDeDatos();
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const index = db.clientes.findIndex(c => c.contacto === datosCliente.contacto);
    if (index !== -1) {
        db.clientes[index] = { ...db.clientes[index], ...datosCliente, ultimaActualizacion: new Date().toISOString() };
    } else {
        db.clientes.push({ ...datosCliente, fechaRegistro: new Date().toISOString(), estado: "Activo" });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// --- MOTOR DE DIFUSIÓN DIARIA (1 VEZ AL DÍA) ---
function iniciarMotorDifusion(sock) {
    console.log('📢 Motor de difusión diaria activado (1 vez cada 24 horas).');
    
    setInterval(async () => {
        try {
            const todosLosGrupos = await sock.groupFetchAllParticipating();
            for (const jid in todosLosGrupos) {
                const nombreGrupo = todosLosGrupos[jid].subject || "";
                const esAutorizado = NOMBRES_GRUPOS_AUTORIZADOS.some(n => nombreGrupo.toLowerCase().includes(n.toLowerCase()));
                
                if (esAutorizado) {
                    console.log(`📢 [DIFUSIÓN DIARIA]: Enviando a grupo autorizado: "${nombreGrupo}"`);
                    await sock.sendMessage(jid, { text: PLANTILLA_DIFUSION });
                    await new Promise(r => setTimeout(r, 15000)); // Pausa de seguridad antispam
                }
            }
        } catch (err) {
            console.error('[ERROR EN DIFUSIÓN DIARIA]:', err.message);
        }
    }, 24 * 60 * 60 * 1000); // Se ejecuta estrictamente cada 24 horas
}

// --- NÚCLEO DEL BOT ---
async function iniciarBot() {
    inicializarBaseDeDatos();
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
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n🔑 CÓDIGO DE VINCULACIÓN DE 8 DÍGITOS: ${code}\n`);
            } catch (err) {
                console.error('[ERROR AL GENERAR CÓDIGO]:', err.message);
            }
        }, 8000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401 && fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
            }
            setTimeout(() => iniciarBot(), 5000);
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela-Bot v1.5 conectada y blindada con éxito absoluto!\n');
            iniciarMotorDifusion(sock);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const sender = msg.key.remoteJid;
            const esGrupo = sender.endsWith('@g.us');
            const textMessage = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

            if (!textMessage) continue;

            // REGLA DE ORO 1: Si es un número excluido (familia/amigos), Gabriela se queda muda.
            if (!esGrupo && esNumeroExcluido(sender)) {
                continue;
            }

            // REGLA DE ORO 2: En grupos, solo responde si mencionan palabras clave de microcréditos de forma natural.
            if (esGrupo) {
                const textoLower = textMessage.toLowerCase();
                if (textoLower.includes('prestamo') || textoLower.includes('insumos') || textoLower.includes('credito')) {
                    await sock.sendMessage(sender, { text: "🤖 Hola, soy Gabriela de Brunilda S.A.S. Escríbeme al privado para coordinar tu financiación de insumos." });
                }
                continue;
            }

            // ATENCIÓN EN CHATS PRIVADOS (Leads de microcréditos)
            console.log(`💬 Procesando consulta privada de: ${sender}`);
            registrarCliente({ contacto: sender, ultimaConsulta: textMessage });

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                }, { timeout: 8000 });

                if (response.data && response.data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: response.data.respuesta_bot });
                } else {
                    await sock.sendMessage(sender, {
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                              `📌 *Condiciones Operativas Express:*\n` +
                              `• *Plazo:* Exactamente **168 horas** (7 días corridos).\n` +
                              `• *Tasa:* **2% de interés** sobre el capital.\n\n` +
                              `Para evaluar tu cupo, completá nuestro formulario de contrato: ${LINK_CONTRATO}`
                    });
                }
            } catch (err) {
                console.error('[WEBHOOK ERROR]:', err.message);
                await sock.sendMessage(sender, { text: "⚠️ Sistema temporalmente ocupado. Dejanos tu consulta y te responderemos a la brevedad." });
            }
        }
    });
}

iniciarBot();

// Healthcheck minimalista para servidores VPS / Fly.io / Railway
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela-Bot v1.5 Stable Core - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
