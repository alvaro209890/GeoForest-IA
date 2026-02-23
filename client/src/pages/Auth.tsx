/**
 * Auth Page - Fullscreen, non-scrollable, no top bar artifacts
 */

import { useEffect, useState } from 'react';
import { Mail, Lock, User, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { handleSignUp, handleLogin, handleGoogleSignIn } from '@/lib/auth';
import { useLocation } from 'wouter';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

type AuthMode = 'login' | 'signup';

export default function Auth() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyHeight = document.body.style.height;
    const prevHtmlHeight = document.documentElement.style.height;
    const prevBodyWidth = document.body.style.width;
    const prevHtmlWidth = document.documentElement.style.width;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.height = '100%';
    document.documentElement.style.height = '100%';
    document.body.style.width = '100%';
    document.documentElement.style.width = '100%';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.height = prevBodyHeight;
      document.documentElement.style.height = prevHtmlHeight;
      document.body.style.width = prevBodyWidth;
      document.documentElement.style.width = prevHtmlWidth;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (!userDocSnap.exists()) {
          await signOut(auth);
          toast.error('Conta sem cadastro no sistema. Entre em contato com o suporte.');
          return;
        }
        setLocation('/dashboard');
      } catch (error) {
        await signOut(auth);
        console.error('[auth-check] falha ao validar perfil no Firestore', error);
        toast.error('Nao foi possivel validar sua conta agora. Tente novamente.');
      }
    });

    return () => unsubscribe();
  }, [setLocation]);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validateSignUp = () => {
    if (!fullName.trim()) {
      toast.error('Por favor, insira seu nome completo');
      return false;
    }
    if (!signupEmail.trim() || !validateEmail(signupEmail)) {
      toast.error('Por favor, insira um e-mail válido');
      return false;
    }
    if (signupPassword.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return false;
    }
    if (signupPassword !== signupConfirmPassword) {
      toast.error('As senhas não correspondem');
      return false;
    }
    return true;
  };

  const validateLogin = () => {
    if (!loginEmail.trim() || !validateEmail(loginEmail)) {
      toast.error('Por favor, insira um e-mail válido');
      return false;
    }
    if (!loginPassword.trim()) {
      toast.error('Por favor, insira sua senha');
      return false;
    }
    return true;
  };

  const wakeBackend = async () => {
    const configuredBase = String(import.meta.env.VITE_API_BASE || '').trim();
    const apiBase = configuredBase ? configuredBase.replace(/\/+$/, '') : '';
    const url = `${apiBase}/api/health`;
    const controller = new AbortController();
    const timeoutMs = 20000;
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        keepalive: true,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn('[auth-wake] backend respondeu com erro', res.status, res.statusText);
        return;
      }
      console.info('[auth-wake] ping enviado com sucesso', {
        status: res.status,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error: any) {
      console.warn('[auth-wake] falha ao pingar backend', error?.message || error);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateSignUp()) return;
    setLoading(true);
    void wakeBackend();
    try {
      await handleSignUp({
        email: signupEmail,
        password: signupPassword,
        fullName,
      });
      toast.success('Cadastro realizado com sucesso!');
      setLocation('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao cadastrar');
    } finally {
      setLoading(false);
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateLogin()) return;
    setLoading(true);
    void wakeBackend();
    try {
      await handleLogin(loginEmail, loginPassword);
      toast.success('Login realizado com sucesso!');
      setLocation('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    setLoading(true);
    void wakeBackend();
    try {
      await handleGoogleSignIn();
      toast.success('Login com Google realizado com sucesso!');
      setLocation('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao entrar com Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-auto bg-black">
      <div className="absolute inset-0 bg-[radial-gradient(1200px_800px_at_20%_10%,rgba(34,197,94,0.25),transparent_60%),radial-gradient(900px_700px_at_80%_20%,rgba(234,179,8,0.18),transparent_60%),linear-gradient(135deg,#0b1f16,#0b1b10_45%,#0a1210)]" />
      <div className="absolute inset-0 bg-[url('https://files.manuscdn.com/user_upload_by_module/session_file/310419663030608231/aWDbHEOGaMpaIiIr.jpg')] bg-cover bg-center opacity-35" />
      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 h-full w-full flex items-center justify-center px-3 sm:px-4 overflow-y-auto py-4 sm:py-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8">
          <div className="hidden lg:flex flex-col justify-center">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-700 shadow-lg flex items-center justify-center">
                <span className="text-2xl">🌲</span>
              </div>
              <div>
                <h1 className="text-4xl font-bold text-white">GeoForest IA</h1>
                <p className="text-green-200 text-sm">Inteligência Artificial para Engenharia Florestal</p>
              </div>
            </div>
            <p className="text-green-100/80 text-lg leading-relaxed max-w-md">
              Plataforma inteligente para apoio técnico e análise ambiental com foco em dados florestais.
            </p>
          </div>

          <div className="flex flex-col justify-center">
            <div className="lg:hidden text-center mb-4 sm:mb-6 flex flex-col items-center gap-2 sm:gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-700 shadow-lg flex items-center justify-center">
                <span className="text-xl sm:text-2xl">🌲</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">GeoForest IA</h1>
              <p className="text-green-200 text-xs sm:text-sm">IA aplicada à Engenharia Florestal</p>
            </div>

            <div className="rounded-2xl sm:rounded-3xl border border-white/15 bg-white/8 backdrop-blur-xl shadow-2xl p-4 sm:p-6 md:p-8">
              <div className="grid grid-cols-2 gap-2 bg-white/5 p-1 rounded-2xl mb-4 sm:mb-6">
                <button
                  onClick={() => setMode('login')}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    mode === 'login'
                      ? 'bg-green-600 text-white shadow-lg'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Login
                </button>
                <button
                  onClick={() => setMode('signup')}
                  className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    mode === 'signup'
                      ? 'bg-green-600 text-white shadow-lg'
                      : 'text-white/70 hover:text-white'
                  }`}
                >
                  Cadastro
                </button>
              </div>

              {mode === 'login' && (
                <form onSubmit={onLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">E-mail</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type="email"
                        placeholder="seu@email.com"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="pl-9 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="pl-9 pr-10 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-white/60 hover:text-white/90 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-semibold py-2.5 rounded-xl transition-all shadow-lg disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Entrando...
                      </>
                    ) : (
                      'Entrar'
                    )}
                  </Button>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/15" />
                    <span className="text-[11px] text-white/60">ou</span>
                    <div className="flex-1 h-px bg-white/15" />
                  </div>

                  <Button
                    type="button"
                    onClick={onGoogleSignIn}
                    disabled={loading}
                    className="w-full bg-white/90 hover:bg-white text-gray-900 font-semibold py-2.5 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.73 1.22 9.23 3.62l6.88-6.88C35.77 2.48 30.2 0 24 0 14.62 0 6.52 5.38 2.56 13.22l8.04 6.25C12.5 13.06 17.78 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.64-.15-3.22-.43-4.75H24v9h12.94c-.56 3.02-2.25 5.58-4.79 7.3l7.36 5.72c4.3-3.97 6.47-9.82 6.47-17.27z"/>
                      <path fill="#FBBC05" d="M10.6 28.22c-.5-1.52-.78-3.14-.78-4.82s.28-3.3.78-4.82l-8.04-6.25C.92 15.41 0 19.6 0 23.4c0 3.8.92 7.99 2.56 11.07l8.04-6.25z"/>
                      <path fill="#34A853" d="M24 48c6.2 0 11.77-2.05 15.69-5.58l-7.36-5.72c-2.05 1.38-4.66 2.2-8.33 2.2-6.22 0-11.5-3.56-13.4-8.48l-8.04 6.25C6.52 42.62 14.62 48 24 48z"/>
                    </svg>
                    Continuar com Google
                  </Button>
                </form>
              )}

              {mode === 'signup' && (
                <form onSubmit={onSignUp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">Nome Completo</label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type="text"
                        placeholder="Seu nome completo"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="pl-9 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">E-mail</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type="email"
                        placeholder="seu@email.com"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        className="pl-9 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                        className="pl-9 pr-10 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-white/60 hover:text-white/90 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/80 mb-2">Confirmar Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-green-300" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={signupConfirmPassword}
                        onChange={(e) => setSignupConfirmPassword(e.target.value)}
                        className="pl-9 pr-10 bg-white/10 border-white/15 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-white/60 hover:text-white/90 transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-semibold py-2.5 rounded-xl transition-all shadow-lg disabled:opacity-50"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Cadastrando...
                      </>
                    ) : (
                      'Cadastrar'
                    )}
                  </Button>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-white/15" />
                    <span className="text-[11px] text-white/60">ou</span>
                    <div className="flex-1 h-px bg-white/15" />
                  </div>

                  <Button
                    type="button"
                    onClick={onGoogleSignIn}
                    disabled={loading}
                    className="w-full bg-white/90 hover:bg-white text-gray-900 font-semibold py-2.5 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.73 1.22 9.23 3.62l6.88-6.88C35.77 2.48 30.2 0 24 0 14.62 0 6.52 5.38 2.56 13.22l8.04 6.25C12.5 13.06 17.78 9.5 24 9.5z"/>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.64-.15-3.22-.43-4.75H24v9h12.94c-.56 3.02-2.25 5.58-4.79 7.3l7.36 5.72c4.3-3.97 6.47-9.82 6.47-17.27z"/>
                      <path fill="#FBBC05" d="M10.6 28.22c-.5-1.52-.78-3.14-.78-4.82s.28-3.3.78-4.82l-8.04-6.25C.92 15.41 0 19.6 0 23.4c0 3.8.92 7.99 2.56 11.07l8.04-6.25z"/>
                      <path fill="#34A853" d="M24 48c6.2 0 11.77-2.05 15.69-5.58l-7.36-5.72c-2.05 1.38-4.66 2.2-8.33 2.2-6.22 0-11.5-3.56-13.4-8.48l-8.04 6.25C6.52 42.62 14.62 48 24 48z"/>
                    </svg>
                    Continuar com Google
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
