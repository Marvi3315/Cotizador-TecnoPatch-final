import React, { useEffect, useMemo, useState } from 'react';
import { Download, Pencil, Plus, Trash, Wallet, AlertTriangle, Clock3, CheckCircle2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deleteInvoice, saveInvoice, subscribeToAllClientFiscal, subscribeToInvoices } from '../sharedStore';
import type { ClientFiscal, ClientRecord, InvoiceRecord, InvoiceStatus, QuoteHistoryItem } from '../types';

const STATUSES: InvoiceStatus[] = ['Emitida', 'Enviada', 'Parcial', 'Pagada', 'Cancelada'];
type ViewStatus = InvoiceStatus | 'Vencida';

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const mxn = (n: number) => (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const todayIso = () => new Date().toLocaleDateString('en-CA');
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);

const saldoOf = (i: InvoiceRecord) => (i.status === 'Cancelada' ? 0 : Math.max(0, round2((i.total || 0) - (i.paidAmount || 0))));
const viewStatus = (i: InvoiceRecord, today: string): ViewStatus => {
  if (i.status === 'Cancelada') return 'Cancelada';
  if (saldoOf(i) <= 0.009) return 'Pagada';
  if (i.dueDate && i.dueDate < today) return 'Vencida';
  return i.status === 'Pagada' ? 'Parcial' : i.status;
};
const badgeCls: Record<ViewStatus, string> = {
  Emitida: 'bg-slate-100 text-slate-700 border-slate-200',
  Enviada: 'bg-blue-50 text-blue-700 border-blue-100',
  Parcial: 'bg-amber-50 text-amber-700 border-amber-100',
  Pagada: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  Cancelada: 'bg-slate-100 text-slate-400 border-slate-200 line-through',
  Vencida: 'bg-red-50 text-red-700 border-red-100'
};

const blank = (): InvoiceRecord => ({
  id: '', folio: '', uuid: '', clientId: '', clientName: '', quoteNumber: '', orderNumber: '', issueDate: todayIso(), dueDate: todayIso(),
  subtotal: 0, total: 0, paidAmount: 0, paidDate: '', status: 'Emitida', paymentComplement: false, notes: '', createdAt: '', updatedAt: '', updatedBy: ''
});

const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500';
const selectCls = 'h-10 w-full rounded-md border border-slate-200 px-3 text-sm bg-white';

type Props = { clients: ClientRecord[]; quotes: QuoteHistoryItem[]; userName: string };

