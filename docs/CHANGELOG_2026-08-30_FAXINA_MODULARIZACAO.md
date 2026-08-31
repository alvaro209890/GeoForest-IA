# Faxina, deduplicação e modularização — 2026-08-30

> **Autor:** Claude · **Regra da rodada:** nenhuma funcionalidade podia mudar.
> Rotas, contratos de API, formato dos jobs, laudos, WMS/GeoServer e processamento
> continuam exatamente como estavam.

**Números:** 98 arquivos tocados, **+412 / −5.289 linhas**, 19 arquivos apagados,
8 módulos novos. `tsc --noEmit` limpo, `vite build` + `esbuild` verdes,
**148 rotas antes = 148 rotas depois** (comparação automática entre `HEAD` e a árvore
de trabalho).

---

## 1. Código morto removido (−2.632 linhas)

| Arquivo | Por quê |
|---|---|
| `client/src/components/ProcessarProjetoAnalysis.tsx` (2.191) | Aba do oráculo removida em 21/07; nenhum importador. Regra em `docs/FLUXO_ORACULO_SIMCAR_DESATIVADO.md` |
| `client/src/pages/dashboard/*.tsx` (9 arquivos) | Wrappers órfãos substituídos pelo `DashboardRouter` |
| `client/src/components/ManusDialog.tsx`, `client/src/pages/Home.tsx`, `client/src/const.ts`, `shared/const.ts` | Restos do template inicial (login OAuth que o projeto nunca usou) |
| `backend/query-alvaro.{js,ts}`, `backend/query-users.js`, `backend/query-wfs.ts`, `backend/test-pdfkit.js` | Scripts de scratch da época do Firestore |

Mais **203 linhas dentro de `backend/index.ts`**: coleta de métricas do servidor
(`parseStorageMetrics`, `parseProcesses`, `sampleCpuUsagePercent`, `parseTemperatureReadings`…)
sem nenhuma rota que a consumisse — resto do painel admin removido em 03/08.

E **303 specifiers de import** que não eram usados em lugar nenhum
(73 só no `index.ts`, ~90 em `simcar/analysis.ts`).

Os aliases `@shared` de `vite.config.ts` / `tsconfig.json` e o `shared/**` do
`vitest.workspace.ts` saíram junto com o diretório.

## 2. Deduplicação no backend

Módulos novos em `backend/lib/`. **Cada módulo continua exportando o mesmo nome que
sempre exportou** — o hub devolve as funções e o módulo as reexporta, então nenhum
importador mudou.

| Novo | Substituiu |
|---|---|
| `lib/sse.ts` — `createSseHub({ collection })` | 11 cópias de `writeSse`, 10 de `emitJobEvent`, 8 de `closeSubscribers`, 8 de `persistJob`/`progress` (cbers, croqui, containment, fiscalização, geometria, landsat, overlap, processar-projeto, vértices, lotes SIMCAR, ndvi-scene) |
| `lib/job-utils.ts` — `sleep`, `safeSegment`, `parseBase64Zip`, `csvEscape` | 8 + 6 + 8 + 4 cópias |
| `lib/fs-json.ts` — `ensureDir`, `writeJsonAtomic`, `readJsonSafe` | 6 + 4 + 3 cópias |
| `lib/http.ts` — `fetchJsonWithTimeout`, `xmlEscape`, `asArray` | 5 cópias do par `AbortController` + `setTimeout` (cbers, landsat, ndvi, ndvi-scene, fiscalização) |

Comportamento preservado nos casos que divergiam:
- `parseBase64Zip` recebe as mensagens por parâmetro (cbers/landsat diziam
  "ZIP da área é obrigatório", os outros "ZIP não enviado").
- `fetchJsonWithTimeout` recebe `httpError` — cada chamador mantém a mensagem que
  já aparecia no log e no laudo.
- O `progress` do CBERS e o `persistLandsatJob`/`progress` do Landsat continuam
  próprios (Landsat preserva `timestamp`/`createdAt` do doc anterior e serializa o
  evento com `stripUndefinedDeep`); só o encanamento é compartilhado.

**Não foi unificado de propósito:** `geoserverFetch`/`geoserverJson`/`geoserverWrite`
de `cbers/archive.ts`, `landsat/geoserver.ts` e `ndvi/geoserver.ts` divergem em status
aceitos e política de retry — unificar mudaria o comportamento de publicação.

## 3. Deduplicação no frontend

- `client/src/dashboard/lib/values.ts` (novo): `isPlainObject` (7 cópias) e
  `toIsoDateFromUnknown` (6 cópias). `lib/format.tsx` e `lib/mappers.ts` reexportam,
  então quem importava de lá continua funcionando.
