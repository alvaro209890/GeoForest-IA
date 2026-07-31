# Plano: Desmembramento de `backend/landsat.ts`

**Arquivo atual:** `backend/landsat.ts` — 1,621 linhas
**Objetivo:** Separar pipeline Landsat em etapas independentes

---

## Estrutura proposta

```
backend/landsat/
├── index.ts                   # barrel (~30 linhas)
├── types.ts                   # interfaces: LandsatScene, LandsatBand (~80 linhas)
├── constants.ts               # coleções, URLs, resoluções (~50 linhas)
├── stac-search.ts             # busca LandsatLook STAC + Planetary Computer (~300 linhas)
├── download-sas.ts            # download via Planetary Computer SAS token (~300 linhas)
├── composite.ts               # composição RGB: gdalbuildvrt → gdal_translate -scale (~250 linhas)
├── publish.ts                 # publicação no GeoServer com overviews (~200 linhas)
├── pipeline.ts                # orquestrador (~200 linhas)
└── __tests__/
    ├── stac-search.test.ts
    └── composite.test.ts
```

---

## Mapeamento

### `types.ts`
```typescript
interface LandsatScene {
  id: string;
  satellite: 'LANDSAT_8' | 'LANDSAT_9';
  path: number;
  row: number;
  date: string;
  cloudCover: number;
  bands: LandsatBand[];
  footprint: GeoJSON.Polygon;
}

interface LandsatBand {
  name: string;            // 'B2', 'B3', 'B4', etc
  wavelength: string;      // 'Blue', 'Green', 'Red'
  url?: string;
  localPath?: string;
}

interface LandsatPipelineResult {
  scene: LandsatScene;
  outputPath: string;
  layerName: string;
  steps: StepResult[];
}
```

### `constants.ts`
```typescript
export const LANDSAT_COLLECTION = 'landsat-c2l2-sr';  // Collection 2 Level 2
export const RGB_BANDS = ['B4', 'B3', 'B2'];           // R=4, G=3, B=2
export const STAC_API = 'https://landsatlook.usgs.gov/stac-server';
export const PC_SAS_URL = 'https://planetarycomputer.microsoft.com/api/sas/v1';
export const OUTPUT_CRS = 'EPSG:4674';
```

### `stac-search.ts`
- `searchLandsatScene(path: number, row: number, date?: string): Promise<LandsatScene[]>`
- `getBestScene(scenes: LandsatScene[]): LandsatScene` — menor cloud cover
- `getFootprint(scene: LandsatScene): GeoJSON.Polygon`
- `getAssetUrls(scene: LandsatScene): Record<string, string>` — URLs do Planetary Computer

### `download-sas.ts`
- `getSasToken(assetUrl: string): Promise<string>` — token SAS do Planetary Computer
- `downloadBand(band: LandsatBand, sasToken: string, outputDir: string): Promise<string>`
- `downloadRgbBands(scene: LandsatScene, outputDir: string): Promise<LandsatBand[]>`

### `composite.ts`
- `buildVrt(bands: LandsatBand[], outputPath: string): Promise<string>` — `gdalbuildvrt -separate`
- `scaleTo8Bit(vrtPath: string, outputPath: string): Promise<string>` — `gdal_translate -scale`
- `applyColorInterpretation(tiffPath: string): Promise<void>` — `gdal_edit.py` RGB
- `buildOverviews(tiffPath: string): Promise<void>` — `gdaladdo`

### `publish.ts`
- `publishToGeoServer(tiffPath: string, layerName: string): Promise<void>`
- `validateGetMap(layerName: string): Promise<boolean>`

### `pipeline.ts` — Orquestrador
```typescript
export async function runLandsatPipeline(
  path: number,
  row: number,
  date?: string
): Promise<LandsatPipelineResult> {
  // 1. Buscar cena
  const scenes = await searchLandsatScene(path, row, date);
  const scene = getBestScene(scenes);
  
  // 2. Download bandas
  const bands = await downloadRgbBands(scene);
  
  // 3. Composição RGB
  const vrt = await buildVrt(bands);
  const tiff = await scaleTo8Bit(vrt);
  await applyColorInterpretation(tiff);
  await buildOverviews(tiff);
  
  // 4. Publicar
  await publishToGeoServer(tiff, scene.id);
  
  return { scene, outputPath: tiff, layerName: scene.id, ... };
}
```

---

## Passo a passo

### Passo 1: Criar `types.ts` e `constants.ts` (10 min)
### Passo 2: Extrair `stac-search.ts` (20 min)
### Passo 3: Extrair `download-sas.ts` (20 min)
### Passo 4: Extrair `composite.ts` (25 min)
### Passo 5: Extrair `publish.ts` (15 min)
### Passo 6: Criar `pipeline.ts` + `index.ts` (15 min)

---

## ⚠️ Cuidados

### SAS token do Planetary Computer
O token SAS expira rápido. A lógica de refresh precisa ficar clara em `download-sas.ts`.

### Diferença com CBERS
Landsat NÃO tem pansharpening (já é multiespectral 30m). O pipeline é mais simples que CBERS.

---

## Estimativa

| Total | **~1.5 h** | Risco: Baixo |
