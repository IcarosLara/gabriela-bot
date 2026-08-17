/**
 * ============================================================================
 * BRUNILDA S.A.S. - NÚCLEO UNIFICADO GABRIELA-BOT V1.5 (SUPER CÓDIGO BLINDADO)
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
    "5493815115726", "5493815201497", "5493813218727", "5493815464065", 
    "5493813495051", "5493854868483", "5493816876445", "5493812436722", 
    "5493812143182", "5493816990027", "5493816605072", "5493815290915", 
    "5493815972000", "5493813301753", "5493854115251", "4917679792358"
];

function esNumeroExcluido(sender) {
    if (!sender) return false;
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

const NOMBRES_GRUPOS_AUTORIZADOS = ["Impulso universitario", "EMPRENDIMIENTOS", "Activando las Ventas en Feria"];

const PLANTILLA_DIFUSION = `📢 *SISTEMA DE MICROCRÉDITOS DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
    `🚀 ¿Necesitás stock o mercadería para tu emprendimiento en Tucumán?\n\n` +
    `🌐 *Visitá nuestra web oficial:* https://icaroslara.github.io/gabriela-bot/\n\n` +
    `• Financiación directa sin bancos.\n` +
    `• Pagamos directo al comercio y retirás al instante.\n` +
    `• Plazo: 168 horas (7 días) con tasa del 2%.\n\n` +
    `👉 *Escribime por privado para evaluar tu cupo.*`;

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

async function iniciarBot() {
    inicializarBaseDeDatos();
    
    // --- BLINDAJE DE CARPETA DE SESIÓN ---
    const authFolder = path.join(__dirname, 'auth_info_v2');
    if (!fs.existsSync(authFolder)) {
        fs.mkdirSync(authFolder, { recursive: true });
    }

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
                console.log(`\n🔑 CÓDIGO DE VINCULACIÓN: ${code}\n`);
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
            console.log('\n🚀 ¡Gabriela-Bot v1.5 conectada y blindada!\n');
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
            if (!esGrupo && esNumeroExcluido(sender)) continue;
            
            if (esGrupo) {
                const textoLower = textMessage.toLowerCase();
                if (textoLower.includes('prestamo') || textoLower.includes('insumos') || textoLower.includes('credito')) {
                    await sock.sendMessage(sender, { text: "🤖 Hola, soy Gabriela. Escríbeme al privado para coordinar tu financiación." });
                }
                continue;
            }

            registrarCliente({ contacto: sender, ultimaConsulta: textMessage });
            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, { sender, message: textMessage }, { timeout: 8000 });
                if (response.data?.respuesta_bot) {
                    await sock.sendMessage(sender, { text: response.data.respuesta_bot });
                } else {
                    await sock.sendMessage(sender, { text: `¡Hola! Soy Gabriela de Brunilda S.A.S. Para evaluar tu cupo, completá nuestro formulario: ${LINK_CONTRATO}` });
                }
            } catch (err) {
                await sock.sendMessage(sender, { text: "⚠️ Sistema ocupado. Dejanos tu consulta y te responderemos." });
            }
        }
    });
}

iniciarBot();

const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela-Bot v1.5 Stable Core - Brunilda S.A.S.');
}).listen(PORT, () => console.log(`🌐 Healthcheck activo en puerto ${PORT}`));
