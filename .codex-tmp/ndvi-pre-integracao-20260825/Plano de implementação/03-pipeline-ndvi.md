# 03 — Pipeline técnico do NDVI

> **Decisão D2 (confirmada):** o NDVI roda por **botão próprio**, no padrão das fases
> pós-recorte — flag de ambiente + gate `409 PHASE_NOT_READY`. Não roda automático em
> todo recorte.

Módulo novo: **`backend/ndvi/`**, seguindo a mesma anatomia de `backend/cbers/` e
`backend/landsat/` (que já foram desmembrados assim nos planos 05/06/07).

```
backend/ndvi/
  constants.ts      env vars, paletas, limites
  types.ts          NdviJobState, NdviSceneRef, NdviZonalStat, NdviFailureCode
  scene-select.ts   escolha da cena STAC (nuvem, cobertura, SLC-off)
  gdal.ts           wrappers dos comandos NDVI (reusa runCommand do cbers)
  compute.ts        recorte + cálculo + máscara + color-relief
  zonal.ts          estatística por polígono              → doc 04
  geoserver.ts      publicação na biblioteca NDVI          → doc 05
  archive.ts        acervo no HD Backup + índice JSON      → doc 05
  report-ndvi-docx.ts  laudo Word                          → doc 06
  job.ts            orquestrador do job
  routes.ts         rotas HTTP                             → doc 07
  index.ts          barrel
```

---

## 3.0 O que reusar (não reescrever)

| Precisa de | Use | Onde |
|---|---|---|
| Executar GDAL com progresso + cancelamento | `runCommand({ uid, jobId, command, commandArgs, basePercent, spanPercent, stage, message })` | `backend/cbers/gdal.ts:11` |
| Capturar stdout de GDAL (ex.: `gdalinfo -json`) | `runCommandCapture(command, args, jobId)` | `backend/cbers/gdal.ts:128` |
| Env de GDAL para ler COG por HTTP | `gdalCommandEnv()` | `backend/cbers/utils.ts:14` |
| Ler bounds/EPSG de um raster | `readRasterBoundsInfo(path, jobId)` | `backend/cbers/gdal.ts:211` |
| Assinar assets do Planetary Computer | `prepareDownloadableLandsatItem(item)` | `backend/landsat/stac-search.ts` |
| Buscar item STAC | `getStacItem(itemId)` / `getPlanetaryComputerStacItem(itemId)` | `backend/landsat/stac-search.ts` |
| Baixar arquivo com validação | `downloadFile(url, destPath)` | `backend/landsat/composite.ts:42` |
| Progresso SSE + persistência do job | `progress()`, `persistCbersJob()` (molde) | `backend/cbers/sse.ts` |
| Ciclo de vida do job | `startJob`, `finishJob`, `isCancelRequested` | `backend/processing-jobs.ts` |
| Registrar `proj4.defs` | `import "../proj-defs"` | `backend/proj-defs.ts` |

> ⚠️ `backend/cbers/gdal.ts` estima duração só para `gdal_pansharpen.py` e
> `gdal_translate` (`CBERS_*_ESTIMATE_MS`). Para `gdalwarp` e `gdal_calc.py` o
> `estimatedDurationMs` cai para 0 e o progresso passa a depender só do parser
> `0...10...20...`. Adicionar `NDVI_WARP_ESTIMATE_MS` / `NDVI_CALC_ESTIMATE_MS` se a
> barra ficar parada.

---

## 3.1 Ferramentas GDAL — conferir antes de escrever código

`scripts/cbers-doctor.sh:55` valida hoje:

```
gdalinfo gdal_translate gdalwarp gdaladdo gdalbuildvrt gdal_pansharpen.py gdal_edit.py python3 node
```

**`gdal_calc.py` e `gdaldem` NÃO estão nessa lista.** Os dois são necessários.

- `gdaldem` faz parte do core do GDAL (pacote `gdal-bin`) — presença praticamente certa.
- `gdal_calc.py` vem dos scripts Python do GDAL. Como `gdal_pansharpen.py` **já funciona
  no servidor**, as bindings Python do GDAL estão instaladas e `gdal_calc.py` deve estar
  junto — mas **confirmar, não presumir**.

