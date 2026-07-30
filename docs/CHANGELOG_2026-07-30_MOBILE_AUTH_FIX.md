# Fix: Login mobile (Google Auth — popup vs redirect)

**Data:** 30/07/2026

## Problema

Erro ao fazer login com Google em navegadores mobile:

> "Unable to process request due to missing initial state. This may happen if browser sessionStorage is inaccessible or accidentally cleared."

**Causa raiz:** O Firebase Auth usa `signInWithPopup` para login Google. Em navegadores mobile (Safari, Chrome com ITP, Brave), popups são bloqueados e o SDK tenta processar um redirect que nunca foi iniciado, resultando no erro `auth/missing-initial-state` — o `sessionStorage` onde o estado do redirect é salvo fica inacessível ou é limpo entre navegações.

## Solução

Adicionado fallback de `signInWithPopup` → `signInWithRedirect` em 2 camadas:

1. **`client/src/lib/auth.ts`**:
   - `handleGoogleSignIn()` agora captura `auth/popup-blocked` e `auth/popup-closed-by-user` e faz fallback automático para `signInWithRedirect()`
   - Nova função `handleGoogleRedirectResult()` — processa o resultado do redirect OAuth (chama `getRedirectResult()`), lida silenciosamente com `auth/missing-initial-state` (quando não há redirect pendente) e outros erros esperados

2. **`client/src/pages/Auth.tsx`**:
   - `useEffect` do auth agora chama `handleGoogleRedirectResult()` no mount da página de login, capturando o resultado do redirect quando o usuário volta do Google OAuth
   - Redireciona automaticamente para `/dashboard/simcar` em caso de sucesso

## Fluxo resultante

```
Desktop: Google Sign-In → signInWithPopup (funciona direto)
Mobile:  Google Sign-In → signInWithPopup (bloqueado)
                         → fallback: signInWithRedirect → vai pro Google
                         → volta → handleGoogleRedirectResult() → dashboard
```

## Arquivos modificados

- `client/src/lib/auth.ts` — imports + funções de redirect
- `client/src/pages/Auth.tsx` — chamada do redirect result no mount

## Build & Deploy

- `pnpm run build:app` ✅
- `firebase deploy --only hosting` ✅ (ia-florestal + geoforest-admin)
