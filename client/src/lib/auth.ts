/**
 * Authentication Functions
 *
 * Firebase Auth + Firestore profile enforcement.
 */

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  creaNumber?: string;
  specialization?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
}

async function assertFirestoreProfileExists(user: User): Promise<void> {
  const userDocRef = doc(db, 'users', user.uid);
  const userDocSnap = await getDoc(userDocRef);
  if (userDocSnap.exists()) return;

  await signOut(auth);
  throw new Error('Conta sem cadastro no sistema. Entre em contato com o suporte.');
}

export async function handleSignUp(data: SignUpData): Promise<User> {
  try {
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      data.email,
      data.password,
    );

    const user = userCredential.user;

    const userProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      fullName: data.fullName,
      createdAt: serverTimestamp() as Timestamp,
    };

    await setDoc(doc(db, 'users', user.uid), userProfile);

    console.log('Usuario cadastrado com sucesso:', user.uid);
    return user;
  } catch (error: any) {
    console.error('Erro ao cadastrar:', error);

    switch (error.code) {
      case 'auth/email-already-in-use':
        throw new Error('Este e-mail ja esta cadastrado');
      case 'auth/weak-password':
        throw new Error('A senha e muito fraca. Use pelo menos 6 caracteres');
      case 'auth/invalid-email':
        throw new Error('E-mail invalido');
      default:
        throw new Error(error.message || 'Erro ao cadastrar usuario');
    }
  }
}

export async function handleGoogleSignIn(): Promise<User> {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      await signOut(auth);
      throw new Error('Conta sem cadastro no sistema. Entre em contato com o suporte.');
    }

    const data = userDocSnap.data() as Partial<UserProfile>;
    const updates: Partial<UserProfile> = {
      email: data.email || user.email || '',
      updatedAt: serverTimestamp() as Timestamp,
    };

    if (!data.fullName && user.displayName) {
      updates.fullName = user.displayName;
    }
    if (!data.specialization) {
      updates.specialization = 'outro';
    }
    if (!data.uid) {
      updates.uid = user.uid;
    }

    await setDoc(userDocRef, updates, { merge: true });

    console.log('Login com Google realizado com sucesso:', user.uid);
    return user;
  } catch (error: any) {
    console.error('Erro no login com Google:', error);
    throw new Error(error.message || 'Erro ao entrar com Google');
  }
}

export async function handleLogin(
  email: string,
  password: string,
): Promise<User> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    await assertFirestoreProfileExists(userCredential.user);
    console.log('Login realizado com sucesso:', userCredential.user.uid);
    return userCredential.user;
  } catch (error: any) {
    console.error('Erro ao fazer login:', error);

    switch (error.code) {
      case 'auth/user-not-found':
        throw new Error('Usuario nao encontrado');
      case 'auth/wrong-password':
        throw new Error('Senha incorreta');
      case 'auth/invalid-email':
        throw new Error('E-mail invalido');
      case 'auth/user-disabled':
        throw new Error('Esta conta foi desativada');
      default:
        throw new Error(error.message || 'Erro ao fazer login');
    }
  }
}

export async function handleLogout(): Promise<void> {
  try {
    await signOut(auth);
    console.log('Logout realizado com sucesso');
  } catch (error: any) {
    console.error('Erro ao fazer logout:', error);
    throw new Error(error.message || 'Erro ao fazer logout');
  }
}

export function getCurrentUser(): User | null {
  return auth.currentUser;
}

export function isAuthenticated(): boolean {
  return auth.currentUser !== null;
}

export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}
