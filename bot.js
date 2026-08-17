/**
 * ============================================================================
 * BRUNILDA S.A.S. - GABRIELA-BOT V1.5 (MODO STANDBY / ANTI-CRASH PASIVO)
 * ============================================================================
 */

const { makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const LINK_CONTRATO = "https://docs.google.com/forms/d/1xMQwxWzehYW2NbYt87lreaATKHyWYkp2fMuBgXvJBXE/viewform";
const DB_FILE = './clientes_db.json';

const NUMEROS_EXCLUIDOS_GLOBALES = [
    "5493815115726", "5493815201497", "5493813218727", "5493815464065", 
    "5493813495051", "5493854868483", "5493816876445", "5493812436722", 
    "5493812143182", "5493816990027", "5493816605072", "5493815290915", 
    "5493815972000", "5493813301753", "5493854115251", "4917679792358"
];

function inicializarBaseDeDatos() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({ clientes: [] }, null, 2), 'utf8');
        }
    } catch (e) {
        console.error("Error al inicializar BD:", e.message);
    }
}

async function iniciarBot() {
    try {
        inicializarBaseDeDatos();
        
        const authFolder = path.join(__dirname, 'auth_info_v2');
        if (!fs.existsSync(authFolder)) {
            fs.mkdirSync(authFolder, { recursive: true });
        }

        const credsFile = path.join(authFolder, 'creds.json');
        const tieneCredenciales = fs.existsSync(credsFile);

        // SI NO ESTÁ VINCULADO PREVIAMENTE: No rompemos la app, entramos en modo reposo operativo.
        if (!tieneCredenciales) {
            console.log('\n🟡 [ESTADO: STANDBY]: El bot está encendido en el servidor pero sin sesión activa de WhatsApp.');
            console.log('💡 El servidor web (Healthcheck) sigue activo para mantener vivo a Railway.');
            console.log('📌 Cuando decidas vincularlo en el futuro, subiremos las credenciales o cambiaremos la IP.\n');
            return; // Detiene la ejecución de Baileys aquí para evitar bucles y crasheos.
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

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                console.log('⚠️ Conexión de WhatsApp cerrada. Entrando en pausa...');
                setTimeout(() => iniciarBot(), 20000);
            } else if (connection === 'open') {
                console.log('\n🚀 ¡Gabriela-Bot conectada y operando al 100%!\n');
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe) continue;
                const sender = msg.key.remoteJid;
                if (sender.endsWith('@g.us')) continue; // Ignora grupos por seguridad

                try {
                    const textMessage = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
                    if (!textMessage) continue;

                    const response = await axios.post(RAILWAY_WEBHOOK_URL, { sender, message: textMessage }, { timeout: 8000 });
                    if (response.data?.respuesta_bot) {
                        await sock.sendMessage(sender, { text: response.data.respuesta_bot });
                    }
                } catch (err) {
                    // Silencia errores de red
                }
            }
        });

    } catch (err) {
        console.error('[AVISO DE SISTEMA]:', err.message);
    }
}

// Arranca el bot en segundo plano
iniciarBot();

// Servidor web obligatorio para que Railway no apague el contenedor (Healthcheck)
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela-Bot v1.5 [Modo Standby Operativo] - Brunilda S.A.S.');
}).listen(PORT, () => console.log(`🌐 Healthcheck activo en puerto ${PORT} (Servidor en línea)`));
