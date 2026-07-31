# Plano: Desmembramento de `backend/geometry-errors.ts`

**Arquivo atual:** `backend/geometry-errors.ts` — 2,885 linhas
**Objetivo:** Separar detectores de erro geométrico SIMCAR em módulos independentes

---

## Estrutura proposta

```
backend/geometry/
├── index.ts                      # barrel: re-exporta detectores + runner (~50 linhas)
├── types.ts                      # interfaces: GeometryError, DetectorResult, ErrorCode (~100 linhas)
├── constants.ts                  # thresholds calibrados (~50 linhas)
├── utils.ts                      # helpers: calculateArea, ringWidth, borderSample (~200 linhas)
├── runner.ts                     # orquestrador: runAllDetectors(featureCollection) → errors (~150 linhas)
├── detectors/
│   ├── collapsed-ring.ts         # "Borda se cruza" — anel colapsado (~300 linhas)
│   ├── duplicate-points.ts       # Pontos repetidos consecutivos (~150 linhas)
│   ├── overlapping-rings.ts      # Anéis sobrepostos (~350 linhas)
│   ├── complex-polygon.ts        # Polígono complexo / multipart (~150 linhas)
│   ├── umida-containment.ts      # AREA_UMIDA contida em AVN∪AUAS∪CONS (~400 linhas)
│   ├── reservatorio.ts           # Regras de reservatório (~200 linhas)
│   └── forbidden-overlap.ts      # Sobreposição proibida entre classes (~300 linhas)
└── __tests__/
    ├── collapsed-ring.test.ts
    ├── umida-containment.test.ts
    └── ...                        # testes unitários por detector
```

---

## Mapeamento dos detectores

### 1. `collapsed-ring.ts` — "Borda se cruza"
**Regra:** Anel com largura ≤ 0,02 m **ou** área ≤ 0,01 m². Encoste pontual NÃO reprova.

```typescript
export function detectCollapsedRings(
  feature: GeoJSON.Feature,
  options?: { minWidthM?: number; minAreaM2?: number }
): GeometryError[]
```

**Constantes:** `MIN_RING_WIDTH_M = 0.02`, `MIN_RING_AREA_M2 = 0.01`

### 2. `duplicate-points.ts` — "Pontos repetidos"
**Regra:** Vértices consecutivos com distância ≤ 0,1 m.

```typescript
export function detectDuplicatePoints(
  feature: GeoJSON.Feature,
  options?: { minDistanceM?: number }
): GeometryError[]
```

**Constante:** `MIN_DISTANCE_M = 0.1`

### 3. `overlapping-rings.ts` — "Anéis sobrepostos"
**Regra:** Área de sobreposição parcial **ou** borda compartilhada ≥ 1 m. Buraco interior limpo é ok.

```typescript
export function detectOverlappingRings(
  feature: GeoJSON.Feature,
  options?: { sharedEdgeM?: number }
): GeometryError[]
```

**Constante:** `SIMCAR_RING_SHARED_EDGE_M = 1`

### 4. `complex-polygon.ts` — "Polígono complexo"
**Regra:** Um registro com ≥ 2 exteriores (MultiPolygon com partes desconexas).

```typescript
export function detectComplexPolygon(
  feature: GeoJSON.Feature
): GeometryError[]
```

### 5. `umida-containment.ts` — "AREA_UMIDA contida"
**Regra:** União real AVN∪AUAS∪CONS + área residual > 0,3 m² **ou** amostra de borda a cada 20 m fora da cobertura.

```typescript
export function detectUmidaContainment(
  feature: GeoJSON.Feature,
  coverageAreas: GeoJSON.Feature[],
  options?: { residualAreaM2?: number; sampleDistanceM?: number }
): GeometryError[]
```

**Constantes:** `RESIDUAL_AREA_M2 = 0.3`, `BORDER_SAMPLE_DISTANCE_M = 20`

### 6. `reservatorio.ts` — "Reservatório"
**Regra:** Sem barramento → contido em AUAS/CONS; SITUACAO='O'.

```typescript
export function detectReservatorioRules(
  feature: GeoJSON.Feature,
  auxAreas: GeoJSON.Feature[]
): GeometryError[]
```

### 7. `forbidden-overlap.ts` — "Sobreposição proibida"
**Regra:** Par de camadas que não podem se sobrepor. Isenta: RES sem barramento.

```typescript
export function detectForbiddenOverlap(
  features: GeoJSON.FeatureCollection,
  pairFilter: (a: string, b: string) => boolean
): GeometryError[]
```

---

## `types.ts`

