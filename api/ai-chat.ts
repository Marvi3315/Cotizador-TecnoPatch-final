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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${SYSTEM_INSTRUCTION}\n\nClientes existentes en el CRM (para comparar nombres):\n${clientList || 'Sin clientes registrados.'}` }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error('Gemini error:', data);
      return res.status(response.status).json({ error: data?.error?.message || 'Error al consultar Gemini' });
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
