# 2026-08-07 — Análise pós-recorte: Fases 2 (datação 2009–2019) e 3 (vegetação na AC)

Segunda rodada de **código** do plano `docs/planos/analise-pos-recorte/`. Entrega as
duas fases que faltavam, com a arquitetura acordada no plano: **Groq só enxerga,
DeepSeek só redige, o veredito é do código**. Commit `7097fb84` no `main`; pusheado em
07/08 e colocado em produção pelo auto-sync (build + restart + Firebase hosting).

> ⚠️ **Flags permanecem desligadas.** Nenhuma fase nova está ativa em produção: as
> rotas F2/F3 respondem `409 PHASE_NOT_READY` até `SIMCAR_AUAS_POS2008_ENABLED` /
> `SIMCAR_AC_VEG_ENABLED` entrarem no `config.ts` e no `backend.env`. Desligado por
> design: rollout é decisão de humano.

## O que entrou

| Tarefa do plano | Entrega |
|---|---|
| **F2** | `backend/analise-pos-recorte/pos2008/` — datação 2008–2019 |
| **F3** | `backend/analise-pos-recorte/ac-vegetacao/` — vegetação na Área Consolidada |
| **Catálogo** | `GET /api/simcar/imagery/catalog` (SSE, descoberta via WMS GetCapabilities) |
| **Rotas** | `POST /api/simcar/clip/analyze-auas-pos2008`, `POST /api/simcar/clip/analyze-ac-vegetacao` |
| **Front** | runner SSE com progresso/cancelamento para as duas fases + gates |

## F2 — `pos2008/`

Modulos:

- `catalog-discovery.ts` — descoberta do catálogo WMS da SEMA (série 2009–2019 já
  mapeada) com cache/TTL;
- `timeline.ts` — 5 janelas anuais + janela-ponte no sensor alternativo em fronteiras
  de troca de sensor (L5→RS2→L8→S2), conforme o risco nº 1 do plano;
- `evidence-reducer.ts` — regra determinística: transição em borda de sensor só vira
  **ano confirmado** se a janela-ponte confirmar; senão vira **intervalo**;
- `scenes.ts`, `orchestrator.ts`, `report-builder.ts`, `schemas.ts`,
  `groq-vision-client.ts` (retry, mutex).

## Fase 3 — `ac-vegetacao/`

Híbrida (geometria no turf + IA):

- `geometry-evidence.ts` — cruza `AREA_CONSOLIDADA` × `AVN`/`ARL`/`TIPOLOGIA_VEGETAL`;
  considera slivers < 500 m² como ruído;
- 3 cenas: S2 RGB (2024), S2 NIR (`featureType`), SPOT 2008;
- `evidence-reducer.ts` — precedência da evidência geométrica sobre a leitura visual;
- `orchestrator.ts`, `report-builder.ts`, `schemas.ts`.

## Contratos

Rota F2: `POST /api/simcar/clip/analyze-auas-pos2008` — SSE com progresso e resultado
`auasPos2008Meta` persistido (Firestore). Rota F3: `POST /api/simcar/clip/analyze-ac-vegetacao`
— idem, `acVegetacaoMeta`. Catálogo: `GET /api/simcar/imagery/catalog` expõe as janelas do
sensor para o front.

Continuam com o mesmo formulário das Fases 1: billing (reserve/settle), gates de fase
(`409 PHASE_NOT_READY`), checkpoint, `generateAndPersistSimcarReport`.

## Front

`useSimcarAnalysisFlow.ts` ganhou os estados `pos2008PhaseState` e `acVegetacaoPhaseState`,
SSE com progresso, cancelamento, toast; painéis novos com a prévia (`auasPos2008Meta` /
`acVegetacaoMeta`), resultado detalhado e recarga de gates quando a fase termina.

## Qualidade

* `pnpm test` → **579 passed / 8 skipped** (33 testes novos)
* `pnpm check` (tsc) → sem erros
* `pnpm build` → ok (backend esbuild + front Vite)

## Pendências (não fechadas por design)

1. `config.ts` ainda **não lê** `SIMCAR_AUAS_POS2008_ENABLED` nem `SIMCAR_AC_VEG_ENABLED`
   (o gate hoje segue `SIMCAR_AUAS_V2_ENABLED`) — pegada para ligar as fases;
2. E2E "dourado" humano da F2/F3 não rodado (depende de humano + env live);
3. `DEEPSEEK_API_KEY` do server continua a 401 (laudo cai no fallback determinístico).