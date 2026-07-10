# CHANGELOG 2026-07-10 — Áreas Não Contidas + Auto-update sem Ctrl+F5

## Resumo

1. **Nova análise "Áreas Não Contidas"** (containment SIMCAR): gera shapefiles
   dos polígonos que uma camada-alvo tem fora da união de camadas-continente —
   o erro *"Geometria deve ser completamente contida por AVN, AUAS ou
   AREA_CONSOLIDADA"* do validador da SEMA.
2. **Aba "Vértices" renomeada para "Análise de Erros"**, agora com duas
   sub-abas: **Vértices Próximas** (existente) e **Áreas Não Contidas** (nova).
3. **Auto-update do frontend**: abas já abertas recarregam sozinhas quando um
   novo build é publicado — sem Ctrl+F5.

---

## 1. Áreas Não Contidas (containment)

Documento completo: [`docs/AREAS_NAO_CONTIDAS.md`](AREAS_NAO_CONTIDAS.md).

### Backend — `backend/containment-analysis.ts` (novo)
- Rotas `POST /api/containment/upload`, `POST /api/containment/process`,
  `GET /api/containment/jobs/:id/status`, `GET .../events` (SSE),
  `GET /api/containment/download/:id`, `DELETE /api/containment/jobs/:id`.
- Núcleo `analyzeContainment()`: para cada feição do alvo calcula
  `alvo − união(continentes)` com `@turf/turf` (`difference`/`union`), explode em
  polígonos, mede área por shoelace no CRS métrico (UTM 22S) e filtra por área
  mínima (padrão 1 m²).
- Saída: `areas_nao_contidas.shp`, `pontos_nao_contidos.shp`, CSV e relatório TXT.
- Reaproveita os helpers de leitura de shapefile do módulo de vértices.

### `backend/vertices-proximas.ts`
- Exportados os helpers compartilhados: `getZipLayerGroups`,
  `parsePolygonRecords`, `detectCrs`, `ringGroupsForRecord`, `layerBbox`,
  `estimateUtmProjFromLonLat`, constantes de `.prj` e tipos.

### `backend/index.ts`
- Registro de `registerContainmentRoutes(app)`.

### `backend/local-storage.ts`
- Novas áreas de armazenamento `containment/input` e `containment/output`.

### Frontend — `client/src/components/ContainmentAnalysis.tsx` (novo)
- Componente autocontido: upload, definição da regra (radio = alvo,
  checkbox = continentes), frase-resumo ao vivo, área mínima, progresso SSE,
  cards de resumo, tabela e download. Design alinhado ao restante do app
  (glassmorphism, gradiente rose→emerald).

### `client/src/pages/Dashboard.tsx`
- Aba renomeada para **Análise de Erros** (label "Erros" no menu, título
  "Análise de Erros" no cabeçalho).
- Sub-abas **Vértices Próximas** × **Áreas Não Contidas** dentro da view.
- Import de `ContainmentAnalysis` e do ícone `ShieldAlert`.

---

## 2. Auto-update sem Ctrl+F5

Objetivo: quem já está com a aba aberta não precisa dar Ctrl+F5 para receber a
versão nova após um deploy.

### `vite.config.ts`
- `buildId` único por build, injetado como `__APP_BUILD_ID__` (via `define`).
- Plugin `geoforest-version-json`: grava `version.json` (`{ buildId, builtAt }`)
  no diretório de saída ao final do build.

### `client/src/lib/autoUpdate.ts` (novo)
- `setupAutoUpdate()`: a cada 5 min, ao focar a aba e ao voltar a ficar visível,
  busca `version.json` (no-store); se o `buildId` mudou, faz `location.reload()`
  uma única vez. O reload só ocorre com a aba visível, para não interromper o uso.

### `client/src/main.tsx`
- Chama `setupAutoUpdate()` após montar o app.

### `firebase.json`
- `version.json` servido com `no-cache, no-store, must-revalidate` nos dois
  sites. HTML já era `no-cache` e os bundles JS/CSS têm hash imutável — portanto
  **quem abre a página do zero (login) já recebe sempre a versão nova**; o
  auto-update cobre o caso das abas antigas.

---

## Verificação
- `tsc --noEmit`: 0 erros.
- `vite build` + `esbuild` do backend: OK. `version.json` gerado com o `buildId`
  presente no bundle.
- Teste end-to-end da análise com os shapefiles reais da Fazenda Santo Antônio:
  identifica corretamente a feição não contida (bate com o *"Quantidade 1"* do
  validador), anéis bem-formados e pontos dentro da bbox do alvo.
