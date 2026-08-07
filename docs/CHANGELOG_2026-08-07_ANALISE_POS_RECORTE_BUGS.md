# 2026-08-07 — Análise pós-recorte: auditoria e correções de bugs (F2/F3)

Rodada de **correções** sobre as Fases 2 e 3 (datação 2009–2019 e vegetação na AC),
feita após o fast-forward do clone Windows para `origin/main` em `aa0556e6`. São
bugs encontrados em auditoria, todos com teste de regressão. **Flags continuam
desligadas**: as rotas seguem respondendo `409 PHASE_NOT_READY` até as flags serem
ligadas por humano.

## Correções por área

### 1. Ownership e SSRF nas rotas de fase (segurança — alta)

**Problema:** as rotas `POST /api/simcar/clip/analyze-auas-pos2008` e
`POST /api/simcar/clip/analyze-ac-vegetacao` liam o job persistido com
`readPersistedSimcarClip(jobId)` (varre o diretório de todos os usuários) e
hidratavam com `contextUrl`/`outputZipUrl` vindos do **corpo ou query da
requisição**. Um usuário autenticado podia:

- referenciar `jobId` de outro usuário e rodar a análise sobre o recorte dele;
- apontar `contextUrl` para uma URL arbitrária (`http://127.0.0.1:...`) e usar o
  servidor como proxy de leitura (SSRF), já que a hidratação faz `fetch` da URL.

**Correção:**

- `resolvePhaseContext` agora usa somente `readPersistedSimcarClipForUid(uid, jobId)`
  e chama `hydrateCachedJob(jobId, undefined, undefined, uid)` — sem aceitar URL do
  cliente; a fonte de contexto/ZIP é o documento persistido do próprio usuário;
- a mesma regra foi aplicada ao `GET /api/simcar/clip/phases/:jobId`,
  `GET /api/simcar/clip/download/:jobId` (que também só devolve ZIP do dono) e à
  reidratação interna de `backend/simcar/report.ts`;
- `hydrateCachedJob` ganhou o parâmetro `uid`: o cache em memória (`jobCache`) só é
  reutilizado quando `job.uid === uid`; URLs do cliente são ignoradas quando há uid;
- as rotas `POST /api/simcar/clip/analyze`, `analyze-auas` e `analyze/chat` também
  passam o `uid` para a hidratação.

### 2. Flags de habilitação independentes (F2 e F3 usavam a flag errada)

**Problema:** `getAuasV2Config().enabled` (que liga a Fase 1) era usado como gate das
Fases 2 e 3. Ligar `SIMCAR_AUAS_V2_ENABLED` liberava F2/F3; ligar
`SIMCAR_AUAS_POS2008_ENABLED`/`SIMCAR_AC_VEG_ENABLED` não fazia nada.

**Correção:**

- `AuasV2Config` ganhou `phase2Enabled` e `phase3Enabled`
  (`SIMCAR_AUAS_POS2008_ENABLED` e `SIMCAR_AC_VEG_ENABLED`);
- os handlers e o `GET /api/simcar/clip/phases/:jobId` propagam as flags para
  `derivePhases`, que devolve `phase_not_implemented` quando a flag está desligada
  (sem apagar resultados já concluídos);
- se `maxPolygonsPerJob > 0`, o limite de polígonos passou a valer também para F2/F3
  (recusa com `400 TOO_MANY_POLYGONS` **antes** de cobrar).

### 3. Corrida entre execuções da mesma fase (lock por job)

**Problema:** duas abas podiam disparar a mesma fase para o mesmo `jobId`; ambas
passavam no gate (`runningPhase` não era informado), duplicando chamadas de IA,
billing e disputando o mesmo checkpoint/persistência.

**Correção:** lock em memória `phaseLocks` por `uid:jobId` nas rotas F2/F3; a segunda
requisição recebe `409 PHASE_ALREADY_RUNNING` e o lock é liberado no `finally`.

### 4. Invalidação `stale` transitiva (resultado posterior ficava "válido")

**Problema:** F1 concluída em T1, F2 em T2, F3 em T3; refazer F1 em T4 marcava F2
como `stale`, mas F3 continuava `COMPLETED` (comparava só datas e a data da F3
continuava depois da F1). O gate permitia usar a F3 com a F2 antiga.

