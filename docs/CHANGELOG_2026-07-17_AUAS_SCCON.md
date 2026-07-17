# Changelog 2026-07-17 — Automação AUAS × Alertas SCCON

## Resumo

Nova funcionalidade que **data automaticamente** os polígonos AUAS cruzando-os
com os alertas de desmate da plataforma SCCON (SEMA-MT) e gera um shape de
pontos das AUAS sem alerta. Portada de um script Python de referência
([`Automacao_AUAS/`](../Automacao_AUAS/)) para o stack Node/TypeScript do sistema.

Documentação completa: [`AUAS_SCCON.md`](./AUAS_SCCON.md).

## Backend

- **Novo** [`backend/auas-sccon.ts`](../backend/auas-sccon.ts):
  - Cliente SCCON: token público → WFS `GetFeature` no bbox → `localAlerts/{id}`
    em pool paralelo (12 workers), com headers de browser (Cloudflare).
  - Leitura do ZIP AUAS reusando `parsePolygonRecords` / `readDbfRows` /
    `detectCrs` + `proj4`; seleção automática da camada AUAS (com `ABERTURA`).
  - Spatial join `@turf/turf` (`booleanIntersects` + prefiltro por bbox) →
    `ABERTURA = MIN(alertDetectedDate)` (ou MAX, configurável).
  - **Preservação da geometria:** só o `.dbf` é reescrito; `.shp/.shx/.prj`
    saem idênticos ao original.
  - Geração de pontos das AUAS sem alerta, relatório JSON de auditoria e ZIP.
  - Rotas: `POST /api/auas-sccon/process` (SSE), `GET /api/auas-sccon/download/:jobId`,
    `GET /api/auas-sccon/config`. Endpoints públicos (padrão do `/api/simcar/clip`).
  - Aviso no relatório quando o WFS atinge o teto de 10.000 feições.
- **Novo** [`backend/auas-sccon.test.ts`](../backend/auas-sccon.test.ts): 3 testes
  (join + regra MIN/MAX, reescrita do DBF, geração de pontos).
- [`backend/index.ts`](../backend/index.ts): import + `registerAuasScconRoutes(app)`.

## Frontend

- **Novo** [`client/src/components/AuasSccon.tsx`](../client/src/components/AuasSccon.tsx):
  aba autocontida com upload do ZIP (drag & drop), toggle **MIN/MAX**, barra de
  progresso via SSE, cards de resumo, avisos, prévia da tabela antes/depois e
  botão de download.
- [`client/src/pages/Dashboard.tsx`](../client/src/pages/Dashboard.tsx): nova view
  `auas-sccon` (union type, botão de navegação **AUAS**, rótulo do header e
  branch de renderização).
- [`client/src/pages/DashboardRouter.tsx`](../client/src/pages/DashboardRouter.tsx):
  rota `/dashboard/auas` → view `auas-sccon`.

## Verificação

- `tsc --noEmit` limpo; `vite build` + `esbuild` do backend OK.
- Testes unitários passando (3/3).
- **E2E ao vivo** contra a API SCCON real: token → WFS → localAlerts → join →
  ZIP, com AUAS sintético sobre Mato Grosso (polígono em área de desmate datado;
  polígono limpo convertido em ponto sem-alerta).

## Deploy

- Frontend: `pnpm run build` + `npx firebase deploy --only hosting`.
- Backend: recarregar via `systemctl --user restart geoforest-backend.service`.
