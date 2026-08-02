# CHANGELOG 2026-08-02 — PLANO 02 CONCLUÍDO (desmembramento do monólito SIMCAR)

> `backend/simcar-clip.ts`: **10.026 → 87 linhas (−99,1%)** — monólito eliminado.
> 13 módulos em `backend/simcar/` + barrel de compatibilidade. Plano 02 100% concluído.

## O que foi feito (8 commits, 1 por fase)

| Commit | Fase | Conteúdo |
|--------|------|----------|
| `a3f0c204` | 1 | Removidas **25 funções duplicadas** do monólito (passaram a importar dos módulos existentes) |
| `391dd93a` | 2 | **`simcar/cloudinary.ts`** (10 funções): compressForVision, uploads, delete, vision parts, truncation |
| `2eb7ffb2` | 3 | **`simcar/car-lookup.ts`**: fetchCarBoundaryByNumber + WFS fallback |
| `4072a12a` | 4a/4b | **`simcar/wfs-client.ts`** (3 fetchers + paginação/fallback) e `toPublicApiUrl` → constants |
| `79778700` | 4c | **`parseUserShapefile` + `discoverLayerMapping`** → shapefile-io.ts |
| `705ca410` | 4e | **Bloco de recorte → `clip-pipeline.ts`**: processClip (545 linhas), clipFeaturesToPolygon, buildOutputZip, parsePersistedClipContext etc. — 93 → 1.066 linhas |
| `0ea4417f` | 5a | **`simcar/hydration.ts`**: readPersistedSimcarClip, hydrateCachedJob, persistSimcarClipProcessingState/Artifacts, parseCachedContextFromOutputZip |
| `0cd7a001` | 5b | **`simcar/report.ts`**: buildSimcarReportPdfBuffer + generateAndPersistSimcarReport (PDF pdfkit) |
| `031d517e` | 6 | **`simcar/analysis.ts`** (5.249 linhas: config, WMS, Groq/visão, prompts, AC/AVN, AUAS) e **`simcar/routes.ts`** (1.701: registerSimcarClipRoutes). `simcar-clip.ts` vira **barrel de compatibilidade** (87 linhas) |

## Estrutura final de `backend/simcar/`

```
simcar/
├── analysis.ts        # 5.249 linhas — pipeline de análise IA (AC/AVN, AUAS, WMS, Groq, visão, síntese)
├── routes.ts          # 1.701 linhas — registerSimcarClipRoutes (endpoints SSE, download, analyze, report)
├── clip-pipeline.ts   # 1.066 linhas — orquestrador do recorte (processClip, SSE, job cache, ZIP output)
├── report.ts          # 640 linhas  — laudo PDF (pdfkit) + persistência
├── shapefile-io.ts    # 451 linhas  — leitura .shp/.dbf/.zip, parseUserShapefile, discoverLayerMapping
├── hydration.ts       # 336 linhas  — retomada de jobs + persistência Firestore/storage
├── wfs-client.ts      # 291 linhas  — fetch WFS (BBOX/INTERSECTS, paginação, fallback)
├── area-calculator.ts # 220 linhas  — áreas, XLSX quantitativos, warnings
├── types.ts           # 216 linhas  — tipos compartilhados
├── polygon-ops.ts     # 212 linhas  — operações geométricas (union, simplify, point-in-polygon)
├── index.ts           # 185 linhas  — barrel público
├── cloudinary.ts      # 132 linhas  — storage/upload de imagens
├── constants.ts       # 131 linhas  — constantes de configuração
├── air-atp-generator.ts # 116 linhas — AIR/ATP (direct copy layers)
├── attribute-mapper.ts  # (existente) — mapeamento de atributos template→WFS
└── validation.ts        # (existente) — validações pós-recorte
```

## Garantias

- **Zero mudança funcional**: todos os blocos movidos **verbatim** (verificação de hash/âncoras de conteúdo, nunca script de faixa cega). Assinatura real do `processClip` (8 args com requestedLayers/airIdentificacao/forcedJobId) preservada.
- **Tipos corrigidos**: `ClippedPointResult.pointCoords` (era `point`), `WfsFeature.id/bbox` opcionais, `WfsClipFetchResult.warnings/partial`, `AiImage.url`.
- **Sem imports circulares**: ordem de extração por camadas (cloudinary → car-lookup → wfs → parse → recorte → hydration → report → análise → rotas).
- **Validação a cada fase**: `tsc --noEmit` + 16 testes snap (`simcar-clip-snap`, `simcar-rules`) verdes em todos os 8 commits.

## Testes finais

- Suíte completa: 384 testes (51 arquivos) — ver rodada final.
- Build de produção: `pnpm build` (app + admin + backend esbuild) — ver rodada final.
- Deploy automático via auto-sync do servidor (push no main → build → restart → firebase deploy).
