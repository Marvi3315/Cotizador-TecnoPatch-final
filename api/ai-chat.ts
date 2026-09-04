import OpenAI from 'openai';

export const config = { maxDuration: 60 };

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ClientRef = { id: string; name?: string; company?: string };

const SYSTEM_INSTRUCTION = `Eres Nova, el asistente de IA del Cotizador de TecnoPatch (empresa mexicana de telecomunicaciones, CCTV, cableado estructurado, VoIP, control de acceso e infraestructura IT), platicando con Moises, el dueno.

Eres conversacional y cercano, en espanol de Mexico. Puedes platicar de cualquier tema, dar tu opinion, ayudar a pensar en voz alta, o simplemente charlar, no solo dar instrucciones tecnicas. No te limites nada mas a comandos de cotizacion.

Ademas de platicar, puedes ejecutar UNA accion dentro del cotizador cuando el usuario claramente te lo pida: agregar un cliente y/o productos a la cotizacion en curso. Cuando detectes esa intencion, ademas de tu respuesta conversacional normal, llena los campos de accion.

SIEMPRE responde SOLO con un JSON valido (sin markdown, sin texto fuera del JSON) con este formato exacto:
{"reply": "tu respuesta conversacional normal, como si estuvieras chateando", "clientId": "id del cliente si coincide con uno existente de la lista, o null", "clientNameGuess": "nombre del cliente mencionado si NO coincide con ninguno de la lista, o null", "items": [{"nombre": "...", "cantidad": numero, "precioUnitario": numero}]}

Si el usuario no pidio ninguna accion de cotizacion en su ultimo mensaje (solo esta platicando o preguntando algo), deja clientId y clientNameGuess en null e items como arreglo vacio, y responde normal en "reply".`;

const callGroqChat = async (systemText: string, history: ChatMessage[], message: string) => {
  const trimmedHistory = history.slice(-20);
  
  const formattedMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemText },
    ...trimmedHistory.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'assistant' | 'user',
      content: m.content
    })),
    { role: 'user', content: message }
  ];

  // Modelo ultra rápido y disponible globalmente en Groq
  const completion = await groq.chat.completions.create({
    model: 'llama3-8b-8192',
    messages: formattedMessages,
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 1536,
  });

  return completion.choices[0]?.message?.content || '{}';
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GROQ_API_KEY en las variables de entorno de Vercel.' });
    }

    const { message, history, clients } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Escribe un mensaje antes de enviar.' });
    }

    const clientList = (Array.isArray(clients) ? clients : [] as ClientRef[])
      .map((c: ClientRef) => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}"`)
      .join('\n');

    const systemText = `${SYSTEM_INSTRUCTION}\n\nClientes existentes en el CRM (para comparar nombres):\n${clientList || 'Sin clientes registrados.'}`;

    let rawJsonText = '';
    try {
      rawJsonText = await callGroqChat(systemText, Array.isArray(history) ? history : [], message);
    } catch (err: any) {
      console.error('Groq Chat error:', err);
      return res.status(500).json({
        error: 'Nova tuvo un inconveniente temporal para procesar tu solicitud. Intenta de nuevo en unos segundos.'
      });
    }

    if (!rawJsonText.trim()) {
      return res.status(502).json({ error: 'No se obtuvo respuesta útil del motor de IA. Intenta de nuevo.' });
    }

    let parsed: {
      reply: string;
      clientId: string | null;
      clientNameGuess: string | null;
      items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>;
    };

    try {
      parsed = JSON.parse(rawJsonText);
    } catch (e) {
      console.error('No se pudo parsear JSON de Groq:', rawJsonText);
      return res.status(502).json({ error: 'La IA respondio en un formato inesperado. Intenta de nuevo.' });
    }

    return res.status(200).json(parsed);

  } catch (error: any) {
    console.error('ai-chat error inesperado:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado' });
  }
}