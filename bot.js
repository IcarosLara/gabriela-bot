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
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. PROCESO DE VINCULACIÓN (SI NO ESTÁ REGISTRADO)
    if (!sock.authState.creds.registered) {
        if (METODO_VINCULACION === 'CODE') {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(NUMERO_BOT_WHATSAPP);
                    console.log('\n======================================================');
                    console.log(`📱 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ${code}`);
                    console.log('======================================================\n');
                } catch (err) {
                    console.error('Error al solicitar el código de vinculación:', err.message);
                }
            }, 3000);
        }
    }

    // 3. CONTROL DE CONEXIÓN
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && METODO_VINCULACION === 'QR') {
            console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP BUSINESS:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                iniciarBot();
            }
        } else if (connection === 'open') {
            console.log('🚀 ¡Gabriela 1.5 está conectada 24/7 y vinculada a la API de Railway!');
        }
    });

    // 4. PROCESAMIENTO Y REENVIÓ DE MENSAJES CON FILTROS INTELIGENTES
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
                // Frase clave para habilitar a Gabriela en la charla con un amigo
                if (textoMinuscula.includes('ok, te dejo con gabriela') || textoMinuscula === '!activar') {
                    chatsActivosProvisionales.add(sender);
                    chatsPausados.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🤖 *Gabriela:* ¡Hola! Soy la asistente virtual de Brunilda S.A.S. ¿En qué te puedo ayudar con el crédito?' 
                    });
                    console.log(`✅ Gabriela activada manualmente para: ${sender}`);
                    return;
                }

                // Comando para pausar al bot en cualquier conversación
                if (textoMinuscula === '!pausa') {
                    chatsPausados.add(sender);
                    chatsActivosProvisionales.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🛑 *Gabriela ha sido pausada en esta conversación.*' 
                    });
                    console.log(`🛑 Gabriela pausada manualmente para: ${sender}`);
                    return;
                }

                continue; // Si enviaste vos otro mensaje normal, no procesamos webhook
            }

            // ------------------------------------------------------------------
            // ⛔ 2. MENSAJES RECIBIDOS DE OTRAS PERSONAS
            // ------------------------------------------------------------------

            // Filtro A: Si el chat está pausado manualmente -> Ignorar
            if (chatsPausados.has(sender)) {
                console.log(`🛑 Chat ${sender} pausado. Ignorando mensaje.`);
                continue;
            }

            // Filtro B: Amigos / Contactos Agendados
            // Si el nombre viene en los datos del mensaje, Baileys detecta que es un contacto conocido
            const esContactoAgendado = Boolean(msg.pushName && msg.verifiedBizName === undefined);
            
            if (esContactoAgendado && !chatsActivosProvisionales.has(sender)) {
                console.log(`👤 Mensaje de contacto conocido (${msg.pushName}). Ignorando para que hables vos.`);
                continue; 
            }

            // Filtro C: Palabras clave para números DESCONOCIDOS (no agendados)
            if (!chatsActivosProvisionales.has(sender)) {
                const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info'];
                const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

                if (!esConsultaValida) {
                    console.log(`❓ Desconocido (${sender}) envió mensaje sin palabras clave. Ignorando.`);
                    continue; // Ignorar spam/stickers/mensajes fuera de tema
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

                // Responderle al cliente con lo que respondió Gabriela
                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                }

                // Disparo de Alerta a tu WhatsApp Personal al llegar al Estado 5
                if (data && data.estado_siguiente === 5) {
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Firmado y Auditado por Julián 1.5\n` +
                              `📍 *Comercio:* Foto de fachada validada\n` +
                              `📲 *Alias/Datos:* Procesados por la API\n\n` +
                              `*(Realizá la transferencia desde Mercado Pago y confirmá la acreditación al cliente)*`
                    });
                }

            } catch (error) {
                console.error('Error comunicándose con la API en Railway:', error.message);
            }
        }
    });
}

iniciarBot();
