import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Trash, Upload, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  deleteClientDocument,
  getClientDocumentData,
  getClientFiscal,
  saveClientDocument,
  saveClientFiscal,
  saveSharedClient,
  subscribeToClientDocuments
} from '../sharedStore';
import { DOC_KINDS, FORMAS_PAGO, METODOS_PAGO, REGIMENES, RFC_REGEX, USOS_CFDI } from '../fiscalCatalogs';
import type { ClientDocumentMeta, ClientFiscal, ClientRecord } from '../types';

// Firestore limita cada documento a 1 MB; en base64 un archivo crece ~33%.
const MAX_FILE_BYTES = 700 * 1024;

const emptyFiscal = (client: ClientRecord): ClientFiscal => ({
  id: client.id, rfc: client.rfc || '', razonSocial: client.company || client.name || '', regimenFiscal: '', codigoPostal: '', usoCfdi: 'G03',
  formaPago: '03', metodoPago: 'PUE', emailsFactura: client.email || '', apNombre: '', apEmail: '', apTelefono: '', diasCredito: 0, limiteCredito: 0,
  requiereOrdenCompra: false, portalProveedores: '', notasFacturacion: '', updatedAt: '', updatedBy: ''
});

export const missingFiscalFields = (f: ClientFiscal | null): string[] => {
  if (!f) return ['RFC', 'Razon social', 'Codigo postal', 'Regimen fiscal', 'Uso de CFDI', 'Correo de facturacion'];
  const out: string[] = [];
  if (!RFC_REGEX.test((f.rfc || '').toUpperCase())) out.push('RFC');
  if (!f.razonSocial.trim()) out.push('Razon social');
  if (!/^\d{5}$/.test(f.codigoPostal || '')) out.push('Codigo postal');
  if (!f.regimenFiscal) out.push('Regimen fiscal');
  if (!f.usoCfdi) out.push('Uso de CFDI');
  if (!f.emailsFactura.trim()) out.push('Correo de facturacion');
  return out;
};

const fileToBase64 = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
  reader.readAsDataURL(file);
});

// Si una foto es muy pesada, la reduce (max 1800 px, JPG) hasta que quepa
const shrinkImage = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  for (let i = 0; i < 5; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
    if (blob && blob.size <= MAX_FILE_BYTES) return blob;
    scale *= 0.75;
  }
  throw new Error('La imagen sigue siendo muy pesada');
};

type Props = { client: ClientRecord | null; open: boolean; onOpenChange: (v: boolean) => void; userName: string };

const labelCls = 'mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500';
const selectCls = 'h-10 w-full rounded-md border border-slate-200 px-3 text-sm bg-white';