```typescript
export interface GeometryError {
  code: ErrorCode;
  message: string;
  featureIndex: number;
  areaHa?: number;
  details?: Record<string, unknown>;
}

export type ErrorCode =
  | 'COLLAPSED_RING'
  | 'DUPLICATE_POINTS'
  | 'OVERLAPPING_RINGS'
  | 'COMPLEX_POLYGON'
  | 'UMIDA_NOT_CONTAINED'
  | 'RESERVATORIO_SEM_BARRAMENTO'
  | 'FORBIDDEN_OVERLAP';

export interface DetectorOptions {
  collapsedRing: { minWidthM: number; minAreaM2: number };
  duplicatePoints: { minDistanceM: number };
  overlappingRings: { sharedEdgeM: number };
  umidaContainment: { residualAreaM2: number; sampleDistanceM: number };
}
```

## `runner.ts` — Orquestrador

```typescript
import { detectCollapsedRings } from './detectors/collapsed-ring';
import { detectDuplicatePoints } from './detectors/duplicate-points';
// ... todos detectores

export function runAllDetectors(
  featureCollection: GeoJSON.FeatureCollection,
  options?: Partial<DetectorOptions>
): GeometryError[] {
  const errors: GeometryError[] = [];
  
  for (const feature of featureCollection.features) {
    errors.push(...detectCollapsedRings(feature, options?.collapsedRing));
    errors.push(...detectDuplicatePoints(feature, options?.duplicatePoints));
    errors.push(...detectOverlappingRings(feature, options?.overlappingRings));
    errors.push(...detectComplexPolygon(feature));
  }
  
  // Detectores que operam no collection inteiro
  errors.push(...detectUmidaContainment(featureCollection, ...));
  errors.push(...detectReservatorioRules(featureCollection, ...));
  errors.push(...detectForbiddenOverlap(featureCollection, ...));
  
  return errors;
}
```

---

## Passo a passo

### Passo 1: Criar `types.ts` e `constants.ts`
- Isolar todas interfaces e thresholds
- **Validar:** `npx tsc --noEmit`

### Passo 2: Extrair `utils.ts`
- Funções auxiliares geométricas usadas por múltiplos detectores
- `calculateRingArea()`, `calculateRingWidth()`, `borderSample()`, etc.
- **Validar:** testes unitários

### Passo 3: Extrair detectores (um por vez, do mais simples ao mais complexo)
1. `duplicate-points.ts` (mais simples)
2. `complex-polygon.ts`
3. `collapsed-ring.ts`
4. `forbidden-overlap.ts`
5. `overlapping-rings.ts`
6. `reservatorio.ts`
7. `umida-containment.ts` (mais complexo)

A CADA detector extraído: rodar `npx vitest run backend/geometry-errors.test.ts` para garantir que não quebrou.

### Passo 4: Criar `runner.ts`
- Função que chama todos detectores e junta resultados
- Mesma assinatura que a função principal atual

### Passo 5: Criar `index.ts` barrel
- Re-exporta `runAllDetectors` + tipos + detectores individuais

### Passo 6: Atualizar imports
- `backend/processar-projeto.ts` → trocar import de `./geometry-errors` para `./geometry`
- `backend/index.ts` → idem
- Testes → idem

---

## ⚠️ Cuidados

### 1. Ordem de dependência entre detectores
- `umida-containment.ts` usa `polygon-ops` (união de AVN∪AUAS∪CONS) — essa dependência é externa e não muda
- Nenhum detector depende de outro detector (são independentes entre si)

### 2. Teste atual (`geometry-errors.test.ts` — 925 linhas)
O teste atual testa todos os detectores num arquivo só. Idealmente dividir também, mas pode manter como está na primeira fase — só atualizar imports.

### 3. Constantes calibradas
As constantes foram calibradas contra o oráculo SEMA (CAR 270069 Santa Clara). NÃO alterar valores. Documentar origem de cada uma:
```typescript
/** Calibrado contra SEMA — CAR 270069 Santa Clara (16-07-2026) */
export const MIN_RING_WIDTH_M = 0.02;
```

---

## Como validar

```bash
# Compilação
npx tsc --noEmit

# Testes existentes (devem continuar passando)
npx vitest run backend/geometry-errors.test.ts

# Smoke test: processar um shape real
curl -X POST http://localhost:3001/api/processar-projeto/import ...
```

---

## Estimativa

| Passo | Tempo | Risco |
|-------|-------|-------|
| types + constants + utils | 15 min | Baixo |
| 7 detectores (~30 min cada) | 3.5 h | Médio |
| runner + barrel | 20 min | Baixo |
| Atualizar imports | 15 min | Médio |
| **Total** | **~4.5 h** | |
