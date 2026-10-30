import { reserveQuoteNumber } from './quoteNumber.js';
import { buildQuotePdfBuffer } from './quotePdf.js';

// =====================================================================
// Agente de Nova: herramientas reales sobre el cotizador + loop de LLM
// =====================================================================

export type Item = { nombre: string; cantidad: number; precioUnitario: number };
export type Draft = {
  clientId: string | null;
  newClient: { name: string; phone: string; company: string } | null;
  projectType: string;
  projectScope: string;
  technicalNotes: string;
  conditions: string[];
  items: Item[];
};
export type Pending = { tool: string; args: any; msgId: string; at: number } | null;
export type AgentState = { draft: Draft; extrasAsked: boolean; pending: Pending };

export const emptyDraft = (): Draft => ({ clientId: null, newClient: null, projectType: '', projectScope: '', technicalNotes: '', conditions: [], items: [] });
export const emptyState = (): AgentState => ({ draft: emptyDraft(), extrasAsked: false, pending: null });

export type AgentCtx = {
  db: any;
  from: string;
  senderName: string;
  userText: string;
  messageId: string;
  state: AgentState;
  sendPdf: (buffer: Buffer, filename: string, caption: string) => Promise<void>;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const STATUSES = ['Borrador', 'Enviada', 'Seguimiento', 'Aceptada', 'Rechazada'];
const IVA = 0.16;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const YES = /^\s*(s[ií]|sip|simon|dale|ok|okay|va|vale|confirmo|confirmado|hazlo|adelante|claro|correcto|procede|aplicalo|aplícalo)(?![a-záéíóúñ])/i;
const WANTS_NOW = /(?<![a-záéíóúñ])(gen[eé]ra(la|r|me)?|m[aá]nda(me|la|mela|melo|lo)?|env[ií]a(la|me)?|listo|hazla|ya est[aá]|as[ií]|en pdf|sin (alcance|notas)|no)(?![a-záéíóúñ])/i;

// ---------------------------------------------------------------------
// Utilidades de cotizaciones
// ---------------------------------------------------------------------
const docItemsToSimple = (doc: any): Item[] =>
  (doc.items || []).map((it: any) => ({
    nombre: it.product?.titulo || 'Producto',
    cantidad: Number(it.quantity) || 1,
    precioUnitario: Number(it.unitPriceMxn) || 0
  }));

const makeDocItem = (it: Item) => ({
  quantity: Number(it.cantidad) || 1,
  unitPriceMxn: Number(it.precioUnitario) || 0,
  product: {
    producto_id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    modelo: 'WhatsApp', total_existencia: 0, titulo: it.nombre, marca: 'Partida manual', img_portada: '', garantia: '',
    sat_key: '', sat_description: '', pvol: '', peso: '', alto: '', largo: '', ancho: '', link: '',
    precios: { precio_1: '0', precio_especial: '0', precio_descuento: '0', precio_lista: '0' },
    isManual: true, manualCategory: 'Manual', unit: 'pz'
  }
});

const totalsOf = (items: Item[], includeTax: boolean) => {
  const subtotal = round2(items.reduce((s, it) => s + (Number(it.cantidad) || 1) * (Number(it.precioUnitario) || 0), 0));
  const tax = includeTax ? round2(subtotal * IVA) : 0;
  return { subtotal, tax, total: round2(subtotal + tax) };
};

// Ajusta precios: por margen (%) o dejando el subtotal EXACTO en un objetivo.
export const applyAdjustment = (items: Item[], aj?: { tipo?: string; valor?: number } | null): Item[] => {
  if (!aj || !aj.tipo || !(Number(aj.valor) !== 0)) return items.map(i => ({ ...i }));
  const valor = Number(aj.valor);
  if (aj.tipo === 'margen') {
    const factor = 1 + valor / 100;
    return items.map(i => ({ ...i, precioUnitario: round2(i.precioUnitario * factor) }));
  }
  if (aj.tipo === 'subtotal_objetivo') {
    const target = round2(valor);
    const current = items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0);
    if (current <= 0) return items.map(i => ({ ...i }));
    const factor = target / current;
    const out = items.map(i => ({ ...i, precioUnitario: Math.max(1, Math.round(i.precioUnitario * factor)) }));
    let diff = round2(target - out.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0));
    if (diff !== 0) {
      // absorber la diferencia en la partida de cantidad 1 mas cara; si no hay, en la de menor cantidad
      let idx = -1;
      out.forEach((i, k) => { if (i.cantidad === 1 && (idx < 0 || i.precioUnitario > out[idx].precioUnitario)) idx = k; });
      if (idx < 0) out.forEach((i, k) => { if (idx < 0 || i.cantidad < out[idx].cantidad) idx = k; });
      out[idx].precioUnitario = round2(out[idx].precioUnitario + diff / out[idx].cantidad);
    }
    return out;
  }
  return items.map(i => ({ ...i }));
};


// Busca clientes por nombre/empresa tolerando errores de dedo y nombres parciales
const fuzzyClients = async (db: any, texto: string) => {
  const snap = await db.collection('clients').get();
  const tokens = norm(texto).split(' ').filter(Boolean);
  return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    .map((c: any) => {
      const hay = norm(`${c.name} ${c.company}`);
      const score = tokens.length ? tokens.filter((t: string) => hay.includes(t) || (t.length > 4 && hay.split(' ').some((w: string) => w.startsWith(t.slice(0, 4))))).length / tokens.length : 0;
      return { c, score };
    })
    .filter((x: any) => x.score >= 0.5).sort((x: any, y: any) => y.score - x.score);
};

const findQuote = async (db: any, folioText: string): Promise<{ id: string; ref: any; data: any } | null> => {
  const folio = String(folioText || '').trim().toUpperCase();
  if (!folio) return null;
  const exact = await db.collection('quoteHistory').where('quoteNumber', '==', folio).limit(1).get();
  if (!exact.empty) { const d = exact.docs[0]; return { id: d.id, ref: d.ref, data: d.data() }; }
  const snap = await db.collection('quoteHistory').orderBy('savedAt', 'desc').limit(300).get();
  const digits = folio.replace(/\D/g, '');
  const hit = snap.docs.find((d: any) => {
    const qn = String(d.data().quoteNumber || '').toUpperCase();
    return qn === folio || (digits.length >= 1 && digits.length <= 4 && qn.endsWith('-' + digits.padStart(4, '0'))) || (digits.length >= 5 && qn.replace(/\D/g, '').endsWith(digits));
  });
  return hit ? { id: hit.id, ref: hit.ref, data: hit.data() } : null;
};

const quoteSummary = (q: any) => ({
  folio: q.quoteNumber, cliente: q.clientCompany || q.clientName, estatus: q.quoteStatus || 'Borrador',
  subtotal: q.subtotal, iva: q.tax, total: q.total, fecha: q.date, vendedor: q.salesRep || ''
});

