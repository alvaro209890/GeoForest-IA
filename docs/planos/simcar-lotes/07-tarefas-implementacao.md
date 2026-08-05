# 07 — Tarefas de Implementação (ordem, TDD, commits)

> Cada tarefa = 2–5 min de foco. Commit após cada tarefa. Rodar `pnpm run check` + `pnpm run test` antes de cada commit.
> **Nota:** a fase de descoberta não é mais necessária — os 3 endpoints do escopo (A1) já estão validados ao vivo (doc 03).

## Fase 1 — Backend

### Tarefa 1.1: Refactor de sessão por credencial no `client.ts`
**Files:** `backend/simcar-oraculo/client.ts`, novo `backend/simcar-oraculo/client-session.test.ts`
1. Teste falhando: duas credenciais → tokens distintos sem colisão; `getSimcarToken()` (env) intacto.
2. Implementar `Map` de sessões + single-flight por chave (`getSimcarTokenFor(cpf, senha)`, `clearSimcarTokenCache(chave?)`, `withSimcarAuthRetryFor`).
3. Testes verdes. **Commit:** `refactor(simcar): sessao por credencial no client`

### Tarefa 1.2: Mutex por conta (fila serial)
**Files:** `backend/simcar-lotes/session-queue.ts` + teste
1. Teste: mesma chave serializa; chaves diferentes paralelas; timeout → erro.
2. Implementar fila de promessas. **Commit:** `feat(simcar-lotes): fila exclusiva por conta SIMCAR`

### Tarefa 1.3: `recibo-parse.ts` + fixtures
**Files:** `backend/simcar-lotes/recibo-parse.ts`, `recibo-parse.test.ts`, fixtures sintéticas
1. Teste com fixture sintética (layout do recibo estadual) → extrai `MT10005/2019`, recibo federal, propriedade, município; PDF sem padrão → `null`s.
2. Implementar regex + normalização. **Commit:** `feat(simcar-lotes): parser do recibo de inscricao`

### Tarefa 1.4: `resolver.ts`
**Files:** `backend/simcar-lotes/resolver.ts` + teste (mock fetch)
1. Teste: `ListarRasc` → filtra `NumeroCompleto` exato; fallback federal via público; não encontrado → erro mapeado.
2. Implementar. **Commit:** `feat(simcar-lotes): resolver CAR -> requerimentoId`

### Tarefa 1.5: `downloader.ts` (Arquivo Enviado + Arquivo Processado + Recibo)
**Files:** `backend/simcar-lotes/downloader.ts` + teste (mock `simcarDownload` + `fetch` público)
1. Teste: 200 ok / 400 skip+faltante / 401 retry / magic check / recibo público falha → fallback cópia do enviado.
2. Implementar tabela de 3 artefatos (doc 04) com `withSimcarAuthRetryFor` + sessão do job. **Commit:** `feat(simcar-lotes: download enviado/processado/recibo`

### Tarefa 1.6: `zip-builder.ts`
**Files:** `backend/simcar-lotes/zip-builder.ts` + teste
1. Teste: pasta por lote, nomes sanitizados, recibo incluso, ZIP único.
2. Implementar (archiver). **Commit:** `feat(simcar-lotes: zip com pasta por lote`

### Tarefa 1.7: rotas + job SSE (`index.ts`) + registro
**Files:** `backend/simcar-lotes/index.ts`, `types.ts`, `backend/routes/_registry.ts`, `backend/app.ts`
1. Implementar `parse-recibos`, `process` (startJob/persistJob/SSE/heartbeat/cancel), `jobs/:id/status|events`, `download/:jobId` (padrão `croqui.ts`; helpers `local-storage`).
2. Registrar no registry + `AUTH_REQUIRED_PATHS`.
3. `pnpm run check` + testes verdes. **Commit:** `feat(simcar-lotes): rotas e job SSE`

## Fase 2 — Frontend

### Tarefa 2.1: tipos, rotas e sidebar
**Files:** `client/src/dashboard/types.ts`, `routes.ts`, `routes.test.ts`, `DashboardSidebarTabs.tsx`
1. Teste de rota `/dashboard/lotes`.
2. Registrar view/tab/rota/entrada da sidebar. **Commit:** `feat(front): aba Lotes SIMCAR (tipos/rotas/sidebar)`

### Tarefa 2.2: `SimcarLotesPanel.tsx` (credenciais + dropzone + análise)
1. Credenciais em `localStorage['geoforest_simcar_credenciais_v1']` (**chave própria do GeoForest** — decisão A5).
2. Dropzone PDF/ZIP → embrulha PDFs soltos em ZIP → `POST /api/simcar-lotes/parse-recibos` → tabela de lotes detectados.
3. Lazy import + render no `Dashboard.tsx`. **Commit:** `feat(front): painel Lotes SIMCAR (credenciais e analise)`

### Tarefa 2.3: processamento + progresso SSE + download
1. Botão "Baixar documentos" → `POST /process` → SSE progress (fases/contadores) + Cancelar.
2. Link do ZIP final + relatório por lote (baixados/faltantes/erros).
3. `pnpm run check` + `pnpm run test` verdes. **Commit:** `feat(front): Lotes SIMCAR processamento e download`

## Fase 3 — Validação e docs

### Tarefa 3.1: validação manual + live
1. Live e2e (guard `SIMCAR_LIVE=1`, CAR 271442) e fluxo manual completo (doc 06).
2. **Commit:** `test(simcar-lotes): e2e live`

### Tarefa 3.2: changelog + docs
1. `docs/CHANGELOG_2026-08-05_SIMCAR_LOTES.md` (padrão dos changelogs do repo).
2. `STATUS.md` → CONCLUÍDO. **Commit:** `docs(simcar-lotes): changelog`

## Sequência final

```bash
pnpm run check && pnpm run test && pnpm run build
git add -A && git commit -m "feat(simcar-lotes): aba de download de documentos do CAR" && git push origin main
# deploy: ver 08-deploy-e-ops.md
```
