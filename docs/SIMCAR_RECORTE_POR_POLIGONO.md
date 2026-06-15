# SIMCAR — Recorte WFS por polígono (sem unir os lotes)

Data: 2026-06-15

Este documento registra a correção que faz o recorte automático do SIMCAR Digital
(WFS da SEMA-MT) tratar **cada polígono do imóvel separadamente**, em vez de unir
todos os lotes numa única geometria antes de recortar.

## Contexto

Quando o usuário envia um shapefile com **vários lotes** (por exemplo, um arquivo
de "fazendas unidas" com 5 polígonos), o pipeline precisa:

1. Buscar as feições de cada camada SIMCAR (AVN, ÁREA CONSOLIDADA, ARL, etc.) no
   WFS da SEMA-MT.
2. Recortar essas feições nos limites do imóvel.
3. Gerar, para cada camada, **um único shapefile** com as peças recortadas.

## Problema corrigido

O fluxo antigo (`parseUserShapefile`) **unia** todos os polígonos do imóvel com
`turf.union()` e usava a geometria resultante tanto para a consulta WFS quanto
para o recorte local. Isso causava dois defeitos confirmados em campo:

1. **Camadas não eram recortadas (HTTP 400 no WFS).**
   A consulta `INTERSECTS` com o WKT da geometria unida (>10.000 caracteres no
   arquivo de teste) era **rejeitada pelo GeoServer da SEMA-MT com HTTP 400**.
   Como o `INTERSECTS` falhava, camadas como `AREA_CONSOLIDADA` e `AVN` voltavam
   vazias — exatamente o sintoma relatado ("não recorta vários shapes").

2. **União "lossy" do `turf.union()`.**
   Ao unir lotes adjacentes, o `turf.union()` descartava regiões e mesclava
   feições que cruzavam divisas. No arquivo de teste a área total caía de
   **4.890 ha** (soma dos lotes) para **4.243 ha**, e o recorte contra a união
   produzia poucas peças mescladas em vez de uma peça por lote.

## Correção implementada

Arquivos: `backend/simcar-clip.ts`.

### 1. `parseUserShapefile` deixa de unir os lotes

Agora retorna também a lista de polígonos individuais:

```ts
{ polygon, polygons, geometry, areaHa }
```

- `polygons`: cada lote do `.shp`, corrigido individualmente via `buffer(0)`.
  É o que se usa no recorte real.
- `polygon` (união): mantido **apenas** para usos agregados — bbox, snapshots
  WMS e consulta WFS.
- `areaHa`: passa a ser a **soma das áreas de cada lote** (lotes do SIMCAR são
  distintos e não se sobrepõem), evitando a subcontagem do `turf.union()`.

### 2. `clipFeaturesToPolygon` recorta lote a lote

A função aceita um polígono **ou uma lista** e intersecta cada feição WFS contra
**cada lote separadamente**. Uma feição que cruza a divisa entre dois lotes gera
**duas peças independentes** (uma por lote) — nunca uma peça única mesclada.
Todas as peças vão para o **mesmo shapefile** de saída da camada.

### 3. `processClip` usa `userPolygons` no recorte

- Camadas WFS comuns recortam contra `userPolygons` (lotes individuais).
- Camadas de rio continuam usando a fronteira expandida única
  (`riverClipBoundary`), pois dependem da margem de APP.
- `AIR`/`ATP` (cópia direta) geram **um registro por lote**, com os mesmos
  atributos — incluindo o número da AIR (`IDENTIFIC`), **idêntico em todos os
  polígonos** do shape de AIR.

### 4. Fallback de BBOX no WFS

`fetchWfsClipFeatures` passou a cair para a consulta por **BBOX** sempre que o
`INTERSECTS` for rejeitado com **HTTP 400** (e não só quando o WKT passa de 4000
caracteres). O recorte fino é refeito localmente, lote a lote, então o resultado
final continua exato.

## Comportamento atual

Para um imóvel com N lotes:

- O número de peças por camada **não** é necessariamente "1 por lote" — depende
  de quantas feições WFS caem em cada lote. Um lote pode ter várias peças de AVN
  e outro nenhuma.
- O que está **garantido**: nenhuma feição é mesclada entre lotes diferentes; o
  corte respeita o limite de cada polígono do imóvel.
- `AIR` e `ATP` têm exatamente **N registros** (um por lote).

## Teste realizado (arquivo `fazendas_unidas.zip`, 5 lotes)

Validado contra o WFS real da SEMA-MT, gerando shapefiles inspecionados com
`ogrinfo`:

| Camada            | Antes (união)        | Depois (por lote)        |
|-------------------|----------------------|--------------------------|
| AREA_CONSOLIDADA  | INTERSECTS → HTTP 400 | 6 interseções → 17 feições |
| AVN               | INTERSECTS → HTTP 400 | 19 interseções → 25 feições |
| AIR / ATP         | colapsava em 1 registro | 5 registros (1 por lote) |
| Área total        | 4.243 ha (lossy)     | 4.890 ha (soma dos lotes) |

No `AIR`, todos os 5 registros saem com o mesmo `IDENTIFIC`.

Validação TypeScript:

```bash
npm run check    # tsc --noEmit, sem erros
```

## Arquivos envolvidos

- `backend/simcar-clip.ts`
  - `parseUserShapefile`: deixa de unir; retorna `polygons`; `areaHa` = soma.
  - `clipFeaturesToPolygon`: aceita lista e recorta lote a lote.
  - `processClip`: usa `userPolygons` no recorte e na cópia direta de AIR/ATP.
  - `fetchWfsClipFeatures`: fallback de BBOX em HTTP 400.

## Relação com o ajuste anterior

Complementa `docs/SIMCAR_MULTIPOLYGON_AIR_ATP.md`. Aquele ajuste corrigiu a
escrita de `MultiPolygon` em registros separados; este garante que os lotes
cheguem separados ao writer (a união anterior podia colapsar lotes contíguos num
único polígono, anulando o efeito esperado em AIR/ATP).
