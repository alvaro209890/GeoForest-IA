# Changelog — Croqui de acesso

## 2026-07-29 — croqui no padrão dos modelos aprovados

Calibrado contra `Croquis/` (`chacara_02`, `Fazenda Irmaos Sebald-lote 121B`,
`Croqui_Chacara_Lotes_41 e 42`) e validado com a ATP real da Aruanã I
(`Croquis/ATP/Aruana_l_MAT_4242.*`, 7.442,14 ha, Ribeirão Cascalheira).

### Corrigido

- **Imagem de satélite desalinhada dos vetores.** O ArcGIS expande a bbox pedida para casar com o
  aspect da imagem (pedindo `-52.3..-52.1` ele devolve `-52.907..-51.492`), enquanto os vetores
  eram desenhados na bbox original. Agora o enquadramento é centro + zoom em Web Mercator
  (`backend/croqui/basemap.ts`), o mesmo contrato dos provedores — a rota cai em cima das estradas.
- **Coordenadas do roteiro defasadas em um passo.** `step.distance` do OSRM é a distância a partir
  da manobra, mas o texto casava essa distância com o DMS da própria manobra. Agora cada trecho
  termina no DMS do ponto seguinte, como nos modelos.
- **Toda via virava "estrada".** O OSRM devolve `ref` (`"BR-158 | BR-242"`) quando `name` vem vazio,
  o que é o normal no rural de MT. O roteiro passa a nomear BR/MT corretamente.
- **Ponto de partida no meio do nada.** Só Querência tinha landmark; o resto caía no centroide da
  malha IBGE (em Ribeirão Cascalheira, 2,8 km fora de qualquer estrada e ~35 km da sede real).
- **`&deg;` no KML.** Não é entidade XML — o Google Earth mostraria o texto cru. Os modelos usam o
  grau literal e só escapam `'` e `"`.
- **`finishJob(jobId, status)`** era chamado com argumentos posicionais numa função que recebe
  objeto: nenhum job de croqui era finalizado no registro em memória.
- Cores trocadas (polígono ciano/rota vermelha → polígono vermelho/rota laranja), pins sem rótulo,
  barra de escala de largura fixa que não correspondia ao número impresso, título longo por cima da
  legenda, lista de coordenadas sem paginação, atribuição "Image Airbus" sobre imagem do ArcGIS,
  ternário sem efeito no KML e import morto em `routing.ts`.
- Erros de tipo pré-existentes: `croqui/input` e `croqui/output` fora da união de `saveUserBuffer`,
  `docx` ausente do `node_modules`, e o parâmetro parcial em `croquiZipFilename`. `tsc --noEmit`
  passou de 8 erros para 0.

### Adicionado

- `backend/croqui/basemap.ts` — Web Mercator, escolha de zoom, faixa reservada para a caixa do
  roteiro, barra de escala com número redondo e largura calculada, e dois provedores de imagem:
  **Google Static Maps `hybrid`** (rótulos de cidade e escudos de rodovia, como nos modelos) com
  fallback automático para Esri World Imagery quando não há `GOOGLE_STATIC_MAPS_KEY`.
- `config/sedes-mt.json` — sedes dos 142 municípios de MT, geradas por `tools/gerar-sedes-mt.mjs`
  (Nominatim, validadas dentro do polígono do município e encaixadas na via mais próxima; todas
  a menos de 65 m de uma estrada).
- `trimRouteAtPolygon` — roteia até o centroide e corta onde a rota cruza a divisa, que é o acesso
  real, em vez do ponto de divisa mais próximo em linha reta.
- `simplifyRouteSteps` — funde trechos na mesma via e absorve os menores que
  `CROQUI_MIN_STEP_M` (300 m), mantendo o roteiro na faixa de 4 a 12 pontos dos modelos.
- `tools/croqui-preview.ts` — gera os 3 arquivos de uma pasta de shapefile para conferência visual.
- Testes: `basemap.test.ts`, `narrative.test.ts` (reproduz o texto do croqui Sebald palavra por
  palavra), `routing.test.ts`, `render-kml.test.ts` — 32 testes. `generate.test.ts` saiu, coberto
  pelos novos.

### Layout do PDF

A4 paisagem, mapa com margem de 8 pt, caixa branca do título + roteiro no topo-esquerdo com altura
calculada pelo texto, caixa "Legenda" no topo-direito, pushpins amarelos com o DMS ao lado
(com desvio de sobreposição), seta N e barra de escala no canto inferior direito.

---

## 2026-07-28 — versão inicial

- Nova aba **Croqui** (`/dashboard/croqui`).
- Backend `croqui.ts` + módulos `backend/croqui/*`: ATP → município → OSRM → PDF/DOCX/KML → ZIP.
- Histórico em `users/{uid}/croqui_jobs` com cards no sidebar.

## Arquivos principais

- `backend/croqui.ts`
- `backend/croqui/basemap.ts`, `routing.ts`, `landmarks.ts`, `narrative.ts`,
  `render-pdf.ts`, `render-docx.ts`, `render-kml.ts`
- `client/src/dashboard/panels/CroquiPanel.tsx`
- `client/src/dashboard/hooks/useCroquiJobs.ts`
- `docs/CROQUI_ACESSO.md`
