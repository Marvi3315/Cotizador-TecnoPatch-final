import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Manejo de verificación de Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook de WhatsApp verificado correctamente.');
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Token de verificación inválido');
  }

  // 2. Recepción de mensajes y eventos de Meta (POST)
  if (req.method === 'POST') {
    try {
      const body = req.body;

      // Imprimir la entrada en los Logs de Vercel para confirmar recepción
      console.log('Mensaje recibido de WhatsApp:', JSON.stringify(body, null, 2));

      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
          const from = message.from; // Número del cliente
          const text = message.text?.body; // Mensaje de texto

          console.log(`Mensaje de ${from}: ${text}`);

          // Aquí irá tu lógica para responder con la API de WhatsApp / IA / Firebase
        }
      }

      // Meta requiere SIEMPRE una respuesta HTTP 200 OK rápida
      return res.status(200).json({ status: 'SUCCESS' });
    } catch (error) {
      console.error('Error procesando el webhook:', error);
      // Responder 200 a Meta incluso si hay error para evitar que reintenten y bloqueen el webhook
      return res.status(200).json({ status: 'ERROR_HANDLED' });
    }
  }

  return res.status(405).send('Método no permitido');
}