# 01 — Contexto e estado atual do código

Levantado por leitura direta do `main` em 2026-08-05 (commit `cb60a28e`). Tudo que está
nesta página é fato verificado no repositório, não intenção.

## 1. O que acontece hoje depois do recorte

```
POST /api/simcar/clip                     → recorta a ATP contra 28 camadas do "Arquivo Modelo"
POST /api/simcar/clip/analyze             → análise AC/AVN (imagens da propriedade inteira)
POST /api/simcar/clip/analyze-auas        → "Análise de AUAS"  ← o botão desta história
POST /api/simcar/clip/analyze/chat        → chat sobre o laudo
POST /api/simcar/clip/report              → PDF
```

Rotas em [`backend/simcar/routes.ts`](../../../backend/simcar/routes.ts); todas exigem
Firebase Auth pela allowlist em [`backend/app.ts:15-27`](../../../backend/app.ts).

No frontend, o botão **"Análise de AUAS"** está em
[`client/src/pages/Dashboard.tsx:5894`](../../../client/src/pages/Dashboard.tsx) e só
aparece depois que a análise AC/AVN produziu mensagem. Ele chama
`runAuasAnalysis` em
[`client/src/dashboard/hooks/useSimcarAnalysisFlow.ts:644`](../../../client/src/dashboard/hooks/useSimcarAnalysisFlow.ts).

## 2. Existem DUAS análises AUAS no código — e a boa está desligada

### V1 (legado, é o que roda hoje)

`processAuasAnalysis` em `backend/simcar/analysis.ts:4159`. Analisa a **união** dos
polígonos AUAS com 6 satélites fixos (`AC_AVN_FIXED_KEYS`: Sentinel 2024/2023, Landsat
2022/2021/2020 e SPOT 2008), janela **2008–2024**, e extrai o veredito de texto livre
por regex. É a janela oposta à que o Álvaro quer.

### V2 (pré-2008, implementada e testada, flag OFF)

Módulo [`backend/analise-pos-recorte/`](../../../backend/analise-pos-recorte/) — 4.228
linhas com testes, entregue em 2026-07-30/31 conforme
[`Analise_pos_recorte/concluido/README.md`](../../../Analise_pos_recorte/concluido/README.md):

| Arquivo | Papel |
|---|---|
| `config.ts` | Flags, modelos, janelas de visão, catálogo 2003–2008, `AUAS_RULES_VERSION` |
| `auas-polygons.ts` | `extractAuasPolygons()` + `computeGeometryHash()` (SHA-256 canônico) |
| `wms-scenes.ts` | `buildAuasScene()`: GetMap, overlay do polígono, resolução dinâmica, qualidade |
| `image-quality.ts` | Magic bytes, uniformidade, nuvem/oclusão |
| `groq-vision-client.ts` | Visão `qwen/qwen3.6-27b`, teto de 3 imagens, `reasoning_effort: none` |
| `deepseek-text-client.ts` | Redação `deepseek-v4-pro` + fallback determinístico |
| `evidence-reducer.ts` | `reduceAuasPolygon()` / `reduceAuasAggregate()` — o veredito é aqui |
| `checkpoint-store.ts` | `createFileCheckpointStore(jobId)` — JSON por job, retomada |
| `orchestrator.ts` | `runAuasPre2008Analysis(jobId, clippedGeometries, deps)` |
| `report-builder.ts` | Insumo factual do texto/PDF |

Integração já pronta: `processAuasAnalysisV2` e `handleAuasAnalyzeV2Route`
(`backend/simcar/analysis.ts:4530` e `:4579`) fazem billing, SSE, persistência e PDF.
O componente [`client/src/components/AuasPre2008Summary.tsx`](../../../client/src/components/AuasPre2008Summary.tsx)
existe (173 linhas) mas **não é renderizado por ninguém** — `grep` não acha uso.

**Porta de entrada:** `SIMCAR_AUAS_V2_ENABLED` (default `false` em
`backend/analise-pos-recorte/config.ts`). A variável **não está** no
`~/.config/geoforest/backend.env` do PC servidor (conferido por SSH, só nomes de
chaves). Ou seja: em produção, hoje, o botão AUAS roda o V1 de 2008–2024.

Pendências herdadas para ligar a Fase 1 (memória do projeto + STATUS do plano-mãe):
**conjunto dourado humano** e **validação live do DeepSeek** no fluxo real.

