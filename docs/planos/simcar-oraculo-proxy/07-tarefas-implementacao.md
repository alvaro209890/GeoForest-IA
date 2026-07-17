# 07 — Tarefas de implementação (bite-sized)

> **For Hermes:** uma task por vez; TDD onde indicado; commit ao fim de cada task.

**Repo:** `/home/acer/Documentos/GeoForest-IA`  
**Branch sugerida:** `feat/simcar-oraculo` → merge `main` após P3 green.

---

### Task 1: Scaffold do módulo + config

**Objective:** Criar pasta e config tipada lendo env.

**Files:**
- Create: `backend/simcar-oraculo/config.ts`
- Create: `backend/simcar-oraculo/config.test.ts`
- Create: `backend/simcar-oraculo/types.ts`

**Step 1:** Teste que `getSimcarOraculoConfig().mode` default é `ORACULO` e aceita `LOCAL`.

**Step 2:** Implementar `config.ts` (código completo em `02-modulo-simcar-oraculo.md`).

**Step 3:**
```bash
npx vitest run --root . backend/simcar-oraculo/config.test.ts
```
Expected: PASS

**Step 4:** Commit `feat(simcar-oraculo): config e types`

---

### Task 2: Portar scramble para o repo

**Objective:** Não depender de path absoluto fora do GeoForest.

**Files:**
- Create: `backend/simcar-oraculo/scramble.ts` (copiar de `acompanhamento-de-processos/backend-email-render/simcar-scramble.js`)
- Create: `backend/simcar-oraculo/scramble.test.ts` (round-trip ou snapshot do formato)

**Step 1:** Teste: `scramble(JSON.stringify({Login:"1",Senha:"x",NovaSenha:""}))` retorna string não vazia.

**Step 2:** Implementar.

**Step 3:** Commit `feat(simcar-oraculo): scramble SIMCAR no repo`

---

### Task 3: Cliente HTTP SIMCAR (login/get/post/download)

**Objective:** Cliente TS com headers do app técnico.

**Files:**
- Create: `backend/simcar-oraculo/client.ts`
- Create: `backend/simcar-oraculo/client.test.ts` (mock global fetch)

**Step 1:** Teste login: mock 200 com body `"TECNICO abc"` → token `TECNICO abc`.

**Step 2:** Implementar login/get/post/download (base `.oraculo-scratch/simcar-client.mjs`).

**Step 3:** Commit `feat(simcar-oraculo): client HTTP`

---

### Task 4: Fila serial

**Objective:** Dois jobs não se intercalam.

**Files:**
- Create: `backend/simcar-oraculo/queue.ts`
- Create: `backend/simcar-oraculo/queue.test.ts`

**Step 1:** Teste: job A delay 50ms, job B delay 10ms; ordem de fim = A depois B se enfileirados A,B.

**Step 2:** Implementar `enqueueSimcar`.

**Step 3:** Commit `feat(simcar-oraculo): fila serial`

---

### Task 5: Buscar projeto + health route

**Objective:** `Buscar/{id}` e rota health.

**Files:**
- Create: `backend/simcar-oraculo/index.ts` (exports)
- Modify: `backend/index.ts` — registrar `GET /api/simcar-oraculo/health` (auth)
- Create: `backend/simcar-oraculo/scripts/smoke-buscar.ts` (manual)

**Step 1:** Unit com mock Buscar.

**Step 2:** Manual no PC:
```bash
export SIMCAR_CPF=... SIMCAR_SENHA=...
npx tsx backend/simcar-oraculo/scripts/smoke-buscar.ts 270069
```
Expected: JSON com Nome/Situacao/Municipio*

**Step 3:** Commit `feat(simcar-oraculo): buscar + health`

---

### Task 6: Upload + ImportarArquivoShape + poll

**Objective:** Importar ZIP no projeto-teste e baixar PDF.

**Files:**
- Create: `backend/simcar-oraculo/import-shape.ts`
- Create: `backend/simcar-oraculo/artifacts.ts`
- Modify: `backend/processar-projeto.ts` — branch `ORACULO` no handler `importar`

**Step 1:** Teste de máquina de estados do poll com status fake: AGUARDANDO → EXECUTANDO → CONCLUIDO FINALIZADO.

**Step 2:** Implementar import real.

