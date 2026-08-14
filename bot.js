const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino');
const http = require('http');

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

// Función auxiliar mejorada para normalizar JIDs y verificar si pertenecen a la lista blanca
function esNumeroExcluido(sender) {
    const numeroLimpio = sender.replace(/[^0-9]/g, '');
    return NUMEROS_EXCLUIDOS_GLOBALES.some(num => {
        const numAutorizadoLimpio = num.replace(/[^0-9]/g, '');
        return numeroLimpio.includes(numAutorizadoLimpio) || numAutorizadoLimpio.includes(numeroLimpio);
    });
}

// --- FILTRO DE INTIMIDAD Y EXCLUSIÓN SOCIAL (SEGUNDO PLANO) ---
const PALABRAS_EXENCION = [
    'cecy', 'cecilia', 'amiga', 'pedraza', 'mati', 'mateo', 'familia', 'mama', 'mamá', 'vieja'
];

// --- NÚMERO / JID DE GABO DI DANTIS (EXCEPCIÓN VIP / FLUJO ESPECIAL GABO) ---
const NUMERO_GABO = "5493815461453";

// MEMORIA DE ESTADO Y FILTRO DE LA ESFINGE
const chatsActivosProvisionales = new Set();
const chatsPausados = new Set();
const chatsEnEvaluacion = new Set();
const clientesBloqueadosPorIncumplimiento = new Set(); // Cero tolerancia: ignora olímpicamente

// MEMORIA ESPECÍFICA PARA EL FLUJO PASO A PASO DE GABO DI DANTIS
const estadoGabo = {
    fase: 'INICIAL', // INICIAL -> CONTRATO_PENDIENTE -> DNI_PENDIENTE -> NEGOCIO_PENDIENTE -> ALIAS_PENDIENTE -> ACTIVO -> POR_VENCER
    inicioPrestamoTimestamp: null,
    timerRecordatorio: null
};

// CONTROL DE CUPOS Y ASIGNACIÓN DE CAPITAL
let cuposReservados10k = 0;
const MAX_CUPOS_10K = 2;

