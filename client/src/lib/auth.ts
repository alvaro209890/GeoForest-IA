import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import { auth } from './firebase';

export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  creaNumber?: string;
  specialization?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
}

function apiUrl(path: string) {
  const base = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/+$/, '');
  return base ? `${base}${path}` : path;
}

export async function bootstrapAccount(fullName?: string): Promise<UserProfile> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Usuário não autenticado.');
  }
  const token = await user.getIdToken();
  const response = await fetch(apiUrl('/api/account/bootstrap'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: user.email || '',
      fullName: fullName || user.displayName || '',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Falha ao provisionar conta local.');
  }
  return payload.profile as UserProfile;
}

export async function handleSignUp(data: SignUpData): Promise<User> {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, data.email, data.password);
    await bootstrapAccount(data.fullName);
    return userCredential.user;
  } catch (error: any) {
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

export async function handleGoogleSignIn(): Promise<User> {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    await bootstrapAccount(result.user.displayName || '');
    return result.user;
  } catch (error: any) {
    // Fallback para redirect quando popup é bloqueado (mobile)
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      const provider = new GoogleAuthProvider();
      await signInWithRedirect(auth, provider);
      // Não chega aqui — o redirect sai da página
      throw new Error('Redirecionando para autenticação...');
    }
    throw new Error(error.message || 'Erro ao entrar com Google');
  }
}

/**
 * Tenta processar resultado de redirect Google (volta do provedor OAuth).
 * Deve ser chamado no mount da página de auth.
 * Retorna o usuário se o login veio de um redirect bem-sucedido, ou null.
 * Erro auth/missing-initial-state é esperado quando não há redirect pendente.
 */
export async function handleGoogleRedirectResult(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      await bootstrapAccount(result.user.displayName || '');
      return result.user;
    }
    return null;
  } catch (error: any) {
    if (error.code === 'auth/missing-initial-state') {
      // Nenhum redirect pendente — silencioso
      return null;
    }
    if (error.code === 'auth/credential-already-in-use') {
      console.warn('[auth-redirect] credencial já vinculada a outra conta, ignorando');
      return null;
    }
    console.error('[auth-redirect] erro inesperado', error.code, error.message);
    return null;
  }
}

export async function handleLogin(email: string, password: string): Promise<User> {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    await bootstrapAccount(userCredential.user.displayName || '');
    return userCredential.user;
  } catch (error: any) {
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

export async function handleLogout(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error: any) {
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
