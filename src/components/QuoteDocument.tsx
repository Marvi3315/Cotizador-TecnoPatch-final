import type { QuoteItem } from '../types';

interface QuoteDocumentProps {
  quoteItems: QuoteItem[];
  clientName: string;
  clientCompany: string;
  clientPhone?: string;
  clientEmail?: string;
  clientRfc?: string;
  clientContactRole?: string;
  projectType: string;
  subtotal: number;
  tax: number;
  total: number;
  includeIva: boolean;
  exchangeRate: number;
  projectScope: string;
  quoteNotes?: string;
  showModels: boolean;
  currency: 'MXN' | 'USD';
  quoteNumber: string;
}

export function QuoteDocument({
  quoteItems,
  clientName,
  clientCompany,
  clientPhone = '',
  clientEmail = '',
  clientRfc = '',
  clientContactRole = '',
  projectType,
  subtotal,
  tax,
  total,
  includeIva,
  exchangeRate,
  projectScope,
  quoteNotes = '',
  showModels,
  currency,
  quoteNumber
}: QuoteDocumentProps) {
  const symbol = currency === 'USD' ? 'USD $' : '$';
  const contactLines = [clientContactRole, clientPhone, clientEmail].filter(Boolean);

  return (
    <div className="quote-document w-[21cm] max-w-none text-left bg-white font-sans flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="bg-[#0f172a] text-white py-5 px-8 border-b-4 border-blue-600">
        <div className="flex justify-between items-center gap-8">
          <div className="flex items-center gap-5 min-w-0">
            <div className="w-28 h-[72px] bg-white flex items-center justify-center rounded-lg p-1.5 shadow-sm overflow-hidden shrink-0">
              <img src="/logo.png" alt="TecnoPatch" className="w-full h-full object-contain" />
            </div>

            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight mb-1 whitespace-nowrap">TecnoPatch</h1>
              <p className="text-[#06b6d4] text-[9px] uppercase font-bold tracking-widest mb-1.5">TELECOMUNICACIONES - GUADALAJARA, JAL.</p>
              <div className="text-[10px] text-slate-300 space-y-0.5">
                <p>33 2849-6052 | 322 518-7656 | serviciotecnopatch@gmail.com</p>
                <p>Guadalajara, Jalisco</p>
              </div>
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="text-[#06b6d4] font-bold text-base mb-1">{quoteNumber}</p>
            <p className="text-slate-300 text-xs">{new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p className="text-slate-400 text-[10px] mt-1">Vigencia: 15 dias naturales</p>
          </div>
        </div>
      </div>

      <div className="p-7 flex-col flex overflow-visible">
        <div className="bg-[#0f172a] rounded-lg p-4 mb-6 break-inside-avoid">
          <h4 className="text-[#06b6d4] text-[11px] font-bold uppercase tracking-widest mb-3">Datos del Cliente</h4>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Empresa / Cliente</p>
              <p className="text-white font-bold text-sm">{clientName || 'N/A'}</p>
              {clientCompany && <p className="text-slate-300 text-xs mt-1">{clientCompany}</p>}
            </div>
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">RFC</p>
              <p className="text-white font-bold text-sm">{clientRfc || 'N/A'}</p>
            </div>
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Contacto</p>
              {contactLines.length > 0 ? (
                <div className="space-y-0.5">
                  {contactLines.map((line, index) => (
                    <p key={`${line}-${index}`} className={index === 0 ? 'text-white font-bold text-sm' : 'text-slate-300 text-[11px]'}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-white font-bold text-sm">N/A</p>
              )}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-700/50">
            <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Proyecto / Referencia</p>
            <p className="text-white font-bold text-sm uppercase">{projectType}</p>
          </div>
        </div>

        {projectScope && projectScope.trim() !== '' && (
          <div className="mb-6 p-4 bg-slate-50 border-l-4 border-blue-600 rounded-r-lg break-inside-avoid shadow-sm">
            <h4 className="text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">Alcance y Memorandum del Proyecto</h4>
            <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium italic">
              "{projectScope}"
            </div>
          </div>
        )}

        {quoteNotes && quoteNotes.trim() !== '' && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-lg break-inside-avoid shadow-sm">
            <h4 className="text-blue-700 text-xs font-bold uppercase tracking-widest mb-3">Notas tecnicas y especificaciones</h4>
            <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium">
              {quoteNotes}
            </div>
          </div>
        )}

        <div className="w-full">
          <table className="quote-table w-full text-left border-collapse mb-6 overflow-visible table-fixed">
            <thead>
              <tr className="bg-[#1d4ed8] text-white text-[10px] uppercase tracking-wider">
                <th className="py-2.5 px-2 font-bold rounded-tl-md w-[38px] text-center">#</th>
                <th className="py-2.5 px-2 font-bold">Descripcion / Categoria</th>
                <th className="py-2.5 px-3 text-right font-bold w-[105px]">P.Unit</th>
                <th className="py-2.5 px-2 text-center font-bold w-[58px]">Cant</th>
                <th className="py-2.5 px-3 text-right font-bold rounded-tr-md w-[120px]">Importe</th>
              </tr>
            </thead>
            <tbody>
              {quoteItems.map((item, idx) => (
                <tr key={`${item.product.producto_id}-${idx}`} className="quote-row border-b border-slate-200 text-[12px]">
                  <td className="py-2.5 px-2 align-top text-center font-bold text-blue-600">{idx + 1}</td>
                  <td className="py-3 px-2 align-top">
                    <p className="font-bold text-slate-800 leading-snug break-words pr-3">{item.product.titulo}</p>
                    <p className="text-[9px] text-slate-500 mt-1.5 capitalize font-medium">
                      {item.product.isManual ? (item.product.manualCategory || 'Partida manual') : (item.product.marca || 'Syscom')}
                      {showModels && !item.product.isManual && ` - ${item.product.modelo}`}
                      {showModels && !item.product.isManual && item.product.producto_id && ` [SKU: ${item.product.producto_id}]`}
                      {item.product.isManual && item.product.unit && ` - Unidad: ${item.product.unit}`}
                    </p>
                  </td>
                  <td className="py-2.5 px-3 align-top text-right text-slate-700 whitespace-nowrap">
                    {symbol}{((currency === 'USD' ? item.unitPriceMxn / exchangeRate : item.unitPriceMxn)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-2.5 px-2 align-top text-center font-bold text-blue-600">
                    {item.quantity}{item.product.isManual && item.product.unit ? ` ${item.product.unit}` : ''}
                  </td>
                  <td className="py-2.5 px-3 align-top text-right font-bold text-emerald-600 whitespace-nowrap">
                    {symbol}{((currency === 'USD' ? (item.unitPriceMxn * item.quantity) / exchangeRate : (item.unitPriceMxn * item.quantity))).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="quote-footer break-inside-avoid mt-2">
          <div className="flex items-start justify-between gap-4 pt-5 border-t border-slate-100">
            <div className="w-7/12 pr-3">
              <div className="bg-[#0f172a] rounded-lg p-3.5 text-slate-300">
                <h4 className="text-[#06b6d4] text-[10px] font-bold uppercase tracking-widest mb-2">Notas y Condiciones</h4>
                <ul className="text-[8px] space-y-1 leading-relaxed">
                  <li>- Precios en {currency} {includeIva ? 'incluyen IVA' : 'mas IVA'} - Vigencia 15 dias naturales</li>
                  <li>- Tiempo de entrega: 5-10 dias habiles segun volumen del proyecto</li>
                  <li>- Garantia de instalacion 12 meses - Equipos con garantia del fabricante</li>
                  <li>- Forma de pago: 60% anticipo, 40% contra entrega y pruebas</li>
                  <li>- Se entrega documentacion tecnica (planos, certificaciones, contrasenas)</li>
                  <li>- Soporte tecnico prioritario incluido 30 dias post-instalacion</li>
                </ul>
              </div>
            </div>

            <div className="w-5/12 ml-auto">
              <div className="bg-[#0f172a] border-2 border-[#1d4ed8] rounded-md text-white text-[11px]">
                <div className="flex justify-between py-2 px-3 border-b border-white/10">
                  <span className="text-slate-300">Subtotal:</span>
                  <span className="font-medium">{symbol}{subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-2 px-3 border-b border-white/10">
                  <span className="text-slate-300">IVA (16%):</span>
                  <span className="font-medium">{symbol}{tax.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-3 px-3 items-center bg-black/20">
                  <span className="text-[#06b6d4] font-bold text-sm">TOTAL {currency}:</span>
                  <span className="text-emerald-400 font-bold text-base">{symbol}{total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 flex justify-between px-4 pb-8">
            <div className="w-5/12 text-[10px] text-slate-500">
              <div className="border-b border-blue-200 pb-1 mb-2">Ing. _________________________________________</div>
              <p>Director / Responsable de Proyecto</p>
              <p>TecnoPatch</p>
            </div>
            <div className="w-5/12 text-[10px] text-slate-500">
              <div className="border-b border-blue-200 pb-1 mb-2">
                <span className="font-bold text-blue-800">Firma y Sello del Cliente</span>
              </div>
              <div className="flex items-end mb-2">Nombre y cargo: <div className="flex-1 border-b border-blue-200 ml-2"></div></div>
              <div className="flex items-end">Fecha de aceptacion: <div className="flex-1 border-b border-blue-200 ml-2"></div></div>
            </div>
          </div>

          <div className="bg-[#0f172a] text-center py-2 text-[9px] text-slate-300 tracking-wider rounded-md">
            TecnoPatch - Guadalajara, Jalisco | Documento confidencial | T.C: ${exchangeRate.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
