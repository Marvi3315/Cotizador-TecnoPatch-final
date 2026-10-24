import { getAdminDb } from './_lib/firebaseAdmin.js';
import { sendWhatsAppText, uploadWhatsAppMedia, sendWhatsAppDocument, downloadWhatsAppMedia } from './_lib/whatsapp.js';
import { runAgent, emptyState, emptyDraft, type AgentState } from './_lib/agent.js';
import OpenAI, { toFile } from 'openai';

export const config = { maxDuration: 60 };

// Groq (interfaz compatible con OpenAI)
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

type ChatMessage = { role: 'user' | 'assistant'; content: string };
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

// Extrae el texto de un PDF (cotizaciones de otros proveedores, listas de productos, etc.)
const extractPdfText = async (buffer: Buffer): Promise<string> => {
  try {
    // @ts-ignore - se importa el modulo interno para evitar el modo debug de pdf-parse
    const mod: any = await import('pdf-parse/lib/pdf-parse.js');
    const parse = mod.default || mod;
    const data = await parse(buffer);
    return String(data?.text || '').replace(/\n{3,}/g, '\n\n').trim();
  } catch (err) {
    console.error('Error extrayendo texto del PDF:', err);
    return '';
  }
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

// Analiza una imagen (foto, screenshot, lista escrita). Prueba varios modelos de vision en orden:
// si uno esta caido, retirado o sin cuota, pasa al siguiente (Groq y al final Gemini).
const VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3.6-27b'];

const analyzeImage = async (buffer: Buffer, mimeType: string, caption?: string): Promise<string> => {
  const safeMime = /^image\/(jpeg|png|webp|gif)$/.test(mimeType) ? mimeType : 'image/jpeg';
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${safeMime};base64,${base64}`;

  const visionPrompt = `Eres los ojos de Nova, asistente de TecnoPatch (telecomunicaciones, CCTV, cableado y redes). Un vendedor te mando esta imagen por WhatsApp${caption ? ` con el comentario: "${caption}"` : ''}.

Describe con precision lo que ves, pensando en que esta informacion se va a usar para armar una cotizacion o dar una recomendacion tecnica:
- Si es una lista de productos, screenshot de specs, o cotizacion vieja: transcribe EXACTAMENTE los nombres, modelos, cantidades y precios que alcances a leer (no inventes numeros que no veas claro).
- Si es un screenshot de una conversacion o de una respuesta del bot: transcribe el texto tal cual se lee.
- Si es una foto de una instalacion, equipo existente, o sitio de trabajo: describe que equipo identificas, su estado aparente, y cualquier detalle relevante para una instalacion o venta (espacio disponible, cableado existente, etc).
- Si no es ninguna de esas cosas, describe brevemente que es.

Responde solo con la descripcion en texto plano, en español, sin JSON ni markdown.`;

  let lastError: any = null;

  for (const model of VISION_MODELS) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: visionPrompt }, { type: 'image_url', image_url: { url: dataUrl } }] as any }],
        temperature: 0.2,
        max_tokens: 1800
      } as any);
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) return text;
    } catch (err: any) {
      lastError = err;
      console.error(`Vision fallo (${model}) status=${err?.status}:`, err?.message || err);
    }
  }

  // Ultimo recurso: Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: visionPrompt }, { inline_data: { mime_type: safeMime, data: base64 } }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1800 } })
      });
      const data: any = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || `Gemini status ${response.status}`);
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('')?.trim();
      if (text) return text;
    } catch (err: any) {
      lastError = err;
      console.error('Vision fallo (Gemini):', err?.message || err);
    }
  }

  throw lastError || new Error('Ningun modelo de vision pudo leer la imagen');
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
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const from = (message.from as string).replace(/^521/, '52');
    const messageId = message.id as string;
    const db = getAdminDb();

    // Deduplicacion de reintentos de Meta
    const dedupeRef = db.collection('whatsappProcessedMessages').doc(messageId);
    if ((await dedupeRef.get()).exists) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    await dedupeRef.set({ processedAt: Date.now() });

    const supported = ['text', 'audio', 'image', 'document'];
    if (!supported.includes(message.type)) {
      await sendWhatsAppText(from, 'Puedo leer texto, notas de voz, fotos y PDFs. Mandame cualquiera de esos.');
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
        userText = (await transcribeAudio(buffer, mimeType)).trim();
        console.log('audio transcrito:', userText);
      } catch (err) {
        console.error('Error transcribiendo audio:', err);
        await sendWhatsAppText(from, 'No pude escuchar bien tu nota de voz. ¿Me la repites o me la escribes?');
        return res.status(200).json({ ok: true });
      }
      if (!userText) {
        await sendWhatsAppText(from, 'No logre entender tu nota de voz. ¿Me la repites o me la escribes?');
        return res.status(200).json({ ok: true });
      }
    } else if (message.type === 'image') {
      try {
        const mediaId = message.image?.id;
        if (!mediaId) throw new Error('Sin id de imagen');
        const caption = message.image?.caption?.trim();
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaId);
        const description = await analyzeImage(buffer, mimeType, caption);
        userText = `[El vendedor mando una imagen. Esto es lo que se ve en la foto:]\n${description}${caption ? `\n\n[Comentario del vendedor junto a la foto: "${caption}"]` : ''}`;
      } catch (err) {
        console.error('Error analizando imagen (descarga o vision):', err);
        await sendWhatsAppText(from, 'No pude ver bien tu imagen. ¿Me la mandas de nuevo o me la describes por texto?');
        return res.status(200).json({ ok: true });
      }
      if (!userText) {
        await sendWhatsAppText(from, 'No logre entender la imagen. ¿Me la describes por texto?');
        return res.status(200).json({ ok: true });
      }
    } else {
      // document
      try {
        const doc = message.document;
        const mime = String(doc?.mime_type || '');
        if (!doc?.id) throw new Error('Sin id de documento');
        if (!mime.includes('pdf')) {
          await sendWhatsAppText(from, 'Por ahora solo leo PDFs como documento. Si es otro tipo de archivo, mandame una foto o captura.');
          return res.status(200).json({ ok: true });
        }
        const caption = (doc.caption || '').trim();
        const { buffer } = await downloadWhatsAppMedia(doc.id);
        const text = await extractPdfText(buffer);
        if (!text) {
          await sendWhatsAppText(from, 'Ese PDF parece escaneado o sin texto que pueda leer. Mandamelo como foto/captura y lo reviso.');
          return res.status(200).json({ ok: true });
        }
        userText = `[El vendedor mando un PDF${doc.filename ? ` (${doc.filename})` : ''}. Texto extraido:]\n${text.slice(0, 9000)}${caption ? `\n\n[Comentario del vendedor: "${caption}"]` : ''}`;
      } catch (err) {
        console.error('Error leyendo PDF:', err);
        await sendWhatsAppText(from, 'No pude leer ese PDF. ¿Me lo mandas como foto o me pasas los datos por texto?');
        return res.status(200).json({ ok: true });
      }
    }

    if (!userText) {
      return res.status(200).json({ ok: true });
    }

    const senderName = value?.contacts?.[0]?.profile?.name || from;

    // Sesion: historial + estado del agente (borrador, pendiente de confirmacion)
    const sessionRef = db.collection('whatsappSessions').doc(from);
    const sessionSnap = await sessionRef.get();
    const sessionData: any = sessionSnap.exists ? sessionSnap.data() : {};
    const priorMessages: ChatMessage[] = sessionData?.messages || [];
    const saved: Partial<AgentState> = sessionData?.state || {};
    const state: AgentState = { ...emptyState(), ...saved, draft: { ...emptyDraft(), ...(saved.draft || {}) } };
    if (Date.now() - (Number(sessionData?.updatedAt) || 0) > DRAFT_TTL_MS) {
      state.draft = emptyDraft(); state.extrasAsked = false; state.pending = null;
    }

    const saveSession = async (extra: ChatMessage[]) => {
      await sessionRef.set({ messages: [...priorMessages, ...extra].slice(-30), state, updatedAt: Date.now() });
    };

    // Comando rapido para empezar de cero
    if (userText.length < 40 && /^\s*(cancela(r)?|borra(r)?|olvida(lo)?|empezar de nuevo|empecemos de nuevo|nueva cotizaci[oó]n|reiniciar?)(?![a-záéíóúñ])/i.test(userText)) {
      state.draft = emptyDraft(); state.extrasAsked = false; state.pending = null;
      const msg = 'Listo, descarte el borrador y cualquier cambio pendiente. Cuando quieras empezamos otra: dime cliente, productos con cantidad y precio.';
      await sendWhatsAppText(from, msg);
      await saveSession([{ role: 'user', content: userText }, { role: 'assistant', content: msg }]);
      return res.status(200).json({ ok: true, reset: true });
    }

    const ctx = {
      db, from, senderName, userText, messageId, state,
      sendPdf: async (buffer: Buffer, filename: string, caption: string) => {
        const mediaId = await uploadWhatsAppMedia(buffer, filename);
        await sendWhatsAppDocument(from, mediaId, filename, caption);
      }
    };

    let reply: string;
    try {
      reply = await runAgent(groq, ctx, priorMessages.slice(-20));
    } catch (err: any) {
      console.error('Error en el agente:', err);
      reply = 'Se me trabo un momento el cerebro. Tu mensaje quedo guardado: mandame un "listo" o repite lo ultimo y sigo desde donde ibamos.';
    }

    await sendWhatsAppText(from, reply);
    await saveSession([{ role: 'user', content: userText.slice(0, 3000) }, { role: 'assistant', content: reply }]);
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('whatsapp-webhook error:', error);
    return res.status(200).json({ ok: false, error: error.message || 'Error inesperado' });
  }
}
