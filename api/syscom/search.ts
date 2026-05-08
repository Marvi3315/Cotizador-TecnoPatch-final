import { getSyscomToken } from '../syscomAuth.js';

export default async function handler(req: any, res: any) {
  try {
    const query = req.query.q as string || '';
    const page = req.query.page || '1';
    const token = await getSyscomToken();
    
    const searchParams = new URLSearchParams();
    if (query) searchParams.append('busqueda', query);
    searchParams.append('pagina', page.toString());
    
    const response = await fetch(`https://developers.syscom.mx/api/v1/productos?${searchParams.toString()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await response.json();
    console.log(`Search result for "${query}": ${data.productos ? data.productos.length : 0} items found`);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
