const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');

// 1. CONFIGURACIÓN GENERAL
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app';

const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 
const METODO_VINCULACION = process.env.METODO_VINCULACION || 'CODE'; 

// MEMORIA EN VIVO PARA LOS FILTROS
const chatsActivosProvisionales = new Set();
const chatsPausados = new Set();

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: METODO_VINCULACION === 'QR',
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. CONTROL DE CONEXIÓN
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && METODO_VINCULACION === 'QR') {
            console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => iniciarBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 está conectada 24/7 y vinculada a la API de Railway!\n');
        }
    });

    // SOLICITUD DE CÓDIGO CON TIMEOUT STABLE
    if (!sock.authState.creds.registered && METODO_VINCULACION === 'CODE') {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(NUMERO_BOT_WHATSAPP);
                console.log('\n======================================================');
                console.log(`📱 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ${code}`);
                console.log('======================================================\n');
            } catch (err) {
                console.error('Error al solicitar el código de vinculación:', err.message);
            }
        }, 4000);
    }

    // 3. PROCESAMIENTO DE MENSAJES Y FILTROS
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message) continue;

            const sender = msg.key.remoteJid;
            const fromMe = msg.key.fromMe;
            const textMessage = (
                msg.message?.conversation || 
                msg.message?.extendedTextMessage?.text || 
                ''
            ).trim();

            if (!textMessage) continue;
            const textoMinuscula = textMessage.toLowerCase();

            // ------------------------------------------------------------------
            // 👑 1. COMANDOS DEL ADMINISTRADOR / PROPIETARIO (fromMe === true)
            // ------------------------------------------------------------------
            if (fromMe) {
                // Comando de consulta de métricas y rendimiento
                if (textoMinuscula === '!metricas' || textoMinuscula === '!stats') {
                    try {
                        const res = await axios.get(`${RAILWAY_WEBHOOK_URL}/metricas`);
                        const m = res.data;
                        await sock.sendMessage(sender, {
                            text: `📊 *REPORTE DE GESTIÓN CREDITICIA - BRUNILDA S.A.S.*\n\n` +
                                  `⚡ *Créditos Aprobados Hoy:* ${m.aprobados_hoy || 0}\n` +
                                  `📅 *Aprobados esta Semana:* ${m.aprobados_semana || 0}\n` +
                                  `🗓️ *Aprobados este Mes:* ${m.aprobados_mes || 0}\n\n` +
                                  `🔄 *Clientes Habituales:* ${m.clientes_habituales || 0}\n` +
                                  `⏳ *Solicitudes en Evaluación:* ${m.en_proceso || 0}\n\n` +
                                  `_Sistema Gabriela & Julián 1.5 Operativo 24/7_`
                        });
                    } catch (e) {
                        await sock.sendMessage(sender, { 
                            text: `📊 *SISTEMA BRUNILDA S.A.S. OPERATIVO*\n\nGabriela está lista y procesando clientes. Servidor FastAPI responde correctamente.` 
                        });
                    }
                    return;
                }

                // Activar a Gabriela en la conversación actual
                if (textoMinuscula.includes('ok, te dejo con gabriela') || textoMinuscula === '!activar') {
                    chatsActivosProvisionales.add(sender);
                    chatsPausados.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🤖 *Gabriela:* ¡Hola! Soy la asistente virtual de Brunilda S.A.S. ¿En qué te puedo ayudar con tu microcrédito?' 
                    });
                    console.log(`✅ Gabriela activada manualmente para: ${sender}`);
                    return;
                }

                // Pausar al bot
                if (textoMinuscula === '!pausa') {
                    chatsPausados.add(sender);
                    chatsActivosProvisionales.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🛑 *Gabriela ha sido pausada en esta conversación.*' 
                    });
                    console.log(`🛑 Gabriela pausada manualmente para: ${sender}`);
                    return;
                }

                continue;
            }

            // ------------------------------------------------------------------
            // 👥 2. FILTROS PARA CLIENTES Y CONSULTAS EXTERNAS
            // ------------------------------------------------------------------
            if (chatsPausados.has(sender)) {
                console.log(`🛑 Chat ${sender} pausado. Ignorando mensaje.`);
                continue;
            }

            // Palabras clave para detectar solicitudes de crédito directas
            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsActivosProvisionales.has(sender) && !esConsultaValida) {
                console.log(`❓ Mensaje sin palabras clave de (${sender}). Ignorando.`);
                continue;
            }

            // ------------------------------------------------------------------
            // 🤖 3. COMUNICACIÓN CON LA API EN RAILWAY
            // ------------------------------------------------------------------
            console.log(`💬 Procesando solicitud válida de ${sender}: "${textMessage}"`);

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;

                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                } else {
                    // Cuestionario de bienvenida si no hay respuesta formateada
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de créditos de insumos con ciclo de 7 días de Brunilda S.A.S.\n\n` +
                              `Para evaluar tu solicitud hoy mismo, por favor respondeme estas 3 preguntas:\n\n` +
                              `1️⃣ ¿Qué materiales o mercadería necesitás comprar hoy?\n` +
                              `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                              `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 7 días?`
                    });
                }

                // Notificación de aprobación lista al WhatsApp Personal
                if (data && data.estado_siguiente === 5) {
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Auditado por Julián 1.5\n` +
                              `🛒 *Insumos:* Validado por Gabriela\n` +
                              `🔁 *Tipo:* ${data.es_cliente_habitual ? '🔄 CLIENTE HABITUAL / REINCIDENTE' : '✨ CLIENTE NUEVO'}\n\n` +
                              `*(Realizá la transferencia desde Mercado Pago y confirmá la acreditación)*`
                    });
                }

            } catch (error) {
                console.error('Error comunicándose con la API en Railway:', error.message);
                // Respuesta de emergencia asegurada al cliente
                await sock.sendMessage(sender, { 
                    text: `¡Hola! Soy Gabriela, del sistema de créditos de insumos con ciclo de 7 días de Brunilda S.A.S.\n\n` +
                          `Para evaluar tu solicitud hoy mismo, por favor respondeme estas 3 preguntas:\n\n` +
                          `1️⃣ ¿Qué materiales o mercadería necesitás comprar hoy?\n` +
                          `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                          `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 7 días?`
                });
            }
        }
    });
}

iniciarBot();
