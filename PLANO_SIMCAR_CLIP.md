# Plano: Processamento SIMCAR - Recorte Automático de Camadas WFS

## Contexto

O GeoForest-IA precisa automatizar o recorte de camadas SIMCAR (SEMA-MT) para dentro da geometria de um imóvel fornecido pelo usuário. Hoje o processo é manual: o profissional baixa os dados do SIMCAR, abre no QGIS, e recorta manualmente cada camada. Esta funcionalidade vai automatizar esse fluxo — o usuário envia seu Shapefile, o sistema busca as feições no WFS, recorta e devolve um ZIP pronto no formato do `Arquivo Modelo.zip`.

## Decisão de Arquitetura: Node.js Puro (Opção B)

**Justificativa:**
- `@turf/turf` (interseção, área, validação) e `proj4` (reprojeção) já estão no projeto
- Código funcional de WFS com paginação e CQL_FILTER já existe em `wfs-intersection.ts`
- Parser de ZIP e Shapefile binário já existem em `index.ts`
- Única peça faltante: **escrita de Shapefiles** — implementaremos um writer binário próprio
- Evita segundo serviço no Render (custo, latência, complexidade de deploy)

---

## Regras de Negócio

### Camadas do Arquivo Modelo (28 total)

As **camadas são definidas pelo Arquivo Modelo**, não pelo WFS. Existem 3 categorias:

**Categoria 1 — Cópia Direta do Imóvel (2 camadas):**
- `AIR` — Recebe o polígono da propriedade do usuário diretamente (sem WFS)
- `ATP` — Recebe o polígono da propriedade do usuário diretamente (sem WFS)

**Categoria 2 — Recorte WFS (26 camadas restantes):**
Todas buscadas no WFS da SEMA-MT e recortadas nos limites do imóvel:
- AREA_CONSOLIDADA, AREA_USO_RESTRITO, INTERESSE_SOCIAL, UTILIDADE_PUBLICA
- RIO_ATE_10, RIO_10_A_50, RIO_50_A_200, RIO_200_A_600, RIO_ACIMA_600, NASCENTE, RESERVATORIO_ARTIFICIAL, LAGOA_NATURAL
- TIPOLOGIA_VEGETAL, MANGUEZAL, RESTINGA, VEREDA
- AREA_ALTITUDE_1800, AREA_DECLIVIDADE, AREA_TOPO_MORRO, BORDA_CHAPADA
- ARL, ARLREM, AUAS, AURD, AVN, AREA_UMIDA

**Categoria 3 — Camadas Vazias:**
Se uma camada WFS não retornar feições na área, ela mantém os arquivos vazios do template.

### Mapeamento de Nomes

Os typeNames do WFS seguem padrão similar aos do modelo. O sistema fará discovery automático via WFS GetCapabilities com fuzzy matching (ex: `AREA_CONSOLIDADA` → `geoportal:simcar_area_consolidada`).

---

## Arquivos a Criar

### 1. `backend/geo-utils.ts` (~150 linhas)
Funções compartilhadas extraídas de `index.ts`:
- `extractZipEntries(zipBuffer)` — Parser de ZIP usando central directory
- `detectUtmProj(prjText)` — Detecção de zona UTM do .prj
- `reprojectPolygon(polygon, projDef)` — Reprojeção via proj4
- `reprojectBbox(bbox, projDef)` — Reprojeção de bounding box
- `isLatLonBbox(bbox)` — Validação de bbox em graus

### 2. `backend/shapefile-writer.ts` (~350 linhas)
Módulo para escrita de Shapefiles binários (.shp, .shx, .dbf):
- `buildShpBuffer(features, shapeType)` — Header (100 bytes) + registros Polygon/MultiPolygon
- `buildShxBuffer(offsets, fileLengthWords)` — Índice de offsets dos registros
- `buildDbfBuffer(records, fieldDefs)` — Header de campos + registros de atributos
- `parseDbfSchema(dbfBuffer)` — Lê schema DBF de um buffer existente (do template)
- Tipos DBF suportados: Character (C), Numeric (N), Float (F), Date (D)

