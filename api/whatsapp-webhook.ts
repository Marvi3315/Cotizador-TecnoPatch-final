import { getAdminDb } from './_lib/firebaseAdmin.js';
import { getNextQuoteNumber } from './_lib/quoteNumber.js';
import { buildQuotePdfBuffer } from './_lib/quotePdf.js';
import { sendWhatsAppText, uploadWhatsAppMedia, sendWhatsAppDocument, downloadWhatsAppMedia } from './_lib/whatsapp.js';
import OpenAI, { toFile } from 'openai';

export const config = { maxDuration: 60 };

// Inicializar cliente de Groq utilizando la interfaz compatible con OpenAI
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const SYSTEM_INSTRUCTION = `Eres Nova, la asistente virtual inteligente de TecnoPatch (empresa de telecomunicaciones, CCTV, cableado y redes). Hablas con un vendedor del equipo de TecnoPatch de forma natural, amigable, cercana y relajada, en español de México. No suenas como un contestador automático ni haces preguntas tipo formulario.

Tienes DOS capacidades. En cada mensaje, decide cual aplica:

CAPACIDAD 1 - Generar una cotizacion nueva:
Junta la informacion necesaria:
1. Un cliente: si mencionan un nombre que coincide con la lista de clientes existentes, usalo (clientId). Si no coincide con ninguno, necesitas al menos NOMBRE y TELEFONO del cliente nuevo antes de poder generar la cotizacion -- preguntalos si faltan, de forma natural y conversacional.
2. Uno o mas productos, cada uno con cantidad y precio unitario. Si no te dan el precio de algo, preguntalo (nunca inventes precios).

NO pongas "readyToFinalize" en true hasta que:
- Tengas el cliente resuelto (existente o nuevo con nombre+telefono), Y
- Tengas al menos un producto con cantidad y precio, Y
- La persona haya confirmado o pedido explicitamente generarla (frases como "genera", "mandala", "listo", "esta bien asi", "hazla", "si", "en pdf", "mandame la cotizacion").

Si algo falta, responde SOLO pidiendo lo que falta de forma natural, y deja "readyToFinalize" en false. NUNCA digas que no puedes generar un PDF -- si tienes cliente y productos y ya te confirmaron, SIEMPRE puedes generarlo con "readyToFinalize": true.

CAPACIDAD 2 - Consultar cotizaciones YA EXISTENTES:
Si el vendedor pregunta por el estatus, folio, total o cualquier dato de una cotizacion que YA se hizo antes (frases como "como va la cotizacion de...", "cuanto le cotice a...", "buscame el folio...", "que cotizaciones tiene...", "la ultima cotizacion de..."), NO intentes generar nada nuevo. En vez de eso, pon en "queryIntent" el texto de busqueda (nombre del cliente o numero de folio, tal cual lo menciono), y deja "readyToFinalize" en false. El sistema hara la busqueda real y respondera -- tu "reply" en este caso puede quedar vacio o como un simple "dejame checar...", no inventes datos de cotizaciones que no has visto.

CAPACIDAD 3 - Reenviar el PDF de una cotizacion existente:
Si ya le mostraste al vendedor una lista de cotizaciones (capacidad 2) y ahora te pide el PDF de alguna especifica ("mandame esa", "la numero 2", "mandame el PDF del folio COT-2026-7245", "esa misma"), identifica de la conversacion anterior el folio EXACTO que esta pidiendo y ponlo en "resendFolio". Si no tienes claro a cual folio se refiere, pregunta cual (no adivines), y deja "resendFolio" en null.

SIEMPRE responde SOLO con un JSON valido (sin markdown, sin texto fuera del JSON) con este formato exacto:
{"reply": "tu respuesta conversacional y natural", "readyToFinalize": boolean, "queryIntent": "texto de busqueda si es capacidad 2, o null", "resendFolio": "folio exacto si es capacidad 3, o null", "clientId": "id del cliente si coincide con uno existente de la lista, o null", "newClient": {"name": "...", "phone": "...", "company": "..."} o null si vas a usar un cliente existente o aun no tienes esos datos, "projectType": "breve tipo de proyecto si te lo mencionan (ej: Residencial, Comercial, Corporativo), o vacio", "projectScope": "breve descripcion del proyecto/instalacion si te la mencionan, o vacio", "technicalNotes": "notas tecnicas si te las mencionan (voltaje, calibre de cable, etc.), o vacio", "items": [{"nombre": "...", "cantidad": numero, "precioUnitario": numero}]}`;

