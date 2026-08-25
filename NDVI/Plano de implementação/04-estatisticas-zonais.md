# 04 — Estatística zonal: o número que vai no laudo

Este documento existe por causa de **R2** e **R3** da reunião. É a parte que o Bruno
demonstrou ao vivo e a que a IMAP disse fazer na mão hoje.

> "ele já habilita aqui o cálculo da média… **que você vai utilizar nos laudos**"
> — Bruno Cardoso, 20:18

> "é interessante você fazer o **polígono por vez**… tô misturando várias coisas aqui,
> tem três polígonos" — Bruno Cardoso, 22:18

---

## 4.1 A regra que não pode ser quebrada

**Estatística por feição, nunca pela união das feições.**

O Bruno mostrou o erro acontecendo: com três polígonos selecionados juntos, o índice
médio saiu **0,16** — um número que não descrevia nenhum dos três. Dissolver geometrias
antes de medir é o atalho natural de quem implementa e é exatamente o que produz laudo
errado.

Então: para cada feição de cada camada, uma linha de estatística própria.

---

## 4.2 O que é medido, e sobre o quê

| Escopo | Origem da geometria | Por que importa |
|---|---|---|
| **Imóvel inteiro** | `ATP` (união) | Número de cabeçalho do laudo |
| **Cada feição de `AREA_CONSOLIDADA`** | `clippedGeometries` do recorte | AC deve ter NDVI de uso consolidado |
| **Cada feição de `AVN`** | idem | AVN deve ter NDVI de vegetação nativa |
| **Cada feição de `AUAS`** | idem | Supressão pós-2008 |
| **Cada feição de `ARL`** | idem | Reserva legal — comparação útil |

As geometrias saem do `clippedGeometries: Map<string, Geometry[]>` que o
`processClip` já monta (`backend/simcar/clip-pipeline.ts:689`, preenchido em `:916-918`),
recuperado via `hydrateCachedJob`.

⚠️ **`TIPOLOGIA_VEGETAL` fica de fora.** Ela é o mapa de tipologia do imóvel inteiro e
cobre ~100% de toda a AC — tratá-la como declaração de vegetação já causou 100% de falso
positivo uma vez. Além disso está em `EXPORT_EXCLUDED_LAYERS`
(`backend/simcar/constants.ts`), que é filtro de **saída**: nada que é entregue pode
conter essa camada. Reusar `isExcludedExportEntry`, não recriar a lista.

**Limite:** `NDVI_ZONAL_MAX_FEATURES` (padrão 50). Acima disso, medir as maiores por área
e registrar no laudo quantas ficaram de fora. Um CAR com centenas de fragmentos não pode
travar o job.

---

## 4.3 Métricas por feição

| Campo | Como sai | Vai para o laudo? |
|---|---|---|
| `layer` | nome da camada | ✅ |
| `featureIndex` | índice dentro da camada | ✅ |
| `areaHa` | área da feição | ✅ |
| `min`, `max` | `gdalinfo -json -stats` | ✅ |
| `mean` | **o número da reunião** | ✅ destaque |
| `stdDev` | dispersão interna | ✅ |
| `validPixels` | pixels não-nodata | interno |
| `totalPixels` | pixels no envelope recortado | interno |
| `validPct` | `validPixels / totalPixels` | ✅ — é a honestidade da medida |
| `classe` | faixa de [03 §3.10](03-pipeline-ndvi.md#310-faixas-de-interpretação) aplicada à média | ✅ |

`validPct` é obrigatório na tabela. Uma média de 0,72 com 95% de pixels válidos e uma
média de 0,72 com 30% de pixels válidos são afirmações muito diferentes, e só a segunda
precisa de ressalva.

Se `validPct < NDVI_MIN_VALID_PCT` (padrão 0,60), a linha sai marcada
`nuvem_excessiva` e **sem classe atribuída** — mede-se, mas não se classifica.

---

## 4.4 Como calcular sem dependência nova

Não há `rasterstats` em Node e não vale a pena adicionar biblioteca de raster. O caminho
mais limpo usa só o que já está no PATH e o `runCommandCapture` que já existe.

**Para cada feição:**

```bash
# 1. recorta o NDVI pela feição
gdalwarp \
  -cutline "$TMP/feat_<layer>_<i>.geojson" \
  -cutline_srs EPSG:4674 \
  -crop_to_cutline \
  -dstnodata -9999 \
  -of GTiff -co COMPRESS=LZW \
  "$NDVI_TIF" "$TMP/zonal_<layer>_<i>.tif"

# 2. lê as estatísticas
gdalinfo -json -stats "$TMP/zonal_<layer>_<i>.tif"
```

O JSON traz, em `bands[0]`:

```json
{ "minimum": -0.08, "maximum": 0.91, "mean": 0.7213, "stdDev": 0.0844,
  "noDataValue": -9999, "metadata": { "": { "STATISTICS_VALID_PERCENT": "94.7" } } }
```

`STATISTICS_VALID_PERCENT` entrega o `validPct` de graça. `boundsFromGdalInfoJson`
(`backend/cbers/gdal.ts:175`) já é o molde de como parsear essa saída — escrever um
`bandStatsFromGdalInfoJson` irmão no `backend/ndvi/zonal.ts`.

**Cuidados:**

- Usar `-stats`, não `-approx_stats`. A aproximação subamostra, e em polígono pequeno
  isso muda a média de verdade. O CBERS usa `-approx_stats` porque lá é só para calcular
  realce visual; aqui o número **é o produto**.
- `gdalinfo -stats` grava um `.aux.xml` ao lado. Ou apagar junto com o `tmpDir`, ou usar
  `--config GDAL_PAM_ENABLED NO`.
- Pixel de borda parcialmente dentro do polígono: `gdalwarp -cutline` inclui o pixel se o
  **centro** cai dentro. Em 30 m, um polígono estreito pode perder quase tudo. Se
  `totalPixels < NDVI_MIN_PIXELS` (sugestão: 10), marcar `area_pequena_demais` e não
  classificar — em 30 m isso equivale a menos de ~0,9 ha, onde o pixel misto do R9 domina.
- `throwIfCancelled(jobId)` a cada feição.

**Alternativa** se o laço ficar lento (muitas feições): um `scripts/ndvi_zonal.py` único
com `osgeo.gdal` + `numpy`, recebendo o GeoJSON de todas as feições e devolvendo um JSON
com todas as linhas. Também abre espaço para mediana e percentis, que o `gdalinfo` não dá.
A reunião só pediu média, então isso é otimização, não requisito.

---

## 4.5 Série temporal (R6)

Quando o usuário pedir mais de um ano, a estatística é repetida por ano e o laudo ganha
uma tabela ano × média por feição, além do gráfico.

Foi o uso que o Bruno demonstrou: acompanhar o NDVI ao longo dos anos e ver a queda
denunciar um evento — em 1995, fogo (35:50).

⚠️ **Só compare o que é comparável.** Duas ressalvas obrigatórias na tabela de série:

1. **Troca de sensor** (L5 → L7 → L8 → L9) muda a resposta espectral. O laudo tem que
   marcar em qual ano a plataforma trocou. É o mesmo cuidado que o repositório já toma
   com fonte mista de imagem (`MIXED_SOURCE_PROMPT_NOTE` e `imageSourceNote`).
2. **Data de passagem diferente** dentro do ano muda fenologia. Registrar a data exata de
   cada cena na tabela, não só o ano — a mesma razão pela qual o acervo local prefere
   citar "cena de 20/07/2008" em vez de "mosaico 2008".

Sem essas duas colunas, uma variação de sensor vira "mudança no chão" — falso positivo
criado pela infraestrutura, exatamente o que `docs/ACERVO_LANDSAT_LOCAL.md` descreve na
seção "As duas defesas da mistura de fontes".

---

## 4.6 Formato de saída

```ts
export type NdviZonalStat = {
  layer: string;
  featureIndex: number;
  areaHa: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  stdDev: number | null;
  validPixels: number;
  totalPixels: number;
  validPct: number;
  classe: NdviClass | null;          // null quando validPct < mínimo
  aviso: NdviFailureCode | null;     // nuvem_excessiva | area_pequena_demais | null
};

export type NdviSceneRef = {
  itemId: string;
  platform: string;                  // "LANDSAT_5" | "LANDSAT_8" | ...
  path: string; row: string;
  acquiredAt: string;                // ISO da passagem
  cloudCoverPct: number | null;
  collection: string;                // "landsat-c2l2-sr"
  epsg: number | null;
};

export type NdviResult = {
  scene: NdviSceneRef;
  propertyStat: NdviZonalStat;       // o imóvel inteiro
  stats: NdviZonalStat[];            // por feição
  failure: NdviFailureCode | null;
  ndviLayerName: string;
  rgbLayerName: string;
  wmsPublicUrl: string;
};
```

Persistido no mesmo documento do recorte
(`users/<uid>/simcar_clips/<jobId>.json`) por **merge incremental**, com
`persistSimcarClipArtifacts({ uid, jobId, patch: { ndvi: result } })`
(`backend/simcar/hydration.ts:363`). É o mesmo mecanismo que a aba de vetorização usa;
não criar documento novo.
