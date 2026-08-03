# Plano: Desmembramento de `backend/simcar-clip.ts`

**Arquivo final:** `backend/simcar-clip.ts` — 10.026 → **87 linhas (barrel de compatibilidade)**
**Objetivo:** Quebrar o monólito de recorte SIMCAR em módulos por responsabilidade
**Status:** ✅ **CONCLUÍDO 02/08** — 13 módulos em `backend/simcar/`, monólito eliminado (−99,1%)

---

## ✅ Resultado final

`backend/simcar-clip.ts` virou um **barrel fino** que re-exporta dos módulos (mantém
compatibilidade com imports antigos: `_registry.ts`, testes, etc.).

### Estrutura final de `backend/simcar/`

```
simcar/
├── analysis.ts          # 5.249 linhas — pipeline de análise IA (AC/AVN, AUAS, WMS, Groq, visão, síntese)
├── routes.ts            # 1.701 linhas — registerSimcarClipRoutes (endpoints SSE, download, analyze, report)
├── clip-pipeline.ts     # 1.066 linhas — orquestrador do recorte (processClip, SSE, job cache, ZIP output)
├── report.ts            # 640 linhas  — laudo PDF (pdfkit) + persistência
├── shapefile-io.ts      # 451 linhas  — leitura .shp/.dbf/.zip, parseUserShapefile, discoverLayerMapping
├── hydration.ts         # 336 linhas  — retomada de jobs + persistência Firestore/storage
├── wfs-client.ts        # 291 linhas  — fetch WFS (BBOX/INTERSECTS, paginação, fallback)
├── area-calculator.ts   # 220 linhas  — áreas, XLSX quantitativos, warnings
├── types.ts             # 216 linhas  — tipos compartilhados
├── polygon-ops.ts       # 212 linhas  — operações geométricas (union, simplify, point-in-polygon)
├── index.ts             # 185 linhas  — barrel público
├── cloudinary.ts        # 132 linhas  — storage/upload de imagens
├── constants.ts         # 131 linhas  — constantes de configuração
├── air-atp-generator.ts # 116 linhas  — AIR/ATP (direct copy layers)
├── attribute-mapper.ts  # (existente) — mapeamento de atributos template→WFS
└── validation.ts        # (existente) — validações pós-recorte
```

### Commits (8 fases, 1 por commit, todos com tsc + testes verdes)

| Commit | Fase | Conteúdo |
|--------|------|----------|
| `a3f0c204` | 1 | Removidas 25 funções duplicadas (imports dos módulos) |
| `391dd93a` | 2 | `simcar/cloudinary.ts` (10 funções) |
| `2eb7ffb2` | 3 | `simcar/car-lookup.ts` |
| `4072a12a` | 4a/4b | `simcar/wfs-client.ts` + `toPublicApiUrl` → constants |
| `79778700` | 4c | `parseUserShapefile` + `discoverLayerMapping` → shapefile-io |
| `705ca410` | 4e | Bloco de recorte → `clip-pipeline.ts` (processClip 545 linhas verbatim) |
| `0ea4417f` | 5a | `simcar/hydration.ts` |
| `0cd7a001` | 5b | `simcar/report.ts` (PDF pdfkit) |
| `031d517e` | 6 | `simcar/analysis.ts` + `simcar/routes.ts` + monólito → barrel |

## Regras seguidas (aprendidas na prática, Plano 01–03)

- 1 extração = 1 commit, **zero mudança funcional** (blocos movidos verbatim)
- `npx tsc --noEmit` + `npx vitest run backend/simcar-clip-snap backend/simcar-rules` entre cada passo
- **Camadas**: cloudinary → car-lookup → wfs → parse → recorte → hydration → report → análise → rotas
  (ordem por dependência, sem imports circulares)
- `polygon-ops.ts` é camada MAIS BAIXA — nunca importa de volta para `simcar/`
- Cuidado com variáveis de módulo (caches/configs) → mover para `constants.ts`
- Tipos usados por múltiplos módulos → `types.ts` (LayerSummary, ClipResult, PersistedClipContextV1, AiImage, WfsFeature)
- Snapshot de output permanece idêntico (testes snap verdes em todos os commits)

## Como validar

```bash
npx tsc --noEmit                          # compila?
npx vitest run backend/simcar-clip-snap   # snap ainda passa?
npx vitest run backend/simcar/            # testes novos
curl -X POST http://localhost:3001/api/simcar/clip ...  # teste real
```

## Changelog

- `docs/CHANGELOG_2026-08-02_PLANO_02_MONOLITO_SIMCAR.md` — detalhes completos por fase.
- `docs/CHANGELOG_2026-08-03_AUDITORIA_POS_DIVISAO_SIMCAR.md` — auditoria pós-divisão:
  achou e corrigiu 3 constantes/tipo fantasma (`ANALYSIS_VISION_MODELS`, `GROQ_TEXT_MODELS`,
  `SimcarReportArtifact`) que o barrel `simcar/index.ts` expunha divergentes da versão viva.