- `readApiErrorMessage` foi para `client/src/lib/api.ts` — era idêntica em
  `ContainmentAnalysis.tsx` e `GeometryErrorsAnalysis.tsx`.
- `Dashboard.tsx` só perdeu imports mortos (ícones e tipos). **Nenhuma linha de
  lógica tocada** — a regra do patch cirúrgico segue valendo.

## 4. Modularização do entrypoint

`backend/index.ts`: **1.492 → 142 linhas**. Agora é só o boot (logger, `createApp()`,
knowledge base, registro de rotas, static, `listen`, keep-alive).

| Novo | Rotas |
|---|---|
| `backend/routes/chat.ts` (921) | `POST /api/chat`, `POST /api/chat-stream` |
| `backend/routes/uploads.ts` (160) | `POST /api/upload-image`, `POST /api/upload-file`, `GET /api/file-proxy` |
| `backend/routes/health.ts` (44) | `GET /api/health`, `/api/knowledge/health`, `/api/runtime/version` |

O corpo dos handlers foi conferido **byte a byte** contra o bloco original antes e
depois do corte. As três são registradas em `startServer()`, depois do `createApp()`
(o chat depende da knowledge base montada no boot) — por isso **não** entram em
`routes/_registry.ts`.

## 5. Bugs reais corrigidos no caminho

### 5.1 Histórico da "Solicitação de Prioridade" nunca gravou nada

`backend/local-storage.ts` valida o caminho do documento contra uma whitelist de
coleções. `solicitacao_prioridade_jobs` **nunca esteve nela** — `writeDocBySegments`
lançava `INVALID_DOC_PATH`, `persistSolicitacaoJob` engolia no `try/catch` e logava um
warning. O painel (`SolicitacaoPrioridadePanel.tsx`) lê e apaga dessa coleção, então a
aba funcionava mas o histórico ficava **eternamente vazio**. Confirmado no disco:
nenhum diretório `solicitacao_prioridade_jobs` sob nenhum usuário.

Na mesma mudança a whitelist virou a constante única `ALLOWED_COLLECTIONS` — estava
duplicada literalmente em `resolveDocPathFromSegments` e
`resolveCollectionDirFromSegments`, e era um `Set` **realocado a cada chamada** (ou
seja, a cada leitura/escrita/listagem de documento).

### 5.2 Mojibake nos literais do backend

`backend/index.ts`, `routes/map.ts`, `routes/geometry.ts` e `lib/map-utils.ts` tinham
texto gravado em UTF-8-lido-como-cp1252 (`usuÃ¡rio`, `VERIFICAÃ‡ÃƒO`, `nÃ£o`). Isso
vazava para: mensagens de erro da API, o prompt de guardrail enviado ao modelo e o
contexto de PDF anexado no chat. O front já tinha um remendo
(`normalizeBackendText()` em `dashboard/lib/format.tsx`) justamente por causa disso.

Pior: **4 regex de auto-seleção de modelo do chat estavam quebradas.**
`/sat[eÃ©]lite/` é uma classe com `e`, `Ã` e `©` — nunca casava "satélite". O mesmo em
`demarca[cÃ§][aÃ£]o`, `pol[iÃ­]gono`, `an[aÃ¡]lise`, `relat[oÃ³]rio`, `t[eÃ©]cnico`,
`estat[iÃ­]stica`. Agora são `[eé]`, `[cç]`, `[aã]`, `[ií]` etc. e o roteamento
vision/geo/dados volta a disparar em texto acentuado.

A correção foi feita por round-trip `cp1252 → utf-8` só nas sequências afetadas
(nenhum "NÃO" legítimo foi tocado).

## 6. Verificação

| Passo | Resultado |
|---|---|
| `tsc --noEmit` | limpo |
| `vitest run` (suíte inteira) | **1.007 testes passando, 8 skipped, 0 falhas** — o baseline tinha 999 passando + 1 suíte estourando timeout sob carga |
| `vite build` | ok |
| `esbuild backend/index.ts --bundle` | ok |
| Inventário de rotas `HEAD` × árvore | **148 = 148, diff vazio** |
| `backend/auth-required-paths.ts` | intocado |
| Backend reiniciado na 3001 + smoke das rotas públicas | ok |

## Observação deixada em aberto (não é bug, não foi mexido)

`backend/cbers/sse.ts` → `progress()` calcula `clampPercent(patch.percent)` e logo em
seguida o `...patch` sobrescreve o valor calculado. Ou seja, **o clamp de 0–100 nunca
tem efeito**. Preservado byte a byte porque corrigir mudaria o percentual que chega na
tela em qualquer chamador que mande valor fora da faixa. Vale decidir depois se o
clamp deve valer ou se a linha sai.