**Step 3:** Live smoke com fixture FINAL (só se import não destruir dados críticos — é projeto-teste):
```bash
npx tsx backend/simcar-oraculo/scripts/smoke-import.ts \
  270069 backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip
```
Expected: PDF baixado; status FINALIZADO ou COM_PENDENCIA documentado.

**Step 4:** Commit `feat(simcar-oraculo): import shape no projeto-teste`

---

### Task 7: Wire job SSE de import

**Objective:** Front já existente recebe steps.

**Files:**
- Modify: `backend/processar-projeto.ts` (emit progress events)
- Modify: `client/src/components/ProcessarProjetoAnalysis.tsx` (timeline labels)

**Step 1:** Emular eventos no status e validar UI manual.

**Step 2:** Commit `feat(ui): timeline oráculo import`

---

### Task 8: extractShapeContext

**Objective:** Bbox + município hint do ZIP.

**Files:**
- Create: `backend/simcar-oraculo/shape-context.ts`
- Create: `backend/simcar-oraculo/shape-context.test.ts`
- Fixture: `backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip`

**Step 1:** Teste: bbox finito; centroid dentro do Brasil MT roughly.

**Step 2:** Commit `feat(simcar-oraculo): shape context do ZIP`

---

### Task 9: Descoberta endpoints município/abrangência

**Objective:** Documentar paths reais do bundle.

**Files:**
- Create: `backend/simcar-oraculo/docs/endpoints-descobertos.md`

**Step 1:** Buscar no bundle (read-only).

**Step 2:** Testar GET/POST em 270069 com payload mínimo (cuidado).

**Step 3:** Commit `docs(simcar-oraculo): endpoints propriedade/caracterização`

---

### Task 10: prepare-project (município + abrangência)

**Objective:** Ajustar projeto-teste antes do import.

**Files:**
- Create: `backend/simcar-oraculo/prepare-project.ts`
- Create: `backend/simcar-oraculo/prepare-project.test.ts` (mocks)
- Modify: `import-shape.ts` / handler import — chamar prepare antes

**Step 1:** Testes unitários coversBbox + skip se mesmo município.

**Step 2:** Live: shape de outro município (se disponível) ou forçar município errado e reverter.

**Step 3:** Commit `feat(simcar-oraculo): prepare município e abrangência`

---

### Task 11: ProcessarGeo + artefatos

**Objective:** Process + PDF + ZIP erros.

**Files:**
- Create: `backend/simcar-oraculo/process-geo.ts`
- Modify: handler `processar` em `processar-projeto.ts`

**Step 1:** Poll machine unit test.

**Step 2:** Live após import OK.

**Step 3:** Commit `feat(simcar-oraculo): processar geo`

---

### Task 12: Front completo ORACULO

**Objective:** Labels, downloads SEMA, aviso projeto-teste, botão autofix disabled.

**Files:**
- Modify: `ProcessarProjetoAnalysis.tsx`
- Optional: CSS/tailwind existente

**Step 1:** Checklist visual (09).

**Step 2:** Commit `feat(ui): modo oráculo SIMCAR na aba processar`

---

### Task 13: Docs env + README ops

**Objective:** Como configurar o PC servidor.

**Files:**
- Create: `docs/SIMCAR_ORACULO.md`
- Modify: `README_PROJETO.md` (link)

Env exemplo (sem segredos):

```
PROCESSAR_MODE=ORACULO
SIMCAR_TEST_CAR_ID=270069
SIMCAR_CPF=
SIMCAR_SENHA=
SIMCAR_POLL_MS=5000
AUTOFIX_MAX_ROUNDS=3
```

**Step 3:** Commit `docs: oráculo SIMCAR no backend do PC`

---

### Task 14 (P5 depois): autofix dups

Ver `06-autofix-roadmap.md` — não bloquear P0–P4.

---

## Ordem de merge

P0: Tasks 1–5  
P1: Tasks 6–7  
P2: Tasks 8–10  
P3: Task 11  
P4: Task 12–13  
P5+: Task 14+

## Verificação global

```bash
npx vitest run --root . backend/simcar-oraculo backend/processar-projeto.test.ts backend/geometry-errors.test.ts
```
Expected: all pass (processar-projeto tests não devem quebrar no mode LOCAL default de CI — **importante:** em CI usar `PROCESSAR_MODE=LOCAL` se não houver credenciais).
