import { getSyscomToken } from '../syscomAuth.js';

let exchangeCache: any = null;
let exchangeCacheAt = 0;
const EXCHANGE_CACHE_TTL = 1000 * 60 * 30;

export default async function handler(req: any, res: any) {
  try {
    if (exchangeCache && Date.now() - exchangeCacheAt < EXCHANGE_CACHE_TTL) {
      return res.status(200).json(exchangeCache);
    }

    const token = await getSyscomToken();
    const response = await fetch(`https://developers.syscom.mx/api/v1/tipocambio`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    exchangeCache = data;
    exchangeCacheAt = Date.now();
    return res.status(200).json(data);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
