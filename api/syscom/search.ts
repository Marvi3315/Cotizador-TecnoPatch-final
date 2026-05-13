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

const buildSearchVariants = (query: string) => {
  const trimmed = query.trim();
  const normalized = normalizeQuery(trimmed);
  const lower = normalized.toLowerCase();
  const brand = knownBrands.find(item => lower.includes(item));
  const variants: string[] = [];

  if (brand && (trimmed.length > 80 || trimmed.includes('/'))) {
    const terms = normalized
      .split(' ')
      .filter(word => /poe|injector|inyector|30w|60w|gigabit|multigigabit|2\.5gbps|802\.3af|802\.3at/i.test(word))
      .slice(0, 7);
    variants.push([brand, ...terms].join(' '));
    variants.push(`${brand} ${terms.slice(0, 3).join(' ')}`.trim());
  }

  variants.push(trimmed);
  if (normalized !== trimmed) variants.push(normalized);

  if (!brand && normalized.length > 80) {
    variants.push(normalized.split(' ').slice(0, 8).join(' '));
  }

  return Array.from(new Set(variants.filter(Boolean))).slice(0, 4);
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

const mergeProductResponses = (responses: any[]) => {
  const base = responses.find(data => data && !data.error) || {};
  const seen = new Set<string>();
  const productos = responses.flatMap(data => Array.isArray(data?.productos) ? data.productos : []);
  const merged = productos.filter((product: any) => {
    const id = String(product.producto_id || product.modelo || product.titulo || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    ...base,
    productos: merged
  };
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

    const variants = buildSearchVariants(query);
    const responses = await Promise.all(variants.map(item => fetchProducts(token, item, page.toString())));
    const data = responses.length > 1 ? mergeProductResponses(responses) : responses[0];

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