const pdfFromDoc = (q: any): Buffer => buildQuotePdfBuffer({
  quoteNumber: q.quoteNumber, date: q.date || '', clientName: q.clientName || '', clientCompany: q.clientCompany || '',
  clientPhone: q.clientPhone || '', projectType: q.projectType || undefined, projectScope: q.projectScope || undefined,
  technicalNotes: q.technicalNotes || undefined,
  items: docItemsToSimple(q).map(i => ({ ...i, categoria: 'Partida manual' })),
  subtotal: Number(q.subtotal) || 0, tax: Number(q.tax) || 0, total: Number(q.total) || 0,
  includeTax: q.includeTax !== false && Number(q.tax) > 0, validityDays: q.validityDays || 15, exchangeRate: Number(q.pdfExchangeRate) || 18,
  conditions: Array.isArray(q.conditions) && q.conditions.length ? q.conditions : undefined
});

const sendQuotePdf = async (ctx: AgentCtx, q: any, caption: string) => {
  await ctx.sendPdf(pdfFromDoc(q), `${q.quoteNumber}.pdf`, caption);
};

const audit = async (ctx: AgentCtx, action: string, detail: any) => {
  try {
    await ctx.db.collection('whatsappAudit').add({ at: Date.now(), from: ctx.from, vendedor: ctx.senderName, action, detail });
  } catch (e) { console.error('audit fallo:', e); }
};

const resolveClient = async (ctx: AgentCtx, d: { clientId: string | null; newClient: Draft['newClient'] }) => {
  if (d.clientId) {
    const s = await ctx.db.collection('clients').doc(d.clientId).get();
    if (s.exists) { const c: any = s.data(); return { id: d.clientId, name: c.name || '', company: c.company || '', phone: c.phone || '', rfc: c.rfc || '' }; }
  }
  if (d.newClient?.name) {
    const ref = ctx.db.collection('clients').doc();
    const data = {
      id: ref.id, name: d.newClient.name, company: d.newClient.company || d.newClient.name, phone: d.newClient.phone || '', email: '', rfc: '',
      contactRole: '', address: '', source: 'WhatsApp', status: 'Cotizado', owner: `Ventas (WhatsApp - ${ctx.senderName})`, notes: '',
      createdAt: new Date().toISOString()
    };
    await ref.set(data);
    return { id: ref.id, name: data.name, company: data.company, phone: data.phone, rfc: '' };
  }
  return null;
};

const createQuoteFrom = async (
  ctx: AgentCtx,
  client: { id: string; name: string; company: string; phone: string; rfc?: string },
  items: Item[],
  meta: { projectType?: string; projectScope?: string; technicalNotes?: string; conditions?: string[] },
  origin: string
) => {
  const totals = totalsOf(items, true);
  const quoteNumber = await reserveQuoteNumber(ctx.db);
  const ref = ctx.db.collection('quoteHistory').doc();
  const date = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const doc = {
    id: ref.id, quoteNumber, date, items: items.map(makeDocItem), ...totals, includeTax: true, currency: 'MXN', exchangeRate: 1, pdfExchangeRate: 18,
    clientName: client.name, clientCompany: client.company, clientPhone: client.phone, quoteStatus: 'Borrador',
    salesRep: `WhatsApp - ${ctx.senderName}`, validityDays: 15, savedAt: Date.now(),
    projectType: meta.projectType || '', projectScope: meta.projectScope || '', technicalNotes: meta.technicalNotes || '',
    conditions: meta.conditions || []
  };
  await ref.set(doc);
  await sendQuotePdf(ctx, doc,
    `Lista la cotizacion de ${client.company || client.name}.\n\nFolio: ${quoteNumber}\nSubtotal: ${money(totals.subtotal)}\nIVA: ${money(totals.tax)}\nTotal: ${money(totals.total)} MXN`);
  await audit(ctx, origin, { folio: quoteNumber, cliente: client.company || client.name, ...totals });
  return { folio: quoteNumber, cliente: client.company || client.name, partidas: items.length, ...totals };
};

// ---------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------
const partidaSchema = {
  type: 'object',
  properties: {
    nombre: { type: 'string' },
    cantidad: { type: 'number' },
    precio_unitario: { type: 'number', description: 'sin IVA, MXN' }
  },
  required: ['nombre', 'precio_unitario']
};
const ajusteSchema = {
  type: 'object',
  description: 'margen: % a subir (o bajar si es negativo) todos los precios. subtotal_objetivo: deja el subtotal SIN IVA exacto en valor.',
  properties: { tipo: { type: 'string', enum: ['margen', 'subtotal_objetivo'] }, valor: { type: 'number' } },
  required: ['tipo', 'valor']
};

const CITA_TIPOS = ['Visita tecnica', 'Seguimiento', 'Cierre', 'Instalacion', 'Otro'];
const CITA_ESTATUS = ['Programada', 'Realizada', 'Reagendada', 'Cancelada'];
const TZ = 'America/Mexico_City';
const todayMx = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const nowHmMx = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const addDaysIso = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const diaDe = (iso: string) => DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const validDate = (v: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const normHora = (v: any) => { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/); if (!m || +m[1] > 23 || +m[2] > 59) return null; return `${m[1].padStart(2, '0')}:${m[2]}`; };
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const ACTIVE_CITA = ['Programada', 'Reagendada'];

