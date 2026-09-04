import { getSyscomToken } from '../syscomAuth.js';

let exchangeCache: any = null;
let exchangeCacheAt = 0;
const EXCHANGE_CACHE_TTL = 1000 * 60 * 30; // Caché de 30 minutos

export default async function handler(req: any, res: any) {
  try {
    // 1. Si el valor está en caché (sea real o fallback), se devuelve de inmediato
    if (exchangeCache && Date.now() - exchangeCacheAt < EXCHANGE_CACHE_TTL) {
      return res.status(200).json(exchangeCache);
    }

    // 2. Intento de conexión con la API de Syscom
    const token = await getSyscomToken();
    const response = await fetch(`https://developers.syscom.mx/api/v1/tipocambio`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Syscom API status: ${response.status}`);
    }

    const data = await response.json();
    
    // Guardar respuesta exitosa de Syscom en caché
    exchangeCache = data;
    exchangeCacheAt = Date.now();
    
    return res.status(200).json(data);

  } catch (error: any) {
    console.warn('Syscom sin acceso o en mantenimiento. Usando tipo de cambio estático por defecto:', error.message);
    
    // 3. FALLBACK: Datos por defecto para mantener funcional el cotizador web
    const fallbackData = { normal: "18.00", oficial: "18.00" };
    
    // Guardar el fallback en caché para bloquear reintentos continuos a Syscom durante 30 min
    exchangeCache = fallbackData;
    exchangeCacheAt = Date.now();

    // Devolver status 200 para que React detenga los reintentos automáticos
    return res.status(200).json(fallbackData);
  }
}
