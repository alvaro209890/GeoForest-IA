# Modularização do Frontend Dashboard

Documento vivo da quebra do monólito `client/src/pages/Dashboard.tsx` (~13k linhas).

## Objetivo

Separar o Dashboard em módulos com responsabilidades claras, sem mudar o comportamento das ferramentas (SIMCAR, CBERS, Landsat, Erros, AUAS, Recibos, Settings).

## Fase 1 — Fundação (esta PR)

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

## Testes

```bash
pnpm test          # vitest — rotas do dashboard
pnpm check         # tsc --noEmit
pnpm build:app     # vite build (opcional, mais lento)
```

Cobertura inicial: `client/src/dashboard/routes.test.ts` (mapeamento path ↔ view).

## Fases seguintes (roadmap)

1. **Painel Settings** — extrair JSX/estado de configurações + billing para `dashboard/panels/SettingsPanel.tsx`.
2. **Painel CBERS** — mover estado + UI CBERS (~800 linhas) para `panels/CbersPanel.tsx` + hook `useCbersJobs`.
3. **Painel Landsat** — espelhar CBERS.
4. **Painel SIMCAR** — maior superfície; extrair em subpainéis (upload, progresso, resultado).
5. **Painel Erros** — vértices + wrappers dos analyses já lazy.
6. **Fetch sob demanda** — carregar histórico só da `activeView`.
7. **Remover código morto** — `ProcessarProjetoAnalysis.tsx`, `Home.tsx` placeholder.

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
4. Abrir Recibos / AUAS / Manual → loading curto (lazy) depois o painel.
5. Novo Recorte / abas ativas em verde esmeralda.
