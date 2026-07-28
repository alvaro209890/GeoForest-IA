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

## Fase 2 — SettingsPanel

### O que foi feito

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos/constantes de settings | `client/src/dashboard/settings/types.ts` | `UserSettings`, `DEFAULT_SETTINGS`, opções de tema/fonte |
| Painel Settings | `client/src/dashboard/panels/SettingsPanel.tsx` | UI de perfil, créditos/billing e segurança |

### Integração

- `Dashboard.tsx` lazy-loada `SettingsPanel` sob `activeView === 'settings'`.
- Estado de settings/billing e o modal de topup permanecem em `Dashboard` (props + callbacks para o painel).
- Barrel `client/src/dashboard/index.ts` reexporta tipos de settings e props do painel.

## Fase 3 — CbersPanel + useCbersJobs (feita)

### O que foi feito

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos CBERS | `client/src/dashboard/cbers/types.ts` | scenes, estimates, jobs/histórico |
| Filenames | `client/src/dashboard/cbers/filenames.ts` | TIF/ZIP + URL archive |
| mapDoc | `client/src/dashboard/cbers/mapDoc.ts` | hydrate Firestore → history item |
| Hook | `client/src/dashboard/hooks/useCbersJobs.ts` | estado, SSE, poll, search/process |
| Painel | `client/src/dashboard/panels/CbersPanel.tsx` | UI + modal preview (lazy) |

### Integração

- `Dashboard.tsx` usa `useCbersJobs` e lazy-loada `CbersPanel` sob `activeView === 'cbers-wpm'`.
- Sidebar de histórico CBERS permanece no Dashboard (consome o hook).
- Detalhes: `docs/CHANGELOG_2026-07-24_CBERS_PANEL_E_SIMCAR_SNAP.md`.

### Tamanho

- `Dashboard.tsx`: ~12 265 → ~10 681 linhas.

## Fase 4 — LandsatPanel + useLandsatJobs (feita)

### O que foi feito

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos Landsat | `client/src/dashboard/landsat/types.ts` | composition, scenes, jobs/histórico |
| Filenames | `client/src/dashboard/landsat/filenames.ts` | ZIP + URL WMS archive |
| mapDoc | `client/src/dashboard/landsat/mapDoc.ts` | normalize scene + hydrate Firestore |
| Hook | `client/src/dashboard/hooks/useLandsatJobs.ts` | estado, SSE, poll, search/process/download |
| Painel | `client/src/dashboard/panels/LandsatPanel.tsx` | UI completa (lazy) |

### Integração

- `Dashboard.tsx` usa `useLandsatJobs` e lazy-loada `LandsatPanel` sob `activeView === 'landsat'`.
- Sidebar de histórico Landsat permanece no Dashboard (consome o hook).
- Reusa `CbersMapPreview` (não movido).
- Detalhes: `docs/CHANGELOG_2026-07-24_LANDSAT_PANEL.md`.

### Tamanho

- `Dashboard.tsx`: ~10 681 → ~9 534 linhas.

## Testes

```bash
pnpm test          # vitest — rotas + cbers/landsat (filenames/mapDoc)
pnpm check         # tsc --noEmit
pnpm exec vitest run backend/simcar-clip-snap.test.ts --root .  # snap geometry
pnpm build:app     # vite build (opcional, mais lento)
```

Cobertura: `routes.test.ts`, `cbers/*`, `landsat/filenames.test.ts`, `landsat/mapDoc.test.ts`, `simcar-clip-snap.test.ts`.

## Fases seguintes (roadmap)

1. **Painel SIMCAR** — maior superfície; extrair em subpainéis (upload, progresso, resultado).
2. **Painel Erros** — vértices + wrappers dos analyses já lazy.
3. **Fetch sob demanda** — carregar histórico só da `activeView`.
4. **Remover código morto** — `ProcessarProjetoAnalysis.tsx`, `Home.tsx` placeholder.
5. **Backend** — continuar slices de `simcar-clip.ts` (SSE helpers, parse shapefile).

## Fase 5 entregue (2026-07-28) — Sobreposições

- Aba `sobreposicoes` (`/dashboard/sobreposicoes`): hook `useOverlapJobs` + `SobreposicoesPanel`.
- Backend `overlap-analysis.ts` + cliente `sigef-client.ts`.
- Docs: `SOBREPOSICOES_CAR_SIGEF.md`, `CHANGELOG_2026-07-28_SOBREPOSICOES.md`.
- Testes dashboard: incluir `sobreposicoes/mapDoc.test.ts` (34 passed no pacote dashboard).

## Convenções

- Novos painéis em `client/src/dashboard/panels/<Nome>Panel.tsx`.
- Hooks de domínio em `client/src/dashboard/hooks/use<Dominio>.ts`.
- Utilitários HTTP só em `client/src/lib/api.ts` (não recriar `apiUrl` local).
- Toda troca de aba passa por `navigateView` / `getPathForView`.
- Documentar cada fase em `docs/CHANGELOG_YYYY-MM-DD_*.md`.

## Validação manual sugerida

1. Login → `/dashboard/simcar` na URL.
2. Clicar CBERS → URL `/dashboard/cbers`; F5 mantém a aba; painel lazy (“Carregando CBERS...”).
3. Buscar cenas (ZIP/CAR/órbita·ponto) → selecionar → gerar → progresso SSE → download/cancel.
4. Clicar Landsat → URL `/dashboard/landsat`; painel lazy (“Carregando Landsat...”); buscar/reusar WMS.
5. Voltar no browser → volta para SIMCAR sem perder a sessão.
6. Abrir Recibos / AUAS / Manual / Configurações → loading curto (lazy) depois o painel.
7. Novo Recorte / abas ativas em verde esmeralda.
8. Em Configurações: saldo, histórico e “Adicionar créditos” (modal de topup ainda no Dashboard).

## Status GitHub / Deploy

- **Mergeado em `main`**: fases 1–2 (`4a2a4e40`).
- **Local (esta sessão)**: fases 3–4 (CBERS + Landsat) + `simcar-clip-snap.ts` — ver changelogs de 2026-07-24.
- **Build**: `pnpm check` OK; testes dashboard: 29 passed.
- **Firebase Hosting**: deploy **pendente** até commit/push explícito.
