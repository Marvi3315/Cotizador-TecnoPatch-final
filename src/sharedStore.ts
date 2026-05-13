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
  type DocumentReference,
  type Unsubscribe
} from 'firebase/firestore';

import { db } from './firebase';
import type { ClientRecord, MeetingRecord, QuoteHistoryItem } from './types';

const cleanForFirestore = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

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
  await setDoc(quoteRef, cleanForFirestore({ ...quote, savedAt: Date.now() }));
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