**Tarefa F0:** acrescentar `gdaldem` e `gdal_calc.py` à lista do `cbers-doctor.sh`.
GDAL validado no servidor: **3.8.4**.

**Plano B**, se `gdal_calc.py` não existir: escrever `scripts/ndvi_calc.py` usando
`osgeo.gdal` + `numpy` diretamente e chamá-lo com `python3`. Mesmo contrato de entrada e
saída; o resto do pipeline não muda.

---

## 3.2 Visão geral do fluxo

```
jobId do recorte SIMCAR já concluído
  │
  ├─ 1. Geometria: lê o recorte persistido → polígono do imóvel + camadas AC/AVN/AUAS
  ├─ 2. Cena: busca STAC por bbox+ano → ranqueia → escolhe → assina assets
  ├─ 3. Recorte remoto: gdalwarp -cutline direto no /vsicurl/ (não baixa a cena inteira)
  ├─ 4. Cálculo: gdal_calc.py → NDVI Float32 [-1,1], nodata -9999, com máscara de nuvem
  ├─ 5. Paleta: gdaldem color-relief → RGB 8 bits para as figuras do laudo
  ├─ 6. Overviews: gdaladdo nos dois
  ├─ 7. Acervo: copia para o HD Backup + grava JSON no índice        → doc 05
  ├─ 8. Publicação: coveragestore + layer + grupos + GetMap PNG      → doc 05
  ├─ 9. Estatística zonal por polígono                                → doc 04
  └─ 10. Laudo Word                                                   → doc 06
```

---

## 3.3 Passo 1 — Entrada: a geometria vem do recorte

O job recebe o `jobId` de um recorte SIMCAR já concluído. A geometria sai do documento
persistido, não de um upload novo:

- `readPersistedSimcarClipForUid(uid, jobId)` — `backend/simcar/hydration.ts`
- `hydrateCachedJob(jobId, contextUrl, outputZipUrl, uid)` — reidrata o `CachedJob`

Do contexto reidratado saem:

| O que | Para quê |
|---|---|
| Polígono do imóvel (`ATP`, união) | cutline do recorte raster e bbox da busca STAC |
| `clippedGeometries` por camada | feições da estatística zonal (doc 04) |
| `areaHa`, CRS | metadados do laudo |

**CRS:** os vetores do SIMCAR estão em **EPSG:4674** (SIRGAS 2000); as cenas Landsat C2
vêm em **UTM WGS84** (EPSG:326xx/327xx). O cutline precisa ser reprojetado — `gdalwarp`
aceita `-cutline_srs EPSG:4674` e resolve sozinho. Importar `backend/proj-defs.ts` em
qualquer módulo que chame `proj4` diretamente, senão `EPSG:4674` estoura.

---

## 3.4 Passo 2 — Escolha da cena (R7 da reunião)

Busca STAC por bbox do imóvel + janela de datas, com o mesmo `searchExternalLandsatScenes`
que o painel Landsat já usa.

**Janela por ano:** para o ano *A*, buscar de `A-06-01` a `A-09-30` — o miolo da seca em
MT, mesma lógica que o acervo local já usa ("data mais próxima de 22/07", critério 5 do
ranqueamento em `docs/ACERVO_LANDSAT_LOCAL.md`). Exposto em
`NDVI_SEASON_START` / `NDVI_SEASON_END`.

**Ranqueamento** (do melhor para o pior):

1. Descartar cena cujo footprint **não contenha** o imóvel inteiro → senão marcar
   `cobertura_parcial` e seguir com aviso.
2. Descartar **Landsat 7 posterior a 31/05/2003** (SLC-off) quando houver alternativa.
   ⚠️ Ao detectar plataforma por texto, usar **lookaround, não `\b`** — `_` é caractere
   de palavra em JS e `\bl7\b` nunca casa em `..._l7_etm_...`. Esse bug já custou caro
   uma vez (`backend/landsat/naming.ts:22-30`).
