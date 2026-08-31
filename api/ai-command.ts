const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';

type ClientRef = {
  id: string;
  name?: string;
  company?: string;
};

const buildPrompt = (message: string, clients: ClientRef[]) => {
  const clientList = clients
    .map(c => `- id:"${c.id}" nombre:"${c.name || ''}" empresa:"${c.company || ''}"`)
    .join('\n');

  return `Eres el asistente del cotizador de TecnoPatch en Mexico. El usuario te da una instruccion en lenguaje natural para armar una cotizacion. Debes extraer la informacion y devolver SOLO un JSON valido, sin texto adicional ni markdown, con este formato exacto:

{"clientId": "id del cliente si coincide con la lista, o null", "clientNameGuess": "nombre del cliente mencionado si NO coincide con nadie de la lista, o null", "items": [{"nombre": "nombre del producto", "cantidad": numero, "precioUnitario": numero}]}

Reglas:
- Compara el nombre de cliente mencionado en la instruccion contra esta lista de clientes existentes (compara de forma flexible, ignorando mayusculas/acentos, coincidencias parciales de nombre o empresa cuentan como match):
${clientList || 'Sin clientes registrados.'}
- Si encuentras coincidencia clara, regresa su "id" exacto tal cual aparece en la lista en "clientId" y deja "clientNameGuess" en null.
- Si el usuario menciona un nombre de cliente que NO esta en la lista, regresa ese nombre en "clientNameGuess" y deja "clientId" en null.
- Si el usuario no menciona ningun cliente, ambos campos van en null.
- Para cada producto que el usuario pida agregar, extrae "nombre" (descripcion corta del producto tal como lo escribio el usuario), "cantidad" (numero entero, si no la menciona usa 1) y "precioUnitario" (numero, si no menciona precio usa 0).
- Si el usuario no menciona ningun producto, "items" es un arreglo vacio.

Instruccion del usuario:
"${message}"`;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido' });
  }

  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en las variables de entorno.' });
    }

    const { message, clients } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Escribe una instruccion antes de enviar.' });
    }

    const prompt = buildPrompt(message, Array.isArray(clients) ? clients : []);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 500,
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

    let parsed: { clientId: string | null; clientNameGuess: string | null; items: Array<{ nombre: string; cantidad: number; precioUnitario: number }> };
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error('No se pudo parsear JSON de Gemini:', text);
      return res.status(502).json({ error: 'La IA respondio en un formato inesperado. Intenta de nuevo.' });
    }

    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('ai-command error:', error);
    return res.status(500).json({ error: error.message || 'Error inesperado' });
  }
}
