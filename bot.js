const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');

const NUMERO_OPERADOR = "5493812385889"; 
const LINK_CONTRATO = "https://docs.google.com/forms/d/1xMQwxWzehYW2NbYt87lreaATKHyWYkp2fMuBgXvJBXE/viewform";

// CONFIGURACIÓN DE SEGURIDAD Y CUPOS
const GRUPOS_AUTORIZADOS = ["120363000000000000@g.us", "120363000000000001@g.us", "120363000000000002@g.us"];
const LIMITE_SEMANAL = 50000;
let dineroPrestado = 10000; // Gabo ya aprobado
let modoIA_Activado = false; // Controla si Gabriela toma el mando en privado

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    // Espera de 60s para evitar rebote de IP en Railway
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(NUMERO_OPERADOR);
                console.log(`\n🔑 CÓDIGO DE VINCULACIÓN: ${code}\n`);
            } catch (err) { console.error('Error:', err.message); }
        }, 60000);
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            
            const senderJid = msg.key.remoteJid;
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();
            const isGroup = senderJid.endsWith('@g.us');

            // 1. LÓGICA DE GRUPOS (Proactividad controlada)
            if (isGroup && GRUPOS_AUTORIZADOS.includes(senderJid)) {
                if (text.toLowerCase().includes('hola')) {
                    await sock.sendMessage(senderJid, { text: "🤖 Hola, soy Gabriela, IA de Brunilda S.A.S. Ayudo a emprendedores y dueños de locales a financiar insumos de forma rápida. Si necesitas capital para tu negocio, escríbeme al privado y te explico cómo calificar." });
                }
            }

            // 2. LÓGICA DE PRIVADO (El "Director" controla la transferencia a Gabriela)
            if (!isGroup) {
                if (text.toLowerCase().includes('ok, si queres saber mas sobre los prestamos, te dejo con gabriela')) {
                    modoIA_Activado = true;
                    await sock.sendMessage(senderJid, { text: "✅ Entendido. Soy Gabriela, tu IA asistente. A partir de ahora te guiaré con tu solicitud. ¿Qué insumos necesita financiar tu local?" });
                    continue;
                }

                if (modoIA_Activado) {
                    const cupoDisponible = LIMITE_SEMANAL - dineroPrestado;
                    if (text.toLowerCase().includes('credito') || text.toLowerCase().includes('prestamo')) {
                        if (cupoDisponible <= 0) {
                            await sock.sendMessage(senderJid, { text: "⚠️ Cupo semanal agotado. Volvemos a operar en el próximo ciclo." });
                        } else {
                            await sock.sendMessage(senderJid, { text: `Cupo disponible: $${cupoDisponible}. Completa el contrato aquí: ${LINK_CONTRATO}` });
                        }
                    }
                }
            }
        }
    });
}

iniciarBot();
http.createServer((req, res) => res.end('Brunilda S.A.S. Online')).listen(8080);
