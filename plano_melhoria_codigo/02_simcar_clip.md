# Plano: Desmembramento de `backend/simcar-clip.ts`

**Arquivo atual:** `backend/simcar-clip.ts` — 10,103 linhas
**Objetivo:** Quebrar o monólito de recorte SIMCAR em módulos por responsabilidade

---

## Estrutura proposta

```
backend/simcar/
├── index.ts                   # barrel: re-exporta funções públicas (~50 linhas)
├── clip-pipeline.ts           # orquestrador principal: recebe shapefile, coordena pipeline (~300 linhas)
├── polygon-ops.ts             # operações geométricas puras (~800 linhas)
├── air-atp-generator.ts       # geração de AIR e ATP por lote de polígono (~1200 linhas)
├── shapefile-io.ts            # leitura/escrita de shapefile (.shp/.dbf/.prj/.shx) (~600 linhas)
├── area-calculator.ts         # cálculo de áreas (ha, km², percentuais, totais) (~500 linhas)
├── attribute-mapper.ts        # mapeamento de atributos (SIMCAR → colunas do shape) (~400 linhas)
├── validation.ts              # validação pós-recorte (geometria válida, área > 0) (~500 linhas)
├── types.ts                   # interfaces: ClipJob, ClipResult, PolygonBatch, etc (~200 linhas)
├── constants.ts               # tabelas de lookup, thresholds, configurações (~300 linhas)
└── utils.ts                   # helpers compartilhados (~200 linhas)
```

---

## Mapeamento detalhado

### `types.ts` — Extrair PRIMEIRO
Interfaces e tipos usados por todos os outros módulos:
```typescript
interface SimcarClipInput {
  shapefilePath: string;
  carNumber: string;
  outputDir: string;
  mode: 'completo' | 'air' | 'atp';
}

interface PolygonBatch {
  id: number;
  geometria: GeoJSON.Polygon;
  atributos: Record<string, any>;
}

interface ClipResult {
  airPath?: string;
  atpPath?: string;
  airAreaHa: number;
  atpAreaHa: number;
  logs: string[];
}

type ClipPhase = 'leitura' | 'validacao' | 'recorte' | 'air' | 'atp' | 'exportacao' | 'concluido';
```

### `constants.ts`
- `SIMCAR_LAYER_NAMES`: mapeamento de nomes de camada
- `SIMCAR_FIELD_MAP`: campos do DBF → nomes amigáveis
- `DEFAULT_BUFFER_M`: buffer padrão em metros
- `MIN_AREA_HA`: área mínima para considerar válido
- `EPSG_SIRGAS`: 4674
- `AIR_ATP_CONFIG`: configs de dissolve, simplify tolerance

### `shapefile-io.ts`
Funções atuais de leitura/escrita:
- `readShapefile(path)` → GeoJSON FeatureCollection
- `writeShapefile(geojson, outputPath, fields)`
- `readDbf(path)` → array de registros
- `writeDbf(records, outputPath, fields)`
- `copyPrj(sourcePath, destPath)`
- `validateShapefile(path)` → boolean + erros

### `polygon-ops.ts`
Operações geométricas puras (usam Turf.js):
- `unionPolygons(polygons)` → MultiPolygon unido
- `bufferPolygon(polygon, distanceM)` → Polygon com buffer
- `dissolvePolygons(polygons)` → união + dissolve
- `clipPolygons(targetPolygons, clipPolygon)` → interseção
- `simplifyPolygon(polygon, tolerance)` → simplificação
- `explodeMultiPolygon(multiPolygon)` → array de Polygon
- `calculateArea(polygon)` → hectares
- `validateGeometry(polygon)` → erros de geometria

### `area-calculator.ts`
- `calculateTotalArea(polygons)` → soma em ha
- `calculateAreasByClass(polygons, classField)` → { [classe]: hectares }
- `calculatePercentages(areas)` → percentuais
- `formatAreaTable(areas)` → string formatada

### `attribute-mapper.ts`
- `mapSimcarFields(record)` → traduz nomes de campo
- `extractAttributesFromDbf(dbfPath)` → extrai + mapeia
- `buildAttributeTable(polygons, attributes)` → junta geometria + atributos

### `air-atp-generator.ts`
Funções específicas de AIR e ATP (atualmente a maior parte do arquivo):
- `generateAIR(polygons, clipArea)` → shapefile AIR
- `generateATP(polygons, clipArea)` → shapefile ATP
- `generateMultiPolygonAIR(batches)` → AIR por lote (correção MultiPolygon)
- `generateMultiPolygonATP(batches)` → ATP por lote
- `validateAIR_ATP(airPath, atpPath)` → validação cruzada

### `validation.ts`
- `validateOutput(airPath, atpPath)` → checa arquivos existem
- `validateAreas(originalArea, airArea, atpArea)` → áreas consistentes
- `validateGeometryNonEmpty(path)` → shapefile não vazio
- `validateAttributes(path, expectedFields)` → campos presentes

