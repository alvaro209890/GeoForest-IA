# WMS local e fluxo Landsat

Este documento descreve a aba Landsat do GeoForest, o acervo local no HD Backup e o fluxo automatico de reuso ou publicacao no GeoServer/WMS.

## Objetivo

O fluxo Landsat segue a mesma regra operacional esperada para o CBERS:

```text
1. Usuario informa a area no site por ZIP/SHP ou por numero do CAR estadual.
2. Usuario escolhe periodo, nuvem maxima, composicao e, opcionalmente, orbita/ponto.
3. Backend procura primeiro imagens Landsat ja publicadas no WMS local.
4. Backend tambem consulta o STAC LandsatLook/USGS quando precisa encontrar cenas novas.
5. Se a imagem ja existe no WMS, o sistema apenas cria um card/job concluido para o usuario e libera o ZIP.
6. Se a imagem nao existe, o backend baixa as bandas, gera o GeoTIFF RGB, salva no HD Backup e publica no GeoServer.
7. Antes de concluir, o backend valida a layer REST, a coverage REST e um `GetMap` WMS real.
```

A imagem final representa a cena/folha Landsat completa da orbita/ponto. O poligono serve para busca e validacao de cobertura; ele nao recorta o GeoTIFF final.

## Acervo local

O GeoServer usa o workspace `cbers` tambem para Landsat. Os GeoTIFFs ficam no HD Backup:

```text
/media/server/HD Backup/RASTER/LANDSAT/<orbita_ponto>/<ano>/
```

Exemplo ja existente:

```text
/media/server/HD Backup/RASTER/LANDSAT/224_069/2020/LC08_224_069_20200907_C654.TIF
```

O indice local e reconstruido lendo os `coveragestore.xml` de:

```text
/home/server/geoserver_data/workspaces/cbers/landsat_*/
```

Cada store aponta para o GeoTIFF real no HD Backup por URL `file:`.

## Organizacao no WMS

A publicacao automatica cria/atualiza grupos:

```text
LANDSAT
  landsat_orbit_<orbita_ponto>
    landsat_orbit_<orbita_ponto>_y<ano>
      cbers:landsat_<orbita_ponto>_<ano>_<nome_normalizado>
```

Exemplo:

```text
LANDSAT
  landsat_orbit_224_069
    landsat_orbit_224_069_y2020
      cbers:landsat_224_069_2020_lc08_224_069_20200907_comp654
```

O WMS publico continua em:

```text
https://wms.cursar.space/geoserver/cbers/wms
```

## Fonte externa

Quando a imagem nao esta no acervo local, o backend usa o LandsatLook/USGS para busca e metadados:

```text
LANDSAT_STAC_ROOT=https://landsatlook.usgs.gov/stac-server
LANDSAT_STAC_COLLECTION=landsat-c2l2-sr
```

Colecao usada: Landsat Collection 2 Level 2 Surface Reflectance (`landsat-c2l2-sr`).

Para download das bandas, o backend tenta obter o item equivalente no Microsoft Planetary Computer e assina os assets Azure Blob por SAS:

```text
LANDSAT_PC_STAC_ROOT=https://planetarycomputer.microsoft.com/api/stac/v1
LANDSAT_PC_COLLECTION=landsat-c2-l2
LANDSAT_PC_SIGN_ROOT=https://planetarycomputer.microsoft.com/api/sas/v1/sign
```

Isso evita que links USGS que exigem login retornem HTML no lugar de GeoTIFF. O download tambem valida `content-type` e tamanho minimo antes de chamar GDAL.

Assets esperados no STAC:

```text
red, green, blue, nir08, swir16, swir22, thumbnail, reduced_resolution_browse
```

Composicoes:

```text
false_color
  Landsat 8/9: swir16, nir08, red  -> C654
  Landsat 5/7: swir16, nir08, red  -> C543

natural_color
  Landsat 8/9: red, green, blue    -> C432
  Landsat 5/7: red, green, blue    -> C321
```

## Endpoints autenticados

Rotas adicionadas ao backend:

```text
POST   /api/landsat/search
POST   /api/landsat/estimate
POST   /api/landsat/jobs
GET    /api/landsat/jobs/:jobId/status
GET    /api/landsat/jobs/:jobId/events
DELETE /api/landsat/jobs/:jobId
GET    /api/landsat/wms-download?layerName=<layer>
HEAD   /api/landsat/wms-download?layerName=<layer>
```

Contrato de busca:

```json
{
  "propertyZip": "base64-do-zip-opcional",
  "carNumber": "MT-... opcional",
  "orbit": "224",
  "row": "069",
  "dateStart": "2020-09-01",
  "dateEnd": "2020-09-30",
  "maxCloudCover": 30,
  "composition": "false_color"
}
```