export function InvoicesModule({ clients, quotes, userName }: Props) {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [fiscal, setFiscal] = useState<Record<string, ClientFiscal>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'Todas' | 'Abiertas' | ViewStatus>('Abiertas');
  const [form, setForm] = useState<InvoiceRecord | null>(null);
  const [totalTouched, setTotalTouched] = useState(false);
  const [dueTouched, setDueTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = todayIso();

  useEffect(() => {
    const u1 = subscribeToInvoices(setInvoices, e => toast.error(`No se pudieron cargar las facturas: ${e.message}`));
    const u2 = subscribeToAllClientFiscal(rows => setFiscal(Object.fromEntries(rows.map(r => [r.id, r]))), e => console.error('fiscal:', e));
    return () => { u1(); u2(); };
  }, []);

  const rows = useMemo(() => invoices.map(i => ({ i, st: viewStatus(i, today), saldo: saldoOf(i) })), [invoices, today]);

  const stats = useMemo(() => {
    const open = rows.filter(r => r.st !== 'Pagada' && r.st !== 'Cancelada');
    const overdue = open.filter(r => r.st === 'Vencida');
    const soon = open.filter(r => r.st !== 'Vencida' && r.i.dueDate && daysBetween(today, r.i.dueDate) <= 7);
    const month = today.slice(0, 7);
    const paidMonth = rows.filter(r => r.i.paidDate && r.i.paidDate.startsWith(month)).reduce((s, r) => s + (r.i.paidAmount || 0), 0);
    return {
      porCobrar: open.reduce((s, r) => s + r.saldo, 0), openCount: open.length,
      vencido: overdue.reduce((s, r) => s + r.saldo, 0), vencidoCount: overdue.length,
      porVencer: soon.reduce((s, r) => s + r.saldo, 0), porVencerCount: soon.length, paidMonth
    };
  }, [rows, today]);

  const visible = rows.filter(r => {
    if (filter === 'Abiertas' && (r.st === 'Pagada' || r.st === 'Cancelada')) return false;
    if (filter !== 'Todas' && filter !== 'Abiertas' && r.st !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || `${r.i.folio} ${r.i.clientName} ${r.i.quoteNumber} ${r.i.uuid} ${r.i.orderNumber}`.toLowerCase().includes(q);
  }).sort((a, b) => (a.i.dueDate || '9999').localeCompare(b.i.dueDate || '9999'));

  const openNew = () => { setForm({ ...blank(), id: `inv-${Date.now()}` }); setTotalTouched(false); setDueTouched(false); };
  const openEdit = (i: InvoiceRecord) => { setForm({ ...i }); setTotalTouched(true); setDueTouched(true); };

  const patch = (p: Partial<InvoiceRecord>) => setForm(f => f ? { ...f, ...p } : f);
  const setClient = (id: string) => {
    const c = clients.find(x => x.id === id);
    const days = fiscal[id]?.diasCredito || 0;
    setForm(f => f ? { ...f, clientId: id, clientName: c ? (c.company || c.name) : '', dueDate: dueTouched ? f.dueDate : addDays(f.issueDate, days) } : f);
  };
  const setIssue = (d: string) => setForm(f => f ? { ...f, issueDate: d, dueDate: dueTouched ? f.dueDate : addDays(d, fiscal[f.clientId]?.diasCredito || 0) } : f);
  const setSubtotal = (v: number) => setForm(f => f ? { ...f, subtotal: v, total: totalTouched ? f.total : round2(v * 1.16) } : f);

  const save = async () => {
    if (!form) return;
    if (!form.folio.trim()) { toast.error('Agrega el folio de la factura.'); return; }
    if (!form.clientId) { toast.error('Elige el cliente.'); return; }
    if (!(form.total > 0)) { toast.error('El total debe ser mayor a 0.'); return; }
    if (invoices.some(i => i.id !== form.id && i.folio.trim().toLowerCase() === form.folio.trim().toLowerCase() && i.clientId === form.clientId)) {
      toast.error('Ya existe una factura con ese folio para este cliente.'); return;
    }
    const paid = Math.min(round2(form.paidAmount || 0), form.total);
    let status = form.status;
    if (status !== 'Cancelada') {
      if (paid >= form.total - 0.009) status = 'Pagada';
      else if (paid > 0) status = 'Parcial';
      else if (status === 'Pagada' || status === 'Parcial') status = 'Emitida';
    }
    const now = new Date().toISOString();
    const row: InvoiceRecord = { ...form, folio: form.folio.trim(), uuid: form.uuid.trim().toUpperCase(), paidAmount: paid, status, paidDate: paid > 0 ? (form.paidDate || today) : '', createdAt: form.createdAt || now, updatedAt: now, updatedBy: userName };
    try { setSaving(true); await saveInvoice(row); toast.success('Factura guardada'); setForm(null); }
    catch (e: any) { toast.error(`No se pudo guardar: ${e?.message || e}`); }
    finally { setSaving(false); }
  };

  const registerPayment = async (i: InvoiceRecord) => {
    const saldo = saldoOf(i);
    const raw = window.prompt(`Monto del pago para ${i.folio} (saldo ${mxn(saldo)}):`, String(saldo));
    if (raw === null) return;
    const amount = round2(Number(raw.replace(/[$,\s]/g, '')));
    if (!(amount > 0)) { toast.error('Monto invalido.'); return; }
    if (amount > saldo + 0.009) { toast.error(`El pago (${mxn(amount)}) es mayor al saldo (${mxn(saldo)}).`); return; }
    const paid = round2((i.paidAmount || 0) + amount);
    try {
      await saveInvoice({ ...i, paidAmount: paid, paidDate: today, status: paid >= i.total - 0.009 ? 'Pagada' : 'Parcial', updatedAt: new Date().toISOString(), updatedBy: userName });
      toast.success(paid >= i.total - 0.009 ? `${i.folio} pagada` : `Pago registrado, saldo ${mxn(i.total - paid)}`);
    } catch (e: any) { toast.error(`No se pudo registrar el pago: ${e?.message || e}`); }
  };

  const remove = async (i: InvoiceRecord) => {
    if (!window.confirm(`Eliminar la factura ${i.folio} de ${i.clientName}? Si solo se cancelo, mejor cambia su estatus a Cancelada.`)) return;
    try { await deleteInvoice(i.id); toast.success('Factura eliminada'); } catch (e: any) { toast.error(`No se pudo eliminar: ${e?.message || e}`); }
  };

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Folio', 'UUID', 'Cliente', 'Cotizacion', 'Orden de compra', 'Emision', 'Vencimiento', 'Subtotal', 'Total', 'Pagado', 'Saldo', 'Estatus', 'Fecha de pago', 'Complemento de pago', 'Notas'];
    const lines = rows.map(r => [r.i.folio, r.i.uuid, r.i.clientName, r.i.quoteNumber, r.i.orderNumber, r.i.issueDate, r.i.dueDate, r.i.subtotal, r.i.total, r.i.paidAmount, r.saldo, r.st, r.i.paidDate, r.i.paymentComplement ? 'Si' : 'No', r.i.notes].map(esc).join(','));
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `seguimiento-facturas-${today}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const clientQuotes = form ? quotes.filter(q => (q as any).quoteNumber && (q.clientCompany === form.clientName || q.clientName === form.clientName)) : [];
  const card = 'rounded-xl border bg-white p-4 shadow-sm';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className={card}><p className={labelCls}>Por cobrar</p><p className="text-xl font-black text-slate-900">{mxn(stats.porCobrar)}</p><p className="text-xs text-slate-500">{stats.openCount} facturas abiertas</p></div>
        <div className={`${card} ${stats.vencidoCount ? 'border-red-200' : ''}`}><p className={`${labelCls} flex items-center gap-1`}><AlertTriangle size={11} /> Vencido</p><p className={`text-xl font-black ${stats.vencidoCount ? 'text-red-600' : 'text-slate-900'}`}>{mxn(stats.vencido)}</p><p className="text-xs text-slate-500">{stats.vencidoCount} facturas</p></div>
        <div className={card}><p className={`${labelCls} flex items-center gap-1`}><Clock3 size={11} /> Vence en 7 dias</p><p className="text-xl font-black text-amber-600">{mxn(stats.porVencer)}</p><p className="text-xs text-slate-500">{stats.porVencerCount} facturas</p></div>
        <div className={card}><p className={`${labelCls} flex items-center gap-1`}><CheckCircle2 size={11} /> Cobrado este mes</p><p className="text-xl font-black text-emerald-600">{mxn(stats.paidMonth)}</p></div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
          <div className="flex gap-2 flex-1 flex-col sm:flex-row">
            <div className="relative flex-1 max-w-sm"><Search size={14} className="absolute left-3 top-3 text-slate-400" /><Input className="pl-9" placeholder="Buscar folio, cliente, cotizacion, UUID..." value={search} onChange={e => setSearch(e.target.value)} /></div>
            <select className={selectCls + ' sm:max-w-[180px]'} value={filter} onChange={e => setFilter(e.target.value as any)}>
              {['Abiertas', 'Todas', 'Vencida', 'Emitida', 'Enviada', 'Parcial', 'Pagada', 'Cancelada'].map(s => <option key={s} value={s}>{s === 'Abiertas' ? 'Abiertas (por cobrar)' : s}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download size={14} className="mr-2" />Descargar Excel (CSV)</Button>
            <Button onClick={openNew}><Plus size={14} className="mr-2" />Nueva factura</Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="p-10 text-center text-slate-400 font-bold">{rows.length ? 'No hay facturas con ese filtro.' : 'Aun no hay facturas registradas. Agrega la primera con "Nueva factura".'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr><th className="p-3 text-left">Folio</th><th className="p-3 text-left">Cliente</th><th className="p-3 text-left">Vence</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Saldo</th><th className="p-3 text-left">Estatus</th><th className="p-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(({ i, st, saldo }) => {
                  const d = i.dueDate ? daysBetween(today, i.dueDate) : null;
                  return (
                    <tr key={i.id} className="hover:bg-slate-50">
                      <td className="p-3"><div className="font-black text-slate-900">{i.folio}</div>{i.quoteNumber && <div className="text-[11px] text-slate-400">{i.quoteNumber}</div>}</td>
                      <td className="p-3 text-slate-700">{i.clientName}</td>
                      <td className="p-3 whitespace-nowrap"><div>{i.dueDate || '-'}</div>{d !== null && saldo > 0 && st !== 'Cancelada' && <div className={`text-[11px] font-bold ${d < 0 ? 'text-red-600' : d <= 7 ? 'text-amber-600' : 'text-slate-400'}`}>{d < 0 ? `${-d} d vencida` : d === 0 ? 'vence hoy' : `en ${d} d`}</div>}</td>
                      <td className="p-3 text-right whitespace-nowrap">{mxn(i.total)}</td>
                      <td className="p-3 text-right whitespace-nowrap font-bold">{mxn(saldo)}</td>
                      <td className="p-3"><Badge className={`text-[10px] ${badgeCls[st]}`}>{st}</Badge>{i.paymentComplement && <Badge variant="secondary" className="ml-1 text-[10px]">Compl.</Badge>}</td>
                      <td className="p-3"><div className="flex gap-1 justify-end">
                        {saldo > 0 && <Button variant="outline" size="sm" title="Registrar pago" onClick={() => registerPayment(i)}><Wallet size={13} className="mr-1" />Pago</Button>}
                        <Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(i)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" title="Eliminar" className="text-slate-400 hover:text-red-600" onClick={() => remove(i)}><Trash size={15} /></Button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!form} onOpenChange={o => { if (!o) setForm(null); }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl">
          <DialogHeader className="pr-10"><DialogTitle className="text-xl font-black">{form && invoices.some(i => i.id === form.id) ? 'Editar factura' : 'Nueva factura'}</DialogTitle><DialogDescription>Registra la factura que emitiste en tu sistema de facturacion.</DialogDescription></DialogHeader>
          {form && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={labelCls}>Folio de la factura</label><Input value={form.folio} onChange={e => patch({ folio: e.target.value })} /></div>
              <div><label className={labelCls}>UUID / Folio fiscal (opcional)</label><Input value={form.uuid} onChange={e => patch({ uuid: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={labelCls}>Cliente</label>
                <select className={selectCls} value={form.clientId} onChange={e => setClient(e.target.value)}>
                  <option value="">Selecciona...</option>
                  {[...clients].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name)).map(c => <option key={c.id} value={c.id}>{c.company || c.name}</option>)}
                </select>
                {form.clientId && fiscal[form.clientId]?.diasCredito ? <p className="mt-1 text-[11px] text-slate-400">Credito del cliente: {fiscal[form.clientId].diasCredito} dias{fiscal[form.clientId].requiereOrdenCompra ? ' · exige orden de compra' : ''}</p> : null}
              </div>
              <div><label className={labelCls}>Cotizacion relacionada</label><Input list="inv-quotes" value={form.quoteNumber} placeholder="COT-2026-0001" onChange={e => patch({ quoteNumber: e.target.value })} />
                <datalist id="inv-quotes">{clientQuotes.map(q => <option key={q.id} value={(q as any).quoteNumber} />)}</datalist></div>
              <div><label className={labelCls}>Orden de compra del cliente</label><Input value={form.orderNumber} onChange={e => patch({ orderNumber: e.target.value })} /></div>
              <div><label className={labelCls}>Fecha de emision</label><Input type="date" value={form.issueDate} onChange={e => setIssue(e.target.value)} /></div>
              <div><label className={labelCls}>Fecha de vencimiento</label><Input type="date" value={form.dueDate} onChange={e => { setDueTouched(true); patch({ dueDate: e.target.value }); }} /></div>
              <div><label className={labelCls}>Subtotal (sin IVA)</label><Input type="number" min={0} step="0.01" value={form.subtotal || ''} onChange={e => setSubtotal(Number(e.target.value) || 0)} /></div>
              <div><label className={labelCls}>Total (con IVA)</label><Input type="number" min={0} step="0.01" value={form.total || ''} onChange={e => { setTotalTouched(true); patch({ total: Number(e.target.value) || 0 }); }} /></div>
              <div><label className={labelCls}>Monto pagado / anticipo</label><Input type="number" min={0} step="0.01" value={form.paidAmount || ''} onChange={e => patch({ paidAmount: Number(e.target.value) || 0 })} /></div>
              <div><label className={labelCls}>Fecha de pago</label><Input type="date" value={form.paidDate} onChange={e => patch({ paidDate: e.target.value })} /></div>
              <div><label className={labelCls}>Estatus</label>
                <select className={selectCls} value={form.status} onChange={e => patch({ status: e.target.value as InvoiceStatus })}>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <p className="mt-1 text-[11px] text-slate-400">Pagada, Parcial y Vencida se ajustan solas segun el pago y la fecha.</p></div>
              <div className="flex items-center"><label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={form.paymentComplement} onChange={e => patch({ paymentComplement: e.target.checked })} /> Ya se emitio complemento de pago</label></div>
              <div className="sm:col-span-2"><label className={labelCls}>Notas (motivo de cancelacion, acuerdos de pago...)</label>
                <textarea className="w-full min-h-[70px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" value={form.notes} onChange={e => patch({ notes: e.target.value })} /></div>
              <div className="sm:col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar factura'}</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
