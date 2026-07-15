# Changelog — Vazios/gaps e soma AIR×ATP (Erros de Geometria)

Data: 2026-07-15

## O que entrou

Dois checks novos na aba **Erros de Geometria**, derivados da documentação
SEMA/SIMCAR de processamento de shapes ainda ausentes na aba:

1. **Vazios/gaps entre polígonos da mesma camada** (`checks.gaps` → tipo `vazio`)
2. **Consistência de área soma(AIR) vs ATP** (`checks.airAtpArea` → tipo `air_atp_area`)

## Fontes de regra

- Manual do Projeto Geográfico (SIMCAR/SEMA-MT): feições obrigatórias ATP e AIR;
  *“a soma das AIRs deve corresponder à ATP”*.
- `banco_de_dados/07_geoprocessamento/shapefile_vetores.md`: topologia CAR —
  sobreposição, **vazios (gaps)**, autointerseção, vértices duplicados.
- `banco_de_dados/05_matrizes_decisao/checklists_erros.md`: shapefile com erro
  topológico (sobreposição, gaps) → rejeição do mapa.
- Destilação em `docs/ERROS_GEOMETRIA_SIMCAR.md`.

## Comportamento

### Gaps (`detectGaps`)

- Entrada: camadas poligonais selecionadas (como sobreposição).
- Algoritmo: envelope convexo das feições − união das feições.
- Filtros: área ≥ limiar (m², mesmo campo da UI); vazio tocado por ≥ 2 feições
  (ignora buraco interior de uma única feição).
- Saída: linhas `tipo=vazio` + `poligonos_vazios.shp` no ZIP.

### Soma AIR × ATP (`detectAirAtpAreaConsistency`)

- Entrada: ZIP inteiro (reconhece camadas via nomenclatura SIMCAR).
- Compara `sum(área AIR)` com `sum(área ATP)` em m² (CRS métrico/UTM estimado).
- Erro se `|diff| > max(minDiffM2, maxDiffRatio × max(AIR, ATP))`.
  - `minDiffM2` = área mínima da UI (padrão 1 m²)
  - `maxDiffRatio` padrão `1e-4` (0,01%); override em `settings.airAtpMaxDiffRatio`
- Tipo `air_atp_area` é de **nível de camada** (CSV/relatório/tabela; sem ponto
  no shapefile de erros pontuais).

## Arquivos tocados

- `backend/geometry-errors.ts` — detecção, job, ZIP, flags
- `backend/geometry-errors.test.ts` — testes unitários reais das funções
- `client/src/components/GeometryErrorsAnalysis.tsx` — cards e labels
- `docs/ERROS_GEOMETRIA_SIMCAR.md` — tabela de checks e ZIP

## Testes

```bash
npx vitest run --root . backend/geometry-errors.test.ts backend/simcar-rules.test.ts
```
