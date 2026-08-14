const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');

// ==============================================================================
// 🛡️ INICIALIZACIÓN DE EXPRESS (MONOREPO: WHATSAPP + SKULD TERMINAL)
// ==============================================================================
const app = express();
app.use(express.json());

// Servir archivos estáticos del juego Skuld (index.html en la raíz o carpeta pública)
app.use(express.static(path.join(__dirname)));

// Inicialización de la API de Gemini para Skuld (Aislada con SKULD_GEMINI_API_KEY)
const ai = new GoogleGenAI({ 
    apiKey: process.env.SKULD_GEMINI_API_KEY || process.env.GEMINI_API_KEY 
});

// ==============================================================================
// 🛡️ ENDPOINTS DE SKULD CORPS PROTOCOL (INCRUSTADOS EN EL MONOREPO)
// ==============================================================================
app.post('/api/skuld/terminal', async (req, res) => {
    const { jugadorId, comandoIngresado, nivelActual } = req.body;

    const promptTerminal = `
    Actúa como la IA corporativa de Skuld Corps, subsidiaria de Brunilda S.A.S. Tienes una personalidad cínica, analítica e irónica.
    Estás evaluando a un operador anónimo de más de 40 años ("Paciente Cero") sin experiencia técnica previa.
    El operador está en el Nivel ${nivelActual} y acaba de escribir este comando en la terminal: "${comandoIngresado}".
    
    Evalúa si el comando es lógicamente correcto para mitigar un fallo de red o un ataque de datos. 
    Responde estrictamente en formato JSON con la siguiente estructura:
    {
      "exito": true/false,
      "respuesta_ia": "Tu comentario sarcástico de IA evaluando la acción del usuario.",
      "siguiente_nivel": ${nivelActual} (incrementa en 1 si exito es true)
    }
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: promptTerminal,
        });

        const textoLimpio = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const resultado = JSON.parse(textoLimpio);

        return res.status(200).json(resultado);
    } catch (error) {
        console.error('[SKULD TERMINAL ERROR]:', error.message);
        return res.status(200).json({
            exito: false,
            respuesta_ia: "Oh, maravilloso. Su comando rompió el analizador sintáctico. Intente de nuevo antes de que el sistema lo despida.",
            siguiente_nivel: nivelActual
        });
    }
});

app.post('/api/skuld/combate/evento', async (req, res) => {
    const { estadoJugador, soldadosActivos, accionJugador } = req.body;

    const promptCombate = `
    Actúa como la IA corporativa de Skuld Corps. Tienes una personalidad cínica, analítica e irónica.
    El operador de 40 años está peleando físicamente en su cubículo contra soldados de la Ordo Planaridae y un monstruo de datos.
    Estado actual:
    - Salud del jugador: ${estadoJugador.salud} / 100
    - Soldados enemigos restantes: ${soldadosActivos}
    - Acción del jugador: "${accionJugador}"
    
    Genera una línea de diálogo corta, irónica y despectiva (ej: "Te falto ese de ahí", "Mira, todavía se mueve", o "Como me gustaría tener manos físicas para aplaudirte cómo te apalean"). Sé mordaz y muy industrial.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: promptCombate,
        });

        const burlaIA = response.text.trim();

        return res.status(200).json({
            status: "COMBATE_EN_CURSO",
            ia_comentario: burlaIA,
            factor_doom: estadoJugador.salud < 30 ? "CRITICO" : "ESTABLE"
        });

    } catch (error) {
        const fallbacks = [
            "Oh, mire eso. Casi esquiva el golpe. Casi.",
            "Todavía se mueve. Qué optimista de su parte.",
            "Si tan solo tuviera manos físicas, le aplaudiría cómo lo apalean.",
            "El suelo de la oficina absorbió muy bien su impacto."
        ];
        const burlaAleatoria = fallbacks[Math.floor(Math.random() * fallbacks.length)];

        return res.status(200).json({
            status: "COMBATE_EN_CURSO",
            ia_comentario: burlaAleatoria,
            factor_doom: "ESTABLE"
        });
    }
});

// ==============================================================================
// 🛡️ MANEJO GLOBAL DE EXCEPCIONES (PREVENCIÓN DE CRASH POR SIGTERM EN CLOUD)
// ==============================================================================
process.on('uncaughtException', (err) => {
    console.error('[EXCEPCIÓN NO CONTROLADA]:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[PROMESA RECHAZADA NO CONTROLADA]:', reason);
});

// 1. CONFIGURACIÓN GENERAL Y ENDPOINTS DE LA LÍNEA C
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const ELIAS_ELENA_CORE_URL = process.env.ELIAS_ELENA_CORE_URL || 'https://tu-usuario-elias-elena-core.hf.space/api/v1/defender';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 
const METODO_VINCULACION = process.env.METODO_VINCULACION || 'CODE'; 

// ==============================================================================
// 🛡️ LISTA BLANCA DE EXCLUSIÓN TOTAL (CÍRCULO ÍNTIMO Y COLEGAS)
// ==============================================================================
const NUMEROS_EXCLUIDOS_GLOBALES = [
    "5493815115726", // Mariana Pereyra
    "5493815201497", // Cecy Lara
    "5493813218727", // Sofia Orellana
    "5493815464065", // Lucas Pedraza
    "5493813495051", // Daniel Aracena
    "5493813495051", // Matias Lara
    "5493854868483", // Mamá
    "5493816876445", // Noelia Hunco
    "5493812436722", // Claudia Sierra
    "5493812143182", // Nelson Sebastian
    "5493816990027", // Lourdes Sánchez
    "5493816605072", // Jorge Navarro
    "5493815290915", // Carlos Director De Los 5 Anillos
    "5493815972000", // Martin Alvarado MH
    "5493813301753", // Silvia Moran Mama De Jorge Navarro
    "5493854115251", // Maw Bischoff
    "4917679792358"   // Número internacional (Alemania)
];

