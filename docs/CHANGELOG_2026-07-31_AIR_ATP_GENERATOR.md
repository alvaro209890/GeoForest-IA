# CHANGELOG — Plano 02, Passo 5: air-atp-generator

**Data:** 2026-07-31
**Commit:** (pendente)

## O que foi feito

Extraída a lógica de processamento de camadas DIRECT_COPY_LAYERS (AIR, ATP) do monólito `simcar-clip.ts` para um módulo dedicado.

### Novo arquivo: `backend/simcar/air-atp-generator.ts` (116 linhas)

- `buildDirectCopyLayerRecords()` — gera registros shapefile a partir dos polígonos do imóvel para camadas de cópia direta (AIR, ATP)
- `applyAirIdentificacao()` — preenche o campo IDENTIFIC na camada AIR sem mutar os inputs

### Alterações

| Arquivo | Antes | Depois | Delta |
|---------|-------|--------|-------|
| `simcar-clip.ts` | 10,103 | 10,089 | -14 linhas |
| `simcar/index.ts` | 128 | 135 | +7 linhas |
| `simcar/air-atp-generator.ts` | — | 116 | +116 linhas |

### Validação

- ✅ `npx tsc --noEmit` — zero erros
- ✅ `npx vitest run` — 384 testes passando (0 falhas)
- ✅ `pnpm run build` — build completo (frontend + backend + admin)
- ✅ `vitest run backend/simcar-clip-snap` — 7/7 snapshots passando

### Nota sobre o plano original

O plano 02 previa funções `generateAIR()`, `generateATP()`, `generateMultiPolygonAIR()`, etc. (~1200 linhas). Na prática, o AIR/ATP são tratados como DIRECT_COPY_LAYERS dentro do pipeline unificado `processClip()`, sem funções separadas. A extração focou no bloco real (~58 linhas) que processa essas camadas, mantendo a mesma semântica.