Contrato de job:

```json
{
  "sceneId": "LC08_L2SP_224069_20200907_20200918_02_T1_SR",
  "composition": "false_color",
  "filename": "CAR_MT_....zip"
}
```

Para imagem ja publicada, `sceneId` pode ser a layer local:

```text
landsat_224_069_2020_lc08_224_069_20200907_comp654
cbers:landsat_224_069_2020_lc08_224_069_20200907_comp654
```

O backend normaliza o prefixo `cbers:` e reaproveita a imagem local.

## Persistencia do usuario

Cada job/card Landsat e salvo em:

```text
users/<uid>/landsat_jobs/<jobId>
```

Campos principais:

```text
status, stage, percent, message, error
sceneId, composition, scene
wmsLayerName, wmsStoreName, wmsUrl, wmsDownloadUrl
outputFilename, outputBytes
updatedAt, updatedAtMs, createdAt, completedAt
```

A sidebar da aba Landsat carrega esse historico no login, mostra progresso por SSE/polling e permite reabrir jobs concluidos.

## Variaveis de ambiente

```text
LANDSAT_STAC_ROOT                 STAC LandsatLook/USGS
LANDSAT_STAC_COLLECTION           colecao STAC, padrao landsat-c2l2-sr
LANDSAT_PC_STAC_ROOT              STAC publico Planetary Computer
LANDSAT_PC_COLLECTION             colecao Planetary Computer, padrao landsat-c2-l2
LANDSAT_PC_SIGN_ROOT              endpoint SAS para assinar assets Azure Blob
LANDSAT_ARCHIVE_ROOT              acervo HD, padrao /media/server/HD Backup/RASTER/LANDSAT
LANDSAT_TMP_ROOT                  temporarios, padrao /tmp/geoforest-landsat
LANDSAT_SEARCH_LIMIT              limite de cenas por busca
LANDSAT_MIN_DOWNLOAD_BYTES        tamanho minimo aceito para banda baixada
LANDSAT_SCALE_MIN                 minimo para conversao 8 bits
LANDSAT_SCALE_MAX                 maximo para conversao 8 bits
LANDSAT_OVERVIEW_RESAMPLING       reamostragem das overviews
GEOSERVER_BASE_URL                GeoServer local
GEOSERVER_PUBLIC_WMS_BASE         WMS publico
GEOSERVER_WORKSPACE               workspace, padrao cbers
GEOSERVER_LANDSAT_STYLE           style padrao, padrao landsat_rgb
GEOSERVER_USER / GEOSERVER_PASSWORD
```

## Pipeline GDAL

Para cena nova:

```text
1. Baixa as 3 bandas da composicao, preferencialmente via Planetary Computer assinado.
2. Cria VRT RGB com `gdalbuildvrt -separate`.
3. Converte para GeoTIFF Byte com `gdal_translate -scale`.
4. Define interpretacao RGB com `gdal_edit.py`.
5. Cria overviews com `gdaladdo`.
6. Copia TIF e OVR para o acervo LANDSAT no HD Backup.
7. Publica coverage store/layer no GeoServer via REST.
8. Atualiza grupos LANDSAT, landsat_orbit_* e landsat_orbit_*_y*.
9. Valida REST e `GetMap` antes de marcar job como concluido.
```

## Validacao manual

Buscar cena publicada no WMS:

```bash
curl -sS "https://wms.cursar.space/geoserver/cbers/wms?service=WMS&version=1.3.0&request=GetCapabilities" | grep -i "landsat_224_069_2020"
```

Testar render de layer:

```bash
curl -sSI "https://wms.cursar.space/geoserver/cbers/wms?service=WMS&version=1.1.1&request=GetMap&layers=cbers:landsat_224_069_2020_lc08_224_069_20200907_comp654&styles=&bbox=-58,-14,-55,-10&srs=EPSG:4326&width=64&height=64&format=image/png"
```

Rodar testes locais:

```bash
pnpm exec vitest run --root . backend/landsat.test.ts
pnpm exec tsc --noEmit --tsBuildInfoFile /tmp/geoforest-tsbuildinfo
```

## Arquivos principais

```text
backend/landsat.ts                rotas, busca local/STAC, GDAL, publicacao WMS
backend/landsat.test.ts           parsing de layer/STAC e composicoes
backend/index.ts                  registro das rotas e auth patterns
client/src/pages/Dashboard.tsx    aba Landsat, historico, SSE, download
docs/WMS_LANDSAT.md               esta documentacao
```
