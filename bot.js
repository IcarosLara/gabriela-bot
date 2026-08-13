const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

// 1. CONFIGURACIÓN GENERAL Y ENDPOINTS DE LA LÍNEA C
const RAILWAY_WEBHOOK_URL = process.env.RAILWAY_WEBHOOK_URL || 'https://gabriela-loan-api-production.up.railway.app/webhook';
const NUMERO_BOT_WHATSAPP = process.env.NUMERO_BOT || "5493812385889"; 
const TU_NUMERO_PERSONAL = process.env.TU_NUMERO_PERSONAL || "5493812385889"; 
const METODO_VINCULACION = process.env.METODO_VINCULACION || 'CODE'; 

// --- FILTRO DE INTIMIDAD Y EXCLUSIÓN SOCIAL (SEGUNDO PLANO) ---
const PALABRAS_EXENCION = [
    'cecy', 'cecilia', 'amiga', 'pedraza', 'mati', 'mateo', 'familia', 'mama', 'mamá', 'vieja'
];

// --- NÚMERO / JID DE GABO DI DANTIS (EXCEPCIÓN VIP / CHAT MIXTO) ---
const NUMERO_GABO = "5493815461453";

// MEMORIA DE ESTADO Y FILTRO DE LA ESFINGE
const chatsActivosProvisionales = new Set();
const chatsPausados = new Set();
const chatsEnEvaluacion = new Set();
const clientesBloqueadosPorIncumplimiento = new Set(); // Cero tolerancia: ignora olímpicamente

// CONTROL DE CUPOS Y ASIGNACIÓN DE CAPITAL
let cuposReservados10k = 0;
const MAX_CUPOS_10K = 2;

