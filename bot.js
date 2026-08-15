const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const axios = require('axios');
const pino = require('pino');
const http = require('http');
const fs = require('fs');

const NUMERO_OPERADOR = "5493812385889"; 
const LINK_CONTRATO = "https://docs.google.com/forms/d/1xMQwxWzehYW2NbYt87lreaATKHyWYkp2fMuBgXvJBXE/viewform";

// CONFIGURACIÓN DE SEGURIDAD Y CUPOS (Brunilda S.A.S.)
// GRUPO 1: Impulso universitario | GRUPO 2: Emprendimientos (Centro de Estudiantes) | GRUPO 3: ICV Chat Post-Incubacion
const GRUPO_UNIVERSITARIO = "120363000000000000@g.us"; 
const GRUPO_EMPRENDIMIENTOS = "120363000000000001@g.us"; 
const GRUPO_ICV = "120363000000000002@g.us";

const GRUPOS_AUTORIZADOS = [GRUPO_UNIVERSITARIO, GRUPO_EMPRENDIMIENTOS, GRUPO_ICV];

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

    // Espera de 60s para evitar rebote de IP si se conecta en la nube
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

            // 1. LÓGICA DE GRUPOS (Respuestas contextuales según el espacio)
            if (isGroup && GRUPOS_AUTORIZADOS.includes(senderJid)) {
                if (text.toLowerCase().includes('hola') || text.toLowerCase().includes('prestamo') || text.toLowerCase().includes('insumos')) {
                    
                    let mensajeGrupo = "🤖 Hola, soy Gabriela, IA de Brunilda S.A.S. Ayudo a emprendedores a financiar insumos de forma rápida. Escríbeme al privado para más info.";
                    
                    // Si el mensaje ocurre en el Grupo ICV, aplicamos la directriz específica de Argentina y fase de pruebas
                    if (senderJid === GRUPO_ICV) {
                        mensajeGrupo = "🇦🇷 ¡Hola a todos! Soy Gabriela, IA asistente de Brunilda S.A.S. Les cuento que por el momento estamos operando en fase de pruebas con micropréstamos para emprendedores en *Argentina*. Si a alguno le interesa conocer cómo financiamos insumos de forma rápida, comuníquese de forma interna con nuestro director, *Javier Adrian Lara*. 🤝";
                    }

                    await sock.sendMessage(senderJid, { text: mensajeGrupo });
                }
            }

            // 2. LÓGICA DE PRIVADO (El "Director" controla la transferencia a Gabriela)
            if (!isGroup) {
                if (text.toLowerCase().includes('ok, si queres saber mas sobre los prestamos, te dejo con gabriela')) {
                    modoIA_Activado = true;
                    await sock.sendMessage(senderJid, { text: "✅ Entendido. Soy Gabriela, tu IA asistente de Brunilda S.A.S. A partir de ahora te guiaré con tu solicitud de microcrédito. ¿Qué insumos o mercadería necesita financiar tu local?" });
                    continue;
                }

                if (modoIA_Activado) {
                    const cupoDisponible = LIMITE_SEMANAL - dineroPrestado;
                    if (text.toLowerCase().includes('credito') || text.toLowerCase().includes('prestamo') || text.toLowerCase().includes('insumos')) {
                        if (cupoDisponible <= 0) {
                            await sock.sendMessage(senderJid, { text: "⚠️ Sistema de Fondeo: Cupo semanal agotado ($50.000). Volvemos a operar en el próximo ciclo." });
                        } else {
                            await sock.sendMessage(senderJid, { text: `📊 *Brunilda S.A.S. - Sistema Julián 1.5*\n\nCupo semanal disponible: $${cupoDisponible} ARS.\n\nPara avanzar con tu legajo, completa el Contrato de Mutuo aquí:\n${LINK_CONTRATO}\n\nUna vez firmado, envíame tu CUIT, foto del frente de tu local y tu Alias (Mercado Pago/Naranja X).` });
                        }
                    }
                }
            }
        }
    });
}

iniciarBot();
http.createServer((req, res) => res.end('Brunilda S.A.S. Online')).listen(8080);
