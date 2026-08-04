# Plano: Desmembramento de `backend/cbers-wpm.ts`

**Status:** ✅ **CONCLUÍDO em 03/08/2026** — `backend/cbers/` com 20 módulos (inclui `cbers-archive.ts` movido para `cbers/archive.ts`, item 13 do plano 07); `cbers-wpm.ts` virou barrel. Ver `docs/CHANGELOG_2026-08-03_PLANOS_04_07_E_AUDITORIA.md`.

**Arquivo atual:** `backend/cbers-wpm.ts` — 2,693 linhas
**Objetivo:** Separar pipeline CBERS-4A WPM em etapas independentes

---

## Estrutura proposta

```
backend/cbers/
├── index.ts                   # barrel: re-exporta pipeline + funções públicas (~40 linhas)
├── types.ts                   # interfaces: CbersScene, Band, PipelineResult (~80 linhas)
├── constants.ts               # coleções, resoluções, URLs STAC (~60 linhas)
├── stac-search.ts             # busca STAC INPE (CB4A-WPM-L4-DN-1) (~400 linhas)
├── download.ts                # download de bandas (BAND3/4/2 + BAND0 PAN) (~350 linhas)
├── pansharpen.ts              # pansharpening (gdal_pansharpen.py) (~250 linhas)
├── enhance.ts                 # realce: corta cauda, 8 bits, média+2.5σ (~300 linhas)
├── validate.ts                # validação contra footprint STAC da própria cena (~200 linhas)
├── publish.ts                 # publicação no GeoServer com overviews (~300 linhas)
├── pipeline.ts                # orquestrador completo (~250 linhas)
└── __tests__/
    ├── stac-search.test.ts
    ├── pansharpen.test.ts
    ├── enhance.test.ts
    └── publish.test.ts
```

---

## Mapeamento

### `types.ts`
```typescript
interface CbersScene {
  orbit: number;
  point: number;
  date: string;
  collection: 'CB4A-WPM-L4-DN-1';
  bands: Band[];
  footprint: GeoJSON.Polygon;
  stacItem: any;
}

interface Band {
  name: string;        // 'BAND0', 'BAND2', 'BAND3', 'BAND4'
  resolution: number;  // metros
  url: string;
  localPath?: string;
}

interface PipelineResult {
  scene: CbersScene;
  outputPath: string;
  layerName: string;
  steps: StepResult[];
}

interface StepResult {
  step: 'stac' | 'download' | 'pansharpen' | 'enhance' | 'validate' | 'publish';
  success: boolean;
  durationMs: number;
  error?: string;
}
```

### `constants.ts`
```typescript
export const CBERS_COLLECTION = 'CB4A-WPM-L4-DN-1';
export const RGB_BANDS = ['BAND4', 'BAND3', 'BAND2']; // R=3, G=4, B=2 → RGB 342
export const PAN_BAND = 'BAND0';
export const STAC_API = 'https://data.inpe.br/bdc/stac/v1';
export const OUTPUT_CRS = 'EPSG:4674';

// Realce
export const SIGMA_FACTOR = 2.5;    // corta cauda em média + 2.5σ
```

### `stac-search.ts`
- `searchCbersScene(orbit: number, point: number, date?: string): Promise<CbersScene[]>`
- `getLatestScene(orbit: number, point: number): Promise<CbersScene>`
- `getFootprint(scene: CbersScene): GeoJSON.Polygon`
- `isAlreadyActive(layerName: string): Promise<boolean>` — check no GeoServer

### `download.ts`
- `downloadBand(band: Band, outputDir: string): Promise<string>` — local path
- `downloadRgbBands(scene: CbersScene, outputDir: string): Promise<Band[]>`
- `downloadPanBand(scene: CbersScene, outputDir: string): Promise<Band>`

### `pansharpen.ts`
- `pansharpenRgb(scene: CbersScene, bands: Band[], pan: Band, outputDir: string): Promise<string>`
- `buildPansharpenCommand(...): string` — monta comando `gdal_pansharpen.py`
- `validatePansharpResult(path: string): boolean`

### `enhance.ts`
- `enhanceTo8Bit(inputPath: string, outputPath: string): Promise<string>`
- `calculateCutoff(stats: BandStats): { min: number; max: number }` — média ± 2.5σ
- `applyScale(inputPath: string, outputPath: string, min: number, max: number): Promise<void>` — `gdal_translate -scale`

### `validate.ts`
- `validateAgainstFootprint(imagePath: string, footprint: GeoJSON.Polygon): Promise<boolean>`
- `validateAgainstStac(scene: CbersScene): Promise<boolean>` — footprint STAC da própria cena
- `validateMagicBytes(path: string): boolean` — Content-Type image/* + magic bytes

### `publish.ts`
- `publishToGeoServer(tiffPath: string, layerName: string, workspace: string): Promise<void>`
- `publishWithRetry(...): Promise<void>` — REST publish + retry
- `buildOverviews(tiffPath: string): Promise<void>` — `gdaladdo`
- `validateGetMap(layerName: string): Promise<boolean>` — GetMap real antes de concluir

### `pipeline.ts` — Orquestrador
```typescript
export async function runCbersPipeline(
  orbit: number,
  point: number,
  date?: string
): Promise<PipelineResult> {
  // 1. Buscar cena no STAC
  const scene = await searchCbersScene(orbit, point, date);
  
  // 2. Verificar se já está ativa no WMS
  if (await isAlreadyActive(scene.layerName)) {
    return { scene, outputPath: 'already-active', ... };
  }
  
  // 3. Download bandas
  const rgbBands = await downloadRgbBands(scene);
  const panBand = await downloadPanBand(scene);
  
  // 4. Pansharpen
  const sharpened = await pansharpenRgb(scene, rgbBands, panBand);
  
  // 5. Realce 8 bits
  const enhanced = await enhanceTo8Bit(sharpened);
  
  // 6. Validar
  await validateAgainstFootprint(enhanced, scene.footprint);
  
  // 7. Publicar
  await publishToGeoServer(enhanced, scene.layerName, 'cbers');
  
  return { scene, outputPath: enhanced, ... };
}
```

---

## Passo a passo

### Passo 1: Criar `types.ts` e `constants.ts`
- Isolar interfaces e constantes
- **Validar:** compila

### Passo 2: Extrair `stac-search.ts`
- Funções de busca no STAC INPE
- Reuso de cena já ativa
- **Validar:** buscar cena real

### Passo 3: Extrair `download.ts`
- Download de bandas individuais e em lote
- Timeouts e retry
- **Validar:** download de cena pequena

### Passo 4: Extrair `pansharpen.ts`
- Comando gdal_pansharpen.py
- Validação do resultado
- **Validar:** teste com fixtures

### Passo 5: Extrair `enhance.ts`
- Cálculo de estatísticas + cutoff
- gdal_translate -scale
- **Validar:** teste unitário com numpy/GDAL

### Passo 6: Extrair `validate.ts`
- Validação contra footprint
- Magic bytes
- **Validar:** teste com GeoTIFF real

### Passo 7: Extrair `publish.ts`
- GeoServer REST API + retry
- Overviews
- GetMap validation
- **Validar:** publicar cena de teste

### Passo 8: Criar `pipeline.ts` + `index.ts`
- Orquestrador juntando tudo
- Barrel exports
- **Validar:** pipeline completo com `npx vitest run backend/cbers-wpm.test.ts`

---

## ⚠️ Cuidados

### Dependências GDAL
- `gdal_pansharpen.py`, `gdal_translate`, `gdaladdo` precisam estar no PATH
- No PC servidor está OK (GeoServer + GDAL instalados)
- No PC local (Acer) pode não ter → testes precisam de skip condicional

### Cache de cenas
O pipeline verifica se a cena já está ativa no GeoServer. Essa lógica usa o GeoServer REST API e deve permanecer em `stac-search.ts` (ou `publish.ts`).

### Erro HTTP 200 do WMS
A validação GetMap (WMS) pode retornar HTTP 200 com XML de erro (não imagem). O `validate.ts` precisa checar `Content-Type: image/*` + magic bytes. Isso já está implementado — só isolar.

---

## Como validar

```bash
# Testes unitários
npx vitest run backend/cbers/

# Teste de integração (precisa GDAL + GeoServer)
npx vitest run backend/cbers-wpm.test.ts

# Smoke test
curl -X POST http://localhost:3001/api/cbers/search -H 'Content-Type: application/json' \
  -d '{"orbit": 180, "point": 114}'
```

---

## Estimativa

| Passo | Tempo | Risco |
|-------|-------|-------|
| types + constants | 10 min | Baixo |
| stac-search | 20 min | Baixo |
| download | 20 min | Baixo |
| pansharpen | 25 min | Médio (GDAL) |
| enhance | 25 min | Médio |
| validate | 15 min | Baixo |
| publish | 25 min | Médio (GeoServer) |
| pipeline + barrel | 20 min | Baixo |
| **Total** | **~2.5 h** | |
