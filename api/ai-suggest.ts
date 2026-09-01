const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.6-flash';

type QuoteItem = {
  nombre?: string;
  cantidad?: number;
  marca?: string;
  descripcion?: string;
};

type AiMode = 'technical-notes' | 'complementary-equipment';

const contextHeader = 'Eres un tecnico experto de TecnoPatch (telecomunicaciones, CCTV, cableado estructurado, VoIP, control de acceso, infraestructura IT) en Mexico.';

const formatItems = (items: QuoteItem[]) =>
  items
    .map(item => `- ${item.cantidad ?? 1}x ${item.nombre ?? 'Producto sin nombre'}${item.marca ? ` (${item.marca})` : ''}`)
    .join('\n');

const buildTechnicalNotesPrompt = (items: QuoteItem[], clientNotes?: string) => {
  const listado = formatItems(items);
  return `${contextHeader}

Con base en esta lista de equipos de una cotizacion, redacta notas tecnicas breves y practicas para el instalador, en espanol de Mexico. Menciona validaciones necesarias antes de instalar (voltaje, carga, tipo de clavija, calibre de cable, distancias maximas, etc.) SOLO para los equipos listados. No inventes equipos que no esten en la lista.

Equipos de la cotizacion:
${listado || 'Sin equipos capturados aun.'}

${clientNotes ? `Notas ya escritas por el usuario (tomalas en cuenta, no las repitas literalmente):\n${clientNotes}` : ''}

Responde SOLO con el texto de las notas tecnicas, en formato de lista corta con guiones, sin encabezados ni explicaciones adicionales. Maximo 6 lineas.`;
};

const buildComplementaryEquipmentPrompt = (items: QuoteItem[]) => {
  const listado = formatItems(items);
  return `${contextHeader}

Con base en esta lista de equipos que el cliente ya tiene en su cotizacion, identifica equipo o material complementario que normalmente se necesita para una instalacion completa y que NO esta ya en la lista (ej: si hay camaras, revisa si falta NVR, disco duro, cable UTP, conectores, fuente de poder, canaleta; si hay un router/switch, revisa si falta rack, patch panel, etc). Se practico y realista para el mercado mexicano.

Equipos ya en la cotizacion:
${listado || 'Sin equipos capturados aun.'}

Responde UNICAMENTE con un arreglo JSON valido (sin texto adicional, sin markdown) de maximo 5 objetos con este formato exacto:
[{"nombre": "nombre corto del producto o categoria", "motivo": "razon breve de por que se recomienda, menos de 15 palabras"}]

Si ya esta todo lo esencial cubierto, responde con un arreglo vacio: []`;
};

const callGemini = async (prompt: string, asJson: boolean) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 900,
          ...(asJson
            ? {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      nombre: { type: 'STRING' },
                      motivo: { type: 'STRING' }
                    },
                    required: ['nombre', 'motivo']
                  }
                }
              }
            : {})
        }
      })
    }
  );

  const data = await response.json();
  if (!response.ok) {
    console.error('Gemini error:', data);
    throw new Error(data?.error?.message || 'Error al consultar Gemini');
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  if (!text.trim()) {
    throw new Error('Gemini no devolvio texto util. Intenta de nuevo.');
  }
  return text.trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en las variables de entorno.' });
    }

    const { items, clientNotes, mode } = req.body || {};
    const aiMode: AiMode = mode === 'complementary-equipment' ? 'complementary-equipment' : 'technical-notes';

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Agrega al menos un producto a la cotizacion antes de pedir sugerencias.' });
    }

    if (aiMode === 'complementary-equipment') {
      const prompt = buildComplementaryEquipmentPrompt(items);
      const text = await callGemini(prompt, true);
      let suggestions: Array<{ nombre: string; motivo: string }> = [];
      try {
        suggestions = JSON.parse(text);
      } catch (e) {
        console.error('No se pudo parsear JSON de Gemini:', text);
        throw new Error('La IA respondio en un formato inesperado. Intenta de nuevo.');
      }
      return res.status(200).json({ suggestions });
    }

    const prompt = buildTechnicalNotesPrompt(items, clientNotes);
    const suggestion = await callGemini(prompt, false);
    return res.status(200).json({ suggestion });
  } catch (error: any) {
    console.error('ai-suggest error:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado' });
  }
}
