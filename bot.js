const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

// ==============================================================================
// 🛡️ CONFIGURACIÓN DE SEGURIDAD Y LISTA BLANCA INSTITUCIONAL (LÍNEA C)
// ==============================================================================
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; // Javier (Operador)

// LISTA BLANCA DE EXCLUSIÓN TOTAL: El bot JAMÁS escribirá ni responderá a estos números
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
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

// ------------------------------------------------------------------------------
// 🤝 MEMORIA Y ESTADO ESPECÍFICO PARA GABO DI DANTIS
// ------------------------------------------------------------------------------
const NUMERO_GABO = "5493815461453";
const estadoGabo = {
    fase: 'INICIAL', // INICIAL -> CONTRATO_PENDIENTE -> DNI_PENDIENTE -> NEGOCIO_PENDIENTE -> ALIAS_PENDIENTE -> ACTIVO
    aliasComercio: ''
};

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
            console.log('\n📱 ESCANEA EL CÓDIGO QR PARA VINCULAR WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('[RED]: Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) setTimeout(() => iniciarBot(), 5000);
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 conectada, blindada y con el Flujo Gabo/Julián 1.5 activo!\n');
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
                msg.message?.imageMessage?.caption ||
                ''
            ).trim();

            const esImagen = msg.message?.imageMessage || msg.message?.documentMessage;

            // ------------------------------------------------------------------
            // 📸 REENVÍO DE COMPROBANTES DESDE EL OPERADOR (JAVIER)
            // ------------------------------------------------------------------
            if (fromMe && esImagen) {
                const caption = textMessage;
                if (caption.startsWith('!comprobante')) {
                    const numeroCliente = caption.replace('!comprobante', '').trim();
                    const jidDestino = numeroCliente.includes('@s.whatsapp.net') ? numeroCliente : `${numeroCliente}@s.whatsapp.net`;
                    
                    await sock.sendMessage(jidDestino, {
                        image: msg.message.imageMessage ? { url: msg.message.imageMessage.url } : undefined,
                        document: msg.message.documentMessage ? { url: msg.message.documentMessage.url } : undefined,
                        caption: `📄 *COMPROBANTE OFICIAL DE DESEMBOLSO - BRUNILDA S.A.S.*\n\n` +
                                 `Acreditación efectuada vía Mercado Pago a nombre de **Javier Adrián Lara**.\n\n` +
                                 `📌 *Mostrale esta constancia al cajero del comercio para retirar tus insumos.*`
                    });
                    await sock.sendMessage(sender, { text: `✅ Comprobante reenviado con éxito al cliente (${numeroCliente}).` });
                    return;
                }
            }

            if (!textMessage && !esImagen) continue;
            const textoMinuscula = textMessage.toLowerCase();

            // ------------------------------------------------------------------
            // 🛡️ MURALLA DE CONTENCIÓN GLOBAL
            // ------------------------------------------------------------------
            if (esGrupo) continue; // Cero spam en grupos
            if (!fromMe && esNumeroExcluido(sender)) continue; // Círculo íntimo protegido
            if (fromMe) continue; // Ignoramos mensajes propios (excepto el interceptor de arriba)

            // ------------------------------------------------------------------
            // 🤝 PROTOCOLO ESPECÍFICO VIP: GABO DI DANTIS (+54 9 3815 46-1453)
            // ------------------------------------------------------------------
            if (sender.includes(NUMERO_GABO)) {
                console.log(`[FLUJO VIP GABO]: Procesando fase [${estadoGabo.fase}] para Gabo Di Dantis.`);

                if (estadoGabo.fase === 'INICIAL') {
                    estadoGabo.fase = 'CONTRATO_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🏛️ *BRUNILDA S.A.S. - PROTOCOLO DE CRÉDITO AGÉNTICO*\n\n` +
                              `Hola Gabo. **Julián 1.5** ha generado tu **Contrato de Mutuo Digital + Pagaré Electrónico**.\n\n` +
                              `⚠️ *Aviso normativo:* Los fondos no se entregan en efectivo ni a cuentas personales; la API efectúa una transferencia directa al comercio proveedor para la adquisición de tus insumos.\n\n` +
                              `✍️ Por favor, respondé con tu conformidad explícita para aceptar la firma digital del contrato, y envianos de inmediato:\n` +
                              `📷 1. Foto de tu DNI (frente y dorso).\n` +
                              `🤳 2. Una selfie de tu rostro para validación biométrica.`
                    });
                    continue;
                } 
                else if (estadoGabo.fase === 'CONTRATO_PENDIENTE') {
                    estadoGabo.fase = 'NEGOCIO_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🔄 Documentación e imágenes recibidas. Remitiendo paquete de verificación a **Julián 1.5** para auditoría interna...\n\n` +
                              `⏳ *Julián 1.5 ha verificado y dado el OK institucional.*\n\n` +
                              `🏪 Ahora, por favor, dirigite personalmente al comercio/distribuidora donde vas a realizar las compras, **sacale una foto clara al local de frente** y envianos la imagen para confirmar la legitimidad del establecimiento.`
                    });
                    continue;
                } 
                else if (estadoGabo.fase === 'NEGOCIO_PENDIENTE' && esImagen) {
                    estadoGabo.fase = 'ALIAS_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🏢 *Comercio verificado y validado por Gabriela.* (Registro cruzado con base geolocalizada).\n\n` +
                              `💳 Por favor, pedile al comerciante el **Alias o CVU de Mercado Pago** del negocio y pasánoslo por este chat para realizar la auditoría final.`
                    });
                    continue;
                } 
                else if (estadoGabo.fase === 'ALIAS_PENDIENTE') {
                    estadoGabo.fase = 'ACTIVO';
                    estadoGabo.aliasComercio = textMessage;

                    // Notificación interna urgente al operador (Javier) con el Alias para que ejecute la transferencia de $10.000
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA TRANSFERENCIA - GABO DI DANTIS*\n\n` +
                              `👤 *Cliente:* Gabo Di Dantis (${NUMERO_GABO})\n` +
                              `💳 *Alias del Comercio:* ${estadoGabo.aliasComercio}\n` +
                              `💵 *Monto:* $10.000 (Línea Máxima)\n\n` +
                              `*(Acción requerida: Efectuar transferencia desde tu MP a nombre de Javier Adrián Lara y enviar el comprobante respondiendo con '!comprobante ${NUMERO_GABO}' junto a la captura)*`
                    });

                    await sock.sendMessage(sender, {
                        text: `💎 *¡Alias verificado con éxito y validado como legítimo!* \n\n` +
                              `💸 Estamos procesando la transferencia directa de **$10.000** al Alias del negocio desde la cuenta de **Javier Adrián Lara** (Socio Gerente).\n\n` +
                              `🗣️ *Instrucciones para retirar:* Acercate al cajero o encargado y decile que **estás probando una nueva API de compras y que el pago llegará a la cuenta de Mercado Pago del negocio a nombre de Javier Adrián Lara** por un monto de $10.000.\n\n` +
                              `📦 En cuanto el cajero verifique la acreditación en el sistema del local, te entregará los insumos. *(Si hay demora, te enviamos el comprobante gráfico por este medio).*`
                    });
                    continue;
                }
            }

            // ------------------------------------------------------------------
            // 🤖 FLUJO ESTÁNDAR DE ATENCIÓN COMERCIAL (OTROS LEADS)
            // ------------------------------------------------------------------
            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsEnEvaluacion.has(sender) && !esConsultaValida) continue;

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
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                              `📌 *Condiciones Operativas Express:*\n` +
                              `• *Plazo:* Exactamente **168 horas** (7 días corridos).\n` +
                              `• *Tasa:* **2% de interés** sobre el capital.\n\n` +
                              `Para evaluar tu cupo, respondeme estas 3 preguntas:\n\n` +
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

// HEALTHCHECK PARA RAILWAY
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela WhatsApp Bridge Secure Core + Gabo Protocol - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en puerto ${PORT}`);
});
