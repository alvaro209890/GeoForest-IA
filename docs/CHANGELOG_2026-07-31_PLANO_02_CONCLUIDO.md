# CHANGELOG — Plano 02, Passos 6-7: validação + clip-pipeline

**Data:** 2026-07-31
**Commit:** (pendente)

## O que foi feito

Extraídos os últimos 2 módulos do Plano 02, concluindo a extração de todos os submódulos planejados para `simcar-clip.ts`.

### Novos arquivos

| Arquivo | Linhas | Conteúdo |
|---------|--------|----------|
| `simcar/validation.ts` | 72 | `validateShapefileOutput`, `buildLayerSummary`, `validateAreaConsistency` |
| `simcar/clip-pipeline.ts` | 93 | `jobCache`, `pruneJobCache`, `ClientAbortError`, `sendSSE`, `startSseHeartbeat`, `isSseConnectionClosed`, `throwIfClientDisconnected`, `sleepMs` |

### Limpeza do monólito

Removidas 73 linhas de código duplicado do `simcar-clip.ts` após mover as funções para os novos módulos:
- SSE helpers (sendSSE, isSseConnectionClosed, etc.)
- Job cache (jobCache, pruneJobCache, setInterval)
- sleepMs

### Redução acumulada do Plano 02

| Marco | simcar-clip.ts |
|-------|---------------|
| Início | 10,103 linhas |
| Após passos 1-5 | 10,089 (-14) |
| **Após passos 6-7** | **10,026 (-77)** |

**10 módulos extraídos** (1,342 linhas): types, constants, shapefile-io, polygon-ops, attribute-mapper, area-calculator, air-atp-generator, clip-pipeline, validation, index

### Validação

- ✅ `npx tsc --noEmit` — zero erros
- ✅ `npx vitest run` — 384 testes passando (0 falhas)
- ✅ `pnpm run build` — build completo OK

### Status final do Plano 02

✅ **7/7 passos concluídos.** Todos os submódulos extraídos. `simcar-clip.ts` agora importa de `./simcar/` em vez de definir tudo inline.

### Próximos passos (futuro)

- Remover código duplicado restante em `simcar-clip.ts` (funções já extraídas para shapefile-io, polygon-ops, attribute-mapper, area-calculator que ainda existem como cópias no monólito)
- Plano 03: `Dashboard.tsx` (9,765 linhas)
