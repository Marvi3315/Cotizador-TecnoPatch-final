import { initializeApp, deleteApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Unsubscribe
} from 'firebase/firestore';

import { adminEmails, auth, db, firebaseConfig } from './firebase';
import type { UserProfile } from './types';

const requireAuth = () => {
  if (!auth) throw new Error('Firebase Auth no esta configurado.');
  return auth;
};

const requireDb = () => {
  if (!db) throw new Error('Firestore no esta configurado.');
  return db;
};

const isAdminEmail = (email?: string | null) => Boolean(email && adminEmails.includes(email.toLowerCase()));

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(requireAuth(), email, password);
}

export async function logoutUser() {
  return signOut(requireAuth());
}

export async function getOrCreateUserProfile(user: User): Promise<UserProfile | null> {
  const database = requireDb();
  const userRef = doc(database, 'users', user.uid);
  const snapshot = await getDoc(userRef);

  if (snapshot.exists()) {
    const profile = { id: snapshot.id, ...snapshot.data() } as UserProfile;
    try {
      await setDoc(userRef, { lastLoginAt: new Date().toISOString() }, { merge: true });
    } catch (error) {
      console.warn('No se pudo actualizar ultimo acceso del usuario:', error);
    }
    return profile.active ? profile : null;
  }

  if (!isAdminEmail(user.email)) return null;

  const profile: UserProfile = {
    id: user.uid,
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || user.email || 'Administrador',
    role: 'admin',
    active: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };

  await setDoc(userRef, profile);
  return profile;
}

export function subscribeToUsers(onData: (users: UserProfile[]) => void, onError: (error: Error) => void): Unsubscribe {
  const usersQuery = query(collection(requireDb(), 'users'), orderBy('createdAt', 'desc'));

  return onSnapshot(
    usersQuery,
    snapshot => onData(snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as UserProfile)),
    error => onError(error)
  );
}

export async function saveUserProfile(profile: UserProfile) {
  const userRef = doc(requireDb(), 'users', profile.uid);
  await setDoc(userRef, profile, { merge: true });
}

export async function createUserByAdmin(input: {
  email: string;
  password: string;
  name: string;
  role: UserProfile['role'];
  createdBy?: string;
}) {
  const secondaryApp = initializeApp(firebaseConfig, `admin-create-user-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, input.email, input.password);
    if (input.name.trim()) {
      await updateProfile(credential.user, { displayName: input.name.trim() });
    }

    const profile: UserProfile = {
      id: credential.user.uid,
      uid: credential.user.uid,
      email: input.email.trim().toLowerCase(),
      name: input.name.trim() || input.email.trim(),
      role: input.role,
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy
    };

    await saveUserProfile(profile);
    await signOut(secondaryAuth);
    return profile;
  } finally {
    await deleteApp(secondaryApp);
  }
}
