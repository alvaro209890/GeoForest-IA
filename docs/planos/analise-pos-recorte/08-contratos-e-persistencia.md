# 08 — Contratos, SSE e persistência

## 1. Rotas

| Método | Rota | Fase | Gate |
|---|---|---|---|
| POST | `/api/simcar/clip/analyze-auas` | 1 | job de recorte hidratável + camada AUAS |
| POST | `/api/simcar/clip/analyze-auas-pos2008` | 2 | `auasMeta` v2 concluído |
| POST | `/api/simcar/clip/analyze-ac-vegetacao` | 3 | `auasPos2008Meta` concluído + camada AC |
| GET | `/api/simcar/clip/phases/:jobId` | — | estado das 3 fases (para o painel) |
| GET | `/api/simcar/imagery/catalog` | — | catálogo WMS resolvido (prévia/diagnóstico) |

Corpo comum das rotas de fase:

```jsonc
{ "jobId": "…", "contextUrl": "…?", "outputZipUrl": "…?" }
```

Todas entram em `AUTH_REQUIRED_PATHS` (`backend/app.ts:15`). Nenhuma aceita caminho de
arquivo, URL de imagem ou credencial no corpo.

### `GET /api/simcar/clip/phases/:jobId`

Resposta que o painel usa para montar os três cards sem baixar os laudos inteiros:

```jsonc
{
  "jobId": "…",
  "layers": { "auasPolygonCount": 17, "acPolygonCount": 9 },
  "phases": {
    "PRE_2008":  { "state": "COMPLETED", "completedAt": "…", "rulesVersion": "auas-pre2008-v1",
                   "summary": { "alertCount": 3, "inconclusiveCount": 2 } },
    "POS_2008":  { "state": "AVAILABLE", "blockedReason": null,
                   "estimate": { "polygons": 17, "windowsPerPolygon": 5, "etaSeconds": 4800 } },
    "AC_VEG":    { "state": "BLOCKED", "blockedReason": "requires_POS_2008" }
  }
}
```

`state` ∈ `BLOCKED` | `AVAILABLE` | `RUNNING` | `COMPLETED` | `FAILED` | `STALE`.

> **Implementado em 2026-08-05** (`backend/simcar/phases.ts`): cada fase devolve, além
> do acima, `blockedMessage` (o motivo já em pt-BR, para o botão), `rulesVersion` e
> `stale`. `blockedReason` é um código estável: `layer_empty_AUAS`,
> `layer_empty_AREA_CONSOLIDADA`, `requires_PRE_2008`, `requires_POS_2008`,
> `phase_not_implemented`, `phase_running`, `other_phase_running`. Enquanto as fases 2 e
> 3 não existirem, elas respondem `phase_not_implemented`.

## 2. Códigos de erro

| Código | HTTP | Quando |
|---|---|---|
| `PHASE_NOT_READY` | 409 | fase anterior não concluída (`requires` diz qual) |
| `PHASE1_MISMATCH` | 409 | `geometryHash` divergiu entre fases (recorte refeito) |
| `PHASE_ALREADY_RUNNING` | 409 | já existe job ativo desta fase para este `jobId` |
| `LAYER_EMPTY` | 200 + aviso | camada da fase sem polígonos (não é erro) |
| `TOO_MANY_POLYGONS` | 400 | acima do teto configurado — recusa **antes** de processar |
| `CATALOG_UNAVAILABLE` | 503 | `GetCapabilities` falhou e não há catálogo em cache |

`TOO_MANY_POLYGONS` já existe na Fase 1 (`AuasTooManyPolygonsError`) — reusar o padrão:
recusar antes, nunca analisar só os primeiros polígonos em silêncio.

## 3. Eventos SSE (idênticos nas três fases)

```
job_started   { jobId }
progress      { step, percent, message, phase,
                polygonIndex, polygonTotal, windowIndex, windowTotal, etaSeconds }
billing       { … }                      // no-op local, mantido por compatibilidade
report_error  { message }                // DeepSeek falhou → segue com fallback
error         { message, code? }
complete      { phase, meta, images?, layerSummaries? }
```

Regra herdada: `complete` só é emitido **depois** da persistência durável do resultado.
`model_thinking` não é emitido nos fluxos novos.

## 4. Persistência no histórico do job

