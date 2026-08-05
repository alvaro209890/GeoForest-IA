# 07 — Tarefas de Implementação (ordem, TDD, commits)

> Cada tarefa = 2–5 min de foco. Commit após cada tarefa. Rodar `pnpm run check` + `pnpm run test` antes de cada commit.
> Referência de API atual: `backend/simcar-lotes/{job,routes,downloader,session-queue,sse}.ts`, `backend/simcar-oraculo/client.ts`.

## Fase 1 — Backend: leitura do monitor

### Tarefa 1.1: `monitor.ts` — `lerOcupacaoSimcar` + cache
**Files:** `backend/simcar-lotes/monitor.ts`, `monitor.test.ts`
1. Teste (mock fetch): recente→ocupado (com `por` = mais recente), velho/vazio→livre, fallback `current`, erro→fail-open.
2. Implementar leitura REST + regra STALE (doc 03) + cache 5s (`lerOcupacaoSimcarCached`).
3. Teste R2 (superfície): nenhuma chamada de escrita para presence no módulo.
4. `pnpm run test` verde. **Commit:** `feat(simcar-lotes): leitura do monitor SIMCAR (read-only)`

### Tarefa 1.2: `aguardar.ts` — espera cancelável
**Files:** `backend/simcar-lotes/aguardar.ts`, `aguardar.test.ts`
1. Teste: sequência ocupado→ocupado→livre; cancelamento; progress com fase/por; POLL_MS configurável.
2. Implementar loop (doc 04). **Commit:** `feat(simcar-lotes): espera cancelavel pelo SIMCAR livre`

## Fase 2 — Backend: gate e retry no job

### Tarefa 2.1: Gate R1 no `job.ts` (antes da fila + re-checagem interna)
**Files:** `backend/simcar-lotes/job.ts`, `job.test.ts` (criar se não existir)
1. Teste: monitor ocupado → `getSimcarTokenFor` só chamado após liberar; cancelamento durante a espera → job cancelado.
2. Implementar `aguardarSimcarLivre` antes do `comSessaoExclusiva` + re-checagem dentro, antes do login (doc 04).
3. **Commit:** `feat(simcar-lotes): aguarda SIMCAR livre antes de logar`

### Tarefa 2.2: Retry R3 (sessão interrompida) por lote
**Files:** `backend/simcar-lotes/job.ts` (+ helper `isSessaoDerrubada` em `monitor.ts` ou `job.ts`), `job.test.ts`
1. Teste: 401 persistente no lote 2 → fase `sessao_interrompida` com `por`, cache limpo, espera, re-tentativa do mesmo lote; lotes anteriores preservados; `SIMCAR_MONITOR_MAX_RETRY` respeitado quando > 0.
2. Implementar laço de tentativas em volta do corpo do `for` dos lotes (doc 04, item 3).
3. **Commit:** `feat(simcar-lotes): retoma lote automaticamente apos interrupcao`

### Tarefa 2.3: endpoint `monitor-status` + auth
**Files:** `backend/simcar-lotes/routes.ts`, `backend/app.ts`, `routes.test.ts`
1. Teste: 401 sem auth; shape com auth; cache 5s.
2. Implementar rota + `AUTH_REQUIRED_PATHS`.
3. `pnpm run check` + testes. **Commit:** `feat(simcar-lotes): endpoint de status do monitor`

## Fase 3 — Frontend

### Tarefa 3.1: badge do monitor + fases novas
**Files:** `client/src/components/SimcarLotesPanel.tsx`
1. `FASE_LABEL` += `aguardando_simcar` / `sessao_interrompida`; banner âmbar/vermelho + spinner pulsante quando nessas fases; nota "continua em segundo plano mesmo se fechar a página".
2. Badge de monitor-status (poll 15s, para no unmount) com LIVRE/EM USO/indisponível.
3. Aviso ao iniciar job com monitor ocupado.
4. `pnpm run check`. **Commit:** `feat(front): badge do monitor e fases de espera/interrupcao`

### Tarefa 3.2: re-anexação de job ativo (R4)
**Files:** `client/src/components/SimcarLotesPanel.tsx`
1. Ao montar: localizar job ativo (histórico) → `GET jobs/:id/status` → se processando, reabrir SSE `events`.
2. Validar manualmente: fechar página durante espera → reabrir → estado continua.
3. `pnpm run check` + `pnpm run test`. **Commit:** `feat(front): reconecta job ativo ao reabrir`

## Fase 4 — Validação e docs

### Tarefa 4.1: validação manual + live (doc 06)
1. Cenários 1–5 do aceite (monitor livre, ocupado, interrupção, fechar página, R2).
2. **Commit:** `test(simcar-lotes): validacao monitor`

### Tarefa 4.2: changelog + docs
1. `docs/CHANGELOG_2026-08-05_SIMCAR_MONITOR.md` (padrão do repo).
2. `STATUS.md` → CONCLUÍDO. **Commit:** `docs(simcar-monitor): changelog`

## Sequência final

```bash
pnpm run check && pnpm run test && pnpm run build
git add -A && git commit -m "feat(simcar-monitor): fila por ocupacao do SIMCAR" && git push origin main
# deploy: ver 08-deploy-e-ops.md
```
