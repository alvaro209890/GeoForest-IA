/**
 * Auth Page — GeoForest IA
 * Design: Pencil v2.14 — Auth Screen
 * Split layout: Left Brand Column (620px) + Right Card Column (820px)
 */

import { useEffect, useState } from 'react';
import { Mail, Lock, User, Eye, EyeOff, Loader2, Trees } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TermsOfUseDialog from '@/components/TermsOfUseDialog';
import { toast } from 'sonner';
import { bootstrapAccount, handleSignUp, handleLogin, handleGoogleSignIn } from '@/lib/auth';
import { useLocation } from 'wouter';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

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

  // Lock body scroll
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) return;
      try {
        await bootstrapAccount(currentUser.displayName || '');
        setLocation('/dashboard/simcar');
      } catch (error) {
        await signOut(auth);
        console.error('[auth-check] falha ao provisionar conta local', error);
        toast.error('Não foi possível validar sua conta agora. Tente novamente.');
      }
    });
    return () => unsubscribe();
  }, [setLocation]);

  const wakeBackend = async () => {
    const configuredBase = String(import.meta.env.VITE_API_BASE || '').trim();
    const apiBase = configuredBase ? configuredBase.replace(/\/+$/, '') : '';
    const url = `${apiBase}/api/health`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        keepalive: true,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn('[auth-wake] backend respondeu com erro', res.status, res.statusText);
      }
    } catch (error: any) {
      console.warn('[auth-wake] falha ao pingar backend', error?.message || error);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    void wakeBackend();
    try {
      await handleSignUp({ email: signupEmail, password: signupPassword, fullName });
      toast.success('Cadastro realizado com sucesso!');
      setLocation('/dashboard/simcar');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao cadastrar');
    } finally {
      setLoading(false);
    }
  };

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    void wakeBackend();
    try {
      await handleLogin(loginEmail, loginPassword);
      toast.success('Login realizado com sucesso!');
      setLocation('/dashboard/simcar');
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
      setLocation('/dashboard/simcar');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao entrar com Google');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-bg-deep overflow-hidden flex">
      {/* ═══ Background Ambient Effects ═══ */}
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-[#050b08]/55 z-0" />

      {/* Background image */}
      <div
        className="absolute inset-0 opacity-30 z-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('https://files.manuscdn.com/user_upload_by_module/session_file/310419663030608231/aWDbHEOGaMpaIiIr.jpg')",
        }}
      />

      {/* Gradient overlay (bottom to top) */}
      <div
        className="absolute inset-0 z-0"
        style={{
          background: 'linear-gradient(180deg, #00000066 0%, #0000001A 50%, #00000000 100%)',
        }}
      />

      {/* Ambient Glow — top left */}
      <div
        className="absolute z-0 opacity-60"
        style={{
          left: -300,
          top: -200,
          width: 1200,
          height: 1500,
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at 38% 50%, rgba(52,211,153,0.5) 0%, rgba(22,163,74,0.5) 30%, #050b08 100%)',
        }}
      />

      {/* Right Ambient Glow */}
      <div
        className="absolute z-0 opacity-35"
        style={{
          left: 750,
          top: 150,
          width: 700,
          height: 800,
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at 50% 50%, rgba(52,211,153,0.22) 0%, rgba(22,163,74,0.22) 35%, #050b08 100%)',
        }}
      />

      {/* Card Ambient Glow */}
      <div
        className="absolute z-0 opacity-25"
        style={{
          left: 750,
          top: 280,
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(52,211,153,0.15) 0%, transparent 100%)',
        }}
      />

      {/* ═══ Left Column — Brand ═══ */}
      <div className="relative z-10 w-full max-w-[620px] flex flex-col justify-center px-[60px] gap-6 hidden lg:flex">
        {/* Logo Glow (behind logo) */}
        <div
          className="absolute opacity-35"
          style={{
            left: 48,
            top: 378,
            width: 100,
            height: 100,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at 50% 50%, rgba(52,211,153,0.25) 0%, transparent 100%)',
          }}
        />

        {/* Accent Line */}
        <div
          className="h-[3px] rounded-sm"
          style={{
            width: 40,
            background: 'linear-gradient(90deg, #34d399, #6ee7b7)',
          }}
        />

        {/* Logo Box + Brand Name Row */}
        <div className="flex items-center gap-4">
          {/* Logo Box */}
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #34d399, #16a34a)',
            }}
          >
            <Trees className="w-8 h-8 text-[#07100d]" />
          </div>
          <h1 className="text-[48px] font-bold text-white leading-[1.1] font-heading">
            GeoForest IA
          </h1>
        </div>

        {/* Subtitle */}
        <p className="text-base text-accent-emerald leading-relaxed">
          Inteligência Artificial para Engenharia Florestal
        </p>

        {/* Description */}
        <p className="text-sm text-text-secondary leading-[1.65] max-w-md">
          Processamento inteligente de imagens de satélite, identificação de trilhas e estradas
          florestais, e monitoramento ambiental com tecnologia de ponta.
        </p>

        {/* Decorative Dots */}
        <div className="absolute left-[60px] top-[320px] w-1 h-1 rounded-full bg-accent-emerald opacity-40" />
        <div className="absolute left-[80px] top-[330px] w-1.5 h-1.5 rounded-full bg-accent-emerald opacity-25" />
        <div className="absolute left-[100px] top-[325px] w-[3px] h-[3px] rounded-full bg-accent-emerald opacity-50" />

        {/* Decorative Tree */}
        <Trees
          className="absolute left-[60px] bottom-[306px] w-[18px] h-[18px] text-accent-emerald opacity-15"
        />
      </div>

      {/* ═══ Right Column — Auth Card ═══ */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-10">
        {/* Mobile Brand (visible only on small screens) */}
        <div className="lg:hidden absolute top-10 left-0 right-0 flex flex-col items-center gap-2">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #34d399, #16a34a)' }}
          >
            <Trees className="w-7 h-7 text-[#07100d]" />
          </div>
          <h1 className="text-2xl font-bold text-white font-heading">GeoForest IA</h1>
          <p className="text-xs text-accent-emerald">IA aplicada à Engenharia Florestal</p>
        </div>

        {/* Auth Card */}
        <div
          className="w-full max-w-[440px] rounded-3xl border p-8 flex flex-col gap-8"
          style={{
            background: 'rgba(255,255,255,0.078)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            borderColor: 'rgba(34,211,238,0.25)',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.05), 0 16px 80px rgba(0,0,0,0.6), 0 0 50px rgba(34,211,238,0.09)',
          }}
        >
          {/* Card Top Accent */}
          <div
            className="h-[2px] w-full rounded-full opacity-80"
            style={{
              background: 'linear-gradient(90deg, #34d399, #16a34a)',
            }}
          />

          {/* Toggle Bar */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.04] border border-border-subtle">
            <button
              onClick={() => setMode('login')}
              className={`py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                mode === 'login'
                  ? 'text-white shadow-lg'
                  : 'text-white/60 hover:text-white/90'
              }`}
              style={
                mode === 'login'
                  ? { background: 'linear-gradient(135deg, #34d399, #16a34a)' }
                  : {}
              }
            >
              Entrar
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                mode === 'signup'
                  ? 'text-white shadow-lg'
                  : 'text-white/60 hover:text-white/90'
              }`}
              style={
                mode === 'signup'
                  ? { background: 'linear-gradient(135deg, #34d399, #16a34a)' }
                  : {}
              }
            >
              Cadastrar
            </button>
          </div>

          {/* ═══ Login Form ═══ */}
          {mode === 'login' && (
            <form onSubmit={onLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    className="pl-9 pr-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-white/50 hover:text-white/80 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold text-white shadow-lg disabled:opacity-50 transition-all"
                style={{
                  background: 'linear-gradient(135deg, #34d399, #16a34a)',
                }}
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

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[11px] text-white/50">ou</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Google Sign In */}
              <Button
                type="button"
                onClick={onGoogleSignIn}
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold text-gray-900 shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all bg-white/90 hover:bg-white"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.73 1.22 9.23 3.62l6.88-6.88C35.77 2.48 30.2 0 24 0 14.62 0 6.52 5.38 2.56 13.22l8.04 6.25C12.5 13.06 17.78 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.64-.15-3.22-.43-4.75H24v9h12.94c-.56 3.02-2.25 5.58-4.79 7.3l7.36 5.72c4.3-3.97 6.47-9.82 6.47-17.27z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.6 28.22c-.5-1.52-.78-3.14-.78-4.82s.28-3.3.78-4.82l-8.04-6.25C.92 15.41 0 19.6 0 23.4c0 3.8.92 7.99 2.56 11.07l8.04-6.25z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.2 0 11.77-2.05 15.69-5.58l-7.36-5.72c-2.05 1.38-4.66 2.2-8.33 2.2-6.22 0-11.5-3.56-13.4-8.48l-8.04 6.25C6.52 42.62 14.62 48 24 48z"
                  />
                </svg>
                Continuar com Google
              </Button>
            </form>
          )}

          {/* ═══ Sign Up Form ═══ */}
          {mode === 'signup' && (
            <form onSubmit={onSignUp} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type="text"
                    placeholder="Seu nome completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">Senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    className="pl-9 pr-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-white/50 hover:text-white/80 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-2">
                  Confirmar Senha
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 w-4 h-4 text-accent-emerald/70" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={signupConfirmPassword}
                    onChange={(e) => setSignupConfirmPassword(e.target.value)}
                    className="pl-9 pr-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-accent-emerald/50 focus:ring-accent-emerald/20 h-11 rounded-xl"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-white/50 hover:text-white/80 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold text-white shadow-lg disabled:opacity-50 transition-all"
                style={{
                  background: 'linear-gradient(135deg, #34d399, #16a34a)',
                }}
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

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-[11px] text-white/50">ou</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Google Sign In */}
              <Button
                type="button"
                onClick={onGoogleSignIn}
                disabled={loading}
                className="w-full h-11 rounded-xl text-sm font-semibold text-gray-900 shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all bg-white/90 hover:bg-white"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.73 1.22 9.23 3.62l6.88-6.88C35.77 2.48 30.2 0 24 0 14.62 0 6.52 5.38 2.56 13.22l8.04 6.25C12.5 13.06 17.78 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.64-.15-3.22-.43-4.75H24v9h12.94c-.56 3.02-2.25 5.58-4.79 7.3l7.36 5.72c4.3-3.97 6.47-9.82 6.47-17.27z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.6 28.22c-.5-1.52-.78-3.14-.78-4.82s.28-3.3.78-4.82l-8.04-6.25C.92 15.41 0 19.6 0 23.4c0 3.8.92 7.99 2.56 11.07l8.04-6.25z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.2 0 11.77-2.05 15.69-5.58l-7.36-5.72c-2.05 1.38-4.66 2.2-8.33 2.2-6.22 0-11.5-3.56-13.4-8.48l-8.04 6.25C6.52 42.62 14.62 48 24 48z"
                  />
                </svg>
                Continuar com Google
              </Button>

              {/* Terms */}
              <div className="pt-1 text-center space-y-2">
                <TermsOfUseDialog triggerClassName="inline-flex items-center gap-2 rounded-lg border border-accent-emerald/30 bg-accent-emerald/10 px-3 py-1.5 text-xs text-emerald-100 hover:bg-accent-emerald/20 transition-colors" />
                <p className="text-[11px] text-white/45">
                  Ao cadastrar, você declara que leu e concorda com os Termos de Uso.
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
