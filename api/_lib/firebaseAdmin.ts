import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let app: App | null = null;
let dbInstance: Firestore | null = null;

const getServiceAccount = () => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('Falta configurar FIREBASE_SERVICE_ACCOUNT en las variables de entorno.');
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON valido. Pega el contenido completo del archivo descargado de Firebase.');
  }
};

export const getAdminDb = (): Firestore => {
  if (dbInstance) return dbInstance;

  if (!getApps().length) {
    const serviceAccount = getServiceAccount();
    app = initializeApp({ credential: cert(serviceAccount) });
  }

  dbInstance = getFirestore();
  return dbInstance;
};
