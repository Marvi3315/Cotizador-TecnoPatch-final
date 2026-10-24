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


const SYSTEM_INSTRUCTION = `Eres Nova, la asistente virtual inteligente de TecnoPatch (empresa de telecomunicaciones, CCTV, cableado y redes). Hablas con un vendedor del equipo de TecnoPatch de forma natural, amigable, cercana y relajada, en español de México. No suenas como un contestador automatico ni haces preguntas tipo formulario. Eres inteligente: entiendes mensajes desordenados, notas de voz transcritas, abreviaciones, errores de dedo y listas pegadas, y de ahi sacas los datos tu sola.

Tienes TRES capacidades. En cada mensaje decide cual aplica.

CAPACIDAD 1 - Generar una cotizacion nueva (tu trabajo es JUNTAR LOS DATOS; el sistema decide cuando se genera el PDF):
Junta:
1. Cliente: si el nombre coincide (aunque sea parcial o con errores de dedo) con la lista de clientes existentes, usa ese clientId. Si no coincide con ninguno, necesitas al menos el NOMBRE del cliente nuevo (newClient). El telefono es OPCIONAL: nunca lo exijas ni insistas; usa "" si no lo dan.
2. Productos: cada uno con nombre, cantidad (si no dicen, 1) y precio unitario. Si falta el precio de algo, preguntalo (nunca inventes precios). Si el vendedor da un precio TOTAL de la partida y la cantidad, divide para sacar el unitario. Si dicen "mas IVA" o "con IVA" en un precio, usa el numero tal cual (el sistema suma el IVA aparte).
3. Alcance del proyecto (projectScope), notas tecnicas (technicalNotes) y tipo de proyecto (projectType): si vienen escritos, copialos o redactalos bien en espanol profesional. Nunca los omitas si los dieron. Puedes corregir ortografia y redaccion pero sin cambiar el sentido ni los datos.

REGLAS:
- Abajo recibes el "BORRADOR ACTUAL" con lo que ya se junto. Devuelve SIEMPRE el borrador COMPLETO actualizado (todas las partidas anteriores mas lo nuevo; si el vendedor corrige, cambia o quita algo, reflejalo). Nunca vacies "items" si el borrador ya tenia partidas, salvo que el vendedor pida quitarlas todas o empezar de nuevo.
- NO preguntes por alcance ni notas tecnicas: eso lo pregunta el sistema una sola vez.
- Si falta algo esencial (cliente, o precio de una partida), pidelo en UNA sola frase corta, sin repetir la pregunta si ya te contestaron (aunque sea "no se" u "omitelo": avanza con lo que tengas).
- Pon "readyToFinalize" en true solo si el vendedor pide explicitamente generar/mandar la cotizacion ("genera", "mandala", "listo", "hazla", "asi esta bien", "no" como respuesta a si quiere agregar algo mas).
- NUNCA digas que no puedes generar un PDF.
- Si el vendedor te saluda, te da las gracias, o hace una pregunta general sobre equipos, instalacion o ventas de TecnoPatch (CCTV, redes, cableado, VoIP, control de acceso), contesta de forma util y breve en "reply" sin tocar el borrador.

CAPACIDAD 2 - Consultar cotizaciones YA EXISTENTES:
Si preguntan por el estatus, folio, total o cualquier dato de una cotizacion que YA se hizo ("como va la cotizacion de...", "cuanto le cotice a...", "buscame el folio...", "que cotizaciones tiene...", "dame el historial"), NO generes nada nuevo. Pon en "queryIntent" el nombre del cliente o folio EXACTO que mencionaron. Si no especifican uno (piden "el historial", "todas"), pon queryIntent como cadena vacia "". El sistema hace la busqueda real; tu "reply" puede quedar vacio. No inventes datos que no has visto.

CAPACIDAD 3 - Reenviar el PDF de una cotizacion existente:
Si ya les mostraste una lista (capacidad 2) y piden el PDF de alguna ("mandame esa", "la numero 2", "el PDF del folio COT-2026-7245"), pon el folio EXACTO en "resendFolio". Si no tienes claro cual, pregunta cual y deja resendFolio en null.

SIEMPRE responde SOLO con un JSON valido (sin markdown ni texto fuera del JSON) con este formato exacto:
{"reply": "tu respuesta conversacional", "readyToFinalize": boolean, "queryIntent": "texto de busqueda o cadena vacia, o null si no aplica", "resendFolio": "folio exacto o null", "clientId": "id del cliente existente o null", "newClient": {"name": "...", "phone": "... (puede ser vacio)", "company": "..."} o null, "projectType": "tipo de proyecto o vacio", "projectScope": "alcance o vacio", "technicalNotes": "notas tecnicas o vacio", "items": [{"nombre": "...", "cantidad": numero, "precioUnitario": numero}]}`;