// Función para llamar a Groq Cloud con manejo estricto de JSON
const callGroq = async (systemText: string, messagesHistory: ChatMessage[], userText: string) => {
  const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemText },
    ...messagesHistory.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content
    })),
    { role: 'user', content: userText }
  ];

  const completion = await groq.chat.completions.create({
    model: 'openai/gpt-oss-20b',
    messages: formattedMessages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  return completion.choices[0]?.message?.content || '{}';
};

// Transcribe una nota de voz de WhatsApp usando Whisper de Groq (gratis)
const transcribeAudio = async (buffer: Buffer, mimeType: string): Promise<string> => {
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg';
  const file = await toFile(buffer, `audio.${extension}`, { type: mimeType });
  const transcription = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'es'
  });
  return transcription.text || '';
};

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    console.log('whatsapp-webhook: POST recibido. Body:', JSON.stringify(req.body));
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log('whatsapp-webhook: sin mensaje en el payload.');
      return res.status(200).json({ ok: true });
    }

    const rawFrom = message.from as string;
    const from = rawFrom.replace(/^521/, '52');
    const messageId = message.id as string;

    const db = getAdminDb();

    // Deduplicación de mensajes para evitar reintentos de Meta
    const dedupeRef = db.collection('whatsappProcessedMessages').doc(messageId);
    const dedupeSnap = await dedupeRef.get();
    if (dedupeSnap.exists) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    await dedupeRef.set({ processedAt: Date.now() });

    if (message.type !== 'text' && message.type !== 'audio') {
      await sendWhatsAppText(from, 'Por ahora puedo leer texto y notas de voz. Escribeme o mandame un audio con el cliente, producto, cantidad y precio.');
      return res.status(200).json({ ok: true });
    }

    let userText: string | undefined;

    if (message.type === 'text') {
      userText = message.text?.body?.trim();
    } else {
      try {
        const mediaId = message.audio?.id;
        if (!mediaId) throw new Error('Sin id de audio');
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
        const transcription = await transcribeAudio(buffer, mimeType);
        userText = transcription.trim();
        console.log('whatsapp-webhook: audio transcrito:', userText);
      } catch (err) {
        console.error('Error transcribiendo audio:', err);
        await sendWhatsAppText(from, 'Tuve un problema al escuchar tu nota de voz. Intenta de nuevo o mejor escribeme el mensaje.');
        return res.status(200).json({ ok: true });
      }
      if (!userText) {
        await sendWhatsAppText(from, 'No logre entender bien tu nota de voz. ¿Me la puedes repetir o escribir?');
        return res.status(200).json({ ok: true });
      }
    }

    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    const senderName = value?.contacts?.[0]?.profile?.name || from;

    // Cargar clientes desde Firestore
    const clientsSnap = await db.collection('clients').get();
    const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<{ id: string; name?: string; company?: string; phone?: string; rfc?: string }>;
    const clientListText = clients
      .map(c => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}" telefono:"${c.phone || ''}"`)
      .join('\n');

    // Cargar historial
    const sessionRef = db.collection('whatsappSessions').doc(from);
    const sessionSnap = await sessionRef.get();
    const priorMessages: ChatMessage[] = (sessionSnap.exists ? sessionSnap.data()?.messages : []) || [];

    const systemText = `${SYSTEM_INSTRUCTION}\n\nClientes existentes en el CRM:\n${clientListText || 'Sin clientes registrados.'}`;

    let rawJsonText = '';
    try {
      rawJsonText = await callGroq(systemText, priorMessages.slice(-20), userText);
    } catch (err: any) {
      console.error('Error en Groq Cloud API:', err);
      await sendWhatsAppText(from, 'Tuve un problema temporal para procesar tu mensaje. Intenta de nuevo en un momento.');
      return res.status(200).json({ ok: true });
    }

    let parsed: {
      reply: string;
      readyToFinalize: boolean;
      queryIntent?: string | null;
      resendFolio?: string | null;
      clientId: string | null;
      newClient: { name: string; phone: string; company?: string } | null;
      projectType?: string;
      projectScope?: string;
      technicalNotes?: string;
      items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };

    try {
      parsed = JSON.parse(rawJsonText);
    } catch (e) {
      console.error('JSON invalido recibido de Groq:', rawJsonText);
      await sendWhatsAppText(from, 'No entendi bien la solicitud, ¿me la puedes repetir?');
      return res.status(200).json({ ok: true });
    }

    // ---- Capacidad 3: reenviar el PDF de una cotizacion existente ----
    if (parsed.resendFolio && parsed.resendFolio.trim()) {
      const folio = parsed.resendFolio.trim();
      const foundSnap = await db.collection('quoteHistory').where('quoteNumber', '==', folio).limit(1).get();

      if (foundSnap.empty) {
        const notFoundReply = `No encontre la cotizacion con folio "${folio}". ¿Me confirmas el numero exacto?`;
        await sendWhatsAppText(from, notFoundReply);
        await sessionRef.set({
          messages: [...priorMessages, { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: notFoundReply }].slice(-40),
          updatedAt: Date.now()
        });
        return res.status(200).json({ ok: true, resent: false });
      }

      const oldQuote: any = foundSnap.docs[0].data();
      const oldItems = (oldQuote.items || []).map((it: any) => ({
        nombre: it.product?.titulo || 'Producto',
        cantidad: Number(it.quantity) || 1,
        precioUnitario: Number(it.unitPriceMxn) || 0,
        categoria: it.product?.marca || 'Partida'
      }));

      const pdfBuffer = buildQuotePdfBuffer({
        quoteNumber: oldQuote.quoteNumber,
        date: oldQuote.date || '',
        clientName: oldQuote.clientName || '',
        clientCompany: oldQuote.clientCompany || '',
        clientPhone: oldQuote.clientPhone || '',
        items: oldItems,
        subtotal: Number(oldQuote.subtotal) || 0,
        tax: Number(oldQuote.tax) || 0,
        total: Number(oldQuote.total) || 0,
        includeTax: !!oldQuote.includeTax,
        validityDays: oldQuote.validityDays || 15,
        exchangeRate: Number(oldQuote.exchangeRate) || 18
      });

      const filename = `${oldQuote.quoteNumber}.pdf`;
      const mediaId = await uploadWhatsAppMedia(pdfBuffer, filename);
      const resendCaption = `Aqui tienes de nuevo la cotizacion ${oldQuote.quoteNumber} de ${oldQuote.clientCompany || oldQuote.clientName}.`;
      await sendWhatsAppDocument(from, mediaId, filename, resendCaption);

      await sessionRef.set({
        messages: [...priorMessages, { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: resendCaption }].slice(-40),
        updatedAt: Date.now()
      });
      return res.status(200).json({ ok: true, resent: true, quoteNumber: oldQuote.quoteNumber });
    }

    // ---- Capacidad 2: consultar cotizaciones existentes (sin inventar datos) ----
    if (parsed.queryIntent && parsed.queryIntent.trim()) {
      const searchTerm = parsed.queryIntent.trim().toLowerCase();
      const quotesSnap = await db.collection('quoteHistory').orderBy('savedAt', 'desc').limit(300).get();
      const matches = quotesSnap.docs
        .map(d => d.data())
        .filter((q: any) => {
          const haystack = `${q.quoteNumber || ''} ${q.clientName || ''} ${q.clientCompany || ''}`.toLowerCase();
          return haystack.includes(searchTerm);
        })
        .slice(0, 5);

      let queryReply: string;
      if (matches.length === 0) {
        queryReply = `No encontre ninguna cotizacion que coincida con "${parsed.queryIntent.trim()}". ¿Me confirmas el nombre del cliente o el numero de folio?`;
      } else {
        const lines = matches.map((q: any) => {
          const total = Number(q.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
          return `• ${q.quoteNumber} - ${q.clientCompany || q.clientName || 'Sin nombre'} - $${total} MXN - ${q.quoteStatus || 'Borrador'} (${q.date || ''})`;
        });
        queryReply = matches.length === 1
          ? `Aqui esta:\n\n${lines[0]}`
          : `Encontre ${matches.length} cotizaciones:\n\n${lines.join('\n')}`;
      }

      await sendWhatsAppText(from, queryReply);

      const updatedMessagesQuery: ChatMessage[] = [
        ...priorMessages,
        { role: 'user' as const, content: userText },
        { role: 'assistant' as const, content: queryReply }
      ].slice(-40);
      await sessionRef.set({ messages: updatedMessagesQuery, updatedAt: Date.now() });

      return res.status(200).json({ ok: true, queried: true, matches: matches.length });
    }

    // Actualizar historial
    const updatedMessages: ChatMessage[] = [
      ...priorMessages,
      { role: 'user' as const, content: userText },
      { role: 'assistant' as const, content: parsed.reply }
    ].slice(-40);
    await sessionRef.set({ messages: updatedMessages, updatedAt: Date.now() });

    if (!parsed.readyToFinalize) {
      await sendWhatsAppText(from, parsed.reply);
      return res.status(200).json({ ok: true });
    }

    // Resolucion de cliente y guardado de cotización
    let clientRecord: { id: string; name: string; company: string; phone: string; rfc?: string } | null = null;

    if (parsed.clientId) {
      const found = clients.find(c => c.id === parsed.clientId);
      if (found) {
        clientRecord = { id: found.id, name: found.name || '', company: found.company || '', phone: found.phone || '', rfc: found.rfc || '' };
      }
    }

    if (!clientRecord && parsed.newClient?.name && parsed.newClient?.phone) {
      const newClientRef = db.collection('clients').doc();
      const newClientData = {
        id: newClientRef.id,
        name: parsed.newClient.name,
        company: parsed.newClient.company || parsed.newClient.name,
        phone: parsed.newClient.phone,
        email: '',
        rfc: '',
        contactRole: '',
        address: '',
        source: 'WhatsApp',
        status: 'Cotizado',
        owner: `Ventas (WhatsApp - ${senderName})`,
        notes: '',
        createdAt: new Date().toISOString()
      };
      await newClientRef.set(newClientData);
      clientRecord = { id: newClientData.id, name: newClientData.name, company: newClientData.company, phone: newClientData.phone };
    }

    if (!clientRecord) {
      await sendWhatsAppText(from, 'Me falto identificar bien al cliente. Dame su nombre y telefono para continuar.');
      return res.status(200).json({ ok: true });
    }

    const items = (parsed.items || []).filter(it => it.nombre && Number(it.precioUnitario) > 0);
    if (items.length === 0) {
      await sendWhatsAppText(from, 'Necesito al menos un producto con su precio para generar la cotizacion.');
      return res.status(200).json({ ok: true });
    }

    const subtotal = items.reduce((sum, it) => sum + (Number(it.cantidad) || 1) * (Number(it.precioUnitario) || 0), 0);
    const includeTax = true;
    const tax = includeTax ? subtotal * 0.16 : 0;
    const total = subtotal + tax;

    const quoteNumber = await getNextQuoteNumber(db);
    const quoteRef = db.collection('quoteHistory').doc();
    const dateLabel = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    const quoteDoc = {
      id: quoteRef.id,
      quoteNumber,
      date: dateLabel,
      items: items.map(it => ({
        quantity: Number(it.cantidad) || 1,
        unitPriceMxn: Number(it.precioUnitario) || 0,
        product: {
          producto_id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          modelo: 'WhatsApp',
          total_existencia: 0,
          titulo: it.nombre,
          marca: 'Partida manual',
          img_portada: '',
          garantia: '',
          sat_key: '',
          sat_description: '',
          pvol: '',
          peso: '',
          alto: '',
          largo: '',
          ancho: '',
          link: '',
          precios: { precio_1: '0', precio_especial: '0', precio_descuento: '0', precio_lista: '0' },
          isManual: true,
          manualCategory: 'Manual',
          unit: 'pz'
        }
      })),
      subtotal,
      tax,
      total,
      includeTax,
      currency: 'MXN',
      exchangeRate: 1,
      clientName: clientRecord.name,
      clientCompany: clientRecord.company,
      clientPhone: clientRecord.phone,
      quoteStatus: 'Borrador',
      salesRep: `WhatsApp - ${senderName}`,
      validityDays: 15,
      savedAt: Date.now()
    };

    await quoteRef.set(quoteDoc);

    const pdfBuffer = buildQuotePdfBuffer({
      quoteNumber,
      date: dateLabel,
      clientName: clientRecord.name,
      clientCompany: clientRecord.company,
      clientPhone: clientRecord.phone,
      clientRfc: clientRecord.rfc,
      projectType: parsed.projectType || undefined,
      projectScope: parsed.projectScope || undefined,
      technicalNotes: parsed.technicalNotes || undefined,
      items: items.map(it => ({ ...it, categoria: 'Partida manual' })),
      subtotal,
      tax,
      total,
      includeTax,
      validityDays: 15,
      exchangeRate: 18
    });

    const filename = `${quoteNumber}.pdf`;
    const mediaId = await uploadWhatsAppMedia(pdfBuffer, filename);
    await sendWhatsAppDocument(from, mediaId, filename, `${parsed.reply}\n\nFolio: ${quoteNumber} · Total: $${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`);

    return res.status(200).json({ ok: true, quoteNumber });

  } catch (error: any) {
    console.error('whatsapp-webhook error:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Error inesperado' });
  }
}