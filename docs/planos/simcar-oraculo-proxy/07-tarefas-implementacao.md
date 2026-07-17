# 07 — Tarefas de implementação v2 (bite-sized)

> **For Hermes:** uma task por vez; TDD onde indicado; commit ao fim de cada task.
> Live SEMA só no PC com credenciais (`.oraculo-scratch/simcar-oraculo.env`), NUNCA em CI.
> Verificação global ao fim de cada fase:
> `npx vitest run --root . backend/simcar-oraculo backend/processar-projeto.test.ts backend/geometry-errors.test.ts`

**Branch:** direto no `main` (padrão do Álvaro), commits pequenos.

---

## Fase P1.5 — bugs bloqueantes (fazer PRIMEIRO)

### T1 — Whitelist `simcar_oraculo_jobs` (B1) ⚠️ rotas hoje não persistem nada
- Modify: `backend/local-storage.ts:204,212` (+ áreas `simcar-oraculo/*` em saveUserBuffer, B8)
- Test: round-trip write/read doc em `simcar_oraculo_jobs`; save/load buffer área nova
- Commit: `fix(simcar-oraculo): whitelist de coleção e áreas de storage`

### T2 — Timeline com append real (B3) + status/ok coerentes (B2) + campos de PDF separados (B4)
- Modify: `backend/simcar-oraculo/routes.ts`
- Test: 3 eventos → timeline length 3; import reprovado → `status=completed, importOk=false`;
  job com import+process → dois paths de PDF distintos
- Commit: `fix(simcar-oraculo): timeline acumulada, campos de resultado e PDFs`

### T3 — Robustez do client (B5, B6) + interrupted no boot (B7)
- Modify: `client.ts` (timeout no GET; `withSimcarAuthRetry` 401→relogin→1 retry),
  `backend/index.ts` (markPersistedRunningJobsInterrupted cobre `simcar_oraculo_jobs` e
  `processar_projeto_jobs`)
- Test: mock 401 uma vez → renova e completa; não loopa em 401 duplo
- Commit: `fix(simcar-oraculo): retry de sessão, timeouts e jobs interrompidos no boot`

## Fase P2 — município + abrangência

### T4 — Malha municipal MT + `municipio-mt.ts`
- Gerar `config/municipios-mt.geojson` (IBGE simplificado) + tabela `nome→{ibge}`;
  resolver `chaveSimcar` em runtime via `ListarMatoGrosso` (cache 24h)
- Create: `backend/simcar-oraculo/municipio-mt.ts` + testes (Santa Clara→5107065; fora de MT→null)
- Wire: `shape-context.ts` preenche `municipioDetectado`; upload response nova (03)
- Commit: `feat(simcar-oraculo): detecção local de município (malha IBGE MT)`

### T5 — Validação LIVE dos endpoints de escrita (sem código de produção)
- Script: `scripts/probe-escrita.ts` (só no PC): SalvarGrupoPropriedade Querência→Canarana→
  reverte; SalvarAreaAbrangencia +1km; cronometrar BaseRef; se Limpar foi necessário,
  restaurar com o ZIP FINAL da fixture
- Deliverable: atualizar `11-endpoints-sema-descobertos.md` (payload mínimo, precisa-Limpar?,
  tempo BaseRef) — **gate para T6**
- Commit: `docs(simcar-oraculo): payloads reais de propriedade/abrangência validados`

### T6 — `prepare-project.ts`
- Create: prepare-project.ts + testes com client mockado (skip / muda município / muda
  abrangência / BaseRef timeout / salvar falha → failed) — algoritmo em `04`
- Guard: `assertTestCarId` na entrada; `PropriedadeNome` do payload comparado byte a byte
  com o do Buscar (teste garante que nunca muda — D5)
- Commit: `feat(simcar-oraculo): prepare município e abrangência no CAR-teste`

## Fase P3.5 — pipeline único + parse

### T7 — `sema-report-parse.ts` ✅ concluída em 2026-07-16
- pdf-parse nos PDFs reais salvos (v21/v22/v23 do scratch + fixtures) → `errosResumo`
- Test: v23 → `[{AREA_UMIDA, pontos repetidos, 11}]`; v22-process → contida ×41
- Evidência adicional: V21 sobreposição ×1, V22 aprovado sem falso positivo, PDF inválido
  degrada para warning; 7 testes verdes e quatro PDFs-oráculo versionados com hashes em `02`.
- Commit: `feat(simcar-oraculo): parse dos relatórios PDF da SEMA`

### T8 — `pipeline.ts` + rotas novas + SSE ✅ concluída em 2026-07-16
- Create: pipeline.ts (02); rotas `POST /pipeline`, `GET /jobs/:id/events` (SSE via
  processing-jobs), `GET /jobs/:id/artifact/:key`, `POST /jobs/:id/autofix`, DELETE cancel
- Job doc: `rounds[]`, `artifacts{}`, timeline acumulada; artefatos em
  `users/{uid}/simcar-oraculo/{jobId}/r{N}/…` (01)
- Test: pipeline com SEMA mockada — caminho feliz; import reprova e para (autofix ainda off)
- Evidência: cancelamento mid-import com `CancelarImportacaoShape` best-effort; SSE privado
  snapshot→evento→terminal; 5xx com 3 tentativas; 97 testes do gate oráculo+geometria verdes.
- `/autofix` fica registrado e responde 409 explícito até a implementação P5/T15.
- Commit: `feat(simcar-oraculo): pipeline único upload→prepare→import→process`

### T9 — Downloads SEMA extras ✅ concluída em 2026-07-16
- No fim de cada rodada, baixar o que existir: PDF import, PDF process, erros-zip,
  `DownloadArquivoEnviado`, `DownloadArquivoProcessado` (tolerar 400 = não existe)
- Entrega ampliada conforme fluxo executivo do `00`: conferência e pendências também são
  coletadas depois do processamento; probe live read-only confirmou enviado+conferência e
  respostas 400 opcionais para processado/pendências no estado atual.
- Commit: `feat(simcar-oraculo): artefatos completos da SEMA por rodada`

## Fase P4 — front

### T10 — Reescrever `ProcessarProjetoAnalysis.tsx` (ORACULO-only) ✅ concluída em 2026-07-16
- Remover seções locais; dropzone → preview (município + dropdown fallback) → botão único
  "Enviar ao SIMCAR"; componente `OraculoTimeline`; cards por rodada com downloads;
  estados/copy de `05`; SSE com retry + fallback poll
- Entrega: health/configuração sem fallback local; preview com fonte municipal e dropdown
  SIMCAR; pipeline único com `autofix=true`; timeline viva; três tentativas SSE antes de poll
  autenticado; restauração terminal só por snapshot; cancelamento e artefatos por rodada.
- Histórico recebe somente resumo de rodadas e referências de artefatos (sem `timeline` nem
  linhas dos PDFs). `tsc --noEmit` e bundle Vite de produção verdes.
- Commit: `feat(ui): aba Processar projeto 100% SIMCAR real`

### T11 — Wiring Dashboard (4 pontos) + histórico ✅ concluída em 2026-07-16
- `mapProcessarDocToHistoryItem` lê `simcar_oraculo_jobs` + legado; atualizar os 3 blocos de
  status hardcodado; não persistir timeline/rows gigantes no doc de histórico
- Entrega: as duas coleções são lidas em paralelo e deduplicadas com preferência pelo job
  server-owned; `running/cancel_requested/interrupted` e resultados import/process explícitos
  têm badges próprios; cards mostram data/rodadas, reabrem snapshot e são navegáveis por
  teclado. Legado é somente leitura e o callback novo só atualiza memória — não replica jobs.
- Gate React/TypeScript e bundle Vite de produção verdes.
- Commit: `feat(ui): histórico do oráculo SIMCAR no dashboard`

### T12 — Matar rotas locais (D2) ✅ concluída em 2026-07-16
- `/api/processar-projeto/importar|processar` → 410 Gone (1 release); remover
  `assertImportAllowsProcess`, fallback :1654-1665 e chamadas de `runImportPhase`/
  `runProcessPhase` DESTA aba; `import-report-pdf` sai da rota da aba
- Cuidado: `geometry-errors` (outra aba) não usa nada disso — confirmar com grep antes de apagar
- Test: regressão `geometry-errors.test.ts` verde; upload continua ok
- Entrega: handler 410 autenticado com `LOCAL_PROCESSING_REMOVED` + hint do pipeline;
  `runProcessJob`, gate e auto-import local removidos; PDF GeoForest só fica no download
  legado/testes. Fases puras seguem como biblioteca, sem chamada de produto.
- Evidência: 4/4 contratos de rota (inclui upload+preview real de Querência), 42/42 Erros de
  Geometria e 12/12 regressões das fases/PDF legados; `tsc` verde.
- Commit: `feat(processar-projeto)!: remove validação local — veredito é do SIMCAR`

## Fase P5 — autofix import

### T13 — `zip-rewrite.ts` + actions de import
- **Concluída em 2026-07-16.** Reescritor valida alinhamento SHP/SHX/DBF e preserva
  byte a byte todas as entradas não tocadas, PRJ/CPG e o DBF da própria camada quando a ordem
  de registros não muda; índices espaciais obsoletos da camada alterada são descartados.
- Promover v22/v24 + fixLayerGeometry: `remove_duplicate_vertices`, `clean_degenerate_rings`,
  `unkink_self_intersection`, `remove_glued_holes`, `split_complex_polygon`
- Test por action: ZIP sintético entra errado → sai sem o defeito → contagens/prj preservados
  (regras de engenharia de `06` viram asserts: sem buffer, fragmentos <100 m² filtrados…)
- Evidência: 9/9 testes próprios; gate conjunto 53/53; V23 offline produziu as mesmas
  contagens, IDs e coordenadas do V24 aprovado. O filtro pós-clip <100 m² permanece em T17,
  pois nenhuma ação de import faz clip.
- Commit: `feat(autofix): ações mecânicas de importação`

### T14 — `plan.ts` + `deepseek.ts` + fallback
- **Concluída em 2026-07-16.** Planner aceita da IA somente ações/camadas previamente
  elegíveis pelo código, completa omissões mecânicas pelo fallback e preserva decisões
  ambíguas em `naoCorrigivel`.
- Cliente DeepSeek (deepseek-v4-pro, zod, retry content-vazio, timeout, sem chave→fallback);
  tabela fixa erro→ação como fallback; filtro de ações fora do inventário
- Test: resposta IA mockada válida/inválida/fora-do-inventário; sem chave → fallback
- Evidência: 9/9 testes próprios, 115/115 gate acumulado e teste live V4 Pro 1/1 (8,6 s)
  com chave efêmera do Hermes; saída segura `remove_duplicate_vertices→AREA_UMIDA`.
- Commit: `feat(autofix): planner DeepSeek V4 Pro com fallback determinístico`

### T15 — Loop no pipeline (D4) + UI do FixPlan
- **Concluída em 2026-07-16.** A preparação e a aquisição da fila continuam únicas; cada
  reprovação elegível gera plano/diff, ZIP corrigido e nova rodada, limitada a 3.
- Loop ≤3 rodadas com regras de parada (06); artefatos corrigido_rN.zip + fixplan.json;
  front: cards de rodada + modal "o que a IA entendeu" + botão manual pós-parada
- Test: mock SEMA que aprova na rodada 2; que nunca melhora (para em "sem melhora")
- Evidência: 7/7 testes do pipeline cobrem também teto 3/3 e ausência de ação; 4/4 contratos
  SSE/autofix, 78/78 no módulo, `tsc` e build de produção verdes. `fixplan.json` registra
  erros, fonte/plano, diff e o resultado da rodada seguinte.
- Commit: `feat(autofix): loop automático corrigir→reenviar (3 rodadas)`

### T16 — Live P5: oráculo V23
- ZIP V23 (11 pontos repetidos) pelo produto → rodada 2 deve importar FINALIZADO
- Deliverable: registrar em `09` o resultado; ajustar calibração se divergir
- Commit: `test(autofix): V23 aprovado via loop automático (live)`

## Fase P6 — autofix process

### T17 — `clip_layer_to_cover` + clean pós-clip (v23/v9 promovidos)
- Test: fixture com úmida fora do cover → clip → sem fragmentos <100 m², IDs únicos
- Live: V22 → fix → reimporta → processa; meta: zerar os 41; reservatório/ARL duplicado
  aparecem como `naoCorrigivel` com orientação
- Commit: `feat(autofix): recorte de AREA_UMIDA à cobertura + limpeza`

## Fase P7 — fechamento

### T18 — Limpeza de código morto + docs
- Remover PROCESSAR_MODE/branches LOCAL mortos; atualizar `docs/SIMCAR_ORACULO.md`,
  `README_PROJETO.md`; changelog novo
- Commit: `chore: remove modo local do processar-projeto + docs`

### T19 — Deploy PC servidor + smoke produção
- Checklist de `08-seguranca-ops.md` (env, systemd, tunnel) + E2E de `09` no ambiente real
- Commit: (se precisar de ajuste) `fix: ajustes de deploy do oráculo`

---

## Mapa fase → tasks

| Fase | Tasks | Gate de saída |
|------|-------|---------------|
| P1.5 | T1–T3 | vitest verde; rotas persistem job de verdade |
| P2 | T4–T6 | prepare live validado no 270069 (T5 doc atualizada) |
| P3.5 | T7–T9 | pipeline mockado verde + artefatos por rodada |
| P4 | T10–T12 | aba sem validação local; QA visual `09` |
| P5 | T13–T16 | V23 aprovado via loop no SIMCAR real |
| P6 | T17 | V22 sem erros de úmida no process real |
| P7 | T18–T19 | produção no ar + checklist mestre `12` 100% |
