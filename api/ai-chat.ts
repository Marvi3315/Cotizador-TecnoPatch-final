const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ClientRef = { id: string; name?: string; company?: string };

const SYSTEM_INSTRUCTION = `Eres Nova, el asistente de IA del Cotizador de TecnoPatch (empresa mexicana de telecomunicaciones, CCTV, cableado estructurado, VoIP, control de acceso e infraestructura IT), platicando con Moises, el dueno.

Eres conversacional y cercano, en espanol de Mexico. Puedes platicar de cualquier tema, dar tu opinion, ayudar a pensar en voz alta, o simplemente charlar, no solo dar instrucciones tecnicas. No te limites nada mas a comandos de cotizacion.

Ademas de platicar, puedes ejecutar UNA accion dentro del cotizador cuando el usuario claramente te lo pida: agregar un cliente y/o productos a la cotizacion en curso. Cuando detectes esa intencion, ademas de tu respuesta conversacional normal, llena los campos de accion.

SIEMPRE responde SOLO con un JSON valido (sin markdown, sin texto fuera del JSON) con este formato exacto:
{"reply": "tu respuesta conversacional normal, como si estuvieras chateando", "clientId": "id del cliente si coincide con uno existente de la lista, o null", "clientNameGuess": "nombre del cliente mencionado si NO coincide con ninguno de la lista, o null", "items": [{"nombre": "...", "cantidad": numero, "precioUnitario": numero}]}

Si el usuario no pidio ninguna accion de cotizacion en su ultimo mensaje (solo esta platicando o preguntando algo), deja clientId y clientNameGuess en null e items como arreglo vacio, y responde normal en "reply".`;

const buildContents = (history: ChatMessage[], message: string) => {
  const trimmedHistory = history.slice(-20);
  const contents = trimmedHistory.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });
  return contents;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const callGeminiChat = async (systemText: string, contents: any[]) => {
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
            temperature: 0.7,
            maxOutputTokens: 1536,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                reply: { type: 'STRING' },
                clientId: { type: 'STRING', nullable: true },
                clientNameGuess: { type: 'STRING', nullable: true },
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
              required: ['reply', 'items']
            }
          }
        })
      }
    );

    const data = await response.json();

    if (response.ok) {
      return data;
    }

    const isOverloaded = response.status === 503 || response.status === 429;
    lastError = { status: response.status, data };

    if (isOverloaded && attempt < maxAttempts) {
      console.warn(`Gemini ocupado (intento ${attempt}/${maxAttempts}), reintentando...`);
      await sleep(attempt * 800);
      continue;
    }

    throw lastError;
  }

  throw lastError;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en las variables de entorno.' });
    }

    const { message, history, clients } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Escribe un mensaje antes de enviar.' });
    }

    const clientList = (Array.isArray(clients) ? clients : [] as ClientRef[])
      .map((c: ClientRef) => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}"`)
      .join('\n');

    const contents = buildContents(Array.isArray(history) ? history : [], message);
    const systemText = `${SYSTEM_INSTRUCTION}\n\nClientes existentes en el CRM (para comparar nombres):\n${clientList || 'Sin clientes registrados.'}`;

    let data: any;
    try {
      data = await callGeminiChat(systemText, contents);
    } catch (err: any) {
      console.error('Gemini error tras reintentos:', err);
      const status = err?.status || 500;
      const isOverloaded = status === 503 || status === 429;
      return res.status(status).json({
        error: isOverloaded
          ? 'Nova esta saturada en este momento (mucha demanda en Gemini). Intenta de nuevo en unos segundos.'
          : (err?.data?.error?.message || 'Error al consultar Gemini')
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
    if (!text.trim()) {
      return res.status(502).json({ error: 'Gemini no devolvio texto util. Intenta de nuevo.' });
    }

    let parsed: {
      reply: string;
      clientId: string | null;
      clientNameGuess: string | null;
      items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error('No se pudo parsear JSON de Gemini:', text);
      return res.status(502).json({ error: 'La IA respondio en un formato inesperado. Intenta de nuevo.' });
    }

    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('ai-chat error:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado' });
  }
}