```jsonc
{
  "jobId": "…",
  "analysisMeta":     { /* AC/AVN — existente */ },
  "auasMeta":         { "schemaVersion": 2, "rulesVersion": "auas-pre2008-v1", … },
  "auasPos2008Meta":  { "schemaVersion": 1, "rulesVersion": "auas-pos2008-v1", … },
  "acVegetacaoMeta":  { "schemaVersion": 1, "rulesVersion": "ac-vegetacao-v1", … }
}
```

Regras:

- Um bloco **nunca** sobrescreve outro. Refazer uma fase substitui só o bloco dela e
  marca os posteriores como `stale: true`.
- Cada bloco carrega `startedAt`, `completedAt`, `rulesVersion` e (fases 2/3)
  `catalog.version`.
- O tipo do front (`client/src/dashboard/types/history.ts`) ganha os dois campos novos;
  `SimcarAuasMeta = SimcarAuasMetaV1 | SimcarAuasMetaV2` continua como está — cards
  antigos precisam abrir.
- Nada de preencher campo V1 com semântica V2 só para satisfazer tipo antigo.

## 5. Checkpoints

Arquivo por job (evolução de `checkpoint-store.ts`), com a fase no nome:

```text
<STORAGE_ROOT>/analise-pos-recorte/checkpoints/<jobId>.json
{
  "PRE_2008::auas-pre2008-v1::…::AUAS-0007::W2005_2007::<sha das cenas>": { …observação… },
  "POS_2008::auas-pos2008-v1::<catalogVersion>::AUAS-0007::W2013_2015::<sha>": { … }
}
```

Invalidação automática: mudou `rulesVersion` ou `catalogVersion` → a chave não bate →
recomputa. É o mecanismo que impede reaproveitar observação feita sobre outra imagem.

## 6. Configuração (env)

```dotenv
# Fase 1 (já implementada)
SIMCAR_AUAS_V2_ENABLED=false
SIMCAR_AUAS_VISION_MODEL=qwen/qwen3.6-27b
SIMCAR_AUAS_TEXT_MODEL=deepseek-v4-pro
SIMCAR_AUAS_VISION_MAX_IMAGES=3
SIMCAR_AUAS_VISION_REASONING_EFFORT=none
SIMCAR_AUAS_VISION_TIMEOUT_MS=120000
SIMCAR_AUAS_DEEPSEEK_TIMEOUT_MS=90000
SIMCAR_AUAS_MAX_POLYGONS_PER_JOB=0

# Fase 2 (novas)
SIMCAR_AUAS_POS2008_ENABLED=false
SIMCAR_AUAS_POS2008_START_YEAR=2009
SIMCAR_AUAS_POS2008_END_YEAR=2019
SIMCAR_AUAS_POS2008_BRIDGE_ENABLED=true
SIMCAR_IMAGERY_CATALOG_TTL_MS=21600000        # 6 h
SIMCAR_AUAS_LAYER_2009=…                      # overrides opcionais por ano

# Fase 3 (novas)
SIMCAR_AC_VEG_ENABLED=false
SIMCAR_AC_VEG_SCENE_CURRENT=Mosaicos:SENTINEL_2_2024
# ⚠️ corrigido em 2026-08-05 (F0.1): NIR e ESTILO, nao camada.
SIMCAR_AC_VEG_SCENE_NIR_LAYER=Mosaicos:SENTINEL_2_2025
SIMCAR_AC_VEG_SCENE_NIR_STYLE=Geoportal_Sentinel_2_2025_NIR
SIMCAR_AC_VEG_SCENE_REFERENCE=Mosaicos:MOSAICO_SPOT_SEPLAN
SIMCAR_AC_VEG_MIN_SLIVER_M2=500
SIMCAR_AC_VEG_MIN_DECLARED_FRACTION=0.01
```

Chaves de API (`GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `SEMA_WMS_*`) já existem no PC
servidor. **Nenhuma** entra em código, log, fixture ou SSE.

## 7. Billing

Local mode: `backend/billing.ts` devolve 0 BRL. A reserva/liquidação continua sendo
chamada (as fases novas copiam o padrão de `handleAuasAnalyzeV2Route`) para que, se o
billing voltar a ser real, a contabilidade por fase já exista com `endpoint` próprio.
