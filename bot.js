const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');

// 1. CONFIGURACIÓN GENERAL CON TUS DATOS CARGADOS
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';

// Configuración de teléfonos (Formato internacional sin +)
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 

// Método de vinculación: 'CODE' para código de 8 dígitos, 'QR' para código QR
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

    // 2. CONTROL DE CONEXIÓN Y SOLICITUD DE CÓDIGO CON TIMEOUT ESTABILIZADOR
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

    // Solicitud del código de 8 dígitos con delay de 4 segundos
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

    // 3. PROCESAMIENTO Y REENVIÓ DE MENSAJES CON FILTROS INTELIGENTES
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
            // ⛔ 1. COMANDOS DESDE TU PROPIO CELULAR (fromMe === true)
            // ------------------------------------------------------------------
            if (fromMe) {
                if (textoMinuscula.includes('ok, te dejo con gabriela') || textoMinuscula === '!activar') {
                    chatsActivosProvisionales.add(sender);
                    chatsPausados.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🤖 *Gabriela:* ¡Hola! Soy la asistente virtual de Brunilda S.A.S. ¿En qué te puedo ayudar con tu microcrédito?' 
                    });
                    console.log(`✅ Gabriela activada manualmente para: ${sender}`);
                    return;
                }

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
            // ⛔ 2. MENSAJES RECIBIDOS DE OTRAS PERSONAS
            // ------------------------------------------------------------------
            if (chatsPausados.has(sender)) {
                console.log(`🛑 Chat ${sender} pausado. Ignorando mensaje.`);
                continue;
            }

            const esContactoAgendado = Boolean(msg.pushName && msg.verifiedBizName === undefined);
            
            if (esContactoAgendado && !chatsActivosProvisionales.has(sender)) {
                console.log(`👤 Mensaje de contacto conocido (${msg.pushName}). Ignorando para que hables vos.`);
                continue; 
            }

            if (!chatsActivosProvisionales.has(sender)) {
                const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería'];
                const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

                if (!esConsultaValida) {
                    console.log(`❓ Desconocido (${sender}) envió mensaje sin palabras clave. Ignorando.`);
                    continue;
                }
            }

            // ------------------------------------------------------------------
            // 🤖 3. CONEXIÓN A LA API DE PYTHON (FASTAPI EN RAILWAY)
            // ------------------------------------------------------------------
            console.log(`💬 Procesando mensaje válido de ${sender}: ${textMessage}`);

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;

                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                }

                if (data && data.estado_siguiente === 5) {
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Firmado y Auditado por Julián 1.5\n` +
                              `📍 *Insumos/Comercio:* Validado por Gabriela\n` +
                              `📲 *Alias/Datos:* Procesados por la API\n\n` +
                              `*(Realizá la transferencia desde Mercado Pago y confirmá la acreditación)*`
                    });
                }

            } catch (error) {
                console.error('Error comunicándose con la API en Railway:', error.message);
            }
        }
    });
}

iniciarBot();
