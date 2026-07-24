# Modularização do Frontend Dashboard

Documento vivo da quebra do monólito `client/src/pages/Dashboard.tsx`.

## Objetivo

Separar o Dashboard em módulos com responsabilidades claras, sem mudar o comportamento das ferramentas (SIMCAR, CBERS, Landsat, Erros, AUAS, Recibos, Settings).

## Fase 1 — Fundação

### O que foi feito

| Módulo | Caminho | Papel |
|--------|---------|--------|
| API compartilhada | `client/src/lib/api.ts` | `apiUrl`, `apiFetch`, `fileToBase64`, `readApiError`, `resolveBackendUrl` |
| Tipos de view | `client/src/dashboard/types.ts` | `DashboardView`, labels |
| Rotas | `client/src/dashboard/routes.ts` | `getViewFromPath` / `getPathForView` |
| Navegação | `client/src/dashboard/hooks/useDashboardNavigation.ts` | sync URL ↔ aba |
| Abas do sidebar | `client/src/dashboard/components/DashboardSidebarTabs.tsx` | segmented control + a11y `role="tab"` |
| Preview CBERS | `client/src/dashboard/components/CbersMapPreview.tsx` | mapa + helpers de geometria |
| Barrel | `client/src/dashboard/index.ts` | reexports |

### Comportamento corrigido

1. **URL sincronizada** — trocar de aba atualiza `/dashboard/...` (deep link, refresh e histórico do browser).
2. **Sem remount** — `DashboardRouter` não usa mais `key={view}` (preserva jobs/estado ao navegar).
3. **Lazy load** — `ReceiptsHub`, `AuasSccon`, `ContainmentAnalysis`, `GeometryErrorsAnalysis` e `FeaturesManual` entram sob demanda.
4. **Brand** — aba SIMCAR e botão “Novo Recorte” usam gradiente esmeralda (antes roxo/índigo).

### Consumidores atualizados

- `Dashboard.tsx` — importa módulos; `navigateView` no lugar de `setActiveView` para navegação.
- `DashboardRouter.tsx` — usa `getViewFromPath`.
- `AuasSccon`, `ContainmentAnalysis`, `GeometryErrorsAnalysis` — usam `fileToBase64` / `apiUrl` de `@/lib/api`.

## Fase 2 — SettingsPanel (esta PR)

### O que foi feito

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos/constantes de settings | `client/src/dashboard/settings/types.ts` | `UserSettings`, `DEFAULT_SETTINGS`, opções de tema/fonte |
| Painel Settings | `client/src/dashboard/panels/SettingsPanel.tsx` | UI de perfil, créditos/billing e segurança |

### Integração

- `Dashboard.tsx` lazy-loada `SettingsPanel` sob `activeView === 'settings'`.
- Estado de settings/billing e o modal de topup permanecem em `Dashboard` (props + callbacks para o painel).
- Barrel `client/src/dashboard/index.ts` reexporta tipos de settings e props do painel.

## Testes

```bash
pnpm test          # vitest — rotas do dashboard
pnpm check         # tsc --noEmit
pnpm build:app     # vite build (opcional, mais lento)
```

Cobertura inicial: `client/src/dashboard/routes.test.ts` (mapeamento path ↔ view).

## Fases seguintes (roadmap)

1. **Painel CBERS** — mover estado + UI CBERS (~800 linhas) para `panels/CbersPanel.tsx` + hook `useCbersJobs`.
2. **Painel Landsat** — espelhar CBERS.
3. **Painel SIMCAR** — maior superfície; extrair em subpainéis (upload, progresso, resultado).
4. **Painel Erros** — vértices + wrappers dos analyses já lazy.
5. **Fetch sob demanda** — carregar histórico só da `activeView`.
6. **Remover código morto** — `ProcessarProjetoAnalysis.tsx`, `Home.tsx` placeholder.

## Convenções

- Novos painéis em `client/src/dashboard/panels/<Nome>Panel.tsx`.
- Hooks de domínio em `client/src/dashboard/hooks/use<Dominio>.ts`.
- Utilitários HTTP só em `client/src/lib/api.ts` (não recriar `apiUrl` local).
- Toda troca de aba passa por `navigateView` / `getPathForView`.
- Documentar cada fase em `docs/CHANGELOG_YYYY-MM-DD_*.md`.

## Validação manual sugerida

1. Login → `/dashboard/simcar` na URL.
2. Clicar CBERS → URL `/dashboard/cbers`; F5 mantém a aba.
3. Voltar no browser → volta para SIMCAR sem perder a sessão.
4. Abrir Recibos / AUAS / Manual / Configurações → loading curto (lazy) depois o painel.
5. Novo Recorte / abas ativas em verde esmeralda.
6. Em Configurações: saldo, histórico e “Adicionar créditos” (modal de topup ainda no Dashboard).

## Status GitHub / Deploy

- **Mergeado em `main`**: commit `4a2a4e40` (fases 1–2 + firebase-tools).
- **Build**: `pnpm build:app` → `dist/public` (`SettingsPanel` ~27 KB; `DashboardRouter` ~478 KB).
- **Firebase Hosting**: deploy **pendente** neste ambiente cloud (sem `firebase login` nem `FIREBASE_TOKEN`). Projeto: `ia-florestal` → `https://ia-florestal.web.app`.

### Publicar hosting (PC já autenticado)

```bash
git pull origin main
pnpm install
pnpm build:app
pnpm exec firebase deploy --only hosting --project ia-florestal
```

Token para CI/cloud agent (gerar no PC logado):

```bash
firebase login:ci
export FIREBASE_TOKEN='...'
pnpm exec firebase deploy --only hosting --project ia-florestal --non-interactive
```