async function iniciarBot() {
    // SESIÓN LIMPIA EN AUTH_INFO_V2 (Mantenimiento de sesión estable)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_v2');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: METODO_VINCULACION === 'QR',
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    // 2. CONTROL DE CONEXIÓN DE RED
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
                setTimeout(() => iniciarBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 está conectada 24/7 a la API de Brunilda S.A.S. en Railway!\n');
            
            // Iniciar motor de difusión multicanal
            iniciarMotorDifusion(sock);
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
                console.error('[ERROR PAIRING]:', err.message);
            }
        }, 4000);
    }

    // 3. PROCESAMIENTO DE MENSAJES Y FILTROS
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

            // ------------------------------------------------------------------
            // 📸 REENVÍO DE COMPROBANTES DE MERCADO PAGO DESDE EL OPERADOR (JAVIER)
            // ------------------------------------------------------------------
            const esImagen = msg.message?.imageMessage || msg.message?.documentMessage;

            if (fromMe && esImagen) {
                const caption = (msg.message?.imageMessage?.caption || msg.message?.documentMessage?.caption || '').trim();
                
                if (caption.startsWith('!comprobante')) {
                    const numeroCliente = caption.replace('!comprobante', '').trim();
                    const jidDestino = numeroCliente.includes('@s.whatsapp.net') ? numeroCliente : `${numeroCliente}@s.whatsapp.net`;
                    
                    console.log(`📸 Reenviando comprobante de pago al cliente: ${jidDestino}`);

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

            if (!textMessage) continue;
            const textoMinuscula = textMessage.toLowerCase();

            // ------------------------------------------------------------------
            // 🛡️ FILTRO DE INTIMIDAD (EXCLUSIÓN DE CÍRCULO ÍNTIMO)
            // ------------------------------------------------------------------
            const esIntimo = PALABRAS_EXENCION.some(palabra => textoMinuscula.includes(palabra));
            if (esIntimo && !fromMe) {
                console.log(`[FILTRO DE INTIMIDAD]: Mensaje detectado en círculo íntimo (${sender}). Gabriela en reposo.`);
                continue; 
            }

            // ------------------------------------------------------------------
            // 🤝 FILTRO DE GABO DI DANTIS (MODO MIXTO: HUMANO / BOT)
            // ------------------------------------------------------------------
            if (sender.includes(NUMERO_GABO) && !fromMe) {
                const palabrasOperativas = ['prestamo', 'préstamo', 'credito', 'crédito', 'contrato', 'alias', 'negocio', 'comercio', 'dni', 'comprobante', 'insumos', 'mercaderia', 'mercadería', 'firmé', 'firme', 'plata', 'pagar'];
                const esOperativoGabo = palabrasOperativas.some(p => textoMinuscula.includes(p));
                
                if (!esOperativoGabo) {
                    console.log(`[FILTRO GABO]: Conversación casual/externa detectada con Gabo. Gabriela en silencio.`);
                    continue; 
                } else {
                    console.log(`[FILTRO GABO]: Mensaje operativo detectado. Gabriela toma el control.`);
                }
            }

            // ------------------------------------------------------------------
            // 🌐 FILTRO SOBERANO DE JURISDICCIÓN (SÓLO ARGENTINA +54 / 549)
            // ------------------------------------------------------------------
            const esNumeroArgentino = sender.startsWith('54') || sender.startsWith('+54');

            if (!esNumeroArgentino && !esGrupo && !fromMe) {
                console.log(`🌐 Consulta internacional detectada desde: ${sender}`);
                
                await sock.sendMessage(sender, {
                    text: `🏛️ *BRUNILDA S.A.S. - B2B & TECH EXPORT*\n\n` +
                          `Estimado/a. El sistema de microcréditos de insumos con liquidación directa a comercios opera actualmente de forma exclusiva en la *República Argentina*.\n\n` +
                          `💼 *Para licencias de software, integración de la API de Evaluación Agéntica o alianzas internacionales:* Escriba a la dirección oficial de la empresa o aguarde la apertura de mercados regionales en nuestra próxima fase de expansión.`
                });
                return; 
            }

            // ⛔ FILTRO DE LA ESFINGE: SI INCUMPLIÓ, EL BOT LO IGNORA
            if (clientesBloqueadosPorIncumplimiento.has(sender)) {
                console.log(`[ESFINGE]: Cliente bloqueado por mora/incumplimiento (${sender}). Ignorando.`);
                continue;
            }

            // ------------------------------------------------------------------
            // 👑 1. COMANDOS DE ADMINISTRACIÓN / OPERADOR (fromMe === true)
            // ------------------------------------------------------------------
            if (fromMe) {
                if (textoMinuscula.startsWith('!boveda')) {
                    const nuevoMonto = parseFloat(textoMinuscula.replace('!boveda', '').trim());
                    if (!isNaN(nuevoMonto)) {
                        try {
                            await axios.post(`${RAILWAY_WEBHOOK_URL.replace('/webhook', '')}/api/v1/ajustar-boveda?monto=${nuevoMonto}`);
                            await sock.sendMessage(sender, { 
                                text: `⚙️ *BÓVEDA AJUSTADA:* Capital máximo configurado en **$${nuevoMonto.toLocaleString('es-AR')} ARS**.` 
                            });
                        } catch (e) {
                            await sock.sendMessage(sender, { text: `❌ Error al actualizar el monto de la bóveda.` });
                        }
                    }
                    return;
                }

                if (textoMinuscula === '!metricas' === textoMinuscula === '!stats') {
                    // (Soporte métricas)
                }

                if (textoMinuscula.startsWith('!bloquear')) {
                    const numeroABloquear = textoMinuscula.replace('!bloquear', '').trim();
                    if (numeroABloquear) {
                        const jidBloquear = `${numeroABloquear}@s.whatsapp.net`;
                        clientesBloqueadosPorIncumplimiento.add(jidBloquear);
                        await sock.sendMessage(sender, { text: `⛔ Cliente ${numeroABloquear} aislado del sistema.` });
                    }
                    return;
                }

                // COMANDO CLAVE DE TRASPASO A HUMANO SOLICITADO POR EL OPERADOR
                if (textoMinuscula.includes('ok, entonces te dejo que termines de hacer los tramites con gabriela dale?') || textoMinuscula === '!humano') {
                    chatsPausados.delete(sender);
                    chatsActivosProvisionales.add(sender);
                    await sock.sendMessage(sender, { 
                        text: `🤝 *Atención:* El operador humano ha sintonizado este canal. Podés continuar la coordinación directa con Javier.` 
                    });
                    return;
                }

                if (textoMinuscula === '!pausa') {
                    chatsPausados.add(sender);
                    chatsActivosProvisionales.delete(sender);
                    await sock.sendMessage(sender, { text: '🛑 *Gabriela pausada en este canal.*' });
                    return;
                }

                continue;
            }

            // ------------------------------------------------------------------
            // 📢 2. DIFUSIÓN EN GRUPOS DE EMPRENDEDORES (WHATSAPP)
            // ------------------------------------------------------------------
            if (esGrupo) {
                const palabrasClaveGrupo = ['prestamo', 'préstamo', 'credito', 'crédito', 'insumos', 'mercaderia', 'mercadería', 'financiación'];
                if (palabrasClaveGrupo.some(p => textoMinuscula.includes(p))) {
                    await sock.sendMessage(sender, {
                        text: `📢 *FINANCIAMIENTO DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
                              `🚀 Conocé los detalles y requisitos en nuestra web oficial:\n🔗 https://icaroslara.github.io/gabriela-bot/\n\n` +
                              `👉 Para evaluar tu solicitud y reservar tu cupo hoy, *escribime por privado*.`
                    });
                }
                continue;
            }

            // ------------------------------------------------------------------
            // 👥 3. EVALUACIÓN Y CAPTACIÓN INDIVIDUAL
            // ------------------------------------------------------------------
            if (chatsPausados.has(sender)) continue;

            const palabrasClave = ['hola', 'prestamo', 'préstamo', 'credito', 'crédito', 'requisitos', 'insumos', 'info', 'mercaderia', 'mercadería', 'solicitar'];
            const esConsultaValida = palabrasClave.some(palabra => textoMinuscula.includes(palabra));

            if (!chatsEnEvaluacion.has(sender) && !chatsActivosProvisionales.has(sender) && !esConsultaValida) {
                continue;
            }

            // Detección si el cliente prefiere hablar con un humano o desvía el tema
            if (textoMinuscula.includes('humano') || textoMinuscula.includes('persona') || textoMinuscula.includes('operador') || textoMinuscula.includes('hablar con alguien')) {
                chatsPausados.add(sender);
                const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                await sock.sendMessage(jidPersonal, {
                    text: `🚨 *ALERTA DE ATENCIÓN HUMANA*\n\nEl cliente ${sender.replace('@s.whatsapp.net', '')} solicita asistencia directa con el operador humano.`
                });
                await sock.sendMessage(sender, {
                    text: `👤 *Gabriela:* Derivando la consulta con el operador humano de Brunilda S.A.S. Aguardá un momento por favor.`
                });
                continue;
            }

            // ------------------------------------------------------------------
            // 🤖 4. FLUJO DE EVALUACIÓN DIRECTA CON ENLACE WEB
            // ------------------------------------------------------------------
            console.log(`💬 Processing payload from ${sender}: "${textMessage}"`);

            try {
                const response = await axios.post(RAILWAY_WEBHOOK_URL, {
                    sender: sender,
                    message: textMessage
                });

                const data = response.data;

                if (data && data.respuesta_bot) {
                    await sock.sendMessage(sender, { text: data.respuesta_bot });
                    chatsEnEvaluacion.add(sender);
                } else {
                    if (!chatsEnEvaluacion.has(sender)) {
                        let montoOfrecido = "$5.000";
                        if (cuposReservados10k < MAX_CUPOS_10K) {
                            montoOfrecido = "$5.000 a $10.000";
                        }

                        await sock.sendMessage(sender, { 
                            text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                                  `🌐 *Revisá primero nuestra plataforma y condiciones:* \nhttps://icaroslara.github.io/gabriela-bot/\n\n` +
                                  `📌 *Condiciones Operativas Express:*\n` +
                                  `• *Plazo:* Exactamente **168 horas** (7 días corridos).\n` +
                                  `• *Tasa:* **2% de interés** sobre el capital.\n` +
                                  `• *Desembolsos:* A partir de este **VIERNES** (líneas de ${montoOfrecido}).\n\n` +
                                  `Para evaluar tu cupo hoy mismo, respondeme estas 3 preguntas:\n\n` +
                                  `1️⃣ ¿Qué materiales o mercadería necesitás comprar?\n` +
                                  `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                                  `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 168 hs?`
                        });
                        chatsEnEvaluacion.add(sender);
                    } else {
                        await sock.sendMessage(sender, { 
                            text: `¡Perfecto! Para avanzar con el agendamiento y la firma del **Contrato de Mutuo Digital + Pagaré Electrónico** con Brunilda S.A.S.:\n\n` +
                                  `📷 1. Enviame foto de tu DNI (frente y dorso) y una selfie de tu rostro.\n` +
                                  `✍️ 2. Tu confirmación en este chat constituye acceptance contractual digital.\n\n` +
                                  `🏪 *El día viernes:* Una vez en el comercio, le sacás foto al local de frente y nos pasás el Alias/CVU de Mercado Pago del negocio. Le transferimos directamente al comercio y retirás tus insumos al instante.`
                        });
                        
                        if (cuposReservados10k < MAX_CUPOS_10K) {
                            cuposReservados10k++;
                        }
                    }
                }

                if (data && data.estado_siguiente === 5) {
                    const montoSolicitado = data.monto_aprobado || (cuposReservados10k <= MAX_CUPOS_10K ? 10000 : 5000);
                    const tasaInteres = 0.02;
                    const totalDevolucion = montoSolicitado * (1 + tasaInteres);

                    await sock.sendMessage(sender, {
                        text: `🎉 *¡Tu crédito de insumos ha sido otorgado!*\n\n` +
                              `📋 *Resumen de la operación:*\n` +
                              `• *Monto aprobado:* $${montoSolicitado.toLocaleString('es-AR')}\n` +
                              `• *Tasa aplicada:* 2%\n` +
                              `• *Total a devolver:* $${totalDevolucion.toLocaleString('es-AR')}\n` +
                              `• *Plazo límite de pago:* Exactamente **168 horas** contadas a partir de la transferencia.`
                    });

                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Mutuo + Pagaré Digital Auditado por Julián 1.5\n` +
                              `🛒 *Insumos:* Validado por Gabriela\n` +
                              `💵 *Monto:* $${montoSolicitado.toLocaleString('es-AR')} (Devuelve $${totalDevolucion.toLocaleString('es-AR'  )})\n\n` +
                              `*(Efectuar transferencia directa al Alias del negocio tras verificación)*`
                    });
                }

            } catch (error) {
                console.error('[API ERROR]:', error.message);
                
                if (!chatsEnEvaluacion.has(sender)) {
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                              `🌐 *Conocé el proyecto:* https://icaroslara.github.io/gabriela-bot/\n\n` +
                              `📌 *Condiciones:* Devolución a las **168 hs** con **2% de interés**.\n` +
                              `📌 *Operativa:* Desembolsos este **VIERNES**.\n\n` +
                              `Respondeme estas 3 preguntas para evaluar tu cupo hoy:\n\n` +
                              `1️⃣ ¿Qué materiales o mercadería necesitás comprar?\n` +
                              `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                              `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 168 hs?`
                    });
                    chatsEnEvaluacion.add(sender);
                } else {
                    await sock.sendMessage(sender, { 
                        text: `¡Perfecto! Para agendar tu solicitud para el viernes:\n\n` +
                              `📷 Pasame foto de tu DNI (frente y dorso) + selfie de tu rostro.\n\n` +
                              `🏪 El viernes, cuando estés en la distribuidora, enviás la foto del local y el Alias del comercio para realizar el pago directo.`
                    });
                }
            }
        }
    });
}

// ==============================================================================
// 📢 MOTOR DE DIFUSIÓN MULTICANAL (WHATSAPP + CATÁLOGO DE GRUPOS DE FACEBOOK)
// ==============================================================================

const PLANTILLAS_DIFUSION_API = [
    `📢 *SISTEMA DE MICROCRÉDITOS DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
    `🚀 ¿Necesitás stock, mercadería o herramientas para tu emprendimiento en Tucumán?\n\n` +
    `🌐 *Visitá nuestra web oficial:* https://icaroslara.github.io/gabriela-bot/\n\n` +
    `• Financiación directa sin pasar por bancos.\n` +
    `• Pagamos directo al comercio y retirás al instante.\n` +
    `• Plazo: 168 horas (7 días) con tasa promocional del 2%.\n\n` +
    `👉 *Iniciá tu evaluación automática escribiendo al privado.*`,

    `💡 *LÍNEA DE CRÉDITO ÁGIL PARA COMERCIOS Y FERIANTES*\n\n` +
    `Operamos con cupos limitados de capital para abastecimiento inmediato en Tucumán.\n` +
    `🌐 *Conocé más:* https://icaroslara.github.io/gabriela-bot/\n\n` +
    `• Cero efectivo en mano: liquidación directa al proveedor.\n` +
    `• Validación agéntica instantánea por WhatsApp.\n\n` +
    `📲 *Escribime por privado para coordinar tu cupo operativo de esta semana.*`
];

const NOMBRES_GRUPOS_AUTORIZADOS = [
    "Impulso universitario",
    "EMPRENDIMIENTOS",
    "Activando las Ventas en Feria"
];

// Catálogo completo de nodos de Facebook (Tucumán / Emprendedores) para referencia y despliegue manual/asistido
const GRUPOS_FACEBOOK_TUCUMAN = [
    "https://www.facebook.com/groups/2172262632989328",
    "https://www.facebook.com/groups/1394502770854035/",
    "https://www.facebook.com/groups/700304290049093/",
    "https://www.facebook.com/groups/1354064399204358/",
    "https://www.facebook.com/groups/142879459662158",
    "https://www.facebook.com/groups/151380463528326",
    "https://www.facebook.com/groups/896151388499604/",
    "https://www.facebook.com/groups/3479044339084820/",
    "https://www.facebook.com/groups/2612748399045340/",
    "https://www.facebook.com/groups/620037500898356/",
    "https://www.facebook.com/groups/1736002576686741/",
    "https://www.facebook.com/groups/995029149002432/",
    "https://www.facebook.com/groups/6047094375350212/",
    "https://www.facebook.com/groups/1776863525951433/",
    "https://www.facebook.com/groups/1340005841268859/",
    "https://www.facebook.com/groups/1263020233736895/",
    "https://www.facebook.com/groups/933582880558743/",
    "https://www.facebook.com/groups/tucumanemprendejuntos/",
    "https://www.facebook.com/groups/tucsontucuman/",
    "https://www.facebook.com/groups/1967793493470122/",
    "https://www.facebook.com/groups/806284709527139/",
    "https://www.facebook.com/groups/674118302285476/",
    "https://www.facebook.com/groups/553662105504414/",
    "https://www.facebook.com/groups/471268432404874/",
    "https://www.facebook.com/groups/616525368404823/",
    "https://www.facebook.com/groups/1665692150725971/",
    "https://www.facebook.com/groups/1543022199193518/",
    "https://www.facebook.com/groups/1182724812378081/",
    "https://www.facebook.com/groups/1174318729287342/",
    "https://www.facebook.com/groups/338318037250183/",
    "https://www.facebook.com/groups/280481515717874/"
];

function iniciarMotorDifusion(sock) {
    console.log('📢 Motor de difusión multicanal activado (WhatsApp + Enlace Web de Gabriela).');

    async function ejecutarBroadcastHibrido() {
        const ahora = new Date();
        const anio = ahora.getFullYear();
        const mes = ahora.getMonth(); // 7 = Agosto
        const dia = ahora.getDate();  

        const esViernesOPosterior = (anio > 2026 || mes > 7 || (mes === 7 && dia >= 14));

        let debeEjecutar = false;

        if (!esViernesOPosterior) {
            debeEjecutar = true; // Modo hoy (4-5 hs)
        } else {
            const horaActual = ahora.getHours();
            // Bloques estrictos: 06:00 hs, 13:00 hs, 17:00 hs
            debeEjecutar = (horaActual === 6) || (horaActual === 13) || (horaActual === 17);
        }

        if (debeEjecutar) {
            try {
                const todosLosGrupos = await sock.groupFetchAllParticipating();
                const gruposValidados = [];

                for (const jid in todosLosGrupos) {
                    const nombreGrupo = todosLosGrupos[jid].subject || "";
                    const esAutorizado = NOMBRES_GRUPOS_AUTORIZADOS.some(nombreValido => 
                        nombreGrupo.toLowerCase().includes(nombreValido.toLowerCase())
                    );
                    if (esAutorizado) {
                        gruposValidados.push({ jid, nombre: nombreGrupo });
                    }
                }

                if (gruposValidados.length > 0) {
                    const gruposSeleccionados = gruposValidados.sort(() => 0.5 - Math.random()).slice(0, 2);
                    const plantilla = PLANTILLAS_DIFUSION_API[Math.floor(Math.random() * PLANTILLAS_DIFUSION_API.length)];

                    for (const grupo of gruposSeleccionados) {
                        console.log(`📢 [BROADCAST MULTICANAL]: Enviando a grupo "${grupo.nombre}" (${grupo.jid})`);
                        await sock.sendMessage(grupo.jid, { text: plantilla });
                        await new Promise(r => setTimeout(r, 20000));
                    }
                }
            } catch (err) {
                console.error('[ERROR BROADCAST MULTICANAL]:', err.message);
            }
        }

        const tiempoEspera = !esViernesOPosterior ? (4.5 * 60 * 60 * 1000) : (10 * 60 * 1000);
        setTimeout(ejecutarBroadcastHibrido, tiempoEspera);
    }

    setTimeout(ejecutarBroadcastHibrido, 10 * 60 * 1000);
}

iniciarBot();

// SERVER HEALTHCHECK PARA RAILWAY
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela WhatsApp Bridge Operativo - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en el puerto ${PORT}`);
});
