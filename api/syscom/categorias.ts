import { getSyscomToken } from '../syscomAuth.js';

export default async function handler(req: any, res: any) {
  try {
    const token = await getSyscomToken();
    const response = await fetch(`https://developers.syscom.mx/api/v1/categorias`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