3. Menor `eo:cloud_cover` da propriedade STAC.
4. Data mais próxima de **22/07**.

Se nenhuma candidata sobrar: `sem_cena_nir` (ver [02 §2.7](02-fonte-das-bandas.md#27-quando-não-houver-nir-falhar-declarando-nunca-estimar)).

---

## 3.5 Passo 3 — Recorte remoto, antes de calcular

**Não baixar a cena inteira.** Cada banda C2 L2 é um COG de ~60–120 MB cobrendo
~180 × 180 km; o imóvel típico ocupa uma fração ínfima disso.

`gdalCommandEnv()` (`backend/cbers/utils.ts:14`) já está configurado exatamente para
leitura parcial de COG por HTTP:

```
GDAL_DISABLE_READDIR_ON_OPEN = EMPTY_DIR
CPL_VSIL_CURL_ALLOWED_EXTENSIONS = .tif,.TIF,.tiff,.TIFF
GDAL_HTTP_MAX_RETRY = 8 ; GDAL_HTTP_RETRY_DELAY = 2
VSI_CACHE = TRUE ; VSI_CACHE_SIZE = 50000000
```

Então dá para recortar direto da URL assinada, lendo só os tiles necessários:

```bash
gdalwarp \
  -cutline "$TMP/imovel.geojson" \
  -cutline_srs EPSG:4674 \
  -crop_to_cutline \
  -dstnodata 0 \
  -of GTiff \
  -co COMPRESS=LZW -co TILED=YES -co BIGTIFF=IF_SAFER \
  "/vsicurl/$NIR_SIGNED_URL" \
  "$TMP/nir_clip.tif"
```

Repetir para `red` e para `qa_pixel`. No `qa_pixel` usar **`-r near`** — é bitmask, e
qualquer reamostragem que interpole inventa bits que não existem.

Detalhes:

- Manter os três recortes **na projeção nativa da cena** (sem `-t_srs`). Reprojetar antes
  do cálculo introduz interpolação nas bandas; se precisar reprojetar, é **depois** do
  NDVI pronto.
- Os três recortes têm que sair com **grade idêntica**. Rodar o `gdalwarp` do NIR
  primeiro e passar `-te`/`-tr`/`-ts` daquele resultado para os outros dois garante isso.
  Grade desalinhada faz o `gdal_calc.py` falhar ou, pior, alinhar errado em silêncio.
- URLs assinadas do Planetary Computer **expiram em ~1 h**. Assinar imediatamente antes
  de usar; em job longo, reassinar.
- Se `/vsicurl/` falhar (rede, servidor sem range request), cair para o caminho antigo:
  `downloadFile` da cena inteira + `gdalwarp` local. Registrar no log qual caminho foi
  usado.

---

## 3.6 Passo 4 — Cálculo do NDVI

Aqui mora a armadilha do §2.3 do doc 02. A expressão precisa converter para reflectância
**antes** de dividir, e precisa mascarar nodata e nuvem.

```bash
gdal_calc.py \
  -A "$TMP/nir_clip.tif" --A_band=1 \
  -B "$TMP/red_clip.tif" --B_band=1 \
  -C "$TMP/qa_clip.tif"  --C_band=1 \
  --outfile="$TMP/ndvi.tif" \
  --type=Float32 \
  --NoDataValue=-9999 \
  --co COMPRESS=LZW --co TILED=YES --co BIGTIFF=IF_SAFER \
  --calc "where( (A<=0)|(B<=0)|(bitwise_and(C.astype(uint16), $QA_MASK)>0), -9999, ((A*0.0000275-0.2)-(B*0.0000275-0.2)) / where(((A*0.0000275-0.2)+(B*0.0000275-0.2))==0, nan, ((A*0.0000275-0.2)+(B*0.0000275-0.2))) )"
```

Onde `$QA_MASK` = `NDVI_QA_MASK_BITS` (27 para L4/5/7, 31 para L8/9 — o bit 2 é cirrus).

O que cada pedaço faz:

| Trecho | Motivo |
|---|---|
| `A<=0 \| B<=0` | `nodata = 0` das bandas SR — borda da cena. Sem isso a borda vira NDVI espúrio |
| `bitwise_and(C, QA_MASK) > 0` | nuvem, sombra, cirrus, neve e fill fora da conta (`gdal_calc` faz `from numpy import *`, então `bitwise_and` está disponível) |
| `A*0.0000275-0.2` | **conversão para reflectância** — o ponto do §2.3 |
| `where(denominador==0, nan, denominador)` | evita divisão por zero sem mascarar o pixel inteiro |
| `--type=Float32` + `--NoDataValue=-9999` | **R1**: guardar o valor real em [−1, 1], não byte esticado |

**Validar a saída** logo depois, com `runCommandCapture("gdalinfo", ["-json","-stats", ndviPath], jobId)`:
mínimo ≥ −1 e máximo ≤ 1. Fora disso, alguma coisa está errada — falhar o job, não
publicar. Esse teste de sanidade custa nada e pega o erro do offset na hora.

### Opcional: recorte estrito ao polígono

O `-crop_to_cutline` do passo 3 já limitou ao polígono, mas pixels de borda parcialmente
cobertos permanecem. Para a estatística zonal isso é tratado no doc 04.

---

## 3.7 Passo 5 — Paleta de cor (verde → amarelo → marrom)

**Decisão D3:** ficam **dois produtos**. O Float32 é o dado; o RGB é a figura.

Arquivo de rampa versionado em **`config/geoserver-styles/ndvi_ramp.clr`**, fonte única
para o `gdaldem` e para o SLD (doc 05) — as duas representações precisam bater, senão a
figura do laudo e a camada do WMS mostram cores diferentes para o mesmo valor.

```
# ndvi_ramp.clr — valor R G B A
-9999   0   0   0   0
-1.00 140  81  10 255
-0.20 191 129  45 255
 0.00 223 194 125 255
 0.10 246 232 195 255
 0.20 255 255 191 255
 0.30 217 240 163 255
 0.40 173 221 142 255
 0.50 120 198 121 255
 0.60  65 171  93 255
 0.70  35 132  67 255
 0.80   0 104  55 255
 1.00   0  69  41 255
nv     0   0   0   0
```

Marrom no fundo da escala, bege/amarelo no meio, verde escuro no topo — a rampa clássica
de NDVI, e a mesma leitura que o Bruno usou ao vivo ("menos um é solo exposto… um é onde
tem vegetação", 08:46).

```bash
gdaldem color-relief \
  -alpha \
  -of GTiff \
  -co COMPRESS=LZW -co TILED=YES -co BIGTIFF=IF_SAFER \
  "$TMP/ndvi.tif" \
  config/geoserver-styles/ndvi_ramp.clr \
  "$TMP/ndvi_rgb.tif"
```

`-alpha` gera a 4ª banda, para o nodata sair transparente no WMS e no Word.

---

## 3.8 Passo 6 — Overviews

Mesmo padrão de CBERS e Landsat (`backend/cbers/archive.ts:196-204`):

```bash
gdaladdo -ro -r average \
  --config COMPRESS_OVERVIEW LZW \
  --config INTERLEAVE_OVERVIEW PIXEL \
  --config BIGTIFF_OVERVIEW IF_SAFER \
  "$FINAL_TIF" 2 4 8 16 32 64 128
```

⚠️ No **Float32** com nodata `-9999`, `-r average` mistura nodata com dado válido e cria
zoom-out com valores inventados. Usar **`-r nearest`** no NDVI Float32 e deixar `average`
só para o RGB. Exposto em `NDVI_OVERVIEW_RESAMPLING_DATA` (padrão `nearest`) e
`NDVI_OVERVIEW_RESAMPLING_RGB` (padrão `average`).

Se o imóvel for pequeno (poucas centenas de pixels), pular overviews — não há o que
reamostrar.

---

## 3.9 Nomenclatura (R5 da reunião)

A convenção veio da própria reunião — "a órbita/ponto, o ano, o mês e o dia, e a
composição" (17:36) — e casa com o padrão já usado no acervo.

**Arquivos:**

```
NDVI_<PATH>_<ROW>_<YYYYMMDD>_<PLATAFORMA>_NDVI.TIF      ← Float32, o dado
NDVI_<PATH>_<ROW>_<YYYYMMDD>_<PLATAFORMA>_RGB.TIF       ← color-relief, a figura
```

Exemplo: `NDVI_224_069_20080720_L5_NDVI.TIF`

**No acervo permanente**, sufixo curto do job para não sobrescrever — igual ao CBERS
(`withJobSuffix`, `backend/cbers/archive.ts:270-285`):

```
NDVI_224_069_20080720_L5_NDVI_J47FA5471.TIF
```

**Nome da layer** (minúsculo, `cleanLayerName` do padrão Landsat):

```
cbers:ndvi_224_069_2008_ndvi_224_069_20080720_l5_ndvi_j47fa5471
cbers:ndvi_224_069_2008_ndvi_224_069_20080720_l5_rgb_j47fa5471
```

> O workspace continua sendo **`cbers`** — é o workspace único do GeoServer da casa,
> usado também pelo Landsat. O que separa NDVI de CBERS e Landsat é o **grupo**, não o
> workspace. Ver [05](05-publicacao-wms.md).

---

## 3.10 Faixas de interpretação

Calibradas com o que a reunião mostrou ao vivo (R4: floresta 0,7–0,8; queda para 0,6
denunciando fogo em 1995) e com `banco_de_dados/06_sensoriamento_remoto/indices_vegetacao.md`.

| Faixa | Classe | Tom no laudo |
|---|---|---|
| < 0,00 | Água / superfície não vegetada | `info` |
| 0,00 – 0,20 | Solo exposto ou vegetação ausente | `danger` |
| 0,20 – 0,40 | Vegetação rala, pastagem degradada, regeneração inicial | `warn` |
| 0,40 – 0,60 | Vegetação intermediária, pastagem vigorosa, regeneração | `warn` |
| 0,60 – 0,75 | Vegetação arbórea | `ok` |
| ≥ 0,75 | Vegetação arbórea densa | `ok` |

Constantes em `backend/ndvi/constants.ts`, consumidas pelo laudo (doc 06) e pela rampa
de cor. **As faixas são descritivas, não conclusivas** — nenhuma delas afirma AC, AVN ou
AUAS. Isso é o R10 (NDVI é o primeiro elo, não a prova) virando código.

⚠️ **Vocabulário:** ao redigir qualquer texto derivado dessas faixas, respeitar o
glossário do repositório — AC → "uso consolidado"; AUAS → "supressão pós-2008"; nunca
"área antropizada" (`AC_AUAS_PROMPT_GLOSSARY` / `AC_VS_AUAS_GLOSSARY`).

---

## 3.11 Progresso e cancelamento

O job é longo. Seguir o padrão do CBERS:

| Etapa | `stage` | % |
|---|---|---|
| Reidratar recorte, montar cutline | `geometry` | 0–5 |
| Buscar e escolher cena | `scene` | 5–12 |
| Recortar NIR / RED / QA | `clip` | 12–45 |
| Calcular NDVI | `ndvi` | 45–60 |
| Color-relief | `palette` | 60–66 |
| Overviews | `overview` | 66–72 |
| Acervo no HD | `archive` | 72–78 |
| Publicar no GeoServer | `publish` | 78–88 |
| Estatística zonal | `zonal` | 88–94 |
| Laudo Word | `report` | 94–100 |

`throwIfCancelled(jobId)` entre etapas e dentro do laço da estatística zonal. Todo
`runCommand` já checa cancelamento a cada 1 s e manda `SIGTERM`.

Temporários em `NDVI_TMP_ROOT` (padrão `/tmp/geoforest-ndvi`), removidos em `finally`
com `fs.rmSync(tmpDir, { recursive: true, force: true })` — e uma limpeza periódica no
molde de `backend/cbers/tmp.ts` para o caso de o processo morrer no meio.
