import { jsPDF } from 'jspdf';

export type PdfQuoteItem = {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
};

export type PdfQuoteData = {
  quoteNumber: string;
  date: string;
  clientName: string;
  clientCompany?: string;
  clientPhone?: string;
  items: PdfQuoteItem[];
  subtotal: number;
  tax: number;
  total: number;
  includeTax: boolean;
  validityDays?: number;
};

const money = (value: number) => `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const buildQuotePdfBuffer = (quote: PdfQuoteData): Buffer => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 20;
  let y = margin;

  doc.setProperties({
    title: quote.quoteNumber,
    subject: 'Cotizacion TecnoPatch',
    author: 'TecnoPatch',
    creator: 'TecnoPatch'
  });

  const drawHeader = () => {
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(margin, y, contentWidth, 32, 3, 3, 'F');
    doc.setFillColor(37, 99, 235);
    doc.rect(margin, y + 29, contentWidth, 3, 'F');
    doc.setTextColor(56, 189, 248);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('TECNOPATCH', margin + 7, y + 9);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.text('Cotizacion', margin + 7, y + 18);
    doc.setFontSize(10);
    doc.text(quote.quoteNumber, margin + 7, y + 25);
    doc.setTextColor(203, 213, 225);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(quote.date, pageWidth - margin - 7, y + 25, { align: 'right' });
    y += 38;
  };

  const ensurePage = (heightNeeded: number) => {
    if (y + heightNeeded <= bottomLimit) return;
    doc.addPage();
    y = margin;
  };

  drawHeader();

  // Client block
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 22, 2, 2, 'FD');
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('CLIENTE', margin + 5, y + 6.5);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(quote.clientCompany || quote.clientName || 'Cliente', margin + 5, y + 13);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  const contactLine = [quote.clientName, quote.clientPhone].filter(Boolean).join(' · ');
  if (contactLine) doc.text(contactLine, margin + 5, y + 18.5);
  y += 28;

  // Items table header
  const colProduct = margin + 3;
  const colQty = margin + contentWidth - 60;
  const colUnit = margin + contentWidth - 42;
  const colTotal = margin + contentWidth - 3;

  const drawTableHeader = () => {
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, y, contentWidth, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text('PRODUCTO / DESCRIPCION', colProduct, y + 5.5);
    doc.text('CANT.', colQty, y + 5.5, { align: 'right' });
    doc.text('P. UNIT.', colUnit, y + 5.5, { align: 'right' });
    doc.text('TOTAL', colTotal, y + 5.5, { align: 'right' });
    y += 8;
  };

  drawTableHeader();

  quote.items.forEach((item, idx) => {
    const nombreLines = doc.splitTextToSize(item.nombre || 'Producto sin nombre', contentWidth - 66);
    const rowHeight = Math.max(8, nombreLines.length * 4.2 + 3);

    ensurePage(rowHeight);
    if (y === margin) drawTableHeader();

    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, contentWidth, rowHeight, 'F');
    }

    doc.setTextColor(30, 41, 59);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(nombreLines, colProduct, y + 5);

    const lineTotal = (Number(item.cantidad) || 0) * (Number(item.precioUnitario) || 0);
    doc.text(String(item.cantidad), colQty, y + 5, { align: 'right' });
    doc.text(money(item.precioUnitario), colUnit, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.text(money(lineTotal), colTotal, y + 5, { align: 'right' });

    y += rowHeight;
  });

  y += 3;
  ensurePage(28);

  // Totals block
  const totalsWidth = 65;
  const totalsX = margin + contentWidth - totalsWidth;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Subtotal', totalsX, y + 5);
  doc.text(money(quote.subtotal), margin + contentWidth - 3, y + 5, { align: 'right' });
  y += 6;

  if (quote.includeTax) {
    doc.text('IVA (16%)', totalsX, y + 5);
    doc.text(money(quote.tax), margin + contentWidth - 3, y + 5, { align: 'right' });
    y += 6;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(totalsX, y + 1, margin + contentWidth - 3, y + 1);
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text('TOTAL', totalsX, y + 5);
  doc.text(money(quote.total), margin + contentWidth - 3, y + 5, { align: 'right' });
  y += 14;

  ensurePage(14);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Vigencia: ${quote.validityDays || 15} dias. Precios en MXN. Generada por Nova via WhatsApp.`, margin, y);

  return Buffer.from(doc.output('arraybuffer'));
};
