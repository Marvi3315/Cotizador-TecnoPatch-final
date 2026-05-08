import type { QuoteItem } from '../types';

interface QuoteDocumentProps {
  quoteItems: QuoteItem[];
  clientName: string;
  clientCompany: string;
  projectType: string;
  subtotal: number;
  tax: number;
  total: number;
  includeIva: boolean;
  exchangeRate: number;
  projectScope: string;
  showModels: boolean;
  currency: 'MXN' | 'USD';
  quoteNumber: string;
}

export function QuoteDocument({
  quoteItems,
  clientName,
  clientCompany,
  projectType,
  subtotal,
  tax,
  total,
  includeIva,
  exchangeRate,
  projectScope,
  showModels,
  currency,
  quoteNumber
}: QuoteDocumentProps) {
  const symbol = currency === 'USD' ? 'USD $' : '$';

  return (
    <div className="w-full text-left bg-white font-sans flex flex-col" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="bg-[#0f172a] text-white py-6 px-8 border-b-4 border-blue-600">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div className="w-32 h-20 bg-white flex items-center justify-center rounded-lg p-1.5 shadow-sm overflow-hidden shrink-0">
              <img src="/logo.png" alt="TecnoPatch" className="w-full h-full object-contain" />
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-1">TecnoPatch</h1>
              <p className="text-[#06b6d4] text-[9px] uppercase font-bold tracking-widest mb-1.5">TELECOMUNICACIONES - GUADALAJARA, JAL.</p>
              <div className="text-[10px] text-slate-300 space-y-0.5">
                <p>33 2849-6052 | 322 518-7656 | serviciotecnopatch@gmail.com</p>
                <p>Guadalajara, Jalisco</p>
              </div>
            </div>
          </div>

          <div className="text-right">
            <p className="text-[#06b6d4] font-bold text-base mb-1">{quoteNumber}</p>
            <p className="text-slate-300 text-xs">{new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            <p className="text-slate-400 text-[10px] mt-1">Vigencia: 15 dias naturales</p>
          </div>
        </div>
      </div>

      <div className="p-8 flex-col flex overflow-visible">
        <div className="bg-[#0f172a] rounded-xl p-5 mb-8 break-inside-avoid">
          <h4 className="text-[#06b6d4] text-xs font-bold uppercase tracking-widest mb-4">Datos del Cliente</h4>
          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Empresa / Cliente</p>
              <p className="text-white font-bold text-sm">{clientName || 'N/A'}</p>
              {clientCompany && <p className="text-slate-300 text-xs mt-1">{clientCompany}</p>}
            </div>
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">RFC</p>
              <p className="text-white font-bold text-sm">N/A</p>
            </div>
            <div>
              <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Contacto</p>
              <p className="text-white font-bold text-sm">N/A</p>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-700/50">
            <p className="text-blue-500 text-[10px] font-bold uppercase tracking-wider mb-2">Proyecto / Referencia</p>
            <p className="text-white font-bold text-sm uppercase">{projectType}</p>
          </div>
        </div>

        {projectScope && projectScope.trim() !== '' && (
          <div className="mb-8 p-6 bg-slate-50 border-l-4 border-blue-600 rounded-r-xl break-inside-avoid shadow-sm">
            <h4 className="text-blue-600 text-xs font-bold uppercase tracking-widest mb-3">Alcance y Memorandum del Proyecto</h4>
            <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium italic">
              "{projectScope}"
            </div>
          </div>
        )}

        <div className="w-full">
          <table className="w-full text-left border-collapse mb-10 overflow-visible">
            <thead>
              <tr className="bg-[#1d4ed8] text-white text-xs uppercase tracking-wider">
                <th className="py-3 px-4 font-bold rounded-tl-md w-12 text-center">#</th>
                <th className="py-3 px-2 font-bold">Descripcion / Categoria</th>
                <th className="py-3 px-4 text-right font-bold w-32">P.Unit</th>
                <th className="py-3 px-4 text-center font-bold w-20">Cant</th>
                <th className="py-3 px-4 text-right font-bold rounded-tr-md w-36">Importe</th>
              </tr>
            </thead>
            <tbody>
              {quoteItems.map((item, idx) => (
                <tr key={`${item.product.producto_id}-${idx}`} className="border-b border-slate-200 text-sm">
                  <td className="py-3 px-4 align-top text-center font-bold text-blue-600">{idx + 1}</td>
                  <td className="py-3 px-2 align-top">
                    <p className="font-bold text-slate-800 leading-snug break-words pr-4">{item.product.titulo}</p>
                    <p className="text-[10px] text-slate-500 mt-2 capitalize font-medium">
                      {item.product.isManual ? (item.product.manualCategory || 'Partida manual') : (item.product.marca || 'Syscom')}
                      {showModels && !item.product.isManual && ` - ${item.product.modelo}`}
                      {showModels && !item.product.isManual && item.product.producto_id && ` [SKU: ${item.product.producto_id}]`}
                      {item.product.isManual && item.product.unit && ` - Unidad: ${item.product.unit}`}
                    </p>
                  </td>
                  <td className="py-3 px-4 align-top text-right text-slate-700 whitespace-nowrap">
                    {symbol}{((currency === 'USD' ? item.unitPriceMxn / exchangeRate : item.unitPriceMxn)).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-4 align-top text-center font-bold text-blue-600">
                    {item.quantity}{item.product.isManual && item.product.unit ? ` ${item.product.unit}` : ''}
                  </td>
                  <td className="py-3 px-4 align-top text-right font-bold text-emerald-600 whitespace-nowrap">
                    {symbol}{((currency === 'USD' ? (item.unitPriceMxn * item.quantity) / exchangeRate : (item.unitPriceMxn * item.quantity))).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="break-inside-avoid mt-4">
          <div className="flex items-start justify-between pt-8 border-t border-slate-100">
            <div className="w-7/12 pr-6">
              <div className="bg-[#0f172a] rounded-xl p-5 text-slate-300">
                <h4 className="text-[#06b6d4] text-[11px] font-bold uppercase tracking-widest mb-3">Notas y Condiciones</h4>
                <ul className="text-[10px] space-y-1.5 leading-relaxed">
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
              <div className="bg-[#0f172a] border-4 border-[#1d4ed8] rounded-md text-white text-sm">
                <div className="flex justify-between py-3 px-4 border-b border-white/10">
                  <span className="text-slate-300">Subtotal:</span>
                  <span className="font-medium">{symbol}{subtotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-3 px-4 border-b border-white/10">
                  <span className="text-slate-300">IVA (16%):</span>
                  <span className="font-medium">{symbol}{tax.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between py-4 px-4 items-center bg-black/20">
                  <span className="text-[#06b6d4] font-bold text-base">TOTAL {currency}:</span>
                  <span className="text-emerald-400 font-bold text-lg">{symbol}{total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-16 flex justify-between px-4 pb-12">
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

          <div className="bg-[#0f172a] text-center py-3 text-[10px] text-slate-300 tracking-wider rounded-lg">
            TecnoPatch - Guadalajara, Jalisco | Documento confidencial | T.C: ${exchangeRate.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
