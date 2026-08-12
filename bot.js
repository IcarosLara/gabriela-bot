const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');

// 1. CONFIGURACIÓN GENERAL
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app';

const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 
const METODO_VINCULACION = process.env.METODO_VINCULACION || 'CODE'; 

// MEMORIA EN VIVO PARA CONTROLAR ESTADOS Y EVITAR LOOPS
const chatsActivosProvisionales = new Set();
const chatsPausados = new Set();
const chatsEnEvaluacion = new Set(); // Guarda los clientes que ya iniciaron para NO mandarles la bienvenida en loop

async function iniciarBot() {
    // CAMBIO A AUTH_INFO_V2 PARA FORZAR SESIÓN LIMPIA SIN ARCHIVOS CORRUPTOS
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');

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

    // CÓDIGO DE PAIRING
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

    // 3. PROCESAMIENTO DE MENSAJES
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
            // 👑 1. COMANDOS DEL PROPIETARIO (fromMe === true)
            // ------------------------------------------------------------------
            if (fromMe) {
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
                            text: `📊 *SISTEMA BRUNILDA S.A.S. OPERATIVO*\n\nGabriela lista en producción.` 
                        });
                    }
                    return;
                }

                if (textoMinuscula.includes('ok, te dejo con gabriela') || textoMinuscula === '!activar') {
                    chatsActivosProvisionales.add(sender);
                    chatsPausados.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🤖 *Gabriela:* ¡Hola! Soy la asistente virtual de Brunilda S.A.S. ¿En qué te puedo ayudar con tu microcrédito?' 
                    });
                    return;
                }

                if (textoMinuscula === '!pausa') {
                    chatsPausados.add(sender);
                    chatsActivosProvisionales.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🛑 *Gabriela ha sido pausada en esta conversación.*' 
                    });
                    return;
                }

                continue;
            }

            // ------------------------------------------------------------------
            // 👥 2. FILTROS PARA CLIENTES
            // ------------------------------------------------------------------
            if (chatsPausados.has(sender)) continue;

            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            // Si es un chat nuevo sin palabras clave, ignora
            if (!chatsEnEvaluacion.has(sender) && !chatsActivosProvisionales.has(sender) && !esConsultaValida) {
                continue;
            }

            // ------------------------------------------------------------------
            // 🤖 3. LÓGICA ANTI-LOOP DE CONVERSACIÓN
            // ------------------------------------------------------------------
            console.log(`💬 Mensaje recibido de ${sender}: "${textMessage}"`);

            try {
                // Enviamos el mensaje a la API de FastAPI
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;

                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                    chatsEnEvaluacion.add(sender); // Marcamos que este cliente ya inició la charla
                } else {
                    // Si la API responde vacío, manejamos las fases internamente según el historial
                    if (!chatsEnEvaluacion.has(sender)) {
                        // FASE 1: PRIMER CONTACTO
                        await sock.sendMessage(sender, { 
                            text: `¡Hola! Soy Gabriela, del sistema de créditos de insumos con ciclo de 7 días de Brunilda S.A.S.\n\n` +
                                  `Para evaluar tu solicitud hoy mismo, por favor respondeme estas 3 preguntas:\n\n` +
                                  `1️⃣ ¿Qué materiales o mercadería necesitás comprar hoy?\n` +
                                  `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                                  `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 7 días?`
                        });
                        chatsEnEvaluacion.add(sender);
                    } else {
                        // FASE 2: VERIFICACIÓN Y DOCUMENTACIÓN
                        await sock.sendMessage(sender, { 
                            text: `¡Perfecto! Para avanzar al contrato de mutuo con el equipo legal de Brunilda S.A.S.:\n\n` +
                                  `📷 Por favor enviame una foto del DNI (frente y dorso) y una foto tuya de rostro.\n\n` +
                                  `🏪 Una vez en el comercio, sacale una foto de frente al local para confirmar que estás ahí y pasame el Alias de Mercado Pago del negocio para realizar el pago directo.`
                        });
                    }
                }

                // Alerta automática al propietario al llegar al estado final
                if (data && data.estado_siguiente === 5) {
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Auditado por Julián 1.5\n` +
                              `🛒 *Insumos:* Validado por Gabriela\n\n` +
                              `*(Realizá la transferencia desde Mercado Pago y confirmá la acreditación)*`
                    });
                }

            } catch (error) {
                console.error('Error conectando a la API:', error.message);
                
                // Fallback seguro anti-loop si falla el servidor
                if (!chatsEnEvaluacion.has(sender)) {
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de créditos de insumos con ciclo de 7 días de Brunilda S.A.S.\n\n` +
                              `Para evaluar tu solicitud hoy mismo, por favor respondeme estas 3 preguntas:\n\n` +
                              `1️⃣ ¿Qué materiales o mercadería necesitás comprar hoy?\n` +
                              `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                              `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 7 días?`
                    });
                    chatsEnEvaluacion.add(sender);
                } else {
                    await sock.sendMessage(sender, { 
                        text: `¡Perfecto! Para avanzar con el contrato de mutuo:\n\n` +
                              `📷 Pasame foto de tu DNI (frente y dorso) y una foto de tu rostro.\n\n` +
                              `🏪 Cuando estés en la distribuidora, mandame una foto del local y el Alias/CVU del negocio para transferir los insumos.`
                    });
                }
            }
        }
    });
}

iniciarBot();
