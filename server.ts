import express from 'express';
import path from 'path';

// Credenciales de Syscom (Fallback para desarrollo)
// NOTA DE SEGURIDAD: Para producción y GitHub, elimina estas llaves de aquí y
// agrégalas en el panel de "Settings -> Environment Variables" del proyecto.
const SYSCOM_CLIENT_ID = process.env.SYSCOM_CLIENT_ID;
const SYSCOM_CLIENT_SECRET = process.env.SYSCOM_CLIENT_SECRET;

let syscomToken: string | null = null;
let syscomTokenExpiresAt = 0;
let exchangeCache: any = null;
let exchangeCacheAt = 0;
const searchCache = new Map<string, { at: number; data: any }>();
const EXCHANGE_CACHE_TTL = 1000 * 60 * 30;
const SEARCH_CACHE_TTL = 1000 * 60 * 5;
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
    variants.push(`${brand} poe`);
    variants.push(`${brand} injector`);
    variants.push(brand);
  }

  variants.push(trimmed);
  if (normalized !== trimmed) variants.push(normalized);

  if (!brand && normalized.length > 80) {
    variants.push(normalized.split(' ').slice(0, 8).join(' '));
  }

  return Array.from(new Set(variants.filter(Boolean))).slice(0, 7);
};

const fetchSyscomProducts = async (token: string, query: string, page: string) => {
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

const productScore = (product: any, query: string) => {
  const text = `${product.marca || ''} ${product.modelo || ''} ${product.titulo || ''}`.toLowerCase();
  const normalized = normalizeQuery(query).toLowerCase();
  const brand = knownBrands.find(item => normalized.includes(item));
  const terms = normalized
    .split(' ')
    .filter(word => word.length > 2 && !['con', 'para', 'compatible', 'plug', 'and', 'play'].includes(word));

  let score = 0;
  if (brand && String(product.marca || '').toLowerCase().includes(brand)) score += 100;
  if (brand && text.includes(brand)) score += 40;
  terms.forEach(term => {
    if (text.includes(term)) score += 4;
  });
  return score;
};

const mergeProductResponses = (responses: any[], query: string) => {
  const base = responses.find(data => data && !data.error) || {};
  const seen = new Set<string>();
  const productos = responses.flatMap(data => Array.isArray(data?.productos) ? data.productos : []);
  const merged = productos.filter((product: any) => {
    const id = String(product.producto_id || product.modelo || product.titulo || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  merged.sort((a: any, b: any) => productScore(b, query) - productScore(a, query));

  return {
    ...base,
    productos: merged
  };
};

async function getSyscomToken() {
  if (!SYSCOM_CLIENT_ID || !SYSCOM_CLIENT_SECRET) {
    throw new Error('Missing Syscom credentials. Set SYSCOM_CLIENT_ID and SYSCOM_CLIENT_SECRET.');
  }

  if (syscomToken && Date.now() < syscomTokenExpiresAt) {
    return syscomToken;
  }
  const params = new URLSearchParams({
    client_id: SYSCOM_CLIENT_ID,
    client_secret: SYSCOM_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  
  const response = await fetch('https://developers.syscom.mx/oauth/token', {
    method: 'POST',
    body: params
  });
  const data = await response.json() as any;
  if (data.access_token) {
    syscomToken = data.access_token;
    // expires_in is in seconds, minus 60 seconds buffer
    syscomTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return syscomToken;
  }
  throw new Error('Failed to get Syscom Token');
}

const app = express();
const PORT = 3000;

app.use(express.json());

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/syscom/search', async (req, res) => {
  try {
    const query = req.query.q as string || '';
    const page = req.query.page || '1';
    const cacheKey = `${query}|${page}`.toLowerCase();
    const cached = searchCache.get(cacheKey);

    if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) {
      res.json(cached.data);
      return;
    }

    const token = await getSyscomToken();
    const variants = buildSearchVariants(query);
    const responses = await Promise.all(variants.map(item => fetchSyscomProducts(token, item, page.toString())));
    const data = responses.length > 1 ? mergeProductResponses(responses, query) : responses[0];

    searchCache.set(cacheKey, { at: Date.now(), data });
    if (searchCache.size > 80) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }

    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/syscom/categorias', async (req, res) => {
   try {
     const token = await getSyscomToken();
     const response = await fetch(`https://developers.syscom.mx/api/v1/categorias`, {
       headers: {
         'Authorization': `Bearer ${token}`
       }
     });
     const data = await response.json();
     res.json(data);
   } catch (error: any) {
     console.error(error);
     res.status(500).json({ error: error.message });
   }
});

app.get('/api/syscom/exchange', async (req, res) => {
  try {
    if (exchangeCache && Date.now() - exchangeCacheAt < EXCHANGE_CACHE_TTL) {
      res.json(exchangeCache);
      return;
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
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Vite middleware for local development
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  import('vite').then(({ createServer }) => {
    createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    }).then((vite) => {
      app.use(vite.middlewares);
    });
  });
} else if (!process.env.VERCEL) {
  // Only serve static files via Express if we are NOT on Vercel
  // Vercel handles static assets natively based on package.json's build script
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Export the app directly
export default app;
