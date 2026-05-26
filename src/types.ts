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
  nextFollowUpDate?: string;
  followUpNote?: string;
  lostReason?: string;
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

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  name: string;
  role: 'admin' | 'ventas' | 'lectura';
  active: boolean;
  createdAt: string;
  createdBy?: string;
  lastLoginAt?: string;
}

export type ClientInventoryType =
  | 'dispositivo'
  | 'red'
  | 'correo'
  | 'hosting'
  | 'dominio'
  | 'camara'
  | 'dvr-nvr'
  | 'router'
  | 'access-point'
  | 'impresora'
  | 'computadora'
  | 'software'
  | 'plataforma'
  | 'otro';

export type ClientInventoryStatus = 'activo' | 'reemplazado' | 'mantenimiento' | 'baja' | 'pendiente';

export interface ClientInventoryRecord {
  id: string;
  clientId: string;
  clientName: string;
  type: ClientInventoryType;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  macAddress: string;
  ipAddress: string;
  accessUrl: string;
  username: string;
  password: string;
  location: string;
  responsible: string;
  status: ClientInventoryStatus;
  registeredAt: string;
  updatedAt: string;
  internalNotes: string;
  clientNotes: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface ClientInventoryLog {
  id: string;
  clientId: string;
  clientName: string;
  recordId: string;
  recordName: string;
  action: string;
  userId: string;
  userName: string;
  userEmail: string;
  createdAt: string;
}
