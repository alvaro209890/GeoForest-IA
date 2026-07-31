# Plano: Desmembramento de `client/src/pages/Dashboard.tsx`

**Arquivo atual:** `client/src/pages/Dashboard.tsx` — 9,765 linhas
**Objetivo:** Separar layout, estado, navegação e sub-páginas em arquivos independentes

---

## Estrutura proposta

```
client/src/
├── pages/
│   ├── Dashboard.tsx                # entry (~150 linhas)
│   ├── dashboard/
│   │   ├── DashboardLayout.tsx      # layout: sidebar + header + conteúdo (~200 linhas)
│   │   ├── DashboardContent.tsx     # switch de abas (~150 linhas)
│   │   ├── DashboardAuthGate.tsx    # auth + loading + redirect (~100 linhas)
│   │   ├── MobileBottomNav.tsx      # navegação inferior mobile (~120 linhas)
│   │   ├── SidebarNav.tsx           # sidebar desktop (~180 linhas)
│   │   ├── SimcarPage.tsx           # já existe — manter imports
│   │   ├── CbersPage.tsx            # já existe
│   │   ├── LandsatPage.tsx          # já existe
│   │   ├── RecibosPage.tsx          # já existe
│   │   ├── ErrosPage.tsx            # já existe
│   │   ├── ChatPage.tsx             # já existe
│   │   ├── ManualPage.tsx           # já existe
│   │   ├── ConfiguracoesPage.tsx    # já existe
│   │   └── ProjectDetailPage.tsx    # já existe
│   └── ...
├── hooks/
│   ├── useAuth.ts                   # hook: auth state, refresh, redirect (~150 linhas)
│   ├── useDashboardNavigation.ts    # hook: abas + URL sync (~100 linhas)
│   └── useShapefileUpload.ts        # hook: upload com progresso (~150 linhas)
└── context/
    └── DashboardContext.tsx          # React context: estado global (~80 linhas)
```

---

## O que já está modularizado (NÃO MEXER)

O projeto já tem uma modularização parcial iniciada:
- `client/src/dashboard/panels/` — CbersPanel, LandsatPanel, CroquiPanel, SettingsPanel, SobreposicoesPanel
- `client/src/dashboard/hooks/` — useCbersJobs, useLandsatJobs, useCroquiJobs, useOverlapJobs, useDashboardNavigation
- `client/src/pages/dashboard/` — sub-páginas separadas (SimcarPage, CbersPage, etc)
- `client/src/dashboard/types.ts` — tipos compartilhados
- `client/src/dashboard/routes.ts` — definição de rotas

O problema é que `Dashboard.tsx` ainda concentra **toda a lógica de montagem**: estado, auth, sidebar, header, navegação, contexto, upload.

---

## Mapeamento: o que extrair de `Dashboard.tsx`

### `context/DashboardContext.tsx`
Estado global que hoje vive em `useState` no topo do Dashboard:
```typescript
interface DashboardContextValue {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  uploadedFile: File | null;
  setUploadedFile: (file: File | null) => void;
  geoJsonData: GeoJSON | null;
  setGeoJsonData: (data: GeoJSON | null) => void;
  isMobile: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}
```

### `DashboardAuthGate.tsx`
- Envolve o dashboard com verificação de auth
- Mostra tela de loading enquanto verifica Firebase
- Redireciona para `/auth` se não autenticado
- Atualiza token automaticamente

### `DashboardLayout.tsx`
- Estrutura visual: sidebar + header + área de conteúdo
- Responsivo: mobile empilhado vs desktop lado a lado
- Header: logo, avatar, notificações
- Sidebar: navegação entre abas

### `SidebarNav.tsx`
- Lista de abas com ícones
- Indicador de aba ativa
- Recolher/expandir
- Versão mobile simplificada

### `MobileBottomNav.tsx`
- Barra inferior no mobile (< 768px)
- Ícones + labels
- Badge de notificações

### `DashboardContent.tsx`
- Switch/case baseado na aba ativa:
  ```tsx
  switch (activeTab) {
    case 'simcar': return <SimcarPage />;
    case 'cbers': return <CbersPage />;
    case 'landsat': return <LandsatPage />;
    case 'croqui': return <CroquiPage />;
    // ...
  }
  ```

### `Dashboard.tsx` (novo, enxuto)
```tsx
import { DashboardProvider } from '@/context/DashboardContext';
import { DashboardAuthGate } from './dashboard/DashboardAuthGate';
import { DashboardLayout } from './dashboard/DashboardLayout';

export default function Dashboard() {
  return (
    <DashboardAuthGate>
      <DashboardProvider>
        <DashboardLayout />
      </DashboardProvider>
    </DashboardAuthGate>
  );
}
```

---

## Passo a passo

### Passo 1: Criar `DashboardContext.tsx`
- Extrair todos os `useState` do topo do Dashboard
- Criar provider + hook `useDashboard()`
- **Validar:** Dashboard renderiza sem erros

### Passo 2: Criar `DashboardAuthGate.tsx`
- Extrair lógica de auth, loading, redirect
- **Validar:** Logar, deslogar, refresh

### Passo 3: Criar `SidebarNav.tsx`
- Extrair JSX da sidebar
- **Validar:** Navegação entre abas funciona

### Passo 4: Criar `MobileBottomNav.tsx`
- Extrair navegação mobile
- **Validar:** Testar no celular (375px)

### Passo 5: Criar `DashboardLayout.tsx`
- Compor SidebarNav + MobileBottomNav + header + conteúdo
- **Validar:** Layout responsivo

### Passo 6: Criar `DashboardContent.tsx`
- Extrair switch de abas
- **Validar:** Cada aba carrega corretamente

### Passo 7: Simplificar `Dashboard.tsx`
- Reduzir ao esqueleto mínimo
- **Validar:** Funcionalidade idêntica

---

## ⚠️ Cuidados

### 1. Performance — re-renders
Ao criar `DashboardContext`, cuidado com:
- `value={{ ... }}` inline recria objeto a cada render → `useMemo`
- Estados que mudam com frequência (upload progress) não devem ir pro contexto global
- Separar contexto "estável" (auth, layout) de "volátil" (dados de shapefile)

### 2. Mobile vs Desktop
- `isMobile` hook (`useMobile`) já existe → usar, não recriar
- Sidebar colapsa automaticamente no mobile
- Touch targets mantidos (44px min)

### 3. URL sync
O dashboard usa `useDashboardNavigation` (já existe) que sincroniza abas com URL (`/dashboard/cbers`, `/dashboard/landsat`). Isso **não muda** com o desmembramento — o hook continua funcionando.

### 4. Hot reload
React + Vite HMR funciona melhor com arquivos menores. O desmembramento vai **melhorar** o HMR, não piorar.

---

## Como validar

```bash
npm run dev                           # sobe dev server
# Testar cada aba manualmente
# Testar mobile (DevTools → iPhone 13)
# Testar login/logout
# Testar URL direta (/dashboard/cbers)

npx tsc --noEmit                      # TypeScript
npx vitest run client/                # testes existentes
```

---

## Estimativa

| Passo | Tempo | Risco |
|-------|-------|-------|
| DashboardContext | 15 min | Baixo |
| DashboardAuthGate | 15 min | Baixo |
| SidebarNav | 20 min | Baixo |
| MobileBottomNav | 15 min | Baixo |
| DashboardLayout | 20 min | Médio |
| DashboardContent | 15 min | Baixo |
| Simplificar Dashboard.tsx | 10 min | Baixo |
| Testar mobile | 15 min | Baixo |
| **Total** | **~2 h** | |
