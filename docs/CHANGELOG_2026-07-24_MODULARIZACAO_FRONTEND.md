# CHANGELOG - 2026-07-24 - Modularização Frontend (Fase 1 + Fase 2 Settings)

## Resumo

Quebra do monólito `Dashboard.tsx`: fundação de módulos (Fase 1) e extração do painel de Configurações (Fase 2).

Documento de acompanhamento: [FRONTEND_MODULARIZACAO.md](./FRONTEND_MODULARIZACAO.md).

## Fase 1 — Fundação

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

## Fase 2 — SettingsPanel

### Novos módulos

- `client/src/dashboard/settings/types.ts` — `UserSettings`, `DEFAULT_SETTINGS`, `SETTINGS_THEME_OPTIONS`, `SETTINGS_FONT_SIZE_OPTIONS`
- `client/src/dashboard/panels/SettingsPanel.tsx` — view de Configurações (perfil, créditos, segurança)

### Integração

- `Dashboard.tsx` importa tipos/constantes de settings e lazy-loada `SettingsPanel`
- Modal de topup de créditos permanece em `Dashboard` (acoplado ao fluxo de billing)
- Barrel `client/src/dashboard/index.ts` atualizado

## Validação

- `pnpm test` — 15 testes OK (rotas + api)
- `pnpm check` — sem erros novos no client (backend `jszip` pré-existente)
- `pnpm build:app` — OK; chunks lazy:
  - `SettingsPanel-*.js` (~27 KB)
  - `AuasSccon-*.js` / `ContainmentAnalysis-*.js` / `GeometryErrorsAnalysis-*.js`
  - `ReceiptsHub-*.js` / `FeaturesManual-*.js`
  - `DashboardRouter-*.js` ~478 KB (era ~502 KB)

## GitHub

- Mergeado em **`main`** (`4a2a4e40`).
- Deploy Firebase Hosting neste ambiente cloud: **bloqueado** (sem sessão/`FIREBASE_TOKEN`). Instruções em `FRONTEND_MODULARIZACAO.md`.