### 3. `backend/simcar-clip.ts` (~700 linhas)
Módulo principal de processamento + rotas Express:

**Funções:**
- `parseUserShapefile(zipBuffer)` — Extrai geometria completa, valida, reprojeta → EPSG:4674
- `readFullShapefile(shpBuffer)` — Lê TODOS os polígonos do .shp (não só o primeiro)
- `discoverLayerMapping(templateLayers, wfsCapabilities)` — Fuzzy match de nomes
- `fetchWfsClipFeatures(wfsLayer, polygonWkt, srsName)` — GetFeature com atributos
- `clipFeaturesToPolygon(features, polygon)` — `turf.intersect()` por feição
- `readTemplateSchemas(modeloEntries)` — Schema DBF de cada camada do template
- `buildOutputZip(templateEntries, clippedLayers, propertyPolygon)` — ZIP final
- `registerSimcarClipRoutes(app)` — Registra endpoints Express

---

## Arquivos a Modificar

### 4. `backend/wfs-intersection.ts`
Exportar funções utilitárias (adicionar `export` keyword):
- `buildWfsUrl`, `fetchJsonWithTimeout`, `fetchTextWithTimeout`
- `getGeometryFieldForLayer`, `getCapabilitiesCached`
- `normalizePolygonGeometry`, `polygonToWkt`, `normalizeRing`
- Constantes: `WFS_BASE_URL`, `WFS_AUTHKEY`, `WFS_TIMEOUT_MS`, `WFS_PAGE_SIZE`

### 5. `backend/index.ts`
- Importar `registerSimcarClipRoutes` e chamar logo após `registerWfsIntersectionRoutes(app)`
- Substituir funções locais por imports de `geo-utils.ts`

### 6. `client/src/pages/Dashboard.tsx`
- Botão "Recortar SIMCAR" na seção de overlays SIMCAR
- Dialog com dropzone + checkboxes (todas marcadas por padrão)
- Barra de progresso SSE em tempo real
- Link de download + resumo ao completar

---

## API Endpoints

### `POST /api/simcar/clip` (SSE)
```
Content-Type: application/json
Body: {
  "propertyZip": "<base64>",
  "filename": "imovel.zip",
  "layerNames": ["AREA_CONSOLIDADA", "ARL", ...]  // opcional, default = todas
}

Response: text/event-stream (SSE)

Eventos:
  data: {"type":"progress","layer":"AIR","current":1,"total":28,"status":"copying_property"}
  data: {"type":"progress","layer":"ATP","current":2,"total":28,"status":"copying_property"}
  data: {"type":"progress","layer":"AREA_CONSOLIDADA","current":3,"total":28,"status":"fetching"}
  data: {"type":"progress","layer":"AREA_CONSOLIDADA","current":3,"total":28,"status":"clipping","features":5}
  ...
  data: {"type":"complete","downloadUrl":"/api/simcar/clip/download/<jobId>","summary":{
    "propertyAreaHa": 1250.45,
    "crs": "EPSG:4674",
    "layersProcessed": 28,
    "layersWithData": 7,
    "totalFeaturesClipped": 43,
    "processingTimeMs": 8500,
    "layers": [
      {"name":"AIR","source":"property","features":1},
      {"name":"ATP","source":"property","features":1},
      {"name":"AREA_CONSOLIDADA","source":"wfs","features":3,"areaHa":120.5},
      {"name":"ARL","source":"wfs","features":0},
      ...
    ]
  }}
```

### `GET /api/simcar/clip/download/:jobId`
```
Response: application/zip
Headers: Content-Disposition: attachment; filename="SIMCAR_Recorte_<timestamp>.zip"
```

---

## Fluxo de Processamento Detalhado

```
 1. POST /api/simcar/clip → abrir SSE stream
 2. Decodificar base64 → Buffer do ZIP do usuário
 3. extractZipEntries() → encontrar .shp, .shx, .dbf, .prj
 4. readFullShapefile() → ler TODOS os polígonos do .shp
 5. Se múltiplos polígonos → turf.union() para geometria unificada
 6. Ler .prj → detectUtmProj() → reprojetar para EPSG:4674 se necessário
 7. Validar geometria: turf.buffer(geom, 0) para corrigir self-intersections
 8. Ler Arquivo Modelo.zip (fs.readFileSync) → extractZipEntries()
 9. Extrair schema DBF de cada camada do template
10. WFS GetCapabilities → discoverLayerMapping() → mapear nomes
11. Para AIR e ATP:
    → SSE progress "copying_property"
    → Inserir polígono do imóvel diretamente (geometria + atributos vazios)
12. Para cada camada WFS (26 camadas):
    a. SSE: progress "fetching"
    b. Verificar se typeName WFS existe no capabilities
    c. Query WFS: GetFeature + CQL_FILTER=INTERSECTS(...) + srsName=EPSG:4674
    d. Paginar (startIndex/count) como no wfs-intersection.ts
    e. SSE: progress "clipping"
    f. Para cada feição: turf.intersect(feição, polígono_usuário)
    g. Mapear atributos WFS → campos DBF do template
13. Para cada camada com dados:
    a. Gerar .shp + .shx + .dbf via shapefile-writer.ts
    b. Copiar .prj do template
14. Montar ZIP final (archiver):
    a. Todas entradas do template como base
    b. Substituir .shp/.shx/.dbf das camadas com dados
    c. Camadas sem dados mantêm arquivos vazios do template
15. Armazenar em cache (Map, TTL 15min, max 10 jobs)
16. SSE: complete + downloadUrl + summary
```

---

## Dependências NPM

```bash
pnpm add archiver
pnpm add -D @types/archiver
```

Nenhuma outra — `@turf/turf`, `proj4`, `express`, `zlib` (nativo) já existem.

## Cache e Download

- `Map<string, { buffer: Buffer, expiresAt: number, filename: string }>`
- TTL: 15 minutos | Limpeza: a cada 5 min | Limite: 10 jobs
- JobId: `crypto.randomUUID()`

## Tratamento de Erros

| Cenário | Resposta |
|---------|----------|
| ZIP inválido / sem .shp | SSE error: "ZIP não contém Shapefile válido" |
| Geometria inválida | SSE error: "Geometria do imóvel não pôde ser validada" |
| CRS não detectável | Warning, assume EPSG:4674 |
| WFS timeout numa camada | Warning, continua com as outras |
| WFS totalmente fora do ar | SSE error: "Serviço WFS da SEMA-MT indisponível" |
| Camada sem match no WFS | Warning, mantém template vazio |
| Nenhuma feição encontrada | Complete com layersWithData: 0 |

## Deploy no Render

**Nenhuma mudança na configuração.** O `Arquivo Modelo.zip` está no repositório git e disponível no filesystem do Render:

```typescript
const MODELO_ZIP_PATH = path.resolve(__dirname, '..', 'Arquivo Modelo.zip');
```

## Ordem de Implementação

1. `backend/geo-utils.ts` — Extrair funções compartilhadas
2. `backend/wfs-intersection.ts` — Adicionar exports
3. `backend/index.ts` — Refatorar para usar geo-utils
4. `backend/shapefile-writer.ts` — Writer binário de Shapefiles
5. `backend/simcar-clip.ts` — Lógica de clip + rotas SSE
6. `backend/index.ts` — Registrar rotas simcar-clip
7. Instalar `archiver` + `@types/archiver`
8. `Dashboard.tsx` — UI (dialog, upload, progresso SSE, download)
9. Testes manuais end-to-end

## Verificação

1. Subir servidor dev, enviar shapefile via curl `--no-buffer`
2. Abrir ZIP resultante no QGIS:
   - AIR e ATP contêm polígono do imóvel
   - Camadas WFS recortadas nos limites do imóvel
   - Atributos preservados conforme schema do template
   - CRS = SIRGAS 2000 (EPSG:4674)
3. Camadas sem interseção → arquivos do template mantidos
4. ZIPs inválidos → mensagens de erro claras via SSE
5. Frontend → barra de progresso funcional + download
