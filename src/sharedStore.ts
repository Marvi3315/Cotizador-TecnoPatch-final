import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  type DocumentReference,
  type Unsubscribe
} from 'firebase/firestore';

import { db } from './firebase';
import type { ClientInventoryLog, ClientInventoryRecord, ClientRecord, MeetingRecord, QuoteHistoryItem } from './types';

const cleanForFirestore = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const cleanQuoteForFirestore = (quote: QuoteHistoryItem): QuoteHistoryItem => cleanForFirestore({
  ...quote,
  items: quote.items.map(item => ({
    quantity: Number(item.quantity) || 0,
    unitPriceMxn: Number(item.unitPriceMxn) || 0,
    product: {
      producto_id: item.product.producto_id || '',
      modelo: item.product.modelo || '',
      total_existencia: Number(item.product.total_existencia) || 0,
      titulo: item.product.titulo || '',
      marca: item.product.marca || '',
      img_portada: item.product.img_portada || '',
      garantia: item.product.garantia || '',
      sat_key: item.product.sat_key || '',
      sat_description: item.product.sat_description || '',
      pvol: item.product.pvol || '',
      peso: item.product.peso || '',
      alto: item.product.alto || '',
      largo: item.product.largo || '',
      ancho: item.product.ancho || '',
      link: item.product.link || '',
      precios: {
        precio_1: item.product.precios?.precio_1 || '0',
        precio_especial: item.product.precios?.precio_especial || '0',
        precio_descuento: item.product.precios?.precio_descuento || '0',
        precio_lista: item.product.precios?.precio_lista || '0'
      },
      isManual: Boolean(item.product.isManual),
      manualCategory: item.product.manualCategory || '',
      unit: item.product.unit || ''
    }
  }))
});

const requireDb = () => {
  if (!db) {
    throw new Error('Firebase no esta configurado. Agrega las variables VITE_FIREBASE_* en Vercel y en .env local.');
  }
  return db;
};

const confirmWrite = async (docRef: DocumentReference, label: string) => {
  const snapshot = await getDocFromServer(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Firestore no confirmo en servidor el guardado de ${label}. Revisa reglas, App Check o variables de Vercel.`);
  }
};

export function subscribeToQuotes(onData: (quotes: QuoteHistoryItem[]) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  const quotesQuery = query(collection(database, 'quoteHistory'), orderBy('savedAt', 'desc'), limit(80));

  return onSnapshot(
    quotesQuery,
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as QuoteHistoryItem)),
    error => onError(error)
  );
}

export function subscribeToClients(onData: (clients: ClientRecord[]) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  const clientsQuery = query(collection(database, 'clients'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    clientsQuery,
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as ClientRecord)),
    error => onError(error)
  );
}

export function subscribeToMeetings(onData: (meetings: MeetingRecord[]) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  const meetingsQuery = query(collection(database, 'meetings'), orderBy('date', 'asc'));

  return onSnapshot(
    meetingsQuery,
    snapshot => onData(
      snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }) as MeetingRecord)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    ),
    error => onError(error)
  );
}

export async function saveSharedQuote(quote: QuoteHistoryItem) {
  const database = requireDb();
  const quoteRef = doc(database, 'quoteHistory', quote.id);
  await setDoc(quoteRef, cleanQuoteForFirestore({ ...quote, savedAt: Date.now() }));
  await confirmWrite(quoteRef, 'la cotizacion');
}

export async function deleteSharedQuote(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, 'quoteHistory', id));
}

export async function deleteSharedClient(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, 'clients', id));
}

export async function deleteSharedMeeting(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, 'meetings', id));
}

export async function saveSharedClient(client: ClientRecord) {
  const database = requireDb();
  const clientRef = doc(database, 'clients', client.id);
  await setDoc(clientRef, cleanForFirestore(client));
  await confirmWrite(clientRef, 'el cliente');
}

export async function saveSharedMeeting(meeting: MeetingRecord) {
  const database = requireDb();
  const meetingRef = doc(database, 'meetings', meeting.id);
  await setDoc(meetingRef, cleanForFirestore(meeting));
  await confirmWrite(meetingRef, 'la cita');
}

export function subscribeToInventory(onData: (records: ClientInventoryRecord[]) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  const inventoryQuery = query(collection(database, 'clientInventory'), orderBy('updatedAt', 'desc'), limit(300));

  return onSnapshot(
    inventoryQuery,
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as ClientInventoryRecord)),
    error => onError(error)
  );
}

export function subscribeToInventoryLogs(clientId: string, onData: (logs: ClientInventoryLog[]) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  const logsQuery = query(
    collection(database, 'clientInventoryLogs'),
    where('clientId', '==', clientId || '__none__'),
    limit(80)
  );

  return onSnapshot(
    logsQuery,
    snapshot => onData(
      snapshot.docs
        .map(item => ({ id: item.id, ...item.data() }) as ClientInventoryLog)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    ),
    error => onError(error)
  );
}

export async function saveSharedInventoryRecord(record: ClientInventoryRecord) {
  const database = requireDb();
  const recordRef = doc(database, 'clientInventory', record.id);
  await setDoc(recordRef, cleanForFirestore(record));
  await confirmWrite(recordRef, 'el registro de inventario');
}

export async function deleteSharedInventoryRecord(id: string) {
  const database = requireDb();
  await deleteDoc(doc(database, 'clientInventory', id));
}

export async function saveSharedInventoryLog(log: ClientInventoryLog) {
  const database = requireDb();
  const logRef = doc(database, 'clientInventoryLogs', log.id);
  await setDoc(logRef, cleanForFirestore(log));
}
