import { jsPDF } from 'jspdf';
import { LOGO_BASE64 } from './logoBase64.js';

export type PdfQuoteItem = {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  categoria?: string;
  unidad?: string;
};

export type PdfQuoteData = {
  quoteNumber: string;
  date: string;
  clientName: string;
  clientCompany?: string;
  clientPhone?: string;
  clientRfc?: string;
  projectType?: string;
  projectScope?: string;
  technicalNotes?: string;
  items: PdfQuoteItem[];
  subtotal: number;
  tax: number;
  total: number;
  includeTax: boolean;
  validityDays?: number;
  exchangeRate?: number;
};

// Paleta identica a QuoteDocument.tsx (version web)
const NAVY: [number, number, number] = [15, 23, 42]; // #0f172a
const BLUE_ACCENT: [number, number, number] = [29, 78, 216]; // #1d4ed8
const CYAN: [number, number, number] = [6, 182, 212]; // #06b6d4
const SLATE_300: [number, number, number] = [203, 213, 225];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_700: [number, number, number] = [51, 65, 85];
const SLATE_800: [number, number, number] = [30, 41, 59];
const EMERALD: [number, number, number] = [5, 150, 105];
const LIGHT_BG: [number, number, number] = [248, 250, 252];
const BLUE_50: [number, number, number] = [239, 246, 255];
const WHITE: [number, number, number] = [255, 255, 255];

