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

export const TOOLS: any[] = [
  { type: 'function', function: { name: 'buscar_clientes', description: 'Busca clientes por nombre/empresa (tolera errores). Usala antes de tratar a alguien como cliente nuevo.', parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  { type: 'function', function: { name: 'buscar_cotizaciones', description: 'Lista cotizaciones (recientes primero) filtrando por texto (cliente/folio), estatus y/o dias.', parameters: { type: 'object', properties: { texto: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, dias: { type: 'number' }, limite: { type: 'number' } } } } },
  { type: 'function', function: { name: 'ver_cotizacion', description: 'Detalle de una cotizacion: partidas numeradas, totales, alcance, notas, estatus.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'actualizar_borrador', description: 'Guarda el BORRADOR de una cotizacion NUEVA. Llamala cada vez que den cliente, partidas, alcance o notas. "partidas" REEMPLAZA la lista completa. Lo omitido se conserva. limpiar=true lo descarta.', parameters: { type: 'object', properties: { cliente_id: { type: 'string' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, tipo_proyecto: { type: 'string' }, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' }, condiciones: { type: 'array', items: { type: 'string' } }, partidas: { type: 'array', items: partidaSchema }, limpiar: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'crear_cotizacion', description: 'Genera y envia el PDF de la cotizacion NUEVA con el borrador. Opcional: ajuste de precios.', parameters: { type: 'object', properties: { ajuste: ajusteSchema } } } },
  { type: 'function', function: { name: 'duplicar_cotizacion', description: 'Crea cotizacion NUEVA copiando las partidas de otra, para otro cliente, con ajuste opcional. Envia el PDF.', parameters: { type: 'object', properties: { folio: { type: 'string' }, cliente_id: { type: 'string' }, cliente_nuevo: { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, empresa: { type: 'string' } }, required: ['nombre'] }, ajuste: ajusteSchema, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'editar_cotizacion', description: 'Modifica una cotizacion EXISTENTE (partidas por numero desde 1, agregar/quitar, alcance, notas o ajuste). NO aplica: devuelve antes/despues y espera "si" del vendedor (luego confirmar_accion).', parameters: { type: 'object', properties: { folio: { type: 'string' }, actualizar: { type: 'array', items: { type: 'object', properties: { partida: { type: 'number' }, nombre: { type: 'string' }, cantidad: { type: 'number' }, precio_unitario: { type: 'number' } }, required: ['partida'] } }, agregar: { type: 'array', items: partidaSchema }, quitar: { type: 'array', items: { type: 'number' } }, alcance: { type: 'string' }, notas_tecnicas: { type: 'string' }, ajuste: ajusteSchema, enviar_pdf: { type: 'boolean' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'cambiar_estatus', description: 'Cambia estatus de una cotizacion (Borrador, Enviada, Seguimiento, Aceptada, Rechazada). Pide confirmacion.', parameters: { type: 'object', properties: { folio: { type: 'string' }, estatus: { type: 'string', enum: STATUSES }, motivo: { type: 'string' } }, required: ['folio', 'estatus'] } } },
  { type: 'function', function: { name: 'confirmar_accion', description: 'Aplica la accion pendiente SOLO si el ultimo mensaje del vendedor dice que si.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cancelar_accion', description: 'Descarta la accion pendiente si el vendedor dice que no.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'enviar_pdf', description: 'Reenvia el PDF de una cotizacion existente.', parameters: { type: 'object', properties: { folio: { type: 'string' } }, required: ['folio'] } } },
  { type: 'function', function: { name: 'resumen_ventas', description: 'Resumen de los ultimos N dias (default 7): por estatus, por vendedor y cotizaciones estancadas (>5 dias sin cerrar).', parameters: { type: 'object', properties: { dias: { type: 'number' } } } } }
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

const MUTATORS: Record<string, (ctx: AgentCtx, a: any) => Promise<Mutation>> = { editar_cotizacion: planEdit, cambiar_estatus: planStatus };

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
  return `Eres Nova, asistente de TecnoPatch (telecomunicaciones, CCTV, cableado, redes, VoIP, control de acceso; Guadalajara). Hablas por WhatsApp con ${senderName}, del equipo. Tono cercano y directo, espanol de Mexico, mensajes MUY cortos (sin tablas ni markdown pesado). Hoy es ${hoy}.

Entiendes mensajes desordenados, audios y listas pegadas, y los EJECUTAS con tus herramientas, encadenandolas en el mismo turno. Nunca inventes folios, precios, clientes ni totales: salen de las herramientas. Si una herramienta da error, explicalo claro.

COTIZACION NUEVA
- Si piden una cotizacion sin dar datos, pregunta SOLO esto, en 2 lineas: cliente y partidas (producto, cantidad, precio sin IVA). Nada de listas largas de preguntas.
- Cliente: buscar_clientes antes de tratarlo como nuevo (basta el nombre; telefono opcional, no lo exijas).
- Cada vez que den datos, llama actualizar_borrador con TODO lo acumulado. Precios SIN IVA (el sistema suma 16%). Cantidad default 1. Si dan precio total de una partida, divide. Si falta un precio, pregunta solo eso.
- Si dan alcance o notas tecnicas, guardalos redactados en espanol profesional (sin cambiar datos). Un texto largo de "notas" o "en notas:" va en notas_tecnicas completo.
- Con cliente y partidas con precio, llama crear_cotizacion. Si responde falta_preguntar, haz esa pregunta UNA vez y al contestar vuelve a llamarla. Para dejar un subtotal exacto o subir margen usa "ajuste". Tras enviar el PDF, cierra con una linea.

EXISTENTES
- Consultar: buscar_cotizaciones / ver_cotizacion ("la ultima de Kelly" = buscar con "Kelly", primera).
- Modificar (precios, cantidades, partidas, alcance, ajuste): editar_cotizacion NO aplica; muestra el antes/despues corto y pide "si"; con el si, confirmar_accion; con no, cancelar_accion.
- Estatus: cambiar_estatus (con confirmacion). Copiar a otro cliente: duplicar_cotizacion. Reenviar PDF: enviar_pdf. Resumenes/seguimiento: resumen_ventas.
- "esa/la primera": saca el folio de lo hablado; si hay duda, pregunta.

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
const MODEL_CHAIN: Array<{ model: string; reasoning?: 'low' | 'medium' | 'high' }> = [
  { model: 'openai/gpt-oss-120b', reasoning: 'low' },
  { model: 'llama-3.3-70b-versatile' },
  { model: 'openai/gpt-oss-20b', reasoning: 'low' }
];

// Prueba cada modelo UNA vez (si hay limite de tokens o falla, pasa de inmediato al siguiente).
const chatWithFallback = async (client: any, messages: any[], startAt: number, deadline: number) => {
  const errors: string[] = [];
  for (let m = startAt; m < MODEL_CHAIN.length; m++) {
    const remaining = deadline - Date.now();
    if (remaining < 4000) { errors.push('sin tiempo'); break; }
    const { model, reasoning } = MODEL_CHAIN[m];
    try {
      const params: any = { model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2 };
      if (reasoning) params.reasoning_effort = reasoning;
      const res = await client.chat.completions.create(params, { timeout: Math.min(22000, remaining - 2000), maxRetries: 0 });
      return { res, modelIndex: m };
    } catch (err: any) {
      const detail = String(err?.error?.error?.message || err?.message || err).replace(/\s+/g, ' ').slice(0, 160);
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

  if (state.pending && Date.now() - state.pending.at < 30 * 60 * 1000 && state.pending.msgId !== ctx.messageId) {
    if (YES.test(text)) {
      const r: any = await executeTool(ctx, 'confirmar_accion', {});
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

export const runAgent = async (client: any, ctx: AgentCtx, history: Msg[], deadline: number, persist?: () => Promise<void>): Promise<string> => {
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
    if (deadline - Date.now() < 5000) {
      return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'Me estoy tardando de mas con eso. Lo que ya me diste quedo guardado: mandame un "listo" y sigo.';
    }
    const { res, modelIndex: used } = await chatWithFallback(client, messages, modelIndex, deadline);
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
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 4000) });
      if (persist) { try { await persist(); } catch (e) { console.error('persist fallo:', e); } }
    }
  }
  return sentPdfFlag ? 'Listo, ahi te lo mande.' : 'Me enrede un poco con esa peticion; ¿me la repites mas cortita?';
};