type DraftItem = { nombre: string; cantidad: number; precioUnitario: number };
type Draft = {
  clientId: string | null;
  newClient: { name: string; phone: string; company?: string } | null;
  projectType: string;
  projectScope: string;
  technicalNotes: string;
  items: DraftItem[];
  extrasAsked: boolean;
};
const emptyDraft = (): Draft => ({ clientId: null, newClient: null, projectType: '', projectScope: '', technicalNotes: '', items: [], extrasAsked: false });
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000; // un borrador sin tocar por 12 h se descarta

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Modelos en orden de preferencia: si uno falla (limite de tokens, caida, JSON roto) se prueba el siguiente.
const MODEL_CHAIN: Array<{ model: string; reasoning?: 'low' | 'medium' | 'high' }> = [
  { model: 'openai/gpt-oss-120b', reasoning: 'medium' },
  { model: 'openai/gpt-oss-20b', reasoning: 'medium' },
  { model: 'llama-3.3-70b-versatile' }
];

const extractJson = (text: string): any => {
  try { return JSON.parse(text); } catch { /* sigue */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error('Sin JSON en la respuesta');
};

// Llama al LLM con reintentos, fallback de modelo y parseo de JSON dentro del mismo ciclo.
const callLLM = async (systemText: string, messagesHistory: ChatMessage[], userText: string): Promise<any> => {
  const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemText },
    ...messagesHistory.map(m => ({ role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user', content: m.content })),
    { role: 'user', content: userText }
  ];

  let lastError: any = null;
  for (const { model, reasoning } of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const params: any = { model, messages: formattedMessages, response_format: { type: 'json_object' }, temperature: 0.2 };
        if (reasoning) params.reasoning_effort = reasoning;
        const completion = await groq.chat.completions.create(params);
        const content = completion.choices[0]?.message?.content || '';
        return extractJson(content);
      } catch (err: any) {
        lastError = err;
        const status = err?.status;
        console.error(`LLM fallo (${model}, intento ${attempt + 1}) status=${status}:`, err?.message || err);
        if (status === 400 || status === 404) break; // modelo/params invalidos: pasar al siguiente modelo
        if (status === 429) { await sleep(1200); if (attempt === 0) continue; break; }
        await sleep(600);
      }
    }
  }
  throw lastError || new Error('LLM sin respuesta');
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

// Analiza una imagen (foto, screenshot, lista escrita) usando el modelo de vision de Groq
const analyzeImage = async (buffer: Buffer, mimeType: string, caption?: string): Promise<string> => {
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const visionPrompt = `Eres los ojos de Nova, asistente de TecnoPatch (telecomunicaciones, CCTV, cableado y redes). Un vendedor te mando esta imagen por WhatsApp${caption ? ` con el comentario: "${caption}"` : ''}.

Describe con precision lo que ves, pensando en que esta informacion se va a usar para armar una cotizacion o dar una recomendacion tecnica:
- Si es una lista de productos, screenshot de specs, o cotizacion vieja: transcribe EXACTAMENTE los nombres, modelos, cantidades y precios que alcances a leer (no inventes numeros que no veas claro).
- Si es una foto de una instalacion, equipo existente, o sitio de trabajo: describe que equipo identificas, su estado aparente, y cualquier detalle relevante para una instalacion o venta (espacio disponible, cableado existente, etc).
- Si no es ninguna de esas cosas, describe brevemente que es.

Responde solo con la descripcion en texto plano, en español, sin JSON ni markdown.`;

  const completion = await groq.chat.completions.create({
    model: 'qwen/qwen3.6-27b',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: visionPrompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ] as any
      }
    ],
    temperature: 0.2
  });

  return completion.choices[0]?.message?.content?.trim() || '';
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

    if (message.type !== 'text' && message.type !== 'audio' && message.type !== 'image') {
      await sendWhatsAppText(from, 'Por ahora puedo leer texto, notas de voz y fotos. Escribeme, mandame un audio, o una imagen con el cliente, producto, cantidad y precio.');
      return res.status(200).json({ ok: true });
    }

    let userText: string | undefined;

    if (message.type === 'text') {
      userText = message.text?.body?.trim();
    } else if (message.type === 'audio') {
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
    } else {
      try {
        const mediaId = message.image?.id;
        if (!mediaId) throw new Error('Sin id de imagen');
        const caption = message.image?.caption?.trim();
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
        const description = await analyzeImage(buffer, mimeType, caption);
        console.log('whatsapp-webhook: imagen analizada:', description);
        userText = `[El vendedor mando una imagen. Esto es lo que se ve en la foto:]\n${description}${caption ? `\n\n[Comentario del vendedor junto a la foto: "${caption}"]` : ''}`;
      } catch (err) {
        console.error('Error analizando imagen:', err);
        await sendWhatsAppText(from, 'Tuve un problema al ver tu imagen. Intenta de nuevo o mejor descríbemela por texto.');
        return res.status(200).json({ ok: true });
      }
      if (!userText) {
        await sendWhatsAppText(from, 'No logre entender bien la imagen. ¿Me la puedes describir por texto?');
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
      .slice(0, 250)
      .map(c => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}"`)
      .join('\n');

    // Cargar historial y borrador de la cotizacion en curso
    const sessionRef = db.collection('whatsappSessions').doc(from);
    const sessionSnap = await sessionRef.get();
    const sessionData: any = sessionSnap.exists ? sessionSnap.data() : {};
    const priorMessages: ChatMessage[] = sessionData?.messages || [];
    let draft: Draft = { ...emptyDraft(), ...(sessionData?.draft || {}) };
    if (Date.now() - (Number(sessionData?.draftUpdatedAt) || 0) > DRAFT_TTL_MS) draft = emptyDraft();

    const saveSession = async (extraMessages: ChatMessage[], newDraft: Draft = draft) => {
      await sessionRef.set({
        messages: [...priorMessages, ...extraMessages].slice(-40),
        draft: newDraft,
        draftUpdatedAt: Date.now(),
        updatedAt: Date.now()
      });
    };

    // Comando para tirar el borrador y empezar de cero
    if (/^\s*(cancela(r)?|borra(r)?|olvida(lo)?|empezar de nuevo|empecemos de nuevo|nueva cotizaci[oó]n|reiniciar?)\b/i.test(userText) && userText.length < 40) {
      const msg = 'Listo, descarte el borrador. Cuando quieras empezamos otra cotizacion: dime cliente, productos con cantidad y precio.';
      await sendWhatsAppText(from, msg);
      await saveSession([{ role: 'user', content: userText }, { role: 'assistant', content: msg }], emptyDraft());
      return res.status(200).json({ ok: true, reset: true });
    }

    const draftSummary = JSON.stringify({
      clientId: draft.clientId, newClient: draft.newClient, projectType: draft.projectType,
      projectScope: draft.projectScope, technicalNotes: draft.technicalNotes, items: draft.items
    });
    const systemText = `${SYSTEM_INSTRUCTION}\n\nBORRADOR ACTUAL (lo ya juntado de la cotizacion en curso; devuelvelo completo y actualizado):\n${draftSummary}\n\nClientes existentes en el CRM:\n${clientListText || 'Sin clientes registrados.'}`;

    let parsed: {
      reply?: string;
      readyToFinalize?: boolean;
      queryIntent?: string | null;
      resendFolio?: string | null;
      clientId?: string | null;
      newClient?: { name: string; phone: string; company?: string } | null;
      projectType?: string;
      projectScope?: string;
      technicalNotes?: string;
      items?: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };

    try {
      parsed = await callLLM(systemText, priorMessages.slice(-16), userText);
    } catch (err: any) {
      console.error('Error en LLM tras reintentos y fallback:', err);
      const msg = 'Se me trabo un momento el cerebro. Tu mensaje quedo guardado: mandame un "listo" o repite lo ultimo y sigo desde donde ibamos.';
      await sendWhatsAppText(from, msg);
      await saveSession([{ role: 'user', content: userText }]);
      return res.status(200).json({ ok: true });
    }
    parsed.reply = (parsed.reply || '').toString();

    // ---- Capacidad 3: reenviar el PDF de una cotizacion existente ----
    if (parsed.resendFolio && parsed.resendFolio.trim()) {
      const folio = parsed.resendFolio.trim();
      const foundSnap = await db.collection('quoteHistory').where('quoteNumber', '==', folio).limit(1).get();

      if (foundSnap.empty) {
        const notFoundReply = `No encontre la cotizacion con folio "${folio}". ¿Me confirmas el numero exacto?`;
        await sendWhatsAppText(from, notFoundReply);
        await sessionRef.set({
          draft, draftUpdatedAt: Date.now(),
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
          draft, draftUpdatedAt: Date.now(),
        messages: [...priorMessages, { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: resendCaption }].slice(-40),
        updatedAt: Date.now()
      });
      return res.status(200).json({ ok: true, resent: true, quoteNumber: oldQuote.quoteNumber });
    }

    // ---- Capacidad 2: consultar cotizaciones existentes (sin inventar datos) ----
    if (parsed.queryIntent !== undefined && parsed.queryIntent !== null) {
      const searchTerm = parsed.queryIntent.trim().toLowerCase();
      const quotesSnap = await db.collection('quoteHistory').orderBy('savedAt', 'desc').limit(searchTerm ? 300 : 5).get();
      const allQuotes = quotesSnap.docs.map(d => d.data());
      const matches = searchTerm
        ? allQuotes.filter((q: any) => {
            const haystack = `${q.quoteNumber || ''} ${q.clientName || ''} ${q.clientCompany || ''}`.toLowerCase();
            return haystack.includes(searchTerm);
          }).slice(0, 5)
        : allQuotes.slice(0, 5);

      let queryReply: string;
      if (matches.length === 0) {
        queryReply = searchTerm
          ? `No encontre ninguna cotizacion que coincida con "${parsed.queryIntent.trim()}". ¿Me confirmas el nombre del cliente o el numero de folio?`
          : 'Todavia no hay ninguna cotizacion guardada.';
      } else {
        const lines = matches.map((q: any) => {
          const total = Number(q.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
          return `• ${q.quoteNumber} - ${q.clientCompany || q.clientName || 'Sin nombre'} - $${total} MXN - ${q.quoteStatus || 'Borrador'} (${q.date || ''})`;
        });
        const heading = searchTerm ? `Encontre ${matches.length} cotizacion(es):` : `Las ${matches.length} mas recientes:`;
        queryReply = matches.length === 1 && searchTerm
          ? `Aqui esta:\n\n${lines[0]}`
          : `${heading}\n\n${lines.join('\n')}`;
      }

      await sendWhatsAppText(from, queryReply);

      const updatedMessagesQuery: ChatMessage[] = [
        ...priorMessages,
        { role: 'user' as const, content: userText },
        { role: 'assistant' as const, content: queryReply }
      ].slice(-40);
      await sessionRef.set({
          draft, draftUpdatedAt: Date.now(), messages: updatedMessagesQuery, updatedAt: Date.now() });

      return res.status(200).json({ ok: true, queried: true, matches: matches.length });
    }

    // ---- Capacidad 1: actualizar borrador y decidir (en codigo, no en el LLM) cuando generar ----
    const validItems = (parsed.items || [])
      .map(it => ({ nombre: String(it?.nombre || '').trim(), cantidad: Number(it?.cantidad) > 0 ? Number(it.cantidad) : 1, precioUnitario: Number(it?.precioUnitario) || 0 }))
      .filter(it => it.nombre);
    if (validItems.length > 0) draft.items = validItems;
    if (parsed.clientId && clients.some(c => c.id === parsed.clientId)) { draft.clientId = parsed.clientId; draft.newClient = null; }
    else if (parsed.newClient?.name && parsed.newClient.name.trim()) {
      draft.newClient = { name: parsed.newClient.name.trim(), phone: (parsed.newClient.phone || '').trim(), company: (parsed.newClient.company || '').trim() };
      draft.clientId = null;
    }
    if (parsed.projectType?.trim()) draft.projectType = parsed.projectType.trim();
    if (parsed.projectScope?.trim()) draft.projectScope = parsed.projectScope.trim();
    if (parsed.technicalNotes?.trim()) draft.technicalNotes = parsed.technicalNotes.trim();

    const hasClient = !!(draft.clientId || draft.newClient?.name);
    const missingPrice = draft.items.filter(it => !(it.precioUnitario > 0));
    const hasItems = draft.items.length > 0 && missingPrice.length === 0;
    const complete = hasClient && hasItems;

    const wantsNow = /(?<![a-záéíóúñ])(gen[eé]ra(la|r|me)?|m[aá]nda(me|la|mela|melo|lo)?|env[ií]a(la|me)?|listo|hazla|ya est[aá]|as[ií]|en pdf|sin (alcance|notas)|no)(?![a-záéíóúñ])/i.test(userText) && userText.length < 80;
    const extrasAskedBefore = draft.extrasAsked;
    const hasBothExtras = !!(draft.projectScope && draft.technicalNotes);

    const shouldGenerate = complete && (extrasAskedBefore || wantsNow || hasBothExtras);

    if (!shouldGenerate) {
      let reply = parsed.reply || '';
      if (complete) {
        // Cliente + productos listos y todavia no se pregunta por alcance/notas: pregunta unica y fija
        const who = draft.newClient?.name || clients.find(c => c.id === draft.clientId)?.company || clients.find(c => c.id === draft.clientId)?.name || 'el cliente';
        const falta = !draft.projectScope && !draft.technicalNotes ? 'el alcance del proyecto y/o notas tecnicas' : !draft.projectScope ? 'el alcance del proyecto' : 'notas tecnicas';
        reply = `Ya tengo los productos de ${who}. ¿Quieres agregar ${falta}? Si no, respondeme "genérala" y te la mando asi.`;
        draft.extrasAsked = true;
      } else if (!reply.trim()) {
        reply = !hasClient ? '¿A nombre de que cliente va la cotizacion?' : missingPrice.length ? `¿Cual es el precio unitario de "${missingPrice[0].nombre}"?` : '¿Que productos incluyo, con cantidad y precio?';
      }
      await sendWhatsAppText(from, reply);
      await saveSession([{ role: 'user', content: userText }, { role: 'assistant', content: reply }]);
      return res.status(200).json({ ok: true });
    }

    // Resolucion de cliente y guardado de cotización
    let clientRecord: { id: string; name: string; company: string; phone: string; rfc?: string } | null = null;

    if (draft.clientId) {
      const found = clients.find(c => c.id === draft.clientId);
      if (found) {
        clientRecord = { id: found.id, name: found.name || '', company: found.company || '', phone: found.phone || '', rfc: found.rfc || '' };
      }
    }

    if (!clientRecord && draft.newClient?.name) {
      const newClientRef = db.collection('clients').doc();
      const newClientData = {
        id: newClientRef.id,
        name: draft.newClient.name,
        company: draft.newClient.company || draft.newClient.name,
        phone: draft.newClient.phone || '',
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
      await sendWhatsAppText(from, 'Me falto identificar bien al cliente. Dame su nombre para continuar (el telefono es opcional).');
      return res.status(200).json({ ok: true });
    }

    const items = draft.items.filter(it => it.nombre && Number(it.precioUnitario) > 0);
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
      projectType: draft.projectType || undefined,
      projectScope: draft.projectScope || undefined,
      technicalNotes: draft.technicalNotes || undefined,
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
    const docCaption = `Lista la cotizacion de ${clientRecord.company || clientRecord.name}.\n\nFolio: ${quoteNumber}\nSubtotal: $${subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}\nIVA: $${tax.toLocaleString('es-MX', { minimumFractionDigits: 2 })}\nTotal: $${total.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`;
    await sendWhatsAppDocument(from, mediaId, filename, docCaption);

    // Cotizacion lista: se limpia el borrador y el historial para que la siguiente empiece limpia
    await sessionRef.set({
      messages: [{ role: 'assistant' as const, content: `(Cotizacion ${quoteNumber} de ${clientRecord.company || clientRecord.name} generada y enviada. Ya no hay borrador abierto.)` }],
      draft: emptyDraft(),
      draftUpdatedAt: Date.now(),
      updatedAt: Date.now()
    });

    return res.status(200).json({ ok: true, quoteNumber });

  } catch (error: any) {
    console.error('whatsapp-webhook error:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Error inesperado' });
  }
}
