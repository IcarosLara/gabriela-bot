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
            
            // Iniciar motor de difusión rotativo
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
                
                // Si la captura incluye el comando !comprobante + número del cliente
                if (caption.startsWith('!comprobante')) {
                    const numeroCliente = caption.replace('!comprobante', '').trim();
                    const jidDestino = numeroCliente.includes('@s.whatsapp.net') ? numeroCliente : `${numeroCliente}@s.whatsapp.net`;
                    
                    console.log(`📸 Reenviando comprobante de pago al cliente: ${jidDestino}`);

                    // Reenvía la imagen con el formato oficial de Brunilda S.A.S.
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
                continue; // Gabriela se vuelve invisible en esta conversación
            }

            // ------------------------------------------------------------------
            // 🤝 FILTRO DE GABO DI DANTIS (MODO MIXTO: HUMANO / BOT)
            // ------------------------------------------------------------------
            if (sender.includes(NUMERO_GABO) && !fromMe) {
                const palabrasOperativas = ['prestamo', 'préstamo', 'credito', 'crédito', 'contrato', 'alias', 'negocio', 'comercio', 'dni', 'comprobante', 'insumos', 'mercaderia', 'mercadería', 'firmé', 'firme', 'plata', 'pagar'];
                const esOperativoGabo = palabrasOperativas.some(p => textoMinuscula.includes(p));
                
                if (!esOperativoGabo) {
                    console.log(`[FILTRO GABO]: Conversación casual/externa detectada con Gabo. Gabriela en silencio.`);
                    continue; // Hablás vos con él sin que el bot intervenga
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
                return; // Frena el flujo y no envía el payload a Python
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
                // COMANDO DINÁMICO DE BÓVEDA (Ajuste de capital en vivo)
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

                if (textoMinuscula === '!metricas' || textoMinuscula === '!stats') {
                    try {
                        const res = await axios.get(`${RAILWAY_WEBHOOK_URL.replace('/webhook', '')}/metricas`);
                        const m = res.data;
                        await sock.sendMessage(sender, {
                            text: `📊 *REPORTE DE GESTIÓN CREDITICIA - BRUNILDA S.A.S.*\n\n` +
                                  `⚡ *Cupos $10.000 Asignados:* ${cuposReservados10k}/${MAX_CUPOS_10K}\n` +
                                  `⚡ *Créditos Aprobados Hoy:* ${m.aprobados_hoy || 0}\n` +
                                  `📅 *Aprobados esta Semana:* ${m.aprobados_semana || 0}\n` +
                                  `🗓️ *Aprobados este Mes:* ${m.aprobados_mes || 0}\n\n` +
                                  `🔄 *Clientes Habituales:* ${m.clientes_habituales || 0}\n` +
                                  `⏳ *Solicitudes en Evaluación:* ${m.en_proceso || 0}\n\n` +
                                  `_Brunilda S.A.S. - Motor 1.5 Operativo_`
                        });
                    } catch (e) {
                        await sock.sendMessage(sender, { 
                            text: `📊 *BRUNILDA S.A.S. OPERATIVO*\n\nCupos $10.000 Asignados: ${cuposReservados10k}/${MAX_CUPOS_10K}. Engine sin anomalías.` 
                        });
                    }
                    return;
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

                if (textoMinuscula.includes('ok, te dejo con gabriela') || textoMinuscula === '!activar') {
                    chatsActivosProvisionales.add(sender);
                    chatsPausados.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🤖 *Gabriela:* Asistente activada. Procesando evaluación de microcrédito.' 
                    });
                    return;
                }

                if (textoMinuscula === '!pausa') {
                    chatsPausados.add(sender);
                    chatsActivosProvisionales.delete(sender);
                    await sock.sendMessage(sender, { 
                        text: '🛑 *Gabriela pausada en este canal.*' 
                    });
                    return;
                }

                continue;
            }

            // ------------------------------------------------------------------
            // 📢 2. DIFUSIÓN EN GRUPOS DE EMPRENDEDORES
            // ------------------------------------------------------------------
            if (esGrupo) {
                const palabrasClaveGrupo = ['prestamo', 'préstamo', 'credito', 'crédito', 'insumos', 'mercaderia', 'mercadería', 'financiación'];
                if (palabrasClaveGrupo.some(p => textoMinuscula.includes(p))) {
                    await sock.sendMessage(sender, {
                        text: `📢 *FINANCIAMIENTO DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
                              `🚀 ¡A partir de este **VIERNES** habilitamos créditos directos para compras de mercadería en comercios adheridos (cupos limitados)!\n\n` +
                              `👉 Para evaluar tu solicitud y reservar tu cupo hoy, *escribime por privado* marcando este mensaje o abriendo un chat individual.`
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

            // ------------------------------------------------------------------
            // 🤖 4. FLUJO DE EVALUACIÓN DIRECTA SIN REVELAR FUTURO
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

                        // FASE 1: PRIMER CONTACTO - CRUDA Y DIRECTA
                        await sock.sendMessage(sender, { 
                            text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                                  `📌 *Condiciones Operativas:*\n` +
                                  `• *Plazo de Devolución:* Exactamente **168 horas** (7 días corridos).\n` +
                                  `• *Tasa Promocional:* **2% de interés** sobre el capital otorgado.\n` +
                                  `• *Desembolsos:* A partir de este **VIERNES** con cupos limitados (líneas de ${montoOfrecido}).\n\n` +
                                  `Para evaluar y agendar tu solicitud con anticipación hoy mismo, respondeme estas 3 preguntas:\n\n` +
                                  `1️⃣ ¿Qué materiales o mercadería necesitás comprar?\n` +
                                  `2️⃣ ¿En qué negocio o comercio los vas a retirar?\n` +
                                  `3️⃣ ¿Cómo vas a generar los fondos para devolver el capital en 168 hs?`
                        });
                        chatsEnEvaluacion.add(sender);
                    } else {
                        // FASE 2: VERIFICACIÓN Y FIRMA DIGITAL DE MUTUO + PAGARÉ
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

                // ------------------------------------------------------------------
                // 🚨 5. ALERTA AL OPERADOR Y MENSAJE AUTOMÁTICO DE LIQUIDACIÓN
                // ------------------------------------------------------------------
                if (data && data.estado_siguiente === 5) {
                    const montoSolicitado = data.monto_aprobado || (cuposReservados10k <= MAX_CUPOS_10K ? 10000 : 5000);
                    const tasaInteres = 0.02;
                    const totalDevolucion = montoSolicitado * (1 + tasaInteres);

                    // A) Notificación al cliente con resumen formal de la deuda
                    await sock.sendMessage(sender, {
                        text: `🎉 *¡Tu crédito de insumos ha sido otorgado!*\n\n` +
                              `📋 *Resumen de la operación:*\n` +
                              `• *Monto aprobado:* $${montoSolicitado.toLocaleString('es-AR')}\n` +
                              `• *Tasa aplicada:* 2%\n` +
                              `• *Total a devolver:* $${totalDevolucion.toLocaleString('es-AR')}\n` +
                              `• *Plazo límite de pago:* Exactamente **168 horas** contadas a partir de la transferencia.`
                    });

                    // B) Notificación de ejecución para el Propietario/Operador
                    const jidPersonal = `${TU_NUMERO_PERSONAL}@s.whatsapp.net`;
                    await sock.sendMessage(jidPersonal, {
                        text: `🚨 *SOLICITUD LISTA PARA DESEMBOLSO*\n\n` +
                              `👤 *Cliente:* ${sender.replace('@s.whatsapp.net', '')}\n` +
                              `📄 *Contrato:* Mutuo + Pagaré Digital Auditado por Julián 1.5\n` +
                              `🛒 *Insumos:* Validado por Gabriela\n` +
                              `💵 *Monto:* $${montoSolicitado.toLocaleString('es-AR')} (Devuelve $${totalDevolucion.toLocaleString('es-AR')})\n\n` +
                              `*(Efectuar transferencia directa al Alias del negocio tras verificación)*`
                    });
                }

            } catch (error) {
                console.error('[API ERROR]:', error.message);
                
                if (!chatsEnEvaluacion.has(sender)) {
                    await sock.sendMessage(sender, { 
                        text: `¡Hola! Soy Gabriela, del sistema de microcréditos de insumos de Brunilda S.A.S.\n\n` +
                              `📌 *Condiciones:* Devolución a las **168 hs** con **2% de interés**.\n` +
                              `📌 *Operativa:* Desembolsos este **VIERNES** (Cupos limitados).\n\n` +
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
// 📢 MOTOR DE DIFUSIÓN ROTATIVO ANTI-SPAM (SOLO 3 GRUPOS AUTORIZADOS)
// ==============================================================================

const PLANTILLAS_DIFUSION = [
    `📢 *FINANCIAMIENTO DE INSUMOS - BRUNILDA S.A.S.*\n\n` +
    `🚀 ¡A partir de este **VIERNES** habilitamos créditos directos para compras de mercadería en comercios adheridos!\n\n` +
    `📌 *Líneas iniciales:* $5.000 a $10.000 ARS.\n` +
    `📌 *Devolución:* 168 horas (2% de interés).\n\n` +
    `👉 Para reservar tu cupo hoy, *escribime por privado* marcando este mensaje.`,

    `💡 *¿Necesitás stock o insumos para tu emprendimiento esta semana?*\n\n` +
    `En *Brunilda S.A.S.* financiamos la compra directa en tu distribuidora o comercio de confianza. Pagamos directo en la caja y retirás tus materiales.\n\n` +
    `🗓️ *Desembolsos:* Este **VIERNES** (cupos limitados).\n` +
    `📲 Mandame un mensaje al privado para evaluar tu solicitud hoy mismo.`,

    `🏪 *CRÉDITOS DE MERCADERÍA Y HERRAMIENTAS - TUCUMÁN*\n\n` +
    `Lanzamos líneas de financiamiento rápido a 7 días para feriantes, comercios y gastronómicos.\n\n` +
    `• Sin entrega de efectivo: pagamos en el local donde compras.\n` +
    `• Tasa promocional del 2% a 168 hs.\n\n` +
    `📩 Consultá requisitos por privado para agendar tu cupo del viernes.`
];

const NOMBRES_GRUPOS_AUTORIZADOS = [
    "Impulso universitario",
    "EMPRENDIMIENTOS",
    "Activando las Ventas en Feria"
];

function iniciarMotorDifusion(sock) {
    console.log('📢 Motor de difusión rotativo activado (HORARIO: 08:00 a 20:00 hs | SOLO GRUPOS AUTORIZADOS).');

    const INTERVALO_BASE_MS = 2.5 * 60 * 60 * 1000; 

    async function ejecutarBroadcast() {
        const horaActual = new Date().getHours();

        if (horaActual >= 8 && horaActual <= 20) {
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

                console.log(`🎯 Grupos autorizados detectados (${gruposValidados.length}):`, gruposValidados.map(g => g.nombre));

                if (gruposValidados.length > 0) {
                    const plantilla = PLANTILLAS_DIFUSION[Math.floor(Math.random() * PLANTILLAS_DIFUSION.length)];
                    
                    for (const grupo of gruposValidados) {
                        console.log(`📢 Enviando difusión a grupo autorizado: "${grupo.nombre}" (${grupo.jid})`);
                        await sock.sendMessage(grupo.jid, { text: plantilla });
                        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 10000) + 10000));
                    }
                } else {
                    console.log('⚠️ No se encontraron grupos que coincidan con la lista autorizada.');
                }
            } catch (err) {
                console.error('[ERROR BROADCAST]:', err.message);
            }
        } else {
            console.log('🌙 Fuera de horario comercial. Difusión pausada hasta mañana a las 08:00 hs.');
        }

        const jitter = (Math.random() * 30 - 15) * 60 * 1000; 
        const proximaEjecucion = INTERVALO_BASE_MS + jitter;
        
        console.log(`⏱️ Próxima difusión programada en ${(proximaEjecucion / 1000 / 60).toFixed(1)} minutos.`);
        setTimeout(ejecutarBroadcast, proximaEjecucion);
    }

    setTimeout(ejecutarBroadcast, 5 * 60 * 1000);
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
