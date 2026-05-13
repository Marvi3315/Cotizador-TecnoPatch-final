import { getSyscomToken } from '../syscomAuth.js';

const SEARCH_CACHE_TTL = 1000 * 60 * 5;
const searchCache = new Map<string, { at: number; data: any }>();

const knownBrands = [
  'hikvision',
  'hilook',
  'ubiquiti',
  'grandstream',
  'dahua',
  'tplink',
  'tp-link',
  'epcom',
  'dsc',
  'honeywell',
  'zkteco',
  'ruijie',
  'mikrotik',
  'panduit'
];

const normalizeQuery = (value: string) =>
  value
    .replace(/[()]/g, ' ')
    .replace(/[~/|,;]/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildSearchQuery = (query: string) => {
  const trimmed = query.trim();
  const normalized = normalizeQuery(trimmed);
  const lower = normalized.toLowerCase();
  const brand = knownBrands.find(item => lower.includes(item));

  if (brand && (trimmed.length > 80 || trimmed.includes('/'))) {
    const terms = normalized
      .split(' ')
      .filter(word => /poe|injector|inyector|30w|60w|gigabit|multigigabit|2\.5gbps|802\.3af|802\.3at/i.test(word))
      .slice(0, 5);
    return [brand, ...terms].join(' ').trim();
  }

  if (normalized.length > 100) {
    return normalized.split(' ').slice(0, 8).join(' ');
  }

  return trimmed;
};

const fetchProducts = async (token: string, query: string, page: string) => {
  const searchParams = new URLSearchParams();
  if (query) searchParams.append('busqueda', query);
  searchParams.append('pagina', page);

  const response = await fetch(`https://developers.syscom.mx/api/v1/productos?${searchParams.toString()}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return response.json();
};

export default async function handler(req: any, res: any) {
  try {
    const query = req.query.q as string || '';
    const page = req.query.page || '1';
    const cacheKey = `${query}|${page}`.toLowerCase();
    const cached = searchCache.get(cacheKey);

    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    const token = await getSyscomToken();
    const syscomQuery = buildSearchQuery(query);
    const data = await fetchProducts(token, syscomQuery, page.toString());

    if (syscomQuery !== query) {
      data.searchHint = {
        original: query,
        used: syscomQuery
      };
    }

    searchCache.set(cacheKey, { at: Date.now(), data });
    if (searchCache.size > 80) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }

    console.log(`Search result for "${query}": ${data.productos ? data.productos.length : 0} items found`);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