**Correção:**

- novo estado `STALE` em `derivePhases` (além do booleano `stale`), com motivo
  `phase_stale` e mensagem clara;
- `isStaleAfter` agora usa o **referência persistida** (`pre2008JobRef` /
  `pos2008JobRef`) quando existe — se a Fase N foi gerada sobre a Fase N-1 e a N-1
  mudou, N e todas as dependentes viram `STALE`;
- no front, `STALE` permite "Refazer" (mesma ação de `COMPLETED`).

### 5. Janela-ponte da F2 (sensor alternativo)

**Problema:**

- o orquestrador escolhia `bridgeCandidates[0]` sem garantir que era o candidato da
  fronteira da `bridgeWindow` — no catálogo real (fronteira L8→S2 em 2018/2019 com
  `SENTINEL_2_2018` como alternativa), podia tentar usar a alternativa de outra
  fronteira (ex.: 2011/2012) e a ponte nunca rodava;
- quando a alternativa existia em apenas **um** dos dois anos da fronteira, a ponte
  era descartada (`bridgeScenes.length === years.length` falhava);
- as cenas da ponte **sobrescreviam** `scenesByYear`, trocando a série normal do ano
  pela cena alternativa (proveniência da série corrompida).

**Correção:**

- `bridgeCandidates.find(...)` casa a fronteira exata da `bridgeWindow`;
- para o ano sem alternativa, usa a cena preferida normal (marcada `bridge: true`
  para proveniência) — a ponte roda desde que os dois lados estejam utilizáveis;
- cenas da ponte não são mais escritas em `scenesByYear`/`sceneIdByYear`: as janelas
  normais continuam usando a série RGB preferida; a ponte só adiciona observação.

### 6. Validação de ano por `sceneId` (F2 e F3)

**Problema:** a Groq podia citar um `sceneId` válido mas atribuir a ele outro ano; o
schema aceitava e o redutor datava a transição com o ano inventado. Transições
podiam ligar cenas **não consecutivas** dentro da janela.

**Correção:** `validateGroqPos2008WindowObservation` e
`validateAcVegetacaoWindowObservation` recebem o mapa `sceneId → {year, sensor}`
enviado na chamada; observação com ano divergente e transição entre cenas não
consecutivas são rejeitadas (`INVALID_SCHEMA` → retry → falha controlada).

### 7. Cenas da F3 (layers/styles inexistentes)

**Problema:** a F3 pedia `Cenas_Geral`/`Cenas_2008` com estilo `NIR` — camadas que
não existem no catálogo real da SEMA; as 3 cenas falhariam como `MISSING` e a F3
entregaria só geometria/inconclusivo.

**Correção:** novas configs com os nomes reais descobertos no levantamento F0.1
(`Mosaicos:SENTINEL_2_2024`, `Mosaicos:SENTINEL_2_2025` + `Geoportal_Sentinel_2_2025_NIR`,
`Mosaicos:MOSAICO_SPOT_SEPLAN`), todas sobrescrevíveis por env:

```dotenv
SIMCAR_AC_VEG_SCENE_CURRENT=Mosaicos:SENTINEL_2_2024
SIMCAR_AC_VEG_SCENE_NIR_LAYER=Mosaicos:SENTINEL_2_2025
SIMCAR_AC_VEG_SCENE_NIR_STYLE=Geoportal_Sentinel_2_2025_NIR
SIMCAR_AC_VEG_SCENE_NIR_YEAR=2025
SIMCAR_AC_VEG_SCENE_REFERENCE=Mosaicos:MOSAICO_SPOT_SEPLAN
SIMCAR_AC_VEG_MIN_SLIVER_M2=500
SIMCAR_AC_VEG_MIN_DECLARED_FRACTION=0.01
SIMCAR_AC_VEG_MIN_DECLARED_AREA_HA=0.5
```

### 8. Redutor visual da F3 (falsos alertas)

**Problema:** uma única cena `PATCHES` (com outra `NONE`) já gerava
`VEGETACAO_APARENTE_DENTRO_DA_AC`; `SPARSE` também disparava alerta; conflito
explícito entre cenas era ignorado.

**Correção:**

