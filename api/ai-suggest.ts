const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

type QuoteItem = {
  nombre?: string;
  cantidad?: number;
  marca?: string;
  descripcion?: string;
};

const buildPrompt = (items: QuoteItem[], clientNotes?: string) => {
  const listado = items
    .map(item => `- ${item.cantidad ?? 1}x ${item.nombre ?? 'Producto sin nombre'}${item.marca ? ` (${item.marca})` : ''}`)
    .join('\n');

  return `Eres un tecnico experto de TecnoPatch (telecomunicaciones, CCTV, cableado estructurado, VoIP, control de acceso, infraestructura IT) en Mexico.

Con base en esta lista de equipos de una cotizacion, redacta notas tecnicas breves y practicas para el instalador, en espanol de Mexico. Menciona validaciones necesarias antes de instalar (voltaje, carga, tipo de clavija, calibre de cable, distancias maximas, etc.) SOLO para los equipos listados. No inventes equipos que no esten en la lista.

Equipos de la cotizacion:
${listado || 'Sin equipos capturados aun.'}

${clientNotes ? `Notas ya escritas por el usuario (tomalas en cuenta, no las repitas literalmente):\n${clientNotes}` : ''}

Responde SOLO con el texto de las notas tecnicas, en formato de lista corta con guiones, sin encabezados ni explicaciones adicionales. Maximo 6 lineas.`;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en las variables de entorno.' });
    }

    const { items, clientNotes } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un producto a la cotizacion antes de pedir sugerencias.' });
    }

    const prompt = buildPrompt(items, clientNotes);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 400 }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini error:', data);
      return res.status(response.status).json({ error: data?.error?.message || 'Error al consultar Gemini' });
    }

    const suggestion = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

    if (!suggestion.trim()) {
      return res.status(502).json({ error: 'Gemini no devolvio texto util. Intenta de nuevo.' });
    }

    return res.status(200).json({ suggestion: suggestion.trim() });
  } catch (error: any) {
    console.error('ai-suggest error:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado' });
  }
}
