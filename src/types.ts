export interface Product {
  producto_id: string;
  modelo: string;
  total_existencia: number;
  titulo: string;
  marca: string;
  img_portada: string;
  garantia: string;
  sat_key: string;
  sat_description: string;
  pvol: string;
  peso: string;
  alto: string;
  largo: string;
  ancho: string;
  link: string;
  precios: {
    precio_1: string;
    precio_especial: string;
    precio_descuento: string;
    precio_lista: string;
  };
  isManual?: boolean;
  manualCategory?: string;
  unit?: string;
}

export interface QuoteItem {
  product: Product;
  quantity: number;
  unitPriceMxn: number;
}

export interface QuoteHistoryItem {
  id: string;
  quoteNumber?: string;
  date: string;
  items: QuoteItem[];
  subtotal: number;
  tax: number;
  total: number;
  includeTax: boolean;
  currency: 'MXN' | 'USD';
  exchangeRate: number;
  clientName?: string;
  clientCompany?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientRfc?: string;
  clientContactRole?: string;
  projectType?: string;
  projectScope?: string;
  marginPercent?: number;
  showModelsInPdf?: boolean;
  quoteStatus?: 'Borrador' | 'Enviada' | 'Seguimiento' | 'Aceptada' | 'Rechazada';
  salesRep?: string;
  validityDays?: number;
  advancePercent?: number;
  paymentTerms?: string;
  savedAt?: number;
}

export interface ClientRecord {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  rfc?: string;
  contactRole?: string;
  address: string;
  source: string;
  status: 'Prospecto' | 'Cotizado' | 'Seguimiento' | 'Cliente' | 'Pausado';
  owner: string;
  notes: string;
  createdAt: string;
}

export interface MeetingRecord {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  date: string;
  time: string;
  type: 'Visita tecnica' | 'Seguimiento' | 'Cierre' | 'Instalacion' | 'Otro';
  owner: string;
  location: string;
  status: 'Programada' | 'Realizada' | 'Reagendada' | 'Cancelada';
  notes: string;
}