## 3. O que já existe do lado pós-2008

- **Plano escrito, nada implementado:**
  [`Analise_pos_recorte/fase/PLANO_FASE_2_AUAS_DESMATAMENTO_POS_2008.md`](../../../Analise_pos_recorte/fase/PLANO_FASE_2_AUAS_DESMATAMENTO_POS_2008.md)
  (343 linhas, revisão 2026-07-31). Este plano **absorve e refina** aquele; a diferença
  principal é o corte em 2019 e o encadeamento com a Fase 3.
- **Datação ≥ 2019 já resolvida por outro caminho:**
  [`backend/auas-sccon.ts`](../../../backend/auas-sccon.ts) + aba `/dashboard/auas`
  cravam `ABERTURA` pela data do alerta SCCON (ver [`docs/AUAS_SCCON.md`](../../AUAS_SCCON.md)).
  A Fase 2 **não deve** competir com isso.
- **Fixture oficial:** `Analise_pos_recorte/fase/SIMCAR_Recorte_Digital.zip` (contém a
  camada `AIR`; o teste tem de começar pelo recorte normal, não tratar o ZIP como AUAS).

## 4. O que existe do lado da Área Consolidada

- `AREA_CONSOLIDADA` é uma das 28 camadas recortadas
  ([`backend/simcar/constants.ts:62-70`](../../../backend/simcar/constants.ts)), então
  seus polígonos **já estão** em `job.clippedGeometries.get("AREA_CONSOLIDADA")`, do
  mesmo jeito que os AUAS.
- `AVN` e `TIPOLOGIA_VEGETAL` também são recortadas — é o insumo geométrico da Fase 3.
- A análise AC/AVN atual (`runAcAvnSatelliteAnalysis`, `analysis.ts:4950`) olha a
  **propriedade inteira** em 6 imagens e produz texto; ela **não** responde "tem
  vegetação dentro deste polígono de AC?" por polígono. É complementar, não substituta.
- `computeAcAvnAuasContext` (mesmo arquivo) já calcula relações AC × AVN × AUAS e
  alimenta o veredito global exibido no Dashboard (ex.: "AVN fora em AUAS").

## 4.1 O que este plano NÃO é (para não confundir com o oráculo)

Nenhuma das três fases fala com o SIMCAR da SEMA. Elas leem **imagens do WMS público** e
as **camadas do próprio recorte**. O fluxo em que o GeoForest importava o ZIP do usuário
no SIMCAR real com a **conta técnica do Álvaro** (oráculo / aba "Processar projeto") está
**desativado para sempre** desde 2026-08-05 — ver
[`docs/FLUXO_ORACULO_SIMCAR_DESATIVADO.md`](../../FLUXO_ORACULO_SIMCAR_DESATIVADO.md).
Nenhuma tarefa deste plano pode reintroduzir esse comportamento.

## 5. Restrições operacionais medidas (herdadas, valem para as 3 fases)

| Limite | Valor medido | Origem |
|---|---|---|
| Imagens por chamada de visão | **3** (a API rejeitou 4 e 5) | Validação live 2026-07-30 |
| Tokens/minuto da conta Groq | ~8.000 TPM | Headers da conta |
| Custo de uma janela de 3 cenas | ~5.478 tokens de entrada | Medição live |
| Tempo estimado | ~2–3 min por polígono na Fase 1 (3 janelas) | Estimativa do plano-mãe |

Consequência direta: **o gargalo é o rate limit, não a CPU**. Toda estimativa mostrada
ao usuário deve sair de `nº de polígonos × nº de janelas`, e a fila precisa respeitar
`x-ratelimit-remaining-tokens` / `retry-after`.

## 6. Resumo do delta que este plano pede

| Item | Hoje | Depois |
|---|---|---|
| Botão AUAS | 1 botão → V1 (2008–2024, união, regex) | 1º de 3 botões → V2 (2003–2008, por polígono) |
| Datação 2009–2019 | não existe | Fase 2, por polígono |
| Vegetação dentro da AC | só texto global do AC/AVN | Fase 3, por polígono, geométrico + visual |
| `AuasPre2008Summary.tsx` | órfão | renderizado no card do recorte |
| Persistência | `auasMeta` (um bloco) | `auasMeta` + `auasPos2008Meta` + `acVegetacaoMeta` |
