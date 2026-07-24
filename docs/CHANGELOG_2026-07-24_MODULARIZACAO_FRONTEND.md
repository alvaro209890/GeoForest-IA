# CHANGELOG - 2026-07-24 - Modularização Frontend (Fase 1)

## Resumo

Início da quebra do monólito `Dashboard.tsx`: fundação de módulos, sincronização URL ↔ abas, lazy load de painéis já extraídos e API HTTP compartilhada.

Documento de acompanhamento: [FRONTEND_MODULARIZACAO.md](./FRONTEND_MODULARIZACAO.md).

## Alterações

### Novos módulos

- `client/src/lib/api.ts`
- `client/src/dashboard/` (`types`, `routes`, `hooks`, `components`, `index`)
- `client/src/dashboard/routes.test.ts`

### Integração

- `Dashboard.tsx` consome `@/dashboard` e `@/lib/api`
- `DashboardRouter.tsx` sem `key={view}` (evita remount)
- `AuasSccon` / `ContainmentAnalysis` / `GeometryErrorsAnalysis` usam helpers compartilhados
- Lazy: Recibos, AUAS, Containment, Geometry (+ Features já existente)

### UX

- Deep links `/dashboard/*` passam a refletir a aba ativa
- Aba SIMCAR e “Novo Recorte” alinhados à paleta esmeralda

## Validação

- `pnpm test` — 13 testes de rotas OK
- `pnpm check` — sem erros novos no client (backend `jszip` pré-existente)
- `pnpm build:app` — OK; chunks lazy gerados:
  - `AuasSccon-*.js` (~15 KB)
  - `ContainmentAnalysis-*.js` (~29 KB)
  - `GeometryErrorsAnalysis-*.js` (~33 KB)
  - `ReceiptsHub-*.js` (~47 KB)
  - `FeaturesManual-*.js` (~75 KB)
  - `DashboardRouter-*.js` ainda ~502 KB (próximas fases: extrair CBERS/Landsat/SIMCAR)
