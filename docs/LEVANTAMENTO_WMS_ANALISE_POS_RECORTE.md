# Levantamento WMS — análise pós-recorte (tarefa F0.1)

> Gerado por `scripts/levantamento-wms-pos-recorte.ts` em 2026-08-06T02:32:49.928Z.
> Servidor: `https://geo.sema.mt.gov.br/geoserver/ows` · bbox de teste
> `-55.6,-12.6,-55.55,-12.55` · 800×800 px. Nenhuma URL com `authkey` é gravada aqui.

## 1. Série anual da Fase 2 (2009–2019)

`catalogVersion`: `wms-62f161afc40d`

| Ano | Mosaico escolhido | Sensor | Fronteira | GetMap validado | Alternativos no mesmo ano |
|---|---|---|---|---|---|
| 2009 | `Mosaicos:LANDSAT_5_2009` | LANDSAT_5 |  | ✅ | — |
| 2010 | `Mosaicos:LANDSAT_5_2010` | LANDSAT_5 |  | ✅ | — |
| 2011 | `Mosaicos:LANDSAT_5_2011` | LANDSAT_5 |  | ✅ | — |
| 2012 | `Mosaicos:RESOURCESAT_2012` | RESOURCESAT | ⚠️ troca de sensor | ✅ | — |
| 2013 | `Mosaicos:LANDSAT_8_2013` | LANDSAT_8 | ⚠️ troca de sensor | ✅ | — |
| 2014 | `Mosaicos:LANDSAT_8_2014` | LANDSAT_8 |  | ✅ | — |
| 2015 | `Mosaicos:LANDSAT_8_2015` | LANDSAT_8 |  | ✅ | — |
| 2016 | `Mosaicos:LANDSAT_8_2016` | LANDSAT_8 |  | ✅ | `Mosaicos:SENTINEL_2_2016` |
| 2017 | `Mosaicos:LANDSAT_8_2017` | LANDSAT_8 |  | ✅ | `Mosaicos:SENTINEL_2_2017` |
| 2018 | `Mosaicos:LANDSAT_8_2018` | LANDSAT_8 |  | ✅ | `Mosaicos:SENTINEL_2_2018` |
| 2019 | `Mosaicos:SENTINEL_2_2019` | SENTINEL_2 | ⚠️ troca de sensor | ✅ | — |

Anos sem mosaico publicado: **nenhum**.

### GetMap por camada da série (inclui os alternativos)

| Camada | Estilo | GetMap | HTTP | Dimensão | Desvio-padrão | Tempo | Observação |
|---|---|---|---|---|---|---|---|
| `Mosaicos:LANDSAT_5_2009` | — | ✅ | 200 | 800×800 | 48.72 | 855 ms | ok |
| `Mosaicos:LANDSAT_5_2010` | — | ✅ | 200 | 800×800 | 22.19 | 789 ms | ok |
| `Mosaicos:LANDSAT_5_2011` | — | ✅ | 200 | 800×800 | 40.74 | 806 ms | ok |
| `Mosaicos:RESOURCESAT_2012` | — | ✅ | 200 | 800×800 | 40.85 | 746 ms | ok |
| `Mosaicos:LANDSAT_8_2013` | — | ✅ | 200 | 800×800 | 32.1 | 753 ms | ok |
| `Mosaicos:LANDSAT_8_2014` | — | ✅ | 200 | 800×800 | 34.31 | 832 ms | ok |
| `Mosaicos:LANDSAT_8_2015` | — | ✅ | 200 | 800×800 | 43.44 | 774 ms | ok |
| `Mosaicos:LANDSAT_8_2016` | — | ✅ | 200 | 800×800 | 68.22 | 771 ms | ok |
| `Mosaicos:SENTINEL_2_2016` | — | ✅ | 200 | 800×800 | 53.32 | 1190 ms | ok |
| `Mosaicos:LANDSAT_8_2017` | — | ✅ | 200 | 800×800 | 53.07 | 761 ms | ok |
| `Mosaicos:SENTINEL_2_2017` | — | ✅ | 200 | 800×800 | 43.37 | 1371 ms | ok |
| `Mosaicos:LANDSAT_8_2018` | — | ✅ | 200 | 800×800 | 30.53 | 803 ms | ok |
| `Mosaicos:SENTINEL_2_2018` | — | ✅ | 200 | 800×800 | 40.21 | 1125 ms | ok |
| `Mosaicos:SENTINEL_2_2019` | — | ✅ | 200 | 800×800 | 39.57 | 1356 ms | ok |

## 2. Cenas da Fase 3

| Camada | Estilo | GetMap | HTTP | Dimensão | Desvio-padrão | Tempo | Observação |
|---|---|---|---|---|---|---|---|
| `Mosaicos:SENTINEL_2_2024` | — | ✅ | 200 | 800×800 | 50.24 | 888 ms | ok |
| `Mosaicos:SENTINEL_2_2025` | `Geoportal_Sentinel_2_2025_NIR` | ✅ | 200 | 800×800 | 38.71 | 1632 ms | ok |
| `Mosaicos:MOSAICO_SPOT_SEPLAN` | — | ✅ | 200 | 800×800 | 28.51 | 715 ms | ok |

### ⚠️ NIR é estilo, não camada

Os "mosaicos NIR" aparecem no `GetCapabilities` dentro de `<Style>`, não como camada:
pedir `layers=Mosaicos:Geoportal_Sentinel_2_2021_NIR` devolve
`LayerNotDefined`. A forma correta é
`layers=<mosaico RGB do ano>&styles=<estilo NIR>`.

Estilos NIR publicados (estilo → camada):

- `Geoportal_Sentinel_2_2025_NIR` → `Mosaicos:SENTINEL_2_2025`
- `Geoportal_Sentinel_2_2024_NIR` → `Mosaicos:SENTINEL_2_2024`
- `Geoportal_Sentinel_2_2023_NIR` → `Mosaicos:SENTINEL_2_2023`
- `Geoportal_Sentinel_2_2022_NIR` → `Mosaicos:SENTINEL_2_2022`
- `Mosaicos:Geoportal_Sentinel_2_2021_NIR` → `Mosaicos:SENTINEL_2_2021`
- `Mosaicos:Geoportal_Sentinel_2_2020_NIR` → `Mosaicos:SENTINEL_2_2020`
- `Geoportal_Sentinel_2_2019_NIR` → `Mosaicos:SENTINEL_2_2019`
- `Mosaicos:Geoportal_Sentinel_2_2018_NIR` → `Mosaicos:SENTINEL_2_2018`
- `Mosaicos:Geoportal_Sentinel_2_2017_NIR` → `Mosaicos:SENTINEL_2_2017`
- `Mosaicos:Geoportal_Sentinel_2_2016_NIR` → `Mosaicos:SENTINEL_2_2016`

## 3. Como reproduzir

```bash
npx tsx scripts/levantamento-wms-pos-recorte.ts --bbox=-55.6,-12.6,-55.55,-12.55
```

Uma camada só entra na série quando aparece no `GetCapabilities` **e** devolve
`GetMap` válido e não uniforme. "Imagem uniforme" costuma significar que a bbox de
teste está fora da cobertura daquele mosaico — vale repetir com outra bbox antes de
descartar o ano.
