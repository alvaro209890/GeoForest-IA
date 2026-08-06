# 12 — Tarefas de implementação

Ordem obrigatória: **F0 → F1 → F2 → F3**. Cada tarefa é um commit no `main` (o repo faz
push direto, sem PR) e o gate é sempre: `pnpm test` inteiro verde + `pnpm run check` +
`pnpm run build`.

**Executadas até agora:** F0.1, F0.3, F0.4, F0.5 e F0.6 (rodada de 2026-08-05 — ver
`docs/CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md`). O resto continua pendente.

## F0 — Descoberta e fundação (sem IA, sem UI)

| # | Tarefa | Entrega / gate |
|---|---|---|
| F0.1 ✅ | **Levantamento WMS ao vivo**: `GetCapabilities` + `GetMap` real para 2009→2019 e para as cenas da Fase 3 (2024, NIR, SPOT) | Relatório em `docs/` com layer por ano, ausências, dimensões e tempo de resposta. **Bloqueia F2 e F3** |
| F0.2 | Responder decisões **A1–A4** do doc 11 | Registradas no STATUS |
| F0.3 ✅ | `polygons.ts` genérico + `extractAuasPolygons` como wrapper | U-01, U-02 verdes; testes atuais de `auas-polygons` intactos |
| F0.4 ✅ | `checkpoint-store` com namespace de fase e `catalogVersion` | U-13 verde; chaves antigas continuam legíveis |
| F0.5 ✅ | `GET /api/simcar/clip/phases/:jobId` + allowlist de auth | R-01, R-03 verdes |
| F0.6 ✅ | Painel `AnalisePosRecortePanel` com os 3 cards, **ligado só à Fase 1** | F-01 verde; Dashboard perde o botão solto |

## F1 — Ligar a Fase 1 (código já existe)

| # | Tarefa | Entrega / gate |
|---|---|---|
| F1.1 ✅ | ~~Renderizar `AuasPre2008Summary.tsx`~~ — já era renderizado no card de resultado do recorte (verificado em 2026-08-05); o painel novo não duplica a tabela | — |
| F1.2 | Rótulo "Análise de AUAS (2003–2008)" + prévia (nº de polígonos, cenas, ETA) | Revisão visual |
| F1.3 | **Conjunto dourado da Fase 1** (≥12 polígonos conferidos por humano) | Manifesto versionado, sem chaves |
| F1.4 | **Live do DeepSeek** no fluxo real (`SIMCAR_LIVE=1`) | L-01, L-05 verdes |
| F1.5 | E2E da fixture `SIMCAR_Recorte_Digital.zip` | ≥1 `ALERTA_PRE_2008`; falha se não |
| F1.6 | `SIMCAR_AUAS_V2_ENABLED=true` no servidor + deploy | Health OK; laudo real conferido |
| F1.7 | Decidir/aplicar A5 (destino do V1) + changelog | `docs/CHANGELOG_<data>_ANALISE_POS_RECORTE_F1.md` |

## F2 — Datação 2008–2019

| # | Tarefa | Entrega / gate |
|---|---|---|
| F2.1 | `pos2008/catalog.ts`: descoberta, validação `GetMap`, TTL, `catalogVersion`, anos ausentes | W-01, W-02 verdes |
| F2.2 | `GET /api/simcar/imagery/catalog` (diagnóstico + prévia da UI) | R-01 cobre auth |
| F2.3 | `pos2008/schemas.ts` + tipos do doc 05 §8 | U-14 verde |
| F2.4 | `pos2008/timeline.ts`: 5 janelas, lacunas, fronteiras de sensor, janela-ponte | U-03 verde |
| F2.5 | `pos2008/evidence-reducer.ts` — **puro, sem rede** | U-04…U-09 verdes (é o coração da fase) |
| F2.6 | `pos2008/scenes.ts` reusando `wms-scenes`/`image-quality` (zero duplicação) | W-03, W-04 verdes |
| F2.7 | Cliente de visão da Fase 2: prompt por sensor, JSON estrito, teto de 3 imagens, retry único | U-16 verde |
| F2.8 | `pos2008/orchestrator.ts`: fila, rate limit por headers, checkpoints, cancelamento, progresso | U-15, R-04 verdes |
| F2.9 | Rota `POST /api/simcar/clip/analyze-auas-pos2008` + gate + billing + SSE + persistência | R-02, R-06 verdes |
| F2.10 | `pos2008/report-builder.ts` + DeepSeek + fallback determinístico + encaminhamento SCCON | L-05 verde |
| F2.11 | Front: card da Fase 2, prévia, progresso, tabela por polígono, histograma, filtros | F-03, F-06 verdes |
| F2.12 | Seção da Fase 2 no PDF | Revisão do laudo real |
| F2.13 | Conjunto dourado da Fase 2 + live encadeado (L-02, L-04, L-06) | Paridade acordada |
| F2.14 | `SIMCAR_AUAS_POS2008_ENABLED=true` + deploy + `docs/ANALISE_POS_RECORTE.md` + changelog | Health OK |

## F3 — Vegetação na Área Consolidada

| # | Tarefa | Entrega / gate |
|---|---|---|
| F3.1 | `ac-vegetacao/geometry-evidence.ts`: AC × AVN/TIPOLOGIA_VEGETAL/ARL/AUAS, slivers, flags | U-10, U-11 verdes |
| F3.2 | `ac-vegetacao/schemas.ts` + tipos do doc 06 §4 | U-14 verde |
| F3.3 | `ac-vegetacao/scenes.ts`: 2024 + NIR + SPOT 2008, com fallback de catálogo | W-05 verde |
| F3.4 | Cliente de visão da Fase 3 (vocabulário `NONE…LARGE_BLOCK`, distribuição) | Teste com fixture de resposta |
| F3.5 | `ac-vegetacao/evidence-reducer.ts`: precedência geométrica, bandas de área, níveis de alerta | U-12 verde |
| F3.6 | `ac-vegetacao/orchestrator.ts` + rota `analyze-ac-vegetacao` + gate | R-05 verde (camada vazia = 200 com aviso) |
| F3.7 | Front: card da Fase 3, tabela, coluna declarada × aparente, flags | Revisão visual |
| F3.8 | Seção da Fase 3 no PDF + texto de limitação | Revisão do laudo |
| F3.9 | Conferência no GIS de ≥3 imóveis reais (L-03) | Paridade com a leitura humana |
| F3.10 | `SIMCAR_AC_VEG_ENABLED=true` + deploy + changelog + atualizar `.claude/CLAUDE.md` | Health OK |

## Estimativa grosseira

| Bloco | Tamanho |
|---|---|
| F0 | 1–2 dias (F0.1 é levantamento, não código) |
| F1 | 1 dia de código + tempo humano do conjunto dourado |
| F2 | 4–6 dias (a maior parte é redutor + orquestração + validação) |
| F3 | 2–3 dias (geometria é barata; visão é 1 janela) |

O caminho crítico não é código: é **F0.1 (levantamento WMS)** e as sessões de
**conjunto dourado** de F1 e F2, que dependem de conferência humana.
