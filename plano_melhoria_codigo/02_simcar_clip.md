# Plano: Desmembramento de `backend/simcar-clip.ts`

**Arquivo atual:** `backend/simcar-clip.ts` — 10,103 → **10,026 linhas**
**Objetivo:** Quebrar o monólito de recorte SIMCAR em módulos por responsabilidade
**Status:** 🟡 Plano 02 concluído 7/7 (31/07) — **infraestrutura extraída** (~1.526 linhas em
10 módulos `backend/simcar/`); **o fluxo principal de recorte continua no monólito**
(atualizado 01/08 com medidas reais)

---

## ✅ O que já foi feito (31/07 — commits `1fa6d140`→`7c3ba23e`)

10 módulos criados em `backend/simcar/` (medidos 01/08):

| Módulo | Linhas | Conteúdo real |
|--------|--------|---------------|
| `types.ts` | 209 | Interfaces: SimcarClipInput, PolygonBatch, ClipResult, ClipPhase, etc. |
| `shapefile-io.ts` | 228 | Leitura/escrita .shp/.dbf/.prj/.shx, validação de shapefile |
| `polygon-ops.ts` | 212 | Turf.js: union, buffer, dissolve, clip, simplify, explode, area, validateGeometry |
| `area-calculator.ts` | 220 | Totais em ha, áreas por classe, percentuais, tabela formatada |
| `constants.ts` | 124 | SIMCAR_LAYER_NAMES, SIMCAR_FIELD_MAP, DEFAULT_BUFFER_M, MIN_AREA_HA, EPSG_SIRGAS 4674, AIR_ATP_CONFIG |
| `attribute-mapper.ts` | 98 | mapSimcarFields, extractAttributesFromDbf, buildAttributeTable |
| `air-atp-generator.ts` | 116 | Esqueleto de generateAIR/generateATP/generateMultiPolygon* (lógica real ainda no monólito) |
| `clip-pipeline.ts` | 93 | Esqueleto do orquestrador runSimcarClip (fluxo real ainda no monólito) |
| `validation.ts` | 72 | validateOutput, validateAreas, validateGeometryNonEmpty, validateAttributes |
| `index.ts` (barrel) | 154 | Re-exports públicos (incl. DirectCopyLayerResult de air-atp-generator) |

**Total extraído: ~1.526 linhas** (estrutura/containers). O `backend/index.ts` agora importa
do barrel `./simcar` onde aplicável.

---

## 🔴 O que falta de verdade (o trabalho real)

O monólito `backend/simcar-clip.ts` continua com **10.026 linhas**. O que foi extraído é a
**infraestrutura** (tipos, I/O, helpers puros); o **fluxo principal de recorte** (a maior
parte do arquivo) permanece no monólito:

- Lógica real de geração AIR/ATP por lote (o `air-atp-generator.ts` é só esqueleto)
- Orquestração real do pipeline (o `clip-pipeline.ts` é só esqueleto)
- Handlers de rotas / jobs / SSE associados ao recorte
- Lógica de validação específica SIMCAR (contagens, áreas mínimas, MultiPolygon)

### Passos restantes (ordem sugerida — 1 commit atômico por passo)

| Passo | O que | Risco |
|-------|-------|-------|
| A | Mover a lógica real de geração AIR/ATP do monólito para `air-atp-generator.ts` (funções completas, não esqueletos) | Alto — maior bloco, cuidar imports circulares |
| B | Mover a orquestração (leitura → validação → por lote → exportação → validação) para `clip-pipeline.ts` | Médio |
| C | Mover validações SIMCAR específicas (não genéricas) para `validation.ts` | Baixo |
| D | Limpar exports do monólito: manter no `simcar-clip.ts` só o que as rotas importam, via barrel | Médio |
| E | Remover código morto da versão antiga (pré-MultiPolygon), se existir | Baixo |
| F | Atualizar `backend/simcar-clip-snap.test.ts` para imports dos novos módulos | Baixo |

**Regras (aprendidas na prática, Plano 01–03):**
- 1 extração = 1 commit, zero mudança funcional
- `npx tsc --noEmit` + `npx vitest run --root . backend/simcar-clip-snap` entre cada passo
- `polygon-ops.ts` é camada MAIS BAIXA — nunca importa de volta para `simcar/`
- Cuidado com variáveis de módulo (caches/configs) → mover para `constants.ts`
- Snapshot de output deve permanecer idêntico (não quebrar)

---

## Estrutura alvo (confirmada 01/08)

```
backend/simcar/
├── index.ts                   # barrel: re-exporta funções públicas (~154 linhas) ✅
├── clip-pipeline.ts           # orquestrador principal (~93 → ~300 linhas após passo B)
├── polygon-ops.ts             # operações geométricas puras (~212 linhas) ✅
├── air-atp-generator.ts       # geração AIR/ATP por lote (~116 → ~1.200 após passo A)
├── shapefile-io.ts            # leitura/escrita de shapefile (~228 linhas) ✅
├── area-calculator.ts         # cálculo de áreas (~220 linhas) ✅
├── attribute-mapper.ts        # mapeamento de atributos (~98 linhas) ✅
├── validation.ts              # validação pós-recorte (~72 → ~500 após passo C)
├── types.ts                   # interfaces (~209 linhas) ✅
├── constants.ts               # lookup tables, thresholds (~124 linhas) ✅
└── utils.ts                   # helpers compartilhados (ainda não criado)
```

---

## Como validar

```bash
# A cada passo:
npx tsc --noEmit                          # compila?
npx vitest run backend/simcar-clip-snap   # snap ainda passa?

# Após migração completa:
npx vitest run backend/simcar/            # testes novos
curl -X POST http://localhost:3001/api/simcar/clip ...  # teste real
```

---

## Estimativa

| Passo | Tempo | Risco |
|-------|-------|-------|
| A (air-atp-generator real) | 45 min | Alto |
| B (clip-pipeline real) | 20 min | Médio |
| C (validation SIMCAR) | 15 min | Baixo |
| D (limpar exports) | 15 min | Médio |
| E (código morto) | 10 min | Baixo |
| F (snap tests) | 15 min | Baixo |
| **Total** | **~2 h** | |