- exige **duas ou mais** observações positivas (`LARGE_BLOCK`/`PATCHES`) com
  confiança ≥ `MEDIUM` para `VEGETACAO_APARENTE`;
- `SPARSE` deixou de disparar alerta (entra como ausência);
- conflito entre positivo/negativo ou `conflicts[]` não vazio → `INCONCLUSIVO`.

### 9. Evidência geométrica da F3 (buracos perdidos)

**Problema:** `collectRings` descartava os anéis internos; um AVN em formato "donut"
tinha o buraco preenchido, superestimando a área e podendo cruzar o limiar
(`VEGETACAO_DECLARADA` falso).

**Correção:** `collectPolygons` preserva `Polygon`/`MultiPolygon` completos
(incluindo buracos) no filtro de slivers; testes com donut confirmam fração de
75% (não 100%).

### 10. Catálogo WMS (cache por bbox + validação de imagem)

**Problema:** o catálogo era cacheado por 6 h sem escopo espacial — a validação
`GetMap` de um job (bbox) era reutilizada por outro job em outra região; e o
validador aceitava resposta `text/xml` (erro WMS) como imagem válida quando o
`detectUniformImage` não reprovava.

**Correção:** chave do cache agora inclui a bbox normalizada; o validador checa
`Content-Type` e magic bytes (PNG/JPEG) antes de analisar uniformidade. A versão
do catálogo (`computeCatalogVersion`) passou a incluir os `alternates` (mudar a
alternativa disponível também invalida checkpoints).

### 11. Front (reidratação e vetorizado)

- o mapper do histórico (`Dashboard.tsx`) agora copia `auasPos2008Meta` e
  `acVegetacaoMeta` dos docs Firestore (antes só vinham via SSE — recarregar a
  página perdia o resultado das Fases 2/3);
- o painel "Análise pós-recorte" também renderiza para jobs `vectorized-analysis`
  (antes só `auto-clip`).

### 12. Persistência como pré-condição do `complete` (F2/F3)

`persistSimcarClipArtifacts` agora retorna `boolean`; os handlers de F2/F3 **não
emitem `complete` nem liquidam billing** se a persistência falhar (antes
registravam warning e seguiam — o resultado sumia ao recarregar). O `refundRemaining`
zera `reservedBrl` após o refund para não devolver crédito duas vezes.

## Testes de regressão (novos)

- `backend/simcar/hydration.test.ts` — cache de outro usuário não é reutilizado e
  URL do cliente é ignorada com uid;
- `backend/analise-pos-recorte/pos2008/timeline.test.ts` — ponte casada com o
  candidato que tem alternativa real;
- `backend/analise-pos-recorte/pos2008/orchestrator.test.ts` — ponte com alternativa
  em um lado apenas roda e não troca a série normal;
- `backend/analise-pos-recorte/pos2008/schemas.test.ts` — ano divergente do sceneId
  e transição não consecutiva são rejeitadas;
- `backend/analise-pos-recorte/pos2008/catalog.test.ts` — cache não reutiliza
  validação GetMap de outra bbox;
- `backend/analise-pos-recorte/ac-vegetacao/geometry-evidence.test.ts` — donut
  preserva buraco;
- `backend/analise-pos-recorte/ac-vegetacao/evidence-reducer.test.ts` — 1 cena
  PATCHES + NONE não alerta; SPARSE não alerta; conflito explícito → inconclusivo;
- `backend/simcar/phases.test.ts` — invalidação transitiva (F1 refeita derruba F2 e
  F3) e flags independentes;
- `backend/simcar/routes-phases.test.ts` — `beforeAll` com timeout explícito
  (estabilidade da suíte sob contenção).

## Gate da rodada

* `pnpm test` — **591 passed / 8 skipped** (80 arquivos)
* `pnpm check` (tsc) — sem erros
* `pnpm build` — ok (backend esbuild + front Vite)
* `git diff --check` — sem whitespace errors

## Pendências (fora desta rodada)

1. E2E "dourado" humano da F2/F3 (depende de humano + env live);
2. `DEEPSEEK_API_KEY` do server continua 401 (laudo cai no fallback determinístico);
3. Flags de habilitação seguem `false` — decisão de rollout é do Álvaro.
