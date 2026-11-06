const GRAPH_VERSION = 'v21.0';

const getConfig = () => {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error('Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID en las variables de entorno.');
  }
  return { token, phoneNumberId };
};

// fetch con limite de tiempo y un reintento si la red falla o se cuelga (evita que la funcion de Vercel muera a los 60 s)
const fetchRetry = async (url: string, init: any, ms: number, label: string, makeInit?: () => any): Promise<Response> => {
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { ...(makeInit ? makeInit() : init), signal: AbortSignal.timeout(ms) });
      if (res.status >= 500 && attempt === 0) { lastErr = new Error(`${label}: HTTP ${res.status}`); continue; }
      console.log(`whatsapp ${label} ${res.status} ${Date.now() - t0}ms`);
      return res;
    } catch (e: any) {
      lastErr = e;
      console.error(`whatsapp ${label} fallo intento ${attempt + 1} tras ${Date.now() - t0}ms:`, e?.name || e?.message || e);
    }
  }
  throw lastErr;
};

export const sendWhatsAppText = async (to: string, body: string) => {
  const { token, phoneNumberId } = getConfig();
  const response = await fetchRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.slice(0, 4000) }
    })
  }, 10000, 'texto');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error('Error enviando texto WhatsApp:', data);
  }
};

export const uploadWhatsAppMedia = async (buffer: Buffer, filename: string): Promise<string> => {
  const { token, phoneNumberId } = getConfig();

  const makeInit = () => {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);
    return { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form as any };
  };

  const response = await fetchRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`, null, 15000, 'subir-pdf', makeInit);

  const data = await response.json();
  if (!response.ok || !data.id) {
    console.error('Error subiendo PDF a WhatsApp:', data);
    throw new Error('No se pudo subir el PDF a WhatsApp.');
  }
  return data.id as string;
};

export const sendWhatsAppDocument = async (to: string, mediaId: string, filename: string, caption: string) => {
  const { token, phoneNumberId } = getConfig();
  const response = await fetchRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: mediaId, filename, caption: caption.slice(0, 1000) }
    })
  }, 10000, 'enviar-pdf');
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error('Error enviando documento WhatsApp:', data);
  }
};

export const downloadWhatsAppMedia = async (mediaId: string): Promise<{ buffer: Buffer; mimeType: string }> => {
  const { token } = getConfig();

  const metaResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaResponse.json();
  if (!metaResponse.ok || !metaData.url) {
    console.error('Error obteniendo URL de media WhatsApp:', metaData);
    throw new Error('No se pudo obtener el archivo de WhatsApp.');
  }

  const fileResponse = await fetch(metaData.url, {
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!fileResponse.ok) {
    throw new Error('No se pudo descargar el archivo de WhatsApp.');
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), mimeType: metaData.mime_type || 'audio/ogg' };
};
