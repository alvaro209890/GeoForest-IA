# 2026-08-25 — Aba NDVI refeita no fluxo CBERS (cena completa + 4 composições)

## Entrega

A aba NDVI deixou de ser um card sobre recortes SIMCAR e passou a funcionar **como a
aba CBERS**: o usuário importa o polígono (ZIP/SHP ou Nº do CAR), busca cenas Landsat
C2 L2, escolhe as composições e gera a **cena completa** (a folha inteira da órbita,
não só a propriedade), publicando tudo organizado no WMS.

### Composições (as da reunião de 31/07/2026 com Bruno Cardoso)

| Composição | Bandas | Visual | Estilo |
|---|---|---|---|
| `NDVI` | nir08, red | verde→amarelo→marrom | `ndvi_ramp` |
| `NDFI` | swir16, nir08 | área convertida/solo exposto **BRANCO**, vegetação verde | `ndfi_ramp` (novo) |
| `RGB` | red, green, blue | cor natural | `raster` |
| `SWIR` | swir16, nir08, red | falsa-cor 6-5-4 (banda 7 — cicatriz de exploração) | `raster` |

A rampa `ndfi_ramp` é a que deixa a área mexida em **branco** (NDFI negativo/baixo =
convertido), exatamente como mostrado na reunião ("se tiver branco lá... é caracterizado
como uma área que foi convertida").

### Backend — `backend/ndvi-scene/` (novo)

- `POST /api/ndvi/search` — busca cenas no STAC do Planetary Computer pela área.
- `POST /api/ndvi/jobs` — inicia job (cena única ou lote) com `itemIds` + `compositions`.
- `GET /api/ndvi/jobs/:jobId/status` e `GET /api/ndvi/jobs/:jobId/events` (SSE).
- `DELETE /api/ndvi/jobs/:jobId` — cancela.
- `GET /api/ndvi/archive` — índice do acervo.
- **Pipeline** (`pipeline.ts`): materializa a cena completa em UTM nativa via
  `gdal_translate -projwin` sobre `/vsicurl/` (6 bandas: nir08, red, green, blue,
  swir16, qa_pixel), gera cada composição em RGB 8 bits, arquiva no HD Backup e
  publica no GeoServer na árvore `RASTER → NDVI → órbita → ano → <composição>`.
- `config/geoserver-styles/ndfi_ramp.clr` + `.sld` — rampa nova do NDFI.
- `backend/local-storage.ts` — allowlist da coleção `ndvi_scene_jobs`.

### Frontend — aba NDVI no padrão CBERS

- `client/src/dashboard/hooks/useNdviJobs.ts` — hook completo (upload, busca, seleção,
  composições, jobs SSE, histórico, cancelar/excluir).
- `client/src/dashboard/ndvi/` — tipos, nomes de arquivo, mapper de docs.
- `client/src/dashboard/panels/ndvi/` — `NdviPanel` (container), `NdviPanelHeader`,
  `NdviSceneSelector` (upload + filtros + lista de cenas + checkboxes de composição),
  `NdviJobList` (progresso, cancelar, baixar), `NdviPreviewMap` (preview no mapa).
- `Dashboard.tsx` — view `ndvi` usa o novo painel; histórico lateral lista os jobs
  NDVI (não mais os recortes SIMCAR).

### NDVI pós-recorte (card da análise SIMCAR)

- **Deixou de publicar no WMS** (`backend/ndvi/job.ts`): a cena recortada não aparece
  mais em `wms.cursar.space`. O card continua calculando o NDVI do recorte e gerando o
  laudo Word (estatística zonal preservada).

## Validação

- `pnpm check`: sem erros TypeScript.
- `pnpm test`: **973 testes passando** (0 falhas; 8 skipped por configuração).
- `pnpm build`: frontend Vite + backend esbuild concluídos; chunk `NdviPanel` (54 kB) e
  `DashboardRouter` gerados.
- Deploy: auto-sync no servidor (rebuild + restart + firebase deploy).
