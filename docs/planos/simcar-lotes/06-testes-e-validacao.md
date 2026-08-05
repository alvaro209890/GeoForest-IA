# 06 — Testes e Validação

## Unit (Vitest — `backend/` já roda `vitest`)

| Arquivo de teste | O que cobre |
|---|---|
| `backend/simcar-lotes/recibo-parse.test.ts` | Extração do CAR estadual/federal/propriedade/município de 2 fixtures: recibo estadual (texto real do vídeo — Juliana Durel, MT10005/2019) e recibo federal (layout SICAR). Normalização `MT-10005/2019` → `MT10005/2019`. PDF sem identificação → `null`s |
| `backend/simcar-lotes/resolver.test.ts` | `ListarRasc` com mock de fetch: filtro exato por `NumeroCompleto` (SEMA devolve a conta inteira → filtra), fallback via `Publico/ListarRequerimento` com `NUMERO_CAR_FERERAL`, CAR não encontrado → erro mapeado |
| `backend/simcar-lotes/downloader.test.ts` | Mock de `simcarDownload` + `fetch` público: 200→buffer válido; 400→`null` (skip + `faltantes`); 401→retry 1×; recibo público falha → fallback cópia do PDF enviado; conteúdo inválido (`%PDF`/`PK` check) |
| `backend/simcar-lotes/zip-builder.test.ts` | Estrutura do ZIP (1 pasta por lote, nomes sanitizados `MT10005-2019 - LOTE_RURAL_81`), recibo incluso, ZIP único com N lotes |
| `backend/simcar-oraculo/client-session.test.ts` | Cache por credencial: duas contas com tokens distintos não colidem; single-flight por chave; `clearSimcarTokenCache(chave)` só limpa a chave; `getSimcarToken()` (env) continua funcionando |
| `backend/simcar-lotes/session-queue.test.ts` | Mutex: chamadas da mesma conta serializadas; contas diferentes paralelas; timeout → erro "conta em uso" |

**Fixtures:** os PDFs de recibo NÃO entram no git (binários + dados pessoais) — gerar localmente e apontar via env `SIMCAR_LOTES_FIXTURE_DIR` (ex.: os recibos reais de `Lote 150`/`Lote 81` baixados pela aba Recibos). Alternativa: fixture sintética reproduzindo o layout (texto puro) para o parser.

## Live (opt-in, guard `SIMCAR_LIVE=1` — mesma convenção do oráculo)

| Teste | O que valida |
|---|---|
| `backend/simcar-lotes/live-e2e.test.ts` | Com `SIMCAR_CPF/SIMCAR_SENHA` (env) + CAR de teste `271442` (`SIMCAR_TEST_CAR_ID`): resolver → baixar `Arquivo Enviado` + `Arquivo Processado` + recibo público → montar ZIP → assert de estrutura (pasta com os 3 arquivos) |
| Sessão | Rodar 2 jobs em paralelo com a MESMA conta → segundo serializa/aguarda, sem 401 |

> Rodar live com `--no-file-parallelism` (o SIMCAR só permite 1 sessão por conta).

## Frontend

| Teste | O que cobre |
|---|---|
| `client/src/dashboard/routes.test.ts` | `getViewFromPath("/dashboard/lotes") === "simcar-lotes"` e `getPathForView("simcar-lotes") === "/dashboard/lotes"` |
| `client/src/components/SimcarLotesPanel.test.tsx` (opcional, jsdom) | render do painel, validação de credenciais, chamada de `/parse-recibos` e `/process` |

## Validação manual (aceite — reproduz o vídeo)

1. Baixar recibo real pela aba "Recibos SIMCAR" (pública) → arrastar na aba Lotes → Analisar → deve detectar o CAR.
2. Informar credenciais da conta técnica → Baixar → conferir a pasta do lote (Arquivo Enviado + Arquivo Processado + Recibo).
3. ZIP com 2+ recibos → 2+ pastas num ZIP único.
4. CAR sem "Arquivo Processado" (400) → lote conclui com ⚠ faltante, sem erro geral.

## Comandos

```bash
pnpm run check            # tsc --noEmit (backend + client)
pnpm run test             # vitest (unit)
pnpm run build            # build completo (vite + admin + esbuild backend)
```