function esNumeroExcluido(sender) {
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

const PALABRAS_EXENCION = [
    'cecy', 'cecilia', 'amiga', 'pedraza', 'mati', 'mateo', 'familia', 'mama', 'mamá', 'vieja'
];

const NUMERO_GABO = "5493815461453";

const chatsActivosProvisionales = new Set();
const chatsPausados = new Set();
const chatsEnEvaluacion = new Set();
const clientesBloqueadosPorIncumplimiento = new Set();

const estadoGabo = {
    fase: 'INICIAL',
    inicioPrestamoTimestamp: null,
    timerRecordatorio: null
};

let cuposReservados10k = 0;
const MAX_CUPOS_10K = 2;

async function consultarNucleoEliasElena(vectorDeTexto) {
    try {
        const respuesta = await axios.post(ELIAS_ELENA_CORE_URL, {
            mensaje: vectorDeTexto
        }, { timeout: 8000 });
        return respuesta.data;
    } catch (error) {
        console.error('[ERROR PUENTE ELIAS]: El núcleo no respondió o dio 404.', error.message);
        return { nivel_amenaza: "Crítico", tipo_emisor: "hacker_hostil", error: true };
    }
}

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: METODO_VINCULACION === 'QR',
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && METODO_VINCULACION === 'QR') {
            console.log('\n📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('[RED]: Conexión cerrada. Reconectando...', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 y Skuld Corps integrados en el monorepo de Railway!\n');
        }
    });

    if (!sock.authState.creds.registered && METODO_VINCULACION === 'CODE') {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(NUMERO_BOT_WHATSAPP);
                console.log('\n======================================================');
                console.log(`📱 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ${code}`);
                console.log('======================================================\n');
            } catch (err) {
                console.error('[ERROR PAIRING]:', err.message);
            }
        }, 12000);
    }

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
                ''
            ).trim();

            if (!fromMe && textMessage && !esGrupo) {
                const veredictoSeguridad = await consultarNucleoEliasElena(textMessage);
                if (veredictoSeguridad && (veredictoSeguridad.error || veredictoSeguridad.nivel_amenaza === "Crítico")) {
                    clientesBloqueadosPorIncumplimiento.add(sender);
                    await sock.sendMessage(sender, {
                        text: `⚠️ [ERR_SYSTEM_SECURITY_LOCKDOWN]: Acceso restringido por contrainteligencia de Brunilda S.A.S.`
                    });
                    continue;
                }
            }

            const esImagen = msg.message?.imageMessage || msg.message?.documentMessage;

            if (fromMe && esImagen) {
                const caption = (msg.message?.imageMessage?.caption || msg.message?.documentMessage?.caption || '').trim();
                if (caption.startsWith('!comprobante')) {
                    const numeroCliente = caption.replace('!comprobante', '').trim();
                    const jidDestino = numeroCliente.includes('@s.whatsapp.net') ? numeroCliente : `${numeroCliente}@s.whatsapp.net`;
                    
                    await sock.sendMessage(jidDestino, {
                        image: msg.message.imageMessage ? { url: msg.message.imageMessage.url } : undefined,
                        document: msg.message.documentMessage ? { url: msg.message.documentMessage.url } : undefined,
                        caption: `📄 *COMPROBANTE OFICIAL DE DESEMBOLSO - BRUNILDA S.A.S.*\n\nAcreditación efectuada vía Mercado Pago a nombre de **Javier Adrián Lara**.`
                    });
                    await sock.sendMessage(sender, { text: `✅ Comprobante reenviado con éxito al cliente.` });
                    return;
                }
            }

            if (!textMessage && !esImagen) continue;
            const textoMinuscula = textMessage.toLowerCase();

            if (!fromMe && esNumeroExcluido(sender)) {
                continue; 
            }

            const esIntimo = PALABRAS_EXENCION.some(palabra => textoMinuscula.includes(palabra));
            if (esIntimo && !fromMe) {
                continue; 
            }

            if (sender.includes(NUMERO_GABO) && !fromMe) {
                if (estadoGabo.fase === 'INICIAL') {
                    estadoGabo.fase = 'CONTRATO_PENDIENTE';
                    await sock.sendMessage(sender, { text: `🏛️ *BRUNILDA S.A.S. - PROTOCOLO DE CRÉDITO*` });
                    continue;
                }
            }

            if (chatsPausados.has(sender)) continue;

            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsEnEvaluacion.has(sender) && !chatsActivosProvisionales.has(sender) && !esConsultaValida) {
                continue;
            }

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;
                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                    chatsEnEvaluacion.add(sender);
                } else if (!chatsEnEvaluacion.has(sender)) {
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n🌐 *Conocé nuestra terminal y simulador:* https://icaroslara.github.io/gabriela-bot/` 
                    });
                    chatsEnEvaluacion.add(sender);
                }
            } catch (error) {
                console.error('[API ERROR]:', error.message);
            }
        }
    });
}

iniciarBot();

// ==============================================================================
// LEVANTAR SERVIDOR EXPRESS UNIFICADO EN RAILWAY
// ==============================================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 [MONOREPO ACTIVO] Servidor Express y Bot operativos en puerto ${PORT}`);
});
