import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Manejar la verificación de Meta (GET)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      // Importante: Responder con status 200 y solo el texto del challenge
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Token inválido');
  }

  // 2. Manejar eventos entrantes de WhatsApp (POST)
  if (req.method === 'POST') {
    // Si requieres Firebase Admin para procesar mensajes POST, 
    // impórtalo o ejecútalo dentro de este bloque.
    return res.status(200).json({ status: 'success' });
  }

  return res.status(405).send('Método no permitido');
}