import { getAdminDb } from './_lib/firebaseAdmin.js';
import { getNextQuoteNumber } from './_lib/quoteNumber.js';
import { buildQuotePdfBuffer } from './_lib/quotePdf.js';
import { sendWhatsAppText, uploadWhatsAppMedia, sendWhatsAppDocument } from './_lib/whatsapp.js';
import OpenAI from 'openai';

export const config = { maxDuration: 60 };

// Inicializar cliente de Groq utilizando la interfaz compatible con OpenAI
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const SYSTEM_INSTRUCTION = `Eres Nova, el asistente de IA del Cotizador de TecnoPatch (empresa mexicana de telecomunicaciones, CCTV, cableado estructurado, VoIP, control de acceso e infraestructura IT). Estas platicando por WhatsApp con un vendedor del equipo de TecnoPatch (no con un cliente final), que te pide armar cotizaciones rapidas.

Eres conversacional, breve y directa (los mensajes de WhatsApp deben ser cortos), en espanol de Mexico.

Tu trabajo es juntar la informacion necesaria para generar una cotizacion en PDF:
1. Un cliente: si el vendedor menciona un nombre que coincide con la lista de clientes existentes, usalo. Si no coincide con ninguno, necesitas al menos NOMBRE y TELEFONO del cliente nuevo antes de poder generar la cotizacion -- preguntalos si faltan.
2. Uno o mas productos, cada uno con cantidad y precio unitario. Si el vendedor no da el precio de algo, preguntaselo (no inventes precios).

NO generes la cotizacion (readyToFinalize) hasta que:
- Tengas el cliente resuelto (existente o nuevo con nombre+telefono), Y
- Tengas al menos un producto con cantidad y precio, Y
- El vendedor haya confirmado o pedido explicitamente generarla (frases como "genera", "mandala", "listo", "esta bien asi", "hazla", "si").

Si algo falta, responde SOLO pidiendo lo que falta (breve), y deja readyToFinalize en false.

SIEMPRE responde SOLO con un JSON valido (sin markdown, sin texto fuera del JSON) con este formato exacto:
{"reply": "tu respuesta corta para WhatsApp", "readyToFinalize": boolean, "clientId": "id del cliente existente si coincide, o null", "newClient": {"name": "...", "phone": "...", "company": "..."} o null si vas a usar un cliente existente, "items": [{"nombre": "...", "cantidad": numero, "precioUnitario": numero}]}

Si readyToFinalize es true, "items" debe tener al menos un producto con precioUnitario mayor a 0.`;

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

    if (message.type !== 'text') {
      await sendWhatsAppText(from, 'Por ahora solo puedo leer mensajes de texto. Escribeme el cliente, producto, cantidad y precio, por favor.');
      return res.status(200).json({ ok: true });
    }

    const userText = message.text?.body?.trim();
    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    const senderName = value?.contacts?.[0]?.profile?.name || from;

    // Cargar clientes desde Firestore
    const clientsSnap = await db.collection('clients').get();
    const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<{ id: string; name?: string; company?: string; phone?: string }>;
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
      clientId: string | null;
      newClient: { name: string; phone: string; company?: string } | null;
      items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };

    try {
      parsed = JSON.parse(rawJsonText);
    } catch (e) {
      console.error('JSON invalido recibido de Groq:', rawJsonText);
      await sendWhatsAppText(from, 'No entendi bien la solicitud, ¿me la puedes repetir?');
      return res.status(200).json({ ok: true });
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
    let clientRecord: { id: string; name: string; company: string; phone: string } | null = null;

    if (parsed.clientId) {
      const found = clients.find(c => c.id === parsed.clientId);
      if (found) {
        clientRecord = { id: found.id, name: found.name || '', company: found.company || '', phone: found.phone || '' };
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
    const includeTax = false;
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
          marca: 'Partida manual (WhatsApp)',
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
      items,
      subtotal,
      tax,
      total,
      includeTax,
      validityDays: 15
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