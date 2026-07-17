# 12 — Checklist mestre de aceite (marcar conforme avança)

> Espelho executivo do plano. Detalhes: cada item aponta a fase/task de `07`.

## P1.5 — Fundação (bugs)

- [x] B1 `simcar_oraculo_jobs` na whitelist do local-storage (T1) — round-trip, listagem,
      áreas tipadas e scaffold cobertos por 7 testes (`local-storage.test.ts`, 2026-07-16)
- [x] B2/B4 status+ok coerentes; PDFs import/process em campos separados (T2) — reprovação
      funcional fica `completed` com `importOk=false`; paths/URLs separados e testados
- [x] B3 timeline acumula de verdade (T2) — 3 eventos persistidos em ordem, sem `timelinePush`
- [x] B5/B6 timeout no GET + relogin automático em 401 (T3) — abort testado; 401 renova
      uma vez e 401 duplo não entra em loop
- [x] B7 jobs `running` viram `interrupted` no boot (T3) — coleções nova e legada cobertas
- [x] `vitest backend/simcar-oraculo` verde — gate P1.5: 75 testes relevantes + `tsc` limpo

## P2 — Município e abrangência

- [x] Malha IBGE MT no repo + detecção por centroid (T4) — edição 2024, 142 municípios;
      Santa Clara→Querência e Cuiabá cobertos por teste
- [x] Fallback WFS SEMA + dropdown manual (T4) — `Geoportal:LIM_MUNICIPIOS_MT` validada
      live; `/api/simcar-oraculo/municipios` devolveu 142 opções e Querência/Chave 751
- [x] Endpoints de escrita validados LIVE no 270069 e documentados em `11` (T5) — município
      alterado/revertido com nome intacto; abrangência sobrescrita/restaurada sem `Limpar`
- [x] `prepare-project.ts` com guard do CAR-teste e `PropriedadeNome` intocável (T6) —
      confirmação no polígono oficial e 11 cenários unitários
- [x] BaseRef aguardada após mudar abrangência (T6) — `null` estável, CONCLUIDO, ERRO→
      Reprocessar uma vez e timeout cobertos

## P3.5 — Pipeline

- [x] Parse PDF SEMA → `errosResumo` (T7) — 7 testes; oráculos reais V21, V22-import,
      V23 e V22-process versionados com SHA-256; colunas coladas/quebras/agregação cobertas
- [x] `POST /pipeline` + SSE + artefatos por rodada (T8) — snapshot/evento/heartbeat/terminal,
      Auth por UID, cancelamento e storage `job/rN` cobertos por testes
- [x] Import aprovou → ProcessarGeo automático (T8) — import reprovado para sem processar e
      permanece resultado `completed`; ambos os caminhos mockados
- [x] Todos os downloads SEMA disponíveis por rodada (T9) — PDFs, erros, enviado, processado,
      conferência e pendências; 400/404 não bloqueante testado e endpoints revalidados live

## P4 — Front sem validação local

- [x] Aba 100% oráculo: dropzone → município → timeline → resultados por rodada (T10)
- [x] Dashboard: 4 pontos de wiring + histórico novo/legado (T11)
- [x] Rotas locais mortas (410) e gate local removido (T12)
- [x] Aba Erros de Geometria intacta (T12) — 42/42 testes verdes

## P5 — Autofix import

- [x] `zip-rewrite` preserva bytes de camadas não tocadas (T13)
- [x] 5 ações mecânicas de import com testes (T13)
- [x] DeepSeek V4 Pro planeja/explica; fallback sem IA funciona (T14)
- [x] Loop automático ≤3 rodadas com paradas explícitas (T15)
- [ ] **Prova real: V23 aprovado na rodada 2 no SIMCAR da SEMA (T16)**

## P6 — Autofix process

- [ ] Clip AREA_UMIDA→cover + limpeza, sem fragmentos <100 m² (T17)
- [ ] **Prova real: V22 processa sem os 41 erros de úmida (T17)**
- [ ] Casos de decisão aparecem como "exige edição no GIS" com orientação

## P7 — Produção

- [ ] Código morto removido + docs atualizadas (T18)
- [ ] Env no PC servidor (SIMCAR_* + DEEPSEEK_API_KEY do Hermes) (T19)
- [ ] Deploy backend + front; health `simcarConfigured && deepseekConfigured` (T19)
- [ ] E2E completo de `09` no ambiente real (T19)
- [ ] Grep de segredos no repo vazio (regra do `08`)
- [ ] CAR-teste restaurado com o ZIP FINAL da Santa Clara ao encerrar a bateria

## Segurança transversal (conferir em TODO commit)

- [ ] Nenhum CPF/senha/chave em arquivo commitado (repo PÚBLICO)
- [ ] Mutação SEMA só via `assertTestCarId`
- [ ] Nenhum log de token/senha
