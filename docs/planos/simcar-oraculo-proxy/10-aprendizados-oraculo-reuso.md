# 10 — Aprendizados do oráculo (reuso no produto)

Fonte: sessão 16–17/07/2026 + `docs/CHANGELOG_2026-07-16_ORACULO_SEMA_SANTA_CLARA.md` + código em `backend/geometry-errors.ts`.

## Importação (mensagens SEMA reais)

| Mensagem | Detector GeoForest | Fix offline |
|----------|-------------------|-------------|
| Borda do polígono se cruza | `borda_se_cruza` / colapso 0,02 m | limpar pinças / dups |
| A geometria contém pontos repetidos | `vertice_duplicado` tol **0,1 m** | strip dups |
| Duas ou mais bordas ou buracos… se sobrepõem | `detectOverlappingRings` + borda compartilhada ≥ **1 m** | remover buraco colado |
| Polígono complexo… (import) | regras já no import phase | self-union com cuidado |

**Calibração v23:** SEMA qty **11** pontos repetidos = **11 feições** GeoForest com `vertice_duplicado` (linhas por vértice > 11 — agregar por feição no PDF/resumo).

## Processamento

| Mensagem | Detector | Fix offline |
|----------|----------|-------------|
| Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA | `detectUmidaContainment` (união + área 0,3 m² + amostra borda 20 m) | clip úmida ∩ cover + limpar dups |
| Sobreposições proibidas / reservatório | `detectSimcarForbiddenOverlaps` + `pairFilter` | cartográfico / atributo SITUACAO |

**Diagnóstico 41 úmidas:** quase não é “fora da AIR”; é úmida sobre **hidrografia** (buraco no AVN). Clip por hidro no AVN **piora**.

## Cliente SIMCAR (já validado em laboratório)

```
ROOT = https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api
POST Autenticacao/Autenticar  { v: scramble(JSON) }
GET/POST com header Authorization: TECNICO …
Requerimento/Buscar/{id}
Importar shape (upload + comando import)
Requerimento/ProcessarGeo/{id}
DownloadPdfImportacaoShapefile/{id}
DownloadPdfRelatorioProcessamento/{id}
DownloadArquivoErrosProcessamento/{id}  # 400 se inexistente
```

Poll: `ImportacaoShapeStatus` / `ImportacaoResultado` / `ProcessamentoStatus` / `ProcessamentoResultado`.

## O que o modo ORACULO substitui

| Antes (LOCAL) | Depois (ORACULO) |
|---------------|------------------|
| `runImportPhase` como veredito | PDF SEMA import |
| `runProcessPhase` como veredito | PDF SEMA process |
| Detector local | continua útil em HYBRID e no **autofix planner** |

## Constantes já no código (não re-sintonizar no escuro)

```
SIMCAR_RING_SHARED_EDGE_M = 1.0
SIMCAR_RING_SHARED_EDGE_TOL_M = 0.02
SIMCAR_UMIDA_FORA_TOL_M2 = 0.3
SIMCAR_UMIDA_EDGE_SAMPLE_M = 20
dup vertices import = 0.1 m
```

## Scripts de laboratório a promover (P5+)

- `__tmp_fix_v22_umida_holes.ts`
- `__tmp_fix_v23_umida_clip.ts`
- `__tmp_fix_v24_umida_clean.ts`
- `.oraculo-scratch/simcar-client.mjs` → `backend/simcar-oraculo/client.ts`
