import { getAdminDb } from './_lib/firebaseAdmin.js';
import { getNextQuoteNumber } from './_lib/quoteNumber.js';
import { buildQuotePdfBuffer } from './_lib/quotePdf.js';
import { sendWhatsAppText, uploadWhatsAppMedia, sendWhatsAppDocument } from './_lib/whatsapp.js';

export const config = { maxDuration: 60 };

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-1.5-flash-latest';

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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const callGemini = async (systemText: string, contents: any[]) => {
  const maxAttempts = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                reply: { type: 'STRING' },
                readyToFinalize: { type: 'BOOLEAN' },
                clientId: { type: 'STRING', nullable: true },
                newClient: {
                  type: 'OBJECT',
                  nullable: true,
                  properties: {
                    name: { type: 'STRING' },
                    phone: { type: 'STRING' },
                    company: { type: 'STRING', nullable: true }
                  },
                  required: ['name', 'phone']
                },
                items: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      nombre: { type: 'STRING' },
                      cantidad: { type: 'NUMBER' },
                      precioUnitario: { type: 'NUMBER' }
                    },
                    required: ['nombre', 'cantidad', 'precioUnitario']
                  }
                }
              },
              required: ['reply', 'readyToFinalize', 'items']
            }
          }
        })
      }
    );

    const data = await response.json();
    if (response.ok) return data;

    const isOverloaded = response.status === 503 || response.status === 429;
    lastError = { status: response.status, data };
    if (isOverloaded && attempt < maxAttempts) {
      await sleep(attempt * 800);
      continue;
    }
    throw lastError;
  }
  throw lastError;
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

  // Siempre responder 200 a Meta lo antes posible para evitar reintentos duplicados,
  // pero procesamos primero porque las funciones serverless no soportan trabajo en segundo plano.
  try {
    console.log('whatsapp-webhook: POST recibido. Body:', JSON.stringify(req.body));
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // Es un evento de status (entregado, leido, etc.), no un mensaje nuevo. No hay nada que hacer.
      console.log('whatsapp-webhook: sin mensaje en el payload. Body completo:', JSON.stringify(req.body));
      return res.status(200).json({ ok: true });
    }

    const rawFrom = message.from as string;
    const from = rawFrom.replace(/^521/, '52');
    const messageId = message.id as string;

    const db = getAdminDb();

    // Evitar procesar el mismo mensaje dos veces si Meta reintenta el webhook.
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

    // Cargar clientes existentes para que Nova pueda hacer match
    const clientsSnap = await db.collection('clients').get();
    const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<{ id: string; name?: string; company?: string; phone?: string }>;
    const clientListText = clients
      .map(c => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}" telefono:"${c.phone || ''}"`)
      .join('\n');

    // Cargar/guardar historial de esta conversacion de WhatsApp
    const sessionRef = db.collection('whatsappSessions').doc(from);
    const sessionSnap = await sessionRef.get();
    const priorMessages: ChatMessage[] = (sessionSnap.exists ? sessionSnap.data()?.messages : []) || [];

    const contents = priorMessages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    contents.push({ role: 'user', parts: [{ text: userText }] });

    const systemText = `${SYSTEM_INSTRUCTION}\n\nClientes existentes en el CRM:\n${clientListText || 'Sin clientes registrados.'}`;

    let geminiData: any;
    try {
      geminiData = await callGemini(systemText, contents);
    } catch (err: any) {
      console.error('Gemini error en WhatsApp:', err);
      const isOverloaded = err?.status === 503 || err?.status === 429;
      await sendWhatsAppText(from, isOverloaded ? 'Ando saturada un momento, mandame tu mensaje otra vez en unos segundos por favor.' : 'Tuve un problema para responder, intenta de nuevo.');
      return res.status(200).json({ ok: true });
    }

    const rawText = geminiData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    let parsed: {
      reply: string;
      readyToFinalize: boolean;
      clientId: string | null;
      newClient: { name: string; phone: string; company?: string } | null;
      items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error('JSON invalido de Gemini en WhatsApp:', rawText);
      await sendWhatsAppText(from, 'No entendi bien eso, me lo puedes repetir?');
      return res.status(200).json({ ok: true });
    }

    // Guardar el turno en el historial de la conversacion
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

    // ---- Finalizar: resolver cliente, crear cotizacion y mandar PDF ----
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
    // Siempre 200 hacia Meta para que no reintente indefinidamente; el error ya quedo en logs.
    return res.status(200).json({ ok: false, error: error.message || 'Error inesperado' });
  }
}