export const TOOLS: any[] = [
  { type: 'function', function: { name: 'buscar_clientes', description: 'Busca clientes por nombre/empresa (tolera errores). Usala antes de tratar a alguien como cliente nuevo.', parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'buscar_cotizaciones', description: 'Lista cotizaciones (recientes primero) filtrando por texto (cliente/folio), estatus y/o dias.', parameters: { type: 'object', properties: { texto: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, dias: { type: 'number' }, limite: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ver_cotizacion', description: 'Detalle de una cotizacion: partidas numeradas, totales, alcance, notas, estatus.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'actualizar_borrador', description: 'Guarda el BORRADOR de una cotizacion NUEVA. Llamala cada vez que den cliente, partidas, alcance o notas. "partidas" REEMPLAZA la lista completa. Lo omitido se conserva. limpiar=true lo descarta.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, tipo_proyecto: { type: 'string' }, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' }, condiciones: { type: 'array', items: { type: 'string' } }, partidas: { type: 'array', items: partidaSchema }, limpiar: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'crear_cotizacion', description: 'Genera y envia el PDF de la cotizacion NUEVA con el borrador. Opcional: ajuste de precios.', parameters: { type: 'object', properties: { ajuste: ajusteSchema } } } },
  { type: 'function', function: { name: 'duplicar_cotizacion', description: 'Crea cotizacion NUEVA copiando las partidas de otra, para otro cliente, con ajuste opcional. Envia el PDF.', parameters: { type: 'object', properties: { folio: { type: 'string' }, cliente_id: { type: 'string' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, ajuste: ajusteSchema, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'editar_cotizacion', description: 'Modifica una cotizacion EXISTENTE (partidas por numero desde 1, agregar/quitar, alcance, notas o ajuste). NO aplica: devuelve antes/despues y espera "si" del vendedor (luego confirmar_accion).', parameters: { type: 'object', properties: { folio: { type: 'string' }, actualizar: { type: 'array', items: { type: 'object', properties: { partida: { type: 'number' }, nombre: { type: 'string' }, cantidad: { type: 'number' }, precio_unitario: { type: 'number' } }, required: ['partida'] } }, agregar: { type: 'array', items: partidaSchema }, quitar: { type: 'array', items: { type: 'number' } }, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' }, ajuste: ajusteSchema, enviar_pdf: { type: 'boolean' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'cambiar_estatus', description: 'Cambia estatus de una cotizacion (Borrador, Enviada, Seguimiento, Aceptada, Rechazada). Pide confirmacion.', parameters: { type: 'object', properties: { folio: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, motivo: { type: 'string' } }, required: ['folio', 'estatus'] } } },
  { type: 'function', function: { name: 'confirmar_accion', description: 'Aplica la accion pendiente SOLO si el ultimo mensaje del vendedor dice que si.' } },
  { type: 'function', function: { name: 'cancelar_accion', description: 'Descarta la accion pendiente si el vendedor dice que no.' } },
  { type: 'function', function: { name: 'enviar_pdf', description: 'Reenvia el PDF de una cotizacion existente.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'resumen_ventas', description: 'Resumen de los ultimos N dias (default 7): por estatus, por vendedor y cotizaciones estancadas (>5 dias sin cerrar).', parameters: { type: 'object', properties: { dias: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ver_agenda', description: 'Consulta las citas/visitas de la agenda del CRM. Por defecto hoy y los proximos 7 dias. Fechas YYYY-MM-DD.', parameters: { type: 'object', properties: { desde: { type: 'string' }, hasta: { type: 'string' }, texto: { type: 'string', description: 'filtra por cliente/titulo' }, solo_mias: { type: 'boolean' }, incluir_canceladas: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'agendar_cita', description: 'Agenda una cita/visita en el CRM. Convierte fechas relativas (manana, el jueves) a YYYY-MM-DD y la hora a HH:MM de 24h. Si hay choque de horario avisa y no agenda salvo forzar=true.', parameters: { type: 'object', properties: { cliente: { type: 'string', description: 'nombre del cliente o empresa' }, cliente_id: { type: 'string' }, telefono: { type: 'string', description: 'solo si es cliente nuevo' }, fecha: { type: 'string' }, hora: { type: 'string' }, tipo: { type: 'string', enum: CITA_TIPOS }, titulo: { type: 'string' }, lugar: { type: 'string' }, notas: { type: 'string' }, forzar: { type: 'boolean' } }, required: ['cliente', 'fecha', 'hora'] } } },
  { type: 'function', function: { name: 'modificar_cita', description: 'Reagenda, cancela o marca como realizada una cita EXISTENTE (o cambia lugar/notas/tipo). NO aplica: pide "si" al vendedor (luego confirmar_accion). Identificala con cliente (+ fecha_actual si hay varias) o cita_id.', parameters: { type: 'object', properties: { cita_id: { type: 'string' }, cliente: { type: 'string' }, fecha_actual: { type: 'string' }, fecha: { type: 'string' }, hora: { type: 'string' }, estatus: { type: 'string', enum: CITA_ESTATUS }, tipo: { type: 'string', enum: CITA_TIPOS }, lugar: { type: 'string' }, notas: { type: 'string' }, titulo: { type: 'string' } } } } }
];


const AGENDA_TOOLS = ['ver_agenda', 'agendar_cita', 'modificar_cita', 'buscar_clientes', 'confirmar_accion', 'cancelar_accion'];
const AGENDA_RE = /\bcitas?\b|agend|reagend|reunion|junta|visita|calendario|que tengo|manana|pasado manana|esta semana|proxima semana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las \d|recuerdame/;
const CORE_TOOLS = ['actualizar_borrador', 'crear_cotizacion', 'buscar_clientes'];
const EXISTING_RE = /cot-\d|folio|historial|ultim|anterior|cambia|modifica|edita|duplic|copia|estatus|aceptad|rechazad|seguimiento|resumen|cuanto|cuantas|reenv|manda(me)? (la|el|esa|ese)|pdf|esa cotizacion|la de /i;
// Solo se mandan al modelo las herramientas que la peticion probablemente necesita
export const selectTools = (userText: string, state: AgentState): any[] => {
  const t = userText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (state.pending) return TOOLS;
  if (AGENDA_RE.test(t) && !/cot-\d|cotizacion|cotiza /.test(t)) return TOOLS.filter(x => AGENDA_TOOLS.includes(x.function.name));
  if (EXISTING_RE.test(t)) return TOOLS;
  const looksLikeNewQuote = /\$|\d/.test(t) || state.draft.items.length > 0 || /cotiza/.test(t);
  return looksLikeNewQuote ? TOOLS.filter(x => CORE_TOOLS.includes(x.function.name)) : TOOLS;
};

type Mutation = { error: string } | { preview: any; commit: () => Promise<any> };

const planEdit = async (ctx: AgentCtx, a: any): Promise<Mutation> => {
  const q = await findQuote(ctx.db, a.folio);
  if (!q) return { error: `No encontre la cotizacion ${a.folio}.` };
  const before = docItemsToSimple(q.data);
  let items = before.map(i => ({ ...i }));
  const notas: string[] = [];

  for (const u of a.actualizar || []) {
    const idx = Number(u.partida) - 1;
    if (!items[idx]) return { error: `La cotizacion ${q.data.quoteNumber} no tiene la partida ${u.partida} (tiene ${items.length}).` };
    if (u.nombre) items[idx].nombre = String(u.nombre);
    if (u.cantidad !== undefined && Number(u.cantidad) > 0) items[idx].cantidad = Number(u.cantidad);
    if (u.precio_unitario !== undefined && Number(u.precio_unitario) >= 0) items[idx].precioUnitario = Number(u.precio_unitario);
  }
  const quitar = new Set((a.quitar || []).map((n: any) => Number(n) - 1));
  for (const k of quitar) if (!items[k as number]) return { error: `No existe la partida ${Number(k) + 1} para quitar.` };
  if (quitar.size) items = items.filter((_, k) => !quitar.has(k));
  for (const n of a.agregar || []) items.push({ nombre: String(n.nombre), cantidad: Number(n.cantidad) > 0 ? Number(n.cantidad) : 1, precioUnitario: Number(n.precio_unitario) || 0 });
  if (items.length === 0) return { error: 'La cotizacion se quedaria sin partidas; no lo aplico.' };
  if (a.ajuste) items = applyAdjustment(items, a.ajuste);

  const includeTax = q.data.includeTax !== false && Number(q.data.tax) > 0;
  const oldT = { subtotal: Number(q.data.subtotal) || 0, tax: Number(q.data.tax) || 0, total: Number(q.data.total) || 0 };
  const newT = totalsOf(items, includeTax);
  if (a.alcance) notas.push('alcance actualizado');
  if (a.notas_tecnicas) notas.push('notas tecnicas actualizadas');

  const snippet = (t: any, n = 220) => { const x = String(t || '').trim(); return x.length > n ? `${x.slice(0, n)}...` : x; };
  const itemsChanged = JSON.stringify(before) !== JSON.stringify(items);
  const sameTotals = oldT.subtotal === newT.subtotal && oldT.total === newT.total;
  const cambios: string[] = [];
  if (itemsChanged) cambios.push('Partidas modificadas');
  if (a.alcance) cambios.push(`Alcance nuevo: "${snippet(a.alcance)}"${q.data.projectScope ? ' (reemplaza el anterior)' : ''}`);
  if (a.notas_tecnicas) cambios.push(`Nota tecnica nueva: "${snippet(a.notas_tecnicas)}"${q.data.technicalNotes ? ' (reemplaza la anterior)' : ''}`);
  const preview: any = {
    folio: q.data.quoteNumber, cliente: q.data.clientCompany || q.data.clientName, cambios,
    ...(sameTotals ? { totales_sin_cambio: true, total_actual: oldT.total } : { antes: oldT, despues: newT }),
    ...(itemsChanged ? { partidas_despues: items.map((i, k) => `${k + 1}. ${i.cantidad}x ${i.nombre} @ ${money(i.precioUnitario)}`) } : {})
  };

  return {
    preview,
    commit: async () => {
      const update: any = { items: items.map((it, k) => {
        const old = (q.data.items || [])[k];
        // conservar el producto original (Syscom, etc.) cuando la partida existia y no cambio de nombre
        if (old && old.product?.titulo === it.nombre && !quitar.size) return { ...old, quantity: it.cantidad, unitPriceMxn: it.precioUnitario };
        return makeDocItem(it);
      }), ...newT, savedAt: q.data.savedAt };
      if (quitar.size) update.items = items.map(makeDocItem);
      if (a.alcance) update.projectScope = String(a.alcance);
      if (a.notas_tecnicas) update.technicalNotes = String(a.notas_tecnicas);
      await q.ref.set(update, { merge: true });
      const merged = { ...q.data, ...update };
      await audit(ctx, 'editar_cotizacion', { folio: q.data.quoteNumber, antes: oldT, despues: newT });
      if (a.enviar_pdf !== false) await sendQuotePdf(ctx, merged, `Cotizacion ${merged.quoteNumber} actualizada.\n\nSubtotal: ${money(newT.subtotal)}\nIVA: ${money(newT.tax)}\nTotal: ${money(newT.total)} MXN`);
      return { aplicado: true, folio: merged.quoteNumber, ...newT, pdf_enviado: a.enviar_pdf !== false };
    }
  };
};

const planStatus = async (ctx: AgentCtx, a: any): Promise<Mutation> => {
  const q = await findQuote(ctx.db, a.folio);
  if (!q) return { error: `No encontre la cotizacion ${a.folio}.` };
  if (!STATUSES.includes(a.estatus)) return { error: `Estatus invalido. Opciones: ${STATUSES.join(', ')}.` };
  const actual = q.data.quoteStatus || 'Borrador';
  return {
    preview: { folio: q.data.quoteNumber, cliente: q.data.clientCompany || q.data.clientName, de: actual, a: a.estatus, motivo: a.motivo || '' },
    commit: async () => {
      const upd: any = { quoteStatus: a.estatus };
      if (a.estatus === 'Rechazada' && a.motivo) upd.lostReason = String(a.motivo);
      await q.ref.set(upd, { merge: true });
      await audit(ctx, 'cambiar_estatus', { folio: q.data.quoteNumber, de: actual, a: a.estatus });
      return { aplicado: true, folio: q.data.quoteNumber, estatus: a.estatus };
    }
  };
};

const meetingLine = (m: any) => ({ id: m.id, fecha: m.date, dia: diaDe(m.date), hora: m.time, cliente: m.clientName, tipo: m.type, titulo: m.title, lugar: m.location || '', responsable: m.owner, estatus: m.status });

const meetingConflicts = async (db: any, date: string, time: string, owner: string, ignoreId?: string) => {
  const snap = await db.collection('meetings').where('date', '==', date).get();
  return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
    .filter((m: any) => m.id !== ignoreId && ACTIVE_CITA.includes(m.status) && norm(m.owner) === norm(owner) && Math.abs(minutes(m.time) - minutes(time)) < 60);
};

const findMeeting = async (ctx: AgentCtx, a: any): Promise<{ ref: any; data: any } | { error: string }> => {
  if (a.cita_id) {
    const s = await ctx.db.collection('meetings').doc(String(a.cita_id)).get();
    return s.exists ? { ref: s.ref, data: { id: s.id, ...s.data() } } : { error: 'No encontre esa cita.' };
  }
  const since = a.fecha_actual && validDate(a.fecha_actual) ? a.fecha_actual : todayMx();
  const snap = await ctx.db.collection('meetings').where('date', '>=', since).get();
  const term = norm(a.cliente);
  let list = snap.docs.map((d: any) => ({ ref: d.ref, data: { id: d.id, ...d.data() } }))
    .filter((x: any) => ACTIVE_CITA.includes(x.data.status))
    .filter((x: any) => !a.fecha_actual || x.data.date === a.fecha_actual)
    .filter((x: any) => !term || term.split(' ').every((t: string) => norm(`${x.data.clientName} ${x.data.title}`).includes(t)))
    .sort((x: any, y: any) => `${x.data.date} ${x.data.time}`.localeCompare(`${y.data.date} ${y.data.time}`));
  if (!list.length) return { error: `No encontre citas pendientes${a.cliente ? ` de "${a.cliente}"` : ''}. Usa ver_agenda para revisar.` };
  if (list.length > 1) return { error: 'Hay varias citas que coinciden; pregunta cual (por fecha y hora).', opciones: list.slice(0, 6).map((x: any) => meetingLine(x.data)) } as any;
  return list[0];
};

const planCita = async (ctx: AgentCtx, a: any): Promise<Mutation> => {
  const f: any = await findMeeting(ctx, a);
  if (f.error) return f;
  const m = f.data;
  const upd: any = {};
  if (a.fecha) { if (!validDate(a.fecha)) return { error: 'Fecha invalida, usa YYYY-MM-DD.' }; upd.date = a.fecha; }
  if (a.hora) { const h = normHora(a.hora); if (!h) return { error: 'Hora invalida, usa HH:MM (24h).' }; upd.time = h; }
  for (const [k, v] of [['location', a.lugar], ['notes', a.notas], ['title', a.titulo]] as const) if (v !== undefined && v !== null && String(v).trim()) upd[k] = String(v).trim();
  if (a.tipo) { if (!CITA_TIPOS.includes(a.tipo)) return { error: `Tipo invalido: ${CITA_TIPOS.join(', ')}` }; upd.type = a.tipo; }
  if (a.estatus) { if (!CITA_ESTATUS.includes(a.estatus)) return { error: `Estatus invalido: ${CITA_ESTATUS.join(', ')}` }; upd.status = a.estatus; }
  const moved = (upd.date && upd.date !== m.date) || (upd.time && upd.time !== m.time);
  if (moved && !upd.status) upd.status = 'Reagendada';
  if (!Object.keys(upd).length) return { error: 'No me dijiste que cambiar de la cita.' };
  const newDate = upd.date || m.date, newTime = upd.time || m.time;
  if (moved && newDate < todayMx()) return { error: 'Esa fecha ya paso.' };
  const choques = moved && upd.status !== 'Cancelada' ? await meetingConflicts(ctx.db, newDate, newTime, m.owner, m.id) : [];
  const cambios: any = {};
  for (const k of Object.keys(upd)) cambios[k] = { de: m[k] ?? '', a: upd[k] };
  return {
    preview: { cita: meetingLine(m), cambios, aviso_choque: choques.length ? choques.map((c: any) => `${c.clientName} ${c.time}`) : undefined },
    commit: async () => {
      await f.ref.set(upd, { merge: true });
      await audit(ctx, 'modificar_cita', { id: m.id, cliente: m.clientName, upd });
      return { aplicado: true, mensaje: upd.status === 'Cancelada' ? `Cancele la cita con ${m.clientName}.` : `Listo, actualice la cita con ${m.clientName}${moved ? ` para el ${diaDe(newDate)} ${newDate} a las ${newTime}` : ''}.` };
    }
  };
};

const MUTATORS: Record<string, (ctx: AgentCtx, a: any) => Promise<Mutation>> = { editar_cotizacion: planEdit, cambiar_estatus: planStatus, modificar_cita: planCita };

export const executeTool = async (ctx: AgentCtx, name: string, a: any): Promise<any> => {
  const { db, state } = ctx;
  try {
    // ---- acciones que piden confirmacion ----
    if (MUTATORS[name]) {
      const plan = await MUTATORS[name](ctx, a);
      if ('error' in plan) return plan;
      state.pending = { tool: name, args: a, msgId: ctx.messageId, at: Date.now() };
      return { requiere_confirmacion: true, resumen: plan.preview, instruccion: 'Muestrale al vendedor SOLO lo que cambia, corto y claro (si totales_sin_cambio, no repitas los totales) y pidele que conteste "si" para aplicarlo. Sin negritas ni asteriscos. NO llames confirmar_accion en este mismo turno.' };
    }
    if (name === 'confirmar_accion') {
      const p = state.pending;
      if (!p || Date.now() - p.at > 30 * 60 * 1000) return { error: 'No hay ninguna accion pendiente por confirmar.' };
      if (p.msgId === ctx.messageId) return { error: 'Primero muestrale el resumen al vendedor y espera su respuesta; no puedes confirmar en el mismo turno.' };
      if (!YES.test(ctx.userText)) return { error: 'El ultimo mensaje del vendedor no es una confirmacion clara. Preguntale si lo aplico (si/no).' };
      const plan = await MUTATORS[p.tool](ctx, p.args);
      state.pending = null;
      if ('error' in plan) return plan;
      return await plan.commit();
    }
    if (name === 'cancelar_accion') { state.pending = null; return { ok: true, mensaje: 'Accion descartada.' }; }

    if (name === 'buscar_clientes') {
      const found = (await fuzzyClients(db, a.texto)).slice(0, 6).map((x: any) => ({ id: x.c.id, nombre: x.c.name, empresa: x.c.company, telefono: x.c.phone || '' }));
      return { coincidencias: found, nota: found.length ? '' : 'Sin coincidencias: es un cliente nuevo.' };
    }

    if (name === 'buscar_cotizaciones') {
      const snap = await db.collection('quoteHistory').orderBy('savedAt', 'desc').limit(300).get();
      const term = norm(a.texto);
      const since = a.dias ? Date.now() - Number(a.dias) * 86400000 : 0;
      const rows = snap.docs.map((d: any) => d.data()).filter((q: any) => {
        if (since && (q.savedAt || 0) < since) return false;
        if (a.estatus && (q.quoteStatus || 'Borrador') !== a.estatus) return false;
        if (term) { const hay = norm(`${q.quoteNumber} ${q.clientName} ${q.clientCompany}`); return term.split(' ').every((t: string) => hay.includes(t)); }
        return true;
      }).slice(0, Math.min(Number(a.limite) || 8, 15)).map(quoteSummary);
      return { total_encontradas: rows.length, cotizaciones: rows };
    }

    if (name === 'ver_cotizacion') {
      const q = await findQuote(db, a.folio);
      if (!q) return { error: `No encontre la cotizacion ${a.folio}.` };
      return { ...quoteSummary(q.data), partidas: docItemsToSimple(q.data).map((i, k) => ({ n: k + 1, ...i })), alcance: q.data.projectScope || '', notas_tecnicas: q.data.technicalNotes || '' };
    }

    if (name === 'enviar_pdf') {
      const q = await findQuote(db, a.folio);
      if (!q) return { error: `No encontre la cotizacion ${a.folio}.` };
      await sendQuotePdf(ctx, q.data, `Aqui tienes de nuevo la cotizacion ${q.data.quoteNumber} de ${q.data.clientCompany || q.data.clientName}.`);
      return { enviado: true, folio: q.data.quoteNumber };
    }

    if (name === 'resumen_ventas') {
      const dias = Number(a.dias) > 0 ? Number(a.dias) : 7;
      const snap = await db.collection('quoteHistory').orderBy('savedAt', 'desc').limit(300).get();
      const all = snap.docs.map((d: any) => d.data());
      const inRange = all.filter((q: any) => (q.savedAt || 0) >= Date.now() - dias * 86400000);
      const by: Record<string, { cantidad: number; monto: number }> = {};
      const seller: Record<string, { cantidad: number; monto: number }> = {};
      for (const q of inRange) {
        const s = q.quoteStatus || 'Borrador';
        by[s] = by[s] || { cantidad: 0, monto: 0 }; by[s].cantidad++; by[s].monto = round2(by[s].monto + (Number(q.total) || 0));
        const v = q.salesRep || 'Sin vendedor';
        seller[v] = seller[v] || { cantidad: 0, monto: 0 }; seller[v].cantidad++; seller[v].monto = round2(seller[v].monto + (Number(q.total) || 0));
      }
      const estancadas = all.filter((q: any) => !['Aceptada', 'Rechazada'].includes(q.quoteStatus || 'Borrador') && (q.savedAt || 0) < Date.now() - 5 * 86400000)
        .slice(0, 10).map((q: any) => ({ ...quoteSummary(q), dias_sin_mover: Math.floor((Date.now() - (q.savedAt || 0)) / 86400000) }));
      return { dias, cotizaciones: inRange.length, monto_total: round2(inRange.reduce((s: number, q: any) => s + (Number(q.total) || 0), 0)), por_estatus: by, por_vendedor: seller, estancadas };
    }

    // ---- borrador y creacion ----
    if (name === 'actualizar_borrador') {
      if (a.limpiar) { state.draft = emptyDraft(); state.extrasAsked = false; return { ok: true, borrador: state.draft }; }
      const d = state.draft;
      if (a.cliente_id) {
        const s = await db.collection('clients').doc(String(a.cliente_id)).get();
        if (s.exists) { d.clientId = String(a.cliente_id); d.newClient = null; }
        else return { error: `El cliente_id ${a.cliente_id} no existe. Usa buscar_clientes.` };
      } else if (a.cliente_nuevo?.nombre) {
        // si ya existe UN cliente que coincide con ese nombre, se reutiliza en vez de duplicarlo
        const n = norm(a.cliente_nuevo.nombre);
        const matches = await fuzzyClients(db, a.cliente_nuevo.nombre);
        const full = matches.filter((x: any) => x.score === 1 || norm(x.c.name) === n || norm(x.c.company) === n);
        if (full.length === 1) { d.clientId = full[0].c.id; d.newClient = null; }
        else { d.newClient = { name: String(a.cliente_nuevo.nombre).trim(), phone: String(a.cliente_nuevo.telefono || '').trim(), company: String(a.cliente_nuevo.empresa || '').trim() }; d.clientId = null; }
      }
      if (a.tipo_proyecto) d.projectType = String(a.tipo_proyecto);
      if (a.alcance) d.projectScope = String(a.alcance);
      if (a.notas_tecnicas) d.technicalNotes = String(a.notas_tecnicas);
      if (Array.isArray(a.condiciones) && a.condiciones.length) d.conditions = a.condiciones.map(String);
      if (Array.isArray(a.partidas) && a.partidas.length) {
        d.items = a.partidas.filter((p: any) => p?.nombre).map((p: any) => ({ nombre: String(p.nombre).trim(), cantidad: Number(p.cantidad) > 0 ? Number(p.cantidad) : 1, precioUnitario: Number(p.precio_unitario) || 0 }));
      }
      const faltaPrecio = d.items.filter(i => !(i.precioUnitario > 0)).map(i => i.nombre);
      const falta = [!(d.clientId || d.newClient) ? 'cliente' : '', faltaPrecio.length ? `precio de: ${faltaPrecio.join(', ')}` : '', !d.items.length ? 'partidas' : ''].filter(Boolean);
      const resp: any = { ok: true, borrador: d, falta };
      if (!falta.length) {
        const clienteTxt = d.newClient?.name || '';
        resp.cliente_resuelto = d.clientId ? 'cliente existente' : `cliente nuevo: ${clienteTxt}`;
        if (!state.extrasAsked && !(d.projectScope && d.technicalNotes) && !WANTS_NOW.test(ctx.userText.slice(0, 120))) {
          state.extrasAsked = true;
          resp.instruccion = 'Cliente y partidas completos. Responde SOLO con una pregunta corta: si quiere agregar alcance del proyecto y/o notas tecnicas, o generarla asi ("genérala"). No llames crear_cotizacion todavia.';
        } else {
          resp.instruccion = 'Ya esta completo: llama crear_cotizacion.';
        }
      }
      return resp;
    }

    if (name === 'crear_cotizacion') {
      const d = state.draft;
      const client = (d.clientId || d.newClient) ? { clientId: d.clientId, newClient: d.newClient } : null;
      const faltan: string[] = [];
      if (!client) faltan.push('cliente');
      if (!d.items.length) faltan.push('partidas');
      const sinPrecio = d.items.filter(i => !(i.precioUnitario > 0));
      if (sinPrecio.length) faltan.push(`precio de ${sinPrecio.map(i => i.nombre).join(', ')}`);
      if (faltan.length) return { error: `Falta: ${faltan.join('; ')}. Pidelo al vendedor en una frase corta.` };

      const hasBoth = !!(d.projectScope && d.technicalNotes);
      if (!state.extrasAsked && !hasBoth && !WANTS_NOW.test(ctx.userText.slice(0, 120))) {
        state.extrasAsked = true;
        return { falta_preguntar: true, instruccion: 'Antes de generar, pregunta UNA sola vez al vendedor si quiere agregar alcance del proyecto y/o notas tecnicas (o "genérala así"). Cuando conteste (aunque sea "no"), vuelve a llamar crear_cotizacion.' };
      }
      const cl = await resolveClient(ctx, client!);
      if (!cl) return { error: 'No pude resolver el cliente.' };
      const items = applyAdjustment(d.items, a.ajuste);
      const res = await createQuoteFrom(ctx, cl, items, { projectType: d.projectType, projectScope: d.projectScope, technicalNotes: d.technicalNotes, conditions: d.conditions }, 'crear_cotizacion');
      state.draft = emptyDraft(); state.extrasAsked = false;
      return { creada: true, ...res, instruccion: 'El PDF ya se envio. Responde solo con una linea corta de cierre (no repitas los totales).' };
    }

    if (name === 'duplicar_cotizacion') {
      const q = await findQuote(db, a.folio);
      if (!q) return { error: `No encontre la cotizacion ${a.folio}.` };
      let cl: any = null;
      if (a.cliente_id) cl = await resolveClient(ctx, { clientId: String(a.cliente_id), newClient: null });
      else if (a.cliente_nuevo?.nombre) {
        const snap = await db.collection('clients').get();
        const n = norm(a.cliente_nuevo.nombre);
        const dup = snap.docs.find((x: any) => { const c = x.data(); return norm(c.name) === n || norm(c.company) === n; });
        cl = await resolveClient(ctx, dup ? { clientId: dup.id, newClient: null } : { clientId: null, newClient: { name: String(a.cliente_nuevo.nombre), phone: String(a.cliente_nuevo.telefono || ''), company: String(a.cliente_nuevo.empresa || '') } });
      } else cl = { id: '', name: q.data.clientName, company: q.data.clientCompany, phone: q.data.clientPhone || '' };
      if (!cl) return { error: 'No pude resolver el cliente destino.' };
      const items = applyAdjustment(docItemsToSimple(q.data), a.ajuste);
      const res = await createQuoteFrom(ctx, cl, items, {
        projectType: q.data.projectType, projectScope: a.alcance || q.data.projectScope, technicalNotes: a.notas_tecnicas || q.data.technicalNotes, conditions: q.data.conditions
      }, 'duplicar_cotizacion');
      return { creada: true, copiada_de: q.data.quoteNumber, ...res, instruccion: 'El PDF ya se envio. Responde solo con una linea corta de cierre.' };
    }

    if (name === 'ver_agenda') {
      const desde = validDate(a.desde) ? a.desde : todayMx();
      const hasta = validDate(a.hasta) ? a.hasta : addDaysIso(desde, 7);
      const snap = await db.collection('meetings').where('date', '>=', desde).where('date', '<=', hasta).get();
      const term = norm(a.texto);
      const lista = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((m: any) => a.incluir_canceladas || m.status !== 'Cancelada')
        .filter((m: any) => !a.solo_mias || norm(m.owner) === norm(ctx.senderName))
        .filter((m: any) => !term || term.split(' ').every((t: string) => norm(`${m.clientName} ${m.title}`).includes(t)))
        .sort((x: any, y: any) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`));
      return { desde, hasta, total: lista.length, citas: lista.slice(0, 25).map(meetingLine), instruccion: 'Resume corto, una linea por cita: dia, fecha, hora, cliente y tipo. Si no hay citas, dilo y ofrece agendar.' };
    }

    if (name === 'agendar_cita') {
      if (!validDate(a.fecha)) return { error: 'Falta una fecha valida (YYYY-MM-DD). Pregunta que dia.' };
      const hora = normHora(a.hora);
      if (!hora) return { error: 'Falta una hora valida (HH:MM, 24h). Pregunta a que hora.' };
      const hoy = todayMx();
      if (a.fecha < hoy || (a.fecha === hoy && hora < nowHmMx())) return { error: `Esa fecha/hora ya paso (hoy es ${hoy}, ${diaDe(hoy)}). Confirma la fecha correcta con el vendedor.` };
      if (a.tipo && !CITA_TIPOS.includes(a.tipo)) return { error: `Tipo invalido: ${CITA_TIPOS.join(', ')}` };

      let client: any = null;
      if (a.cliente_id) {
        const s = await db.collection('clients').doc(String(a.cliente_id)).get();
        if (s.exists) client = { id: s.id, ...s.data() };
      }
      if (!client) {
        const matches = await fuzzyClients(db, a.cliente);
        const top = matches[0];
        const tied = matches.filter((x: any) => x.score === top?.score);
        if (top && tied.length > 1) return { error: 'Hay varios clientes parecidos; pregunta cual es.', opciones: tied.slice(0, 5).map((x: any) => ({ id: x.c.id, nombre: x.c.name, empresa: x.c.company })) } as any;
        if (top) client = top.c;
      }
      let creado = false;
      if (!client) {
        const ref = db.collection('clients').doc();
        client = {
          id: ref.id, name: String(a.cliente).trim(), company: String(a.cliente).trim(), phone: a.telefono || '', email: '', rfc: '', contactRole: '', address: '',
          source: 'WhatsApp', status: 'Prospecto', owner: `Ventas (WhatsApp - ${ctx.senderName})`, notes: '', createdAt: new Date().toISOString()
        };
        creado = true;
        if (!a.forzar) {
          const choques0 = await meetingConflicts(db, a.fecha, hora, ctx.senderName);
          if (choques0.length) return { choque: true, citas_en_conflicto: choques0.map(meetingLine), instruccion: 'Avisa del choque de horario y pregunta si la agenda de todos modos u otra hora. Si dice que de todos modos, llama de nuevo con forzar=true.' };
        }
        await ref.set(client);
      }
      if (!a.forzar && !creado) {
        const choques = await meetingConflicts(db, a.fecha, hora, ctx.senderName);
        if (choques.length) return { choque: true, citas_en_conflicto: choques.map(meetingLine), instruccion: 'Avisa del choque de horario y pregunta si la agenda de todos modos u otra hora. Si dice que de todos modos, llama de nuevo con forzar=true.' };
      }
      const tipo = a.tipo || 'Visita tecnica';
      const ref = db.collection('meetings').doc();
      const meeting = {
        id: ref.id, clientId: client.id, clientName: client.company || client.name, title: String(a.titulo || '').trim() || tipo,
        date: a.fecha, time: hora, type: tipo, owner: ctx.senderName, location: String(a.lugar || '').trim() || client.address || '',
        status: 'Programada', notes: String(a.notas || '').trim()
      };
      await ref.set(meeting);
      await audit(ctx, 'agendar_cita', { id: ref.id, cliente: meeting.clientName, fecha: a.fecha, hora });
      return { agendada: true, cliente_nuevo_creado: creado, cita: meetingLine(meeting), instruccion: 'Confirma en una o dos lineas: dia, fecha, hora, cliente y lugar si hay. Si creaste cliente nuevo, mencionalo. No ofrezcas mas de una cosa.' };
    }

    return { error: `Herramienta desconocida: ${name}` };
  } catch (err: any) {
    console.error(`Error en herramienta ${name}:`, err);
    return { error: `Fallo interno en ${name}: ${err?.message || err}` };
  }
};

// ---------------------------------------------------------------------
// Prompt del agente
// ---------------------------------------------------------------------
export const buildSystemPrompt = (state: AgentState, senderName: string) => {
  const hoy = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });
  return `Eres Nova, asistente de TecnoPatch (telecomunicaciones, CCTV, cableado, redes, VoIP, control de acceso; Guadalajara). Hablas por WhatsApp con ${senderName}, del equipo. Tono cercano y directo, espanol de Mexico, mensajes MUY cortos (sin tablas ni markdown pesado). Hoy es ${hoy} (fecha ISO ${todayMx()}).

Entiendes mensajes desordenados, audios y listas pegadas, y los EJECUTAS con tus herramientas, encadenandolas en el mismo turno. Nunca inventes folios, precios, clientes ni totales: salen de las herramientas. Si una herramienta da error, explicalo claro.

COTIZACION NUEVA
- Si piden una cotizacion sin dar datos, pregunta SOLO esto, en 2 lineas: cliente y partidas (producto, cantidad, precio sin IVA). Nada de listas largas de preguntas.
- Cliente: pasa el nombre en cliente_nuevo de actualizar_borrador (el sistema reconoce solo si ya existe en el CRM). Telefono opcional, no lo exijas.
- Cada vez que den datos, llama actualizar_borrador con TODO lo acumulado. Precios SIN IVA (el sistema suma 16%). Cantidad default 1. Si dan precio total de una partida, divide. Si falta un precio, pregunta solo eso.
- Si dan alcance o notas tecnicas, guardalos redactados en espanol profesional (sin cambiar datos). Sigue siempre el campo "instruccion" que devuelvan las herramientas. Un texto largo de "notas" o "en notas:" va en notas_tecnicas completo.
- Con cliente y partidas con precio, llama crear_cotizacion. Si responde falta_preguntar, haz esa pregunta UNA vez y al contestar vuelve a llamarla. Para dejar un subtotal exacto o subir margen usa "ajuste". Tras enviar el PDF, cierra con una linea.

EXISTENTES
- Consultar: buscar_cotizaciones / ver_cotizacion ("la ultima de Kelly" = buscar con "Kelly", primera).
- Modificar (precios, cantidades, partidas, alcance, ajuste): editar_cotizacion NO aplica; muestra el antes/despues corto y pide "si"; con el si, confirmar_accion; con no, cancelar_accion.
- Estatus: cambiar_estatus (con confirmacion). Copiar a otro cliente: duplicar_cotizacion. Reenviar PDF: enviar_pdf. Resumenes/seguimiento: resumen_ventas.
- "esa/la primera": saca el folio de lo hablado; si hay duda, pregunta.

AGENDA (CRM compartido)
- Puedes consultar y agendar citas/visitas: ver_agenda, agendar_cita, modificar_cita. Convierte "manana", "el jueves", "a las 4" a fecha YYYY-MM-DD y hora 24h usando la fecha de hoy. "Proximo jueves" = el jueves que sigue a hoy.
- Para agendar necesitas cliente, dia y hora. Si dan todo en un mensaje, agenda de inmediato. Si falta algo (o solo dicen "ayudame a agendar una cita"), pregunta TODO lo que falta en UN solo mensaje corto, no campo por campo (ej: "Va. Con quien, que dia y a que hora? Si quieres dime tambien el lugar o el motivo"). Lugar y motivo son opcionales, no los exijas. Tipo por defecto: Visita tecnica. Agendar no pide confirmacion (di el resultado); reagendar/cancelar con modificar_cita si pide "si".
- Si agendar_cita avisa choque, preguntalo. Si el cliente no existe, se crea como Prospecto y lo mencionas.

IMAGENES/PDFS llegan como texto entre corchetes: extrae partidas y arma el borrador. No copies m2 salvo que lo pidan. Si los precios ya traen IVA, pregunta.
OTRAS PREGUNTAS (equipos, redes, ventas o cualquier tema): responde util y breve, sin herramientas de cotizaciones ni mostrar historial.

BORRADOR ACTUAL: ${JSON.stringify(state.draft)}
${state.extrasAsked ? 'Ya se pregunto por alcance/notas: no lo repitas.' : ''}
${state.pending ? `PENDIENTE DE CONFIRMAR: ${state.pending.tool} ${JSON.stringify(state.pending.args)}. Si el vendedor dice si: confirmar_accion; si no: cancelar_accion; si pide otra cosa, atiendela.` : ''}`;
};

// ---------------------------------------------------------------------
// Loop del agente con fallback de modelos, limite de tiempo y sin esperas largas
// ---------------------------------------------------------------------
type Msg = { role: 'user' | 'assistant'; content: string };
const MODEL_CHAIN: Array<{ provider: 'groq' | 'gemini'; model: string; reasoning?: 'low' | 'medium' | 'high' }> = [
  { provider: 'groq', model: 'openai/gpt-oss-120b', reasoning: 'low' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  { provider: 'groq', model: 'openai/gpt-oss-20b', reasoning: 'low' },
  { provider: 'gemini', model: 'gemini-3.6-flash' } // respaldo: si Groq esta sin cuota o caido
];

// Prueba cada modelo UNA vez (si hay limite de tokens o falla, pasa de inmediato al siguiente).
const chatWithFallback = async (clients: { groq: any; gemini?: any }, messages: any[], tools: any[], startAt: number, deadline: number) => {
  const errors: string[] = [];
  for (let m = startAt; m < MODEL_CHAIN.length; m++) {
    const remaining = deadline - Date.now();
    if (remaining < 4000) { errors.push('sin tiempo'); break; }
    const { provider, model, reasoning } = MODEL_CHAIN[m];
    const client = clients[provider];
    if (!client) continue; // proveedor no configurado
    try {
      const params: any = { model, messages, tools, tool_choice: 'auto', temperature: 0.2 };
      if (reasoning) params.reasoning_effort = reasoning;
      const res = await client.chat.completions.create(params, { timeout: Math.min(22000, remaining - 2000), maxRetries: 0 });
      return { res, modelIndex: m };
    } catch (err: any) {
      const rawMsg = String((Array.isArray(err?.error) ? err.error[0]?.error?.message : err?.error?.error?.message) || err?.message || err).replace(/\s+/g, ' ');
      const detail = err?.status === 429 ? (/per day|TPD/i.test(rawMsg) ? 'limite diario' : 'limite por minuto') : rawMsg.slice(0, 100);
      console.error(`LLM fallo (${model}) status=${err?.status}:`, detail);
      errors.push(`${model.split('/').pop()}: ${err?.status || 'sin respuesta'} ${detail}`);
    }
  }
  throw new Error(errors.join(' | ') || 'LLM sin respuesta a tiempo');
};

// Atajos SIN LLM para los pasos mas comunes: responder "si/no" a una confirmacion pendiente y
// contestar la pregunta de alcance/notas con un "no / genérala / listo". Asi no dependen del modelo.
export const tryFastPath = async (ctx: AgentCtx): Promise<string | null> => {
  const text = ctx.userText.trim();
  if (text.length > 60 || text.startsWith('[')) return null;
  const { state } = ctx;

  if (/^\s*[¿]?(ayuda|help|men[uú]|comandos|qu[eé] puedes hacer)\s*[?!]*\s*$/i.test(text)) {
    return `Soy Nova, la asistente de TecnoPatch. Puedo:\n- Crear cotizaciones: dime cliente y partidas con precio sin IVA (acepto texto, audios, fotos y PDFs)\n- Duplicar una cotización para otro cliente\n- Editar precios, partidas, alcance o notas (te pido confirmación)\n- Dejar una cotización en un subtotal exacto o subirle un porcentaje\n- Cambiar el estatus y reenviar PDFs\n- Consultar cotizaciones y darte un resumen de ventas\n- Agenda del CRM: agendar visitas y citas, ver tu agenda, reagendar o cancelar (ej: \"agenda a Kelly visita mañana 10am\")\n\nEscribe "cancela" para descartar un borrador.`;
  }

  if (state.pending && Date.now() - state.pending.at < 30 * 60 * 1000 && state.pending.msgId !== ctx.messageId) {
    if (YES.test(text)) {
      const r: any = await executeTool(ctx, 'confirmar_accion', {});
      if (r?.aplicado && r.mensaje) return r.mensaje;
      if (r?.aplicado) return r.pdf_enviado ? `Listo, apliqué el cambio a ${r.folio} y te mandé el PDF actualizado.` : `Listo, apliqué el cambio a ${r.folio}.`;
      return `No pude aplicar el cambio: ${r?.error || 'error desconocido'}`;
    }
    if (/^\s*(no|nel|cancela(r)?|mejor no|d[eé]jalo)(?![a-záéíóúñ])/i.test(text)) {
      await executeTool(ctx, 'cancelar_accion', {});
      return 'Listo, no hice ningún cambio.';
    }
    return null;
  }

  const d = state.draft;
  const complete = !!(d.clientId || d.newClient?.name) && d.items.length > 0 && d.items.every(i => i.precioUnitario > 0);
  if (state.extrasAsked && complete && WANTS_NOW.test(text)) {
    const r: any = await executeTool(ctx, 'crear_cotizacion', {});
    if (r?.creada) return `Listo, ahí tienes la cotización ${r.folio} de ${r.cliente}.`;
    if (r?.error) return `No pude generarla: ${r.error}`;
  }
  return null;
};

export const runAgent = async (clients: { groq: any; gemini?: any }, ctx: AgentCtx, history: Msg[], deadline: number, persist?: () => Promise<void>): Promise<string> => {
  const messages: any[] = [
    { role: 'system', content: buildSystemPrompt(ctx.state, ctx.senderName) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: ctx.userText }
  ];
  const selectedTools = selectTools(ctx.userText, ctx.state);
  let modelIndex = 0;
  let sentPdfFlag = false;
  const origSend = ctx.sendPdf;
  ctx.sendPdf = async (b, f, c) => { sentPdfFlag = true; await origSend(b, f, c); };

  for (let step = 0; step < 7; step++) {
    if (deadline - Date.now() < 5000) {
      return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'Me estoy tardando de mas con eso. Lo que ya me diste quedo guardado: mandame un "listo" y sigo.';
    }
    let result: { res: any; modelIndex: number };
    try {
      result = await chatWithFallback(clients, messages, selectedTools, modelIndex, deadline);
    } catch (e) {
      // un segundo intento completo tras una pausa corta (fallas transitorias o limite por minuto)
      if (deadline - Date.now() > 14000) { await sleep(2500); result = await chatWithFallback(clients, messages, selectedTools, 0, deadline); }
      else throw e;
    }
    const { res, modelIndex: used } = result;
    modelIndex = used;
    const msg = res.choices?.[0]?.message;
    const calls = msg?.tool_calls || [];
    if (!calls.length) {
      const text = String(msg?.content || '').trim();
      if (text) return text;
      return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'No te entendi bien, ¿me lo puedes decir de otra forma?';
    }
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      let args: any = {};
      try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
      const result = await executeTool(ctx, call.function?.name, args);
      console.log(`tool ${call.function?.name}:`, JSON.stringify(args).slice(0, 300), '->', JSON.stringify(result).slice(0, 300));
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function?.name, content: JSON.stringify(result).slice(0, 4000) });
      if (persist) { try { await persist(); } catch (e) { console.error('persist fallo:', e); } }
    }
  }
  return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'Me enrede un poco con esa peticion; ¿me la repites mas cortita?';
};
