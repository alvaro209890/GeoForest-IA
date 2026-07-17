# 12 — Checklist mestre de aceite (marcar conforme avança)

> Espelho executivo do plano. Detalhes: cada item aponta a fase/task de `07`.

## P1.5 — Fundação (bugs)

- [x] B1 `simcar_oraculo_jobs` na whitelist do local-storage (T1) — round-trip, listagem,
      áreas tipadas e scaffold cobertos por 7 testes (`local-storage.test.ts`, 2026-07-16)
- [ ] B2/B4 status+ok coerentes; PDFs import/process em campos separados (T2)
- [ ] B3 timeline acumula de verdade (T2)
- [ ] B5/B6 timeout no GET + relogin automático em 401 (T3)
- [ ] B7 jobs `running` viram `interrupted` no boot (T3)
- [ ] `vitest backend/simcar-oraculo` verde

## P2 — Município e abrangência

- [ ] Malha IBGE MT no repo + detecção por centroid (T4)
- [ ] Fallback WFS SEMA + dropdown manual (T4)
- [ ] Endpoints de escrita validados LIVE no 270069 e documentados em `11` (T5)
- [ ] `prepare-project.ts` com guard do CAR-teste e `PropriedadeNome` intocável (T6)
- [ ] BaseRef aguardada após mudar abrangência (T6)

## P3.5 — Pipeline

- [ ] Parse PDF SEMA → `errosResumo` (T7, oráculos v22/v23)
- [ ] `POST /pipeline` + SSE + artefatos por rodada (T8)
- [ ] Import aprovou → ProcessarGeo automático (T8)
- [ ] Todos os downloads SEMA disponíveis por rodada (T9)

## P4 — Front sem validação local

- [ ] Aba 100% oráculo: dropzone → município → timeline → resultados por rodada (T10)
- [ ] Dashboard: 4 pontos de wiring + histórico novo/legado (T11)
- [ ] Rotas locais mortas (410) e gate local removido (T12)
- [ ] Aba Erros de Geometria intacta (T12)

## P5 — Autofix import

- [ ] `zip-rewrite` preserva bytes de camadas não tocadas (T13)
- [ ] 5 ações mecânicas de import com testes (T13)
- [ ] DeepSeek V4 Pro planeja/explica; fallback sem IA funciona (T14)
- [ ] Loop automático ≤3 rodadas com paradas explícitas (T15)
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