export function ClientFiscalDialog({ client, open, onOpenChange, userName }: Props) {
  const [fiscal, setFiscal] = useState<ClientFiscal | null>(null);
  const [saved, setSaved] = useState<ClientFiscal | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docs, setDocs] = useState<ClientDocumentMeta[]>([]);
  const [docKind, setDocKind] = useState<string>(DOC_KINDS[0]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !client) return;
    let cancelled = false;
    setLoading(true);
    getClientFiscal(client.id)
      .then(f => { if (!cancelled) { setSaved(f); setFiscal(f || emptyFiscal(client)); } })
      .catch(e => { toast.error(`No se pudieron cargar los datos fiscales: ${e?.message || e}`); if (!cancelled) setFiscal(emptyFiscal(client)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const unsub = subscribeToClientDocuments(client.id, setDocs, e => console.error('docs:', e));
    return () => { cancelled = true; unsub(); };
  }, [open, client?.id]);

  if (!client || !fiscal) {
    return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Datos fiscales</DialogTitle></DialogHeader><p className="text-sm text-slate-500 p-2">{loading ? 'Cargando...' : ''}</p></DialogContent></Dialog>;
  }

  const set = <K extends keyof ClientFiscal>(k: K, v: ClientFiscal[K]) => setFiscal({ ...fiscal, [k]: v });
  const missing = missingFiscalFields(fiscal);
  const hasCsf = docs.some(d => d.kind === 'Constancia de Situacion Fiscal');

  const save = async () => {
    const rfc = fiscal.rfc.trim().toUpperCase();
    if (rfc && !RFC_REGEX.test(rfc)) { toast.error('El RFC no tiene un formato valido (12 o 13 caracteres).'); return; }
    if (fiscal.codigoPostal && !/^\d{5}$/.test(fiscal.codigoPostal)) { toast.error('El codigo postal debe tener 5 digitos.'); return; }
    try {
      setSaving(true);
      const row: ClientFiscal = { ...fiscal, rfc, razonSocial: fiscal.razonSocial.trim(), updatedAt: new Date().toISOString(), updatedBy: userName };
      await saveClientFiscal(row);
      // Mantiene el RFC de la ficha del cliente (lo usan las cotizaciones y el PDF)
      if (rfc && rfc !== (client.rfc || '')) await saveSharedClient({ ...client, rfc });
      setSaved(row); setFiscal(row);
      toast.success('Datos fiscales guardados');
    } catch (e: any) {
      toast.error(`No se pudo guardar: ${e?.message || e}`);
    } finally { setSaving(false); }
  };

  const upload = async (file: File) => {
    try {
      setUploading(true);
      let blob: Blob = file;
      let mime = file.type || 'application/octet-stream';
      let name = file.name;
      if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(mime)) { toast.error('Solo PDF, JPG, PNG o WEBP.'); return; }
      if (blob.size > MAX_FILE_BYTES) {
        if (mime.startsWith('image/')) { blob = await shrinkImage(file); mime = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
        else { toast.error(`El PDF pesa ${(file.size / 1024).toFixed(0)} KB y el maximo es ${MAX_FILE_BYTES / 1024} KB. Comprimelo (por ejemplo con ilovepdf.com) y vuelve a subirlo.`); return; }
      }
      const data = await fileToBase64(blob);
      const id = `doc-${Date.now()}`;
      await saveClientDocument({ id, clientId: client.id, kind: docKind, name, mime, size: blob.size, uploadedAt: new Date().toISOString(), uploadedBy: userName }, data);
      toast.success('Documento guardado');
    } catch (e: any) {
      toast.error(`No se pudo subir: ${e?.message || e}`);
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const download = async (d: ClientDocumentMeta) => {
    try {
      const data = await getClientDocumentData(d.id);
      if (!data) { toast.error('No se encontro el archivo.'); return; }
      const bytes = Uint8Array.from(atob(data.dataBase64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: data.mime }));
      const a = document.createElement('a');
      a.href = url; a.download = d.name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { toast.error(`No se pudo descargar: ${e?.message || e}`); }
  };

  const remove = async (d: ClientDocumentMeta) => {
    if (!window.confirm(`Eliminar "${d.name}"?`)) return;
    try { await deleteClientDocument(d.id); toast.success('Documento eliminado'); }
    catch (e: any) { toast.error(`No se pudo eliminar: ${e?.message || e}`); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="flex items-center gap-2 text-xl font-black"><ShieldCheck size={20} className="text-blue-600" /> Datos fiscales · {client.company || client.name}</DialogTitle>
          <DialogDescription>Para tener a la mano lo que se necesita al facturar. Solo lo ven los roles admin y ventas.</DialogDescription>
        </DialogHeader>

        <div className={`rounded-lg border p-3 text-xs flex items-start gap-2 ${missing.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {missing.length ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
          <span>{missing.length ? <>Faltan para facturar: <b>{missing.join(', ')}</b>.{!hasCsf && ' Tampoco hay Constancia de Situacion Fiscal cargada.'}</> : <>Datos completos para facturar.{!hasCsf && ' Falta cargar la Constancia de Situacion Fiscal.'}</>}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>RFC</label><Input value={fiscal.rfc} placeholder="XAXX010101000" onChange={e => set('rfc', e.target.value.toUpperCase())} /></div>
          <div><label className={labelCls}>Codigo postal fiscal</label><Input value={fiscal.codigoPostal} inputMode="numeric" maxLength={5} placeholder="44100" onChange={e => set('codigoPostal', e.target.value.replace(/\D/g, ''))} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Razon social (exactamente como en la constancia)</label><Input value={fiscal.razonSocial} onChange={e => set('razonSocial', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className={labelCls}>Regimen fiscal</label>
            <select className={selectCls} value={fiscal.regimenFiscal} onChange={e => set('regimenFiscal', e.target.value)}>
              <option value="">Selecciona...</option>
              {REGIMENES.map(([c, n]) => <option key={c} value={c}>{c} - {n}</option>)}
            </select></div>
          <div><label className={labelCls}>Uso de CFDI</label>
            <select className={selectCls} value={fiscal.usoCfdi} onChange={e => set('usoCfdi', e.target.value)}>
              {USOS_CFDI.map(([c, n]) => <option key={c} value={c}>{c} - {n}</option>)}
            </select></div>
          <div><label className={labelCls}>Correo(s) para enviar la factura</label><Input value={fiscal.emailsFactura} placeholder="facturas@empresa.com, otro@empresa.com" onChange={e => set('emailsFactura', e.target.value)} /></div>
          <div><label className={labelCls}>Forma de pago</label>
            <select className={selectCls} value={fiscal.formaPago} onChange={e => set('formaPago', e.target.value)}>
              {FORMAS_PAGO.map(([c, n]) => <option key={c} value={c}>{c} - {n}</option>)}
            </select></div>
          <div><label className={labelCls}>Metodo de pago</label>
            <select className={selectCls} value={fiscal.metodoPago} onChange={e => set('metodoPago', e.target.value)}>
              {METODOS_PAGO.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select></div>
        </div>

        <h3 className="mt-2 text-sm font-black text-slate-800">Cobranza y proveedores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className={labelCls}>Contacto cuentas por pagar</label><Input value={fiscal.apNombre} onChange={e => set('apNombre', e.target.value)} /></div>
          <div><label className={labelCls}>Correo</label><Input value={fiscal.apEmail} onChange={e => set('apEmail', e.target.value)} /></div>
          <div><label className={labelCls}>Telefono</label><Input value={fiscal.apTelefono} onChange={e => set('apTelefono', e.target.value)} /></div>
          <div><label className={labelCls}>Dias de credito</label><Input type="number" min={0} value={fiscal.diasCredito || ''} placeholder="0 = contado" onChange={e => set('diasCredito', Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><label className={labelCls}>Limite de credito (MXN)</label><Input type="number" min={0} value={fiscal.limiteCredito || ''} onChange={e => set('limiteCredito', Math.max(0, Number(e.target.value) || 0))} /></div>
          <div className="flex items-end"><label className="flex items-center gap-2 h-10 text-sm font-bold text-slate-700"><input type="checkbox" checked={fiscal.requiereOrdenCompra} onChange={e => set('requiereOrdenCompra', e.target.checked)} /> Exige orden de compra</label></div>
          <div className="sm:col-span-3"><label className={labelCls}>Portal de proveedores (liga, usuario, quien lo administra)</label><Input value={fiscal.portalProveedores} onChange={e => set('portalProveedores', e.target.value)} /></div>
          <div className="sm:col-span-3"><label className={labelCls}>Notas de facturacion</label>
            <textarea className="w-full min-h-[70px] rounded-lg border border-slate-200 p-3 text-sm outline-none focus:ring-1 focus:ring-blue-600" placeholder="Ej. factura por sucursal, un solo pago mensual, enviar el XML y PDF juntos..." value={fiscal.notasFacturacion} onChange={e => set('notasFacturacion', e.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400">{saved?.updatedAt ? `Ultima actualizacion: ${new Date(saved.updatedAt).toLocaleString('es-MX')} · ${saved.updatedBy}` : 'Aun sin guardar'}</span>
          <Button onClick={save} disabled={saving || loading}>{saving ? 'Guardando...' : 'Guardar datos fiscales'}</Button>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-sm font-black text-slate-800">Documentos del cliente</h3>
          <p className="text-[11px] text-slate-400 mb-2">PDF, JPG o PNG de hasta {MAX_FILE_BYTES / 1024} KB (las fotos se reducen solas).</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select className={selectCls + ' sm:max-w-xs'} value={docKind} onChange={e => setDocKind(e.target.value)}>
              {DOC_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <Button variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}><Upload size={14} className="mr-2" />{uploading ? 'Subiendo...' : 'Subir archivo'}</Button>
          </div>
          <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
            {docs.length === 0 ? <p className="p-4 text-center text-xs text-slate-400 font-bold">Sin documentos todavia.</p> : docs.map(d => (
              <div key={d.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><FileText size={14} className="text-slate-400 shrink-0" /><span className="text-sm font-bold text-slate-800 truncate">{d.name}</span><Badge variant="secondary" className="text-[10px]">{d.kind}</Badge></div>
                  <p className="text-[11px] text-slate-400">{(d.size / 1024).toFixed(0)} KB · {new Date(d.uploadedAt).toLocaleDateString('es-MX')} · {d.uploadedBy}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" title="Descargar" onClick={() => download(d)}><Download size={15} /></Button>
                  <Button variant="ghost" size="icon" title="Eliminar" className="text-slate-400 hover:text-red-600" onClick={() => remove(d)}><Trash size={15} /></Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