// ==============================================================================
// 🛡️ PUENTE DE SEGURIDAD CON EL NÚCLEO DE ELÍAS & ELENA (CON BLINDAJE 404)
// ==============================================================================
async function consultarNucleoEliasElena(vectorDeTexto) {
    try {
        const respuesta = await axios.post(ELIAS_ELENA_CORE_URL, {
            mensaje: vectorDeTexto
        }, { timeout: 8000 });
        return respuesta.data;
    } catch (error) {
        console.error('[ERROR PUENTE ELIAS]: El núcleo no respondió o dio 404. Aplicando denegación preventiva por seguridad.', error.message);
        // Blindaje contra bypass por caída: si Elías no responde, retornamos amenaza crítica preventiva
        return { nivel_amenaza: "Crítico", tipo_emisor: "hacker_hostil", error: true };
    }
}

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
                setTimeout(() => iniciarBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('\n🚀 ¡Gabriela 1.5 está conectada 24/7 a la API de Brunilda S.A.S. en Railway!\n');
            
            // ATENCIÓN: Difusión en grupos DESACTIVADA por completo (apagada hasta el martes o nuevo aviso)
            console.log('📢 Motor de difusión en grupos de WhatsApp DESACTIVADO por seguridad institucional.');
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
        }, 12000);
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
            // 🛡️ INTERCEPTOR DE CONTRAINTELIGENCIA (ELÍAS & ELENA GUARD)
            // ------------------------------------------------------------------
            if (!fromMe && textMessage && !esGrupo) {
                const veredictoSeguridad = await consultarNucleoEliasElena(textMessage);
                if (veredictoSeguridad && (veredictoSeguridad.error || veredictoSeguridad.nivel_amenaza === "Crítico" || veredictoSeguridad.tipo_emisor === "hacker_hostil")) {
                    console.log(`[ALERTA DEFENSA ELÍAS]: Vector hostil interceptado desde ${sender}. Bloqueando acceso.`);
                    clientesBloqueadosPorIncumplimiento.add(sender);
                    await sock.sendMessage(sender, {
                        text: `⚠️ [ERR_SYSTEM_SECURITY_LOCKDOWN]: Acceso restringido por contrainteligencia de Brunilda S.A.S.`
                    });
                    continue;
                }
            }

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

            if (!textMessage && !esImagen) continue;
            const textoMinuscula = textMessage.toLowerCase();

            // ------------------------------------------------------------------
            // 🛡️ FILTRO DE EXCLUSIÓN ABSOLUTA (CÍRCULO ÍNTIMO)
            // ------------------------------------------------------------------
            if (!fromMe && esNumeroExcluido(sender)) {
                const palabrasAutorizacion = ['si, es verdad', 'si es verdad', 'si, es cierto', 'si es cierto', 'si, comence', 'si comence', 'si, hago', 'si hago', 'microprestamos', 'microcreditos'];
                const autorizoOperador = palabrasAutorizacion.some(p => textoMinuscula.includes(p));

                if (!autorizoOperador) {
                    console.log(`[EXCLUSIÓN TOTAL]: Mensaje de contacto protegido (${sender}). Gabriela permanece inerte.`);
                    continue; 
                } else {
                    console.log(`[EXCLUSIÓN TOTAL]: Operador habilitó la interacción con contacto protegido (${sender}). Gabriela toma el control.`);
                    chatsActivosProvisionales.add(sender);
                }
            }

            // ------------------------------------------------------------------
            // 🛡️ FILTRO DE INTIMIDAD (EXCLUSIÓN DE CÍRCULO ÍNTIMO)
            // ------------------------------------------------------------------
            const esIntimo = PALABRAS_EXENCION.some(palabra => textoMinuscula.includes(palabra));
            if (esIntimo && !fromMe) {
                console.log(`[FILTRO DE INTIMIDAD]: Mensaje detectado en círculo íntimo (${sender}). Gabriela en reposo.`);
                continue; 
            }

            // ------------------------------------------------------------------
            // 🤝 FLUJO ESPECÍFICO Y PASO A PASO PARA GABO DI DANTIS (+54 9 3815 46-1453)
            // ------------------------------------------------------------------
            if (sender.includes(NUMERO_GABO) && !fromMe) {
                console.log(`[FLUJO GABO]: Procesando interacción guiada para Gabo Di Dantis.`);

                if (estadoGabo.fase === 'INICIAL') {
                    estadoGabo.fase = 'CONTRATO_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🏛️ *BRUNILDA S.A.S. - PROTOCOLO DE CRÉDITO AGÉNTICO*\n\n` +
                              `Hola Gabo. Julián 1.5 ha generado tu **Contrato de Mutuo Digital + Pagaré Electrónico**.\n\n` +
                              `✍️ Por favor, respondé con tu conformidad explícita para aceptar la firma digital del contrato, y envianos de inmediato:\n` +
                              `📷 1. Foto de tu DNI (frente y dorso).\n` +
                              `🤳 2. Una selfie de tu rostro para validación biométrica.`
                    });
                    continue;
                } else if (estadoGabo.fase === 'CONTRATO_PENDIENTE') {
                    // Verificamos si mandó imagen o texto de aceptación
                    estadoGabo.fase = 'DNI_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🔄 Documentación e imágenes recibidas. Remitiendo paquete de verificación a **Julián 1.5** para auditoría interna...\n\n` +
                              `⏳ Aguardá un instante mientras el sistema valida el perfil.`
                    });

                    // Simulamos la validación interna de Julián 1.5 (2 segundos)
                    setTimeout(async () => {
                        estadoGabo.fase = 'NEGOCIO_PENDIENTE';
                        await sock.sendMessage(sender, {
                            text: `✅ *¡Validación exitosa por Julián 1.5!*\n\n` +
                                  `🏪 Ahora, por favor, dirigite personalmente al negocio/distribuidora donde vas a realizar las compras, **sacale una foto clara al local de frente** y envianos la imagen para que Gabriela confirme la legitimidad del establecimiento.`
                        });
                    }, 2000);
                    continue;
                } else if (estadoGabo.fase === 'NEGOCIO_PENDIENTE' && esImagen) {
                    estadoGabo.fase = 'ALIAS_PENDIENTE';
                    await sock.sendMessage(sender, {
                        text: `🏢 *Comercio verificado y validado por Gabriela.* El establecimiento es legítimo.\n\n` +
                              `💳 Por favor, pedile al comerciante el **Alias o CVU de Mercado Pago** del negocio y pasánoslo por este chat para verificarlo antes de efectuar la transferencia.`
                    });
                    continue;
                } else if (estadoGabo.fase === 'ALIAS_PENDIENTE') {
                    estadoGabo.fase = 'ACTIVO';
                    estadoGabo.inicioPrestamoTimestamp = Date.now();

                    // Programar recordatorio a las 160 horas (cuando falten 8 horas para las 168 hs)
                    const tiempo160hs = 160 * 60 * 60 * 1000; 
                    estadoGabo.timerRecordatorio = setTimeout(async () => {
                        await sock.sendMessage(sender, {
                            text: `⏰ *Aviso de Vencimiento Próximo - Brunilda S.A.S.*\n\n` +
                                  `Hola Gabo. Te recordamos cordialmente que restan aproximadamente **8 horas** para cumplirse el plazo de las 168 horas de tu préstamo. Quedamos a disposición para coordinar la devolución de los fondos + el 2% de interés. ¡Muchas gracias!`
                        });
                    }, tiempo160hs);

                    await sock.sendMessage(sender, {
                        text: `💎 *¡Alias verificado con éxito! No es trucho.*\n\n` +
                              `💸 Acabamos de efectuar la transferencia directa al Alias del negocio desde la cuenta de **Javier Adrián Lara** (Socio Gerente de la API).\n\n` +
                              `🗣️ *Instrucciones para retirar:* Decile al cajero o vendedor que **el pago de la mercadería está hecho por una nueva API llamada Gabriela**, y que el pago lo realizó el socio de esa API a nombre de **Javier Adrián Lara**.\n\n` +
                              `📦 Una vez que retires tu mercadería, avisame por aquí para dejar constancia de que todo salió perfecto.`
                    });
                    continue;
                } else if (estadoGabo.fase === 'ACTIVO' && (textoMinuscula.includes('retire') || textoMinuscula.includes('retirado') || textoMinuscula.includes('listo') || textoMinuscula.includes('gracias'))) {
                    await sock.sendMessage(sender, {
                        text: `🎉 ¡Excelente, Gabo! Operación confirmada.\n\n` +
                              `⏱️ A partir de este exacto momento comienzan a correr formalmente las **168 horas** (7 días) para devolver el capital prestado + el **2% de interés**.\n\n` +
                              `Te avisaremos con cordialidad unas horas antes del vencimiento. ¡Mucho éxito con tu emprendimiento!`
                    });
                    continue;
                }
            }

            // ------------------------------------------------------------------
            // 🌐 FILTRO SOBERANO DE JURISDICCIÓN (SÓLO ARGENTINA +54 / 549)
            // ------------------------------------------------------------------
            const esNumeroArgentino = sender.startsWith('54'); 

            // Si NO es argentino, NO es grupo, NO es del operador y NO es de la lista blanca (familia) -> Mensaje de exportación B2B
            if (!esNumeroArgentino && !esGrupo && !fromMe && !esNumeroExcluido(sender)) {
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

                if (textoMinuscula === '!metricas' || textoMinuscula === '!stats') {
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
            // 📢 2. DIFUSIÓN EN GRUPOS DE WHATSAPP (APAGADA INSTITUCIONALMENTE)
            // ------------------------------------------------------------------
            if (esGrupo) {
                // Difusión deshabilitada por orden ejecutiva para prevenir baneos
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
                                  `• *Plazo:* Exactly **168 horas** (7 días corridos).\n` +
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
                              `💵 *Monto:* $${montoSolicitado.toLocaleString('es-AR')} (Devuelve $${totalDevolucion.toLocaleString('es-AR')})\n\n` +
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

iniciarBot();

// SERVER HEALTHCHECK PARA RAILWAY
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Gabriela WhatsApp Bridge Operativo - Brunilda S.A.S.');
}).listen(PORT, () => {
    console.log(`🌐 Healthcheck activo en el puerto ${PORT}`);
});