### `clip-pipeline.ts` — Orquestrador
```typescript
export async function runSimcarClip(input: SimcarClipInput): Promise<ClipResult> {
  // 1. Ler shapefile
  const source = await readShapefile(input.shapefilePath);
  
  // 2. Validar entrada
  await validateInput(source);
  
  // 3. Para cada lote (MultiPolygon):
  for (const batch of splitIntoBatches(source)) {
    // 3a. Operações geométricas
    const buffered = bufferPolygon(batch.geometria, DEFAULT_BUFFER_M);
    
    // 3b. Gerar AIR
    const air = generateAIR([buffered], input.clipArea);
    
    // 3c. Gerar ATP
    const atp = generateATP([buffered], input.clipArea);
  }
  
  // 4. Exportar
  await writeShapefile(allAir, `${input.outputDir}/AIR.shp`);
  await writeShapefile(allAtp, `${input.outputDir}/ATP.shp`);
  
  // 5. Validar saída
  const validation = await validateOutput(airPath, atpPath);
  
  return { airPath, atpPath, airAreaHa, atpAreaHa, logs };
}
```

### `index.ts` — Barrel
```typescript
export { runSimcarClip } from './clip-pipeline';
export type { SimcarClipInput, ClipResult, PolygonBatch } from './types';
export { readShapefile, writeShapefile } from './shapefile-io';
// ... apenas exports públicos
```

---

## Passo a passo

### Passo 1: Criar `types.ts` e `constants.ts`
- Extrair TODAS as interfaces, types, enums, const
- Garantir que são importáveis sem dependências circulares
- **Validar:** TypeScript compila

### Passo 2: Extrair `shapefile-io.ts` (baixo acoplamento)
- Funções puras de I/O — não dependem de regras SIMCAR
- **Validar:** ler um .shp de teste, escrever, ler de novo

### Passo 3: Extrair `polygon-ops.ts` (baixo acoplamento)
- Funções geométricas puras — só dependem de Turf.js
- **Validar:** `npx vitest run backend/simcar/` (testes novos ou movidos)

### Passo 4: Extrair `attribute-mapper.ts` e `area-calculator.ts`
- Mapeamento de campos + cálculo de área — médio acoplamento
- **Validar:** teste com fixture de shapefile real

### Passo 5: Extrair `air-atp-generator.ts` (maior parte)
- Extrair funções de geração AIR e ATP
- Separar versão MultiPolygon (atual) da versão antiga (se ainda existir código morto, REMOVER)
- **Validar:** snap test com fixture existente (`simcar-clip-snap.test.ts`)

### Passo 6: Extrair `validation.ts`
- Validações pós-recorte
- **Validar:** testes unitários

### Passo 7: Criar `clip-pipeline.ts` (orquestrador)
- Juntar tudo numa função `runSimcarClip()`
- Manter mesma assinatura do export atual
- **Validar:** teste de integração (upload → recorte → download)

### Passo 8: Criar `index.ts` barrel
- Re-exportar funções que o `index.ts` do backend usa
- Trocar import no `backend/index.ts` de `./simcar-clip` para `./simcar`

---

## ⚠️ Cuidados críticos

### 1. Funções que se referenciam mutuamente
O `simcar-clip.ts` atual tem funções que chamam outras funções internas em sequência. Ao extrair, essas chamadas viram imports entre módulos. Risco de **circular imports** se `air-atp-generator.ts` importar de `polygon-ops.ts` e vice-versa.

**Solução:** `polygon-ops.ts` é camada MAIS BAIXA — não importa nada do `simcar/`. `air-atp-generator.ts` importa de `polygon-ops.ts` mas nunca o contrário.

### 2. Testes de snapshot
`backend/simcar-clip-snap.test.ts` faz import direto de funções internas. Ao mover, atualizar imports. NÃO quebrar o snapshot — só confirmar que o output é idêntico.

### 3. Variáveis de módulo (estado global)
Verificar se o arquivo tem variáveis no escopo do módulo (fora de funções) como caches, contadores, configs. Se tiver, mover para `constants.ts`.

### 4. Código da versão antiga
Se ainda existir código da versão anterior (sem MultiPolygon), **remover**. Manter código morto "por segurança" é exatamente o que causou o arquivo de 10k linhas.

### 5. Ordem dos exports
O `backend/index.ts` espera imports específicos:
```typescript
import { clipSimcar, generateAIR, generateATP, ... } from './simcar-clip';
```
Manter TODOS esses exports no barrel `simcar/index.ts` inicialmente, depois refatorar as rotas para importar só o que usam.

---

## Como validar

```bash
# A cada passo:
npx tsc --noEmit                          # compila?
npx vitest run backend/simcar-clip-snap   # snap ainda passa?

# Após migração completa:
npx vitest run backend/simcar/            # testes novos
curl -X POST http://localhost:3001/api/simcar/clip ...  # teste real
```

---

## Estimativa

| Passo | Tempo | Risco |
|-------|-------|-------|
| types + constants | 15 min | Baixo |
| shapefile-io | 20 min | Baixo |
| polygon-ops | 25 min | Baixo |
| attribute-mapper + area-calculator | 20 min | Médio |
| air-atp-generator | 45 min | Alto |
| validation | 15 min | Baixo |
| clip-pipeline + barrel | 20 min | Médio |
| Ajustar imports externos | 15 min | Médio |
| **Total** | **~3 h** | |
