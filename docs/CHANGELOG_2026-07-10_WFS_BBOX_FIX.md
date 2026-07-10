# Changelog: Correção WFS — INTERSECTS → BBOX

**Data:** 10/07/2026
**Commits:** `dc911f39`, `036f8a9e`
**Issue:** Recorte SIMCAR perdia features — Área Consolidada vinha truncada

## Diagnóstico

Imóvel de 38.000 ha (SIGEF) na conta do Álvaro — recorte SIMCAR retornava apenas
27 features de AREA_CONSOLIDADA (3.274 ha), mas o WFS da SEMA-MT tem 75 features
(193.875 ha) na mesma região.

### Causa raiz (2 bugs)

**1. Paginação quebrada** (`dc911f39`): O GeoServer da SEMA-MT declara
`PagingIsTransactionSafe=FALSE` e causa **timeout** em qualquer requisição com
`startIndex > 0`. O código só fazia fallback para single-page em caso de
"natural order" ou WFS 400 — timeout era propagado como exceção.

**2. INTERSECTS não confiável** (`036f8a9e`): Mesmo após corrigir a paginação,
o INTERSECTS do GeoServer retornava 27 features sem erro aparente, enquanto o
BBOX retornava 75. O INTERSECTS da SEMA simplesmente não é confiável para
feições complexas.

### Correção

1. **Fallback de paginação** (`simcar-clip.ts` + `wfs-intersection.ts`):
   Qualquer erro de rede (timeout, abort, ETIMEDOUT, ECONNRESET, fetch failed)
   agora dispara fallback para single-page sem `startIndex`.

2. **BBOX como método primário** (`simcar-clip.ts`):
   `fetchWfsClipFeatures` agora usa BBOX como método principal (confiável) e
   faz o clip fino localmente via `clipFeaturesToPolygon`. INTERSECTS só é
   usado como complemento quando BBOX retorna vazio.

### Arquivos modificados

- `backend/simcar-clip.ts` — `fetchWfsClipFeatures`, `fetchWfsIntersectsFeatures`, `fetchWfsBboxFeatures`
- `backend/wfs-intersection.ts` — `computeIntersectionForLayer`

### Verificação

Coordenada 52°26'22"W 12°29'1"S: antes 1 de 5 features de AC capturadas,
depois todas as 75 features do WFS disponíveis para clip local.
