import { getNextQuoteNumber } from './quoteNumber.js';
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
  const quoteNumber = await getNextQuoteNumber(ctx.db);
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
    cantidad: { type: 'number', description: 'Si no la dicen, 1' },
    precio_unitario: { type: 'number', description: 'Precio unitario SIN IVA en MXN' }
  },
  required: ['nombre', 'precio_unitario']
};
const ajusteSchema = {
  type: 'object',
  description: 'Ajuste de precios. tipo "margen": sube (valor positivo) o baja (negativo) todos los precios ese porcentaje. tipo "subtotal_objetivo": reacomoda los precios para que el subtotal (sin IVA) quede EXACTO en valor.',
  properties: { tipo: { type: 'string', enum: ['margen', 'subtotal_objetivo'] }, valor: { type: 'number' } },
  required: ['tipo', 'valor']
};

export const TOOLS: any[] = [
  { type: 'function', function: { name: 'buscar_clientes', description: 'Busca clientes en el CRM por nombre o empresa (tolera errores de dedo). Usala SIEMPRE antes de tratar a alguien como cliente nuevo.', parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'buscar_cotizaciones', description: 'Lista cotizaciones existentes (mas recientes primero) filtrando por texto (cliente o folio), estatus y/o dias hacia atras.', parameters: { type: 'object', properties: { texto: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, dias: { type: 'number' }, limite: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ver_cotizacion', description: 'Devuelve el detalle completo de una cotizacion (partidas numeradas, totales, alcance, notas, estatus).', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'actualizar_borrador', description: 'Guarda/actualiza el BORRADOR de una cotizacion NUEVA. Llamala cada vez que el vendedor de datos del cliente, partidas, alcance o notas. "partidas" REEMPLAZA la lista completa (manda todas, las anteriores mas las nuevas o corregidas). Los campos que omitas se conservan. limpiar=true descarta el borrador.', parameters: { type: 'object', properties: { cliente_id: { type: 'string', description: 'id de un cliente existente (de buscar_clientes)' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, tipo_proyecto: { type: 'string' }, alcance: { type: 'string', description: 'Redactado en espanol profesional' }, notas_tecnicas: { type: 'string' }, condiciones: { type: 'array', items: { type: 'string' }, description: 'Condiciones comerciales personalizadas (cada una una linea). Solo si el vendedor las pide; si no, se usan las estandar.' }, partidas: { type: 'array', items: partidaSchema }, limpiar: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'crear_cotizacion', description: 'Genera el PDF de la cotizacion NUEVA con lo que hay en el borrador y lo envia por WhatsApp. Opcionalmente aplica un ajuste de precios (margen o subtotal objetivo). Si aun no se pregunta por alcance/notas, la herramienta te lo indicara.', parameters: { type: 'object', properties: { ajuste: ajusteSchema } } } },
  { type: 'function', function: { name: 'duplicar_cotizacion', description: 'Crea una cotizacion NUEVA copiando las partidas de una existente, para otro cliente (o el mismo), con ajuste de precios opcional. Genera folio nuevo y envia el PDF.', parameters: { type: 'object', properties: { folio: { type: 'string' }, cliente_id: { type: 'string' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, ajuste: ajusteSchema, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'editar_cotizacion', description: 'Modifica una cotizacion EXISTENTE: cambiar precio/cantidad/nombre de partidas (por numero, empezando en 1), agregar o quitar partidas, cambiar alcance/notas, o aplicar un ajuste de precios (margen o subtotal objetivo). NO aplica el cambio: devuelve un resumen "antes/despues" y espera que el vendedor confirme con "si" (entonces usa confirmar_accion).', parameters: { type: 'object', properties: { folio: { type: 'string' }, actualizar: { type: 'array', items: { type: 'object', properties: { partida: { type: 'number' }, nombre: { type: 'string' }, cantidad: { type: 'number' }, precio_unitario: { type: 'number' } }, required: ['partida'] } }, agregar: { type: 'array', items: partidaSchema }, quitar: { type: 'array', items: { type: 'number' }, description: 'Numeros de partida a quitar' }, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' }, ajuste: ajusteSchema, enviar_pdf: { type: 'boolean', description: 'Mandar el PDF actualizado al aplicar (default true)' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'cambiar_estatus', description: 'Cambia el estatus de una cotizacion (Borrador, Enviada, Seguimiento, Aceptada, Rechazada). Pide confirmacion al vendedor antes de aplicar.', parameters: { type: 'object', properties: { folio: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, motivo: { type: 'string', description: 'Motivo si es Rechazada' } }, required: ['folio', 'estatus'] } } },
  { type: 'function', function: { name: 'confirmar_accion', description: 'Aplica la accion pendiente (editar_cotizacion o cambiar_estatus) SOLO cuando el vendedor acaba de contestar que si/confirma en su mensaje mas reciente.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cancelar_accion', description: 'Descarta la accion pendiente cuando el vendedor dice que no o que mejor no.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'enviar_pdf', description: 'Reenvia por WhatsApp el PDF de una cotizacion existente.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'resumen_ventas', description: 'Resumen de cotizaciones de los ultimos N dias (default 7): cantidad y monto por estatus, por vendedor, y cotizaciones estancadas sin cerrar (mas de 5 dias en Borrador/Enviada/Seguimiento).', parameters: { type: 'object', properties: { dias: { type: 'number' } } } } }
];

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

  const preview = {
    folio: q.data.quoteNumber, cliente: q.data.clientCompany || q.data.clientName,
    antes: { ...oldT },
    despues: { ...newT },
    partidas_despues: items.map((i, k) => `${k + 1}. ${i.cantidad}x ${i.nombre} @ ${money(i.precioUnitario)}`),
    otros_cambios: notas
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

const MUTATORS: Record<string, (ctx: AgentCtx, a: any) => Promise<Mutation>> = { editar_cotizacion: planEdit, cambiar_estatus: planStatus };

export const executeTool = async (ctx: AgentCtx, name: string, a: any): Promise<any> => {
  const { db, state } = ctx;
  try {
    // ---- acciones que piden confirmacion ----
    if (MUTATORS[name]) {
      const plan = await MUTATORS[name](ctx, a);
      if ('error' in plan) return plan;
      state.pending = { tool: name, args: a, msgId: ctx.messageId, at: Date.now() };
      return { requiere_confirmacion: true, resumen: plan.preview, instruccion: 'Muestrale al vendedor este antes/despues de forma clara y corta y pidele que conteste "si" para aplicarlo. NO llames confirmar_accion en este mismo turno.' };
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
      const snap = await db.collection('clients').get();
      const tokens = norm(a.texto).split(' ').filter(Boolean);
      const found = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))
        .map((c: any) => {
          const hay = norm(`${c.name} ${c.company}`);
          const score = tokens.length ? tokens.filter(t => hay.includes(t) || (t.length > 4 && hay.split(' ').some((w: string) => w.startsWith(t.slice(0, 4))))).length / tokens.length : 0;
          return { c, score };
        })
        .filter(x => x.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, 6)
        .map(x => ({ id: x.c.id, nombre: x.c.name, empresa: x.c.company, telefono: x.c.phone || '' }));
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
        // si ya existe un cliente con ese nombre, se reutiliza en vez de duplicarlo
        const snap = await db.collection('clients').get();
        const n = norm(a.cliente_nuevo.nombre);
        const dup = snap.docs.find((x: any) => { const c = x.data(); return norm(c.name) === n || norm(c.company) === n; });
        if (dup) { d.clientId = dup.id; d.newClient = null; }
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
      return { ok: true, borrador: d, falta: [!(d.clientId || d.newClient) ? 'cliente' : '', faltaPrecio.length ? `precio de: ${faltaPrecio.join(', ')}` : '', !d.items.length ? 'partidas' : ''].filter(Boolean) };
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
  return `Eres Nova, la asistente inteligente de TecnoPatch (telecomunicaciones, CCTV, cableado estructurado, redes, VoIP, control de acceso; Guadalajara, Mexico). Hablas por WhatsApp con ${senderName}, del equipo de TecnoPatch. Tono natural, cercano y directo, espanol de Mexico, mensajes cortos (es WhatsApp: sin tablas ni markdown pesado; puedes usar listas simples con guion). Hoy es ${hoy}.

Entiendes conversaciones normales aunque sean desordenadas, con errores de dedo, audios transcritos o listas pegadas, y las EJECUTAS usando tus herramientas, encadenando las que hagan falta en el mismo turno. Nunca inventes folios, precios, clientes ni totales: todo dato de cotizaciones sale de las herramientas. Si la herramienta responde con error, explicaselo al vendedor con claridad y di que falta.

COTIZACION NUEVA
1. Cliente: llama buscar_clientes antes de tratar a alguien como nuevo. Si coincide, usa su id. Si no, basta el nombre (telefono opcional: no lo exijas ni lo repitas).
2. Cada vez que te den datos, llama actualizar_borrador con TODO lo acumulado (partidas completas). Precios SIN IVA (el sistema suma 16%). Si dan precio total de una partida y cantidad, divide para el unitario. Cantidad por default 1. Si falta el precio de algo, pregunta solo eso.
3. Redacta el alcance y las notas tecnicas en espanol profesional si el vendedor los da (corrige ortografia sin cambiar datos).
4. Cuando haya cliente y partidas con precio, llama crear_cotizacion. Si responde falta_preguntar, haz esa pregunta (una sola vez) y cuando conteste llama de nuevo crear_cotizacion. Si piden dejar la cotizacion en un subtotal exacto o subir un margen, pasalo en "ajuste" (subtotal_objetivo = subtotal SIN IVA; margen = porcentaje).
5. Despues de que el PDF se envie, cierra con una linea corta.

COTIZACIONES EXISTENTES
- Consultar: buscar_cotizaciones / ver_cotizacion. "La ultima de Kelly" = buscar_cotizaciones con texto "Kelly" y tomar la primera.
- Modificar (precios, cantidades, quitar/agregar partidas, alcance, ajuste de margen o subtotal): editar_cotizacion. Esa herramienta NO aplica nada: te da un antes/despues; muestraselo corto y pide "si". Cuando el vendedor conteste que si, llama confirmar_accion. Si dice que no, cancelar_accion.
- Cambiar estatus (Borrador, Enviada, Seguimiento, Aceptada, Rechazada): cambiar_estatus y confirmar igual.
- Copiar para otro cliente: duplicar_cotizacion (puedes ajustar precios ahi mismo).
- Reenviar PDF: enviar_pdf. Resumenes y seguimiento ("cuanto cotizamos esta semana", "que se quedo sin cerrar"): resumen_ventas.
- Si dice "esa", "la primera", "la anterior", saca el folio de lo que se acaba de hablar; si hay duda, pregunta cual.

IMAGENES Y PDFS: llegan transcritos como texto entre corchetes. Si es una cotizacion de otro proveedor o una lista de productos, extrae partidas (nombre, cantidad, precio) y arma el borrador; no copies datos de metros cuadrados a menos que los pidan. Si los precios del documento ya traen IVA, pregunta si los quiere asi o sin IVA.

PREGUNTAS GENERALES (equipos, instalacion, redes, ventas, o cualquier otra cosa que te pregunten, aunque no tenga que ver con cotizar): contesta de forma util, amable y breve, sin tocar ninguna cotizacion y SIN llamar herramientas de cotizaciones (nunca muestres el historial de cotizaciones si no lo pidieron). Si piden algo que no puedes hacer (por ejemplo borrar cotizaciones), dilo y ofrece lo mas cercano.

BORRADOR ACTUAL (cotizacion nueva en curso): ${JSON.stringify(state.draft)}
${state.extrasAsked ? 'Ya se pregunto por alcance/notas en esta cotizacion: no lo vuelvas a preguntar.' : ''}
${state.pending ? `ACCION PENDIENTE DE CONFIRMACION: ${state.pending.tool} ${JSON.stringify(state.pending.args)}. Si el mensaje del vendedor es un si, llama confirmar_accion; si es un no, cancelar_accion; si pide otra cosa, atiendela.` : ''}`;
};

// ---------------------------------------------------------------------
// Loop del agente con fallback de modelos
// ---------------------------------------------------------------------
type Msg = { role: 'user' | 'assistant'; content: string };
const MODEL_CHAIN: Array<{ model: string; reasoning?: 'low' | 'medium' | 'high' }> = [
  { model: 'openai/gpt-oss-120b', reasoning: 'medium' },
  { model: 'openai/gpt-oss-20b', reasoning: 'medium' },
  { model: 'llama-3.3-70b-versatile' }
];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const chatWithFallback = async (client: any, messages: any[], startAt: number) => {
  let lastError: any = null;
  for (let m = startAt; m < MODEL_CHAIN.length; m++) {
    const { model, reasoning } = MODEL_CHAIN[m];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const params: any = { model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 };
        if (reasoning) params.reasoning_effort = reasoning;
        const res = await client.chat.completions.create(params);
        return { res, modelIndex: m };
      } catch (err: any) {
        lastError = err;
        console.error(`LLM fallo (${model}, intento ${attempt + 1}) status=${err?.status}:`, err?.message || err);
        if (err?.status === 404) break;
        if (err?.status === 429) { await sleep(1200); if (attempt === 0) continue; break; }
        await sleep(500);
      }
    }
  }
  throw lastError || new Error('LLM sin respuesta');
};

export const runAgent = async (client: any, ctx: AgentCtx, history: Msg[]): Promise<string> => {
  const messages: any[] = [
    { role: 'system', content: buildSystemPrompt(ctx.state, ctx.senderName) },
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: ctx.userText }
  ];
  let modelIndex = 0;
  let sentPdfFlag = false;
  const origSend = ctx.sendPdf;
  ctx.sendPdf = async (b, f, c) => { sentPdfFlag = true; await origSend(b, f, c); };

  for (let step = 0; step < 7; step++) {
    const { res, modelIndex: used } = await chatWithFallback(client, messages, modelIndex);
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
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'Me enrede un poco con esa peticion; ¿me la repites mas cortita?';
};
