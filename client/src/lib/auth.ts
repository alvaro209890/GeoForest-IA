/**
 * Authentication Functions
 * 
 * Design Philosophy: Natureza Elevada com Tecnologia Integrada
 * Este arquivo contém todas as funções de autenticação e gerenciamento de usuários.
 * Integra Firebase Auth para autenticação e Firestore para persistência de dados.
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
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Interface para dados do usuário no Firestore
 */
export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  creaNumber?: string;
  specialization?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * Interface para dados de sign up
 */
export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
}

/**
 * Função de Cadastro (Sign Up)
 * 
 * 1. Cria usuário no Firebase Auth com email e senha
 * 2. Salva dados adicionais no Firestore usando o UID como ID do documento
 * 3. Retorna o usuário criado
 * 
 * @param data - Dados do novo usuário
 * @returns Promise com o usuário criado
 * @throws Erro se o cadastro falhar
 */
export async function handleSignUp(data: SignUpData): Promise<User> {
  try {
    // 1. Criar usuário no Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      data.email,
      data.password
    );

    const user = userCredential.user;

    // 2. Salvar dados adicionais no Firestore
    const userProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      fullName: data.fullName,
      createdAt: serverTimestamp() as Timestamp,
    };

    // Salvar no Firestore usando o UID como ID do documento
    await setDoc(doc(db, 'users', user.uid), userProfile);

    console.log('✅ Usuário cadastrado com sucesso:', user.uid);
    return user;
  } catch (error: any) {
    console.error('❌ Erro ao cadastrar:', error);
    
    // Tratamento de erros específicos do Firebase
    switch (error.code) {
      case 'auth/email-already-in-use':
        throw new Error('Este e-mail já está cadastrado');
      case 'auth/weak-password':
        throw new Error('A senha é muito fraca. Use pelo menos 6 caracteres');
      case 'auth/invalid-email':
        throw new Error('E-mail inválido');
      default:
        throw new Error(error.message || 'Erro ao cadastrar usuário');
    }
  }
}

/**
 * Função de Login/Cadastro com Google
 *
 * 1. Autentica via Google (popup)
 * 2. Garante perfil no Firestore
 */
export async function handleGoogleSignIn(): Promise<User> {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      const userProfile: UserProfile = {
        uid: user.uid,
        email: user.email || '',
        fullName: user.displayName || 'Usuário',
        specialization: 'outro',
        createdAt: serverTimestamp() as Timestamp,
      };
      await setDoc(userDocRef, userProfile);
    } else {
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
    }

    console.log('✅ Login com Google realizado com sucesso:', user.uid);
    return user;
  } catch (error: any) {
    console.error('❌ Erro no login com Google:', error);
    throw new Error(error.message || 'Erro ao entrar com Google');
  }
}

/**
 * Função de Login
 * 
 * Autentica o usuário com email e senha no Firebase Auth
 * 
 * @param email - E-mail do usuário
 * @param password - Senha do usuário
 * @returns Promise com o usuário autenticado
 * @throws Erro se o login falhar
 */
export async function handleLogin(
  email: string,
  password: string
): Promise<User> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log('✅ Login realizado com sucesso:', userCredential.user.uid);
    return userCredential.user;
  } catch (error: any) {
    console.error('❌ Erro ao fazer login:', error);

    // Tratamento de erros específicos do Firebase
    switch (error.code) {
      case 'auth/user-not-found':
        throw new Error('Usuário não encontrado');
      case 'auth/wrong-password':
        throw new Error('Senha incorreta');
      case 'auth/invalid-email':
        throw new Error('E-mail inválido');
      case 'auth/user-disabled':
        throw new Error('Esta conta foi desativada');
      default:
        throw new Error(error.message || 'Erro ao fazer login');
    }
  }
}

/**
 * Função de Logout
 * 
 * Desconecta o usuário atual
 * 
 * @returns Promise que resolve quando o logout é concluído
 * @throws Erro se o logout falhar
 */
export async function handleLogout(): Promise<void> {
  try {
    await signOut(auth);
    console.log('✅ Logout realizado com sucesso');
  } catch (error: any) {
    console.error('❌ Erro ao fazer logout:', error);
    throw new Error(error.message || 'Erro ao fazer logout');
  }
}

/**
 * Função para obter o usuário autenticado atual
 * 
 * @returns O usuário autenticado ou null se não houver usuário
 */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/**
 * Função para verificar se o usuário está autenticado
 * 
 * @returns true se o usuário está autenticado, false caso contrário
 */
export function isAuthenticated(): boolean {
  return auth.currentUser !== null;
}