const money = (value: number) => `$${(Number(value) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const buildQuotePdfBuffer = (quote: PdfQuoteData): Buffer => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 16;
  let y = margin;

  doc.setProperties({ title: quote.quoteNumber, subject: 'Cotizacion TecnoPatch', author: 'TecnoPatch', creator: 'TecnoPatch' });

  const ensurePage = (heightNeeded: number) => {
    if (y + heightNeeded <= bottomLimit) return;
    doc.addPage();
    y = margin;
  };

  // ===== Header =====
  const headerHeight = 30;
  doc.setFillColor(...NAVY);
  doc.rect(margin, y, contentWidth, headerHeight, 'F');

  // Logo real de TecnoPatch
  const logoW = 22;
  const logoH = logoW * (439 / 568);
  doc.setFillColor(...WHITE);
  doc.roundedRect(margin + 5, y + (headerHeight - logoH - 4) / 2, logoW + 4, logoH + 4, 2, 2, 'F');
  doc.addImage(LOGO_BASE64, 'PNG', margin + 7, y + (headerHeight - logoH) / 2, logoW, logoH);

  const textX = margin + 34;
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('TecnoPatch', textX, y + 12);

  doc.setTextColor(...CYAN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('TELECOMUNICACIONES - GUADALAJARA, JAL.', textX, y + 17);

  doc.setTextColor(...SLATE_300);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('33 2849-6052 | 322 518-7656 | serviciotecnopatch@gmail.com', textX, y + 21.5);
  doc.text('Guadalajara, Jalisco', textX, y + 25.5);

  doc.setTextColor(...CYAN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(quote.quoteNumber, margin + contentWidth - 5, y + 12, { align: 'right' });
  doc.setTextColor(...SLATE_300);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(quote.date, margin + contentWidth - 5, y + 17, { align: 'right' });
  doc.setFontSize(7);
  doc.text(`Vigencia: ${quote.validityDays || 15} dias naturales`, margin + contentWidth - 5, y + 21.5, { align: 'right' });

  y += headerHeight;
  doc.setFillColor(...BLUE_ACCENT);
  doc.rect(margin, y, contentWidth, 2, 'F');
  y += 6;

  // ===== Datos del cliente =====
  const clientBoxHeight = quote.projectType ? 32 : 24;
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, y, contentWidth, clientBoxHeight, 2, 2, 'F');

  doc.setTextColor(...CYAN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('DATOS DEL CLIENTE', margin + 5, y + 6);

  const col1X = margin + 5;
  const col2X = margin + contentWidth * 0.4;
  const col3X = margin + contentWidth * 0.68;

  const drawFieldLabel = (label: string, x: number, yy: number) => {
    doc.setTextColor(96, 165, 250);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(label, x, yy);
  };

  drawFieldLabel('EMPRESA / CLIENTE', col1X, y + 12);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(quote.clientName || 'N/A', col1X, y + 17);
  if (quote.clientCompany && quote.clientCompany !== quote.clientName) {
    doc.setTextColor(...SLATE_300);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(quote.clientCompany, col1X, y + 21);
  }

  drawFieldLabel('RFC', col2X, y + 12);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(quote.clientRfc || 'N/A', col2X, y + 17);

  drawFieldLabel('CONTACTO', col3X, y + 12);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(quote.clientPhone || 'N/A', col3X, y + 17);

  if (quote.projectType) {
    doc.setDrawColor(51, 65, 85);
    doc.line(margin + 4, y + 25, margin + contentWidth - 4, y + 25);
    drawFieldLabel('PROYECTO / REFERENCIA', col1X, y + 29.5);
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(quote.projectType.toUpperCase(), col1X + 42, y + 29.5);
  }

  y += clientBoxHeight + 5;

  // ===== Alcance y memorandum =====
  if (quote.projectScope && quote.projectScope.trim()) {
    const lines = doc.splitTextToSize(`"${quote.projectScope.trim()}"`, contentWidth - 12);
    const boxHeight = Math.max(16, lines.length * 4.2 + 11);
    ensurePage(boxHeight + 5);
    doc.setFillColor(...LIGHT_BG);
    doc.rect(margin, y, contentWidth, boxHeight, 'F');
    doc.setFillColor(...BLUE_ACCENT);
    doc.rect(margin, y, 1.2, boxHeight, 'F');
    doc.setTextColor(...BLUE_ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('ALCANCE Y MEMORANDUM DEL PROYECTO', margin + 5, y + 6);
    doc.setTextColor(...SLATE_700);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.text(lines, margin + 5, y + 11.5);
    y += boxHeight + 5;
  }

  // ===== Notas tecnicas =====
  if (quote.technicalNotes && quote.technicalNotes.trim()) {
    const lines = doc.splitTextToSize(quote.technicalNotes.trim(), contentWidth - 12);
    const boxHeight = Math.max(16, lines.length * 4.2 + 11);
    ensurePage(boxHeight + 5);
    doc.setFillColor(...BLUE_50);
    doc.setDrawColor(191, 219, 254);
    doc.rect(margin, y, contentWidth, boxHeight, 'FD');
    doc.setTextColor(29, 78, 216);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('NOTAS TECNICAS Y ESPECIFICACIONES', margin + 5, y + 6);
    doc.setTextColor(...SLATE_700);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(lines, margin + 5, y + 11.5);
    y += boxHeight + 5;
  }

  // ===== Tabla de productos =====
  const colNum = margin + 4;
  const colDesc = margin + 12;
  const colUnit = margin + contentWidth - 62;
  const colQty = margin + contentWidth - 38;
  const colTotal = margin + contentWidth - 4;

  const drawTableHeader = () => {
    doc.setFillColor(...BLUE_ACCENT);
    doc.rect(margin, y, contentWidth, 7.5, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.text('#', colNum, y + 5, { align: 'center' });
    doc.text('DESCRIPCION / CATEGORIA', colDesc, y + 5);
    doc.text('P.UNIT', colUnit, y + 5, { align: 'right' });
    doc.text('CANT', colQty, y + 5, { align: 'center' });
    doc.text('IMPORTE', colTotal, y + 5, { align: 'right' });
    y += 7.5;
  };

  ensurePage(7.5 + 12);
  drawTableHeader();

  quote.items.forEach((item, idx) => {
    const nombreLines = doc.splitTextToSize(item.nombre || 'Producto sin nombre', contentWidth - 78);
    const categoria = item.categoria || 'Partida manual';
    const unidad = item.unidad ? ` - Unidad: ${item.unidad}` : '';
    const rowHeight = Math.max(9, nombreLines.length * 4 + 6);

    ensurePage(rowHeight);
    if (y === margin) drawTableHeader();

    if (idx % 2 === 0) {
      doc.setFillColor(...LIGHT_BG);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }

    doc.setTextColor(...BLUE_ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(String(idx + 1), colNum, y + 5, { align: 'center' });

    doc.setTextColor(...SLATE_800);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(nombreLines, colDesc, y + 5);
    doc.setTextColor(...SLATE_500);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.3);
    doc.text(`${categoria}${unidad}`, colDesc, y + 5 + nombreLines.length * 4);

    const precio = Number(item.precioUnitario) || 0;
    const cantidad = Number(item.cantidad) || 1;
    doc.setTextColor(...SLATE_700);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.text(money(precio), colUnit, y + 5, { align: 'right' });

    doc.setTextColor(...BLUE_ACCENT);
    doc.setFont('helvetica', 'bold');
    doc.text(`${cantidad}${item.unidad ? ' ' + item.unidad : ''}`, colQty, y + 5, { align: 'center' });

    doc.setTextColor(...EMERALD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(money(precio * cantidad), colTotal, y + 5, { align: 'right' });

    y += rowHeight;
  });

  y += 4;

  // ===== Notas y condiciones + Totales =====
  const notesWidth = contentWidth * 0.58;
  const totalsWidth = contentWidth * 0.38;
  const totalsX = margin + contentWidth - totalsWidth;
  const conditionLines = [
    `- Precios en MXN ${quote.includeTax ? 'incluyen IVA' : 'mas IVA'} - Vigencia ${quote.validityDays || 15} dias naturales`,
    '- Tiempo de entrega: 5-10 dias habiles segun volumen del proyecto',
    '- Garantia de instalacion 12 meses - Equipos con garantia del fabricante',
    '- Forma de pago: 60% anticipo, 40% contra entrega y pruebas',
    '- Se entrega documentacion tecnica (planos, certificaciones, contrasenas)',
    '- Soporte tecnico prioritario incluido 30 dias post-instalacion'
  ];
  const notesBoxHeight = Math.max(32, conditionLines.length * 4.3 + 10);
  const totalsBoxHeight = quote.includeTax ? 24 : 17;
  const blockHeight = Math.max(notesBoxHeight, totalsBoxHeight);

  ensurePage(blockHeight + 5);

  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, y, notesWidth, notesBoxHeight, 2, 2, 'F');
  doc.setTextColor(...CYAN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text('NOTAS Y CONDICIONES', margin + 4, y + 6);
  doc.setTextColor(...SLATE_300);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  conditionLines.forEach((line, idx) => {
    doc.text(line, margin + 4, y + 11 + idx * 4.3, { maxWidth: notesWidth - 8 });
  });

  doc.setDrawColor(...BLUE_ACCENT);
  doc.setLineWidth(0.6);
  doc.roundedRect(totalsX, y, totalsWidth, totalsBoxHeight, 1.5, 1.5, 'S');
  doc.setFillColor(...NAVY);
  doc.roundedRect(totalsX + 0.3, y + 0.3, totalsWidth - 0.6, totalsBoxHeight - 0.6, 1.2, 1.2, 'F');

  let ty = y + 6;
  doc.setTextColor(...SLATE_300);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Subtotal:', totalsX + 4, ty);
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'normal');
  doc.text(money(quote.subtotal), totalsX + totalsWidth - 4, ty, { align: 'right' });
  ty += 6.5;

  if (quote.includeTax) {
    doc.setTextColor(...SLATE_300);
    doc.text('IVA (16%):', totalsX + 4, ty);
    doc.setTextColor(...WHITE);
    doc.text(money(quote.tax), totalsX + totalsWidth - 4, ty, { align: 'right' });
    ty += 6.5;
  }

  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.rect(totalsX + 0.3, ty - 4, totalsWidth - 0.6, 8, 'F');
  doc.setTextColor(...CYAN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('TOTAL MXN:', totalsX + 4, ty + 1);
  doc.setTextColor(52, 211, 153);
  doc.setFontSize(9.5);
  doc.text(money(quote.total), totalsX + totalsWidth - 4, ty + 1, { align: 'right' });

  y += blockHeight + 12;

  // ===== Firmas =====
  ensurePage(20);
  const sigWidth = contentWidth * 0.42;
  doc.setDrawColor(191, 219, 254);
  doc.setTextColor(...SLATE_500);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.line(margin, y, margin + sigWidth, y);
  doc.text('Director / Responsable de Proyecto', margin, y + 4.5);
  doc.text('TecnoPatch', margin, y + 8.5);

  const sig2X = margin + contentWidth - sigWidth;
  doc.line(sig2X, y, sig2X + sigWidth, y);
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.text('Firma y Sello del Cliente', sig2X, y - 1.5);
  doc.setTextColor(...SLATE_500);
  doc.setFont('helvetica', 'normal');
  doc.text('Nombre y cargo: ______________________', sig2X, y + 4.5);
  doc.text('Fecha de aceptacion: ______________________', sig2X, y + 8.5);

  y += 16;

  // ===== Footer =====
  ensurePage(10);
  doc.setFillColor(...NAVY);
  doc.roundedRect(margin, y, contentWidth, 7, 1, 1, 'F');
  doc.setTextColor(...SLATE_300);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text(
    `TecnoPatch - Guadalajara, Jalisco | Documento confidencial | T.C: $${(quote.exchangeRate || 18).toFixed(2)}`,
    margin + contentWidth / 2,
    y + 4.5,
    { align: 'center' }
  );

  return Buffer.from(doc.output('arraybuffer'));
};
