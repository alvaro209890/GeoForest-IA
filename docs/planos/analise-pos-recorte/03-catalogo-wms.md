# 03 — Catálogo WMS da SEMA-MT e a série temporal

> **Levantamento ao vivo executado em 2026-08-05 (tarefa F0.1)** — resultado com
> layer por ano, dimensões e tempo de resposta em
> [`docs/LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md`](../../LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md).
> Os 11 anos de 2009 a 2019 existem no `GetCapabilities` **e** devolveram `GetMap`
> válido (PNG 800×800, não uniforme, 0,7–1,4 s). Duas correções à tabela abaixo:
> **(a)** 2018 também tem `Mosaicos:LANDSAT_8_2018`, então a troca L8→S2 acontece em
> **2019**, não entre 2016 e 2018; **(b)** os "`..._NIR`" **não são camadas, são
> estilos** — ver §5.

## 1. O que o repo já sabe hoje

A lista curada de camadas de imagem está em
[`backend/lib/map-utils.ts:28-80`](../../../backend/lib/map-utils.ts)
(`CURATED_IMAGERY_LAYER_NAMES`). Ela é usada para ordenar o que vem do
`GetCapabilities` — **não** é fonte de verdade sobre disponibilidade.

Endpoint: `SEMA_WMS_BASE_URL` (default `https://geo.sema.mt.gov.br/geoserver/ows`) com
`SEMA_WMS_AUTHKEY`. Ambos já configurados no PC servidor.

## 2. Série disponível por ano (do catálogo curado)

| Ano | Camada | Sensor | Fase |
|---|---|---|---|
| 1984–2000 | `Mosaicos:LANDSAT_5_<ano>` | Landsat 5 | fora de escopo |
| 2002 | `Mosaicos:LANDSAT_7_2002` | Landsat 7 | fora de escopo |
| 2003 | `Mosaicos:LANDSAT_5_2003` | Landsat 5 | **1** |
| 2004 | `Mosaicos:LANDSAT_5_2004` | Landsat 5 | **1** |
| 2005 | `Mosaicos:LANDSAT_5_2005` | Landsat 5 | **1** |
| 2006 | `Mosaicos:LANDSAT_5_2006` | Landsat 5 | **1** |
| 2007 | `Mosaicos:LANDSAT_5_2007` | Landsat 5 | **1** |
| 2008 | `Mosaicos:MOSAICO_SPOT_SEPLAN` | SPOT | **1** (âncora) |
| 2008 | `Mosaicos:LANDSAT_5_2008` | Landsat 5 | **2** (ponto de partida alternativo) |
| 2009 | `Mosaicos:LANDSAT_5_2009` | Landsat 5 | **2** |
| 2010 | `Mosaicos:LANDSAT_5_2010` | Landsat 5 | **2** |
| 2011 | `Mosaicos:LANDSAT_5_2011` | Landsat 5 | **2** |
| 2012 | `Mosaicos:RESOURCESAT_2012` | ResourceSat | **2** ⚠️ sensor único |
| 2013 | `Mosaicos:LANDSAT_8_2013` | Landsat 8 | **2** |
| 2014 | `Mosaicos:LANDSAT_8_2014` | Landsat 8 | **2** |
| 2015 | `Mosaicos:LANDSAT_8_2015` | Landsat 8 | **2** |
| 2016 | `Mosaicos:LANDSAT_8_2016` **ou** `Mosaicos:SENTINEL_2_2016` (+ `..._NIR`) | L8 / S2 | **2** ⚠️ dois candidatos |
| 2017 | `Mosaicos:LANDSAT_8_2017` **ou** `Mosaicos:SENTINEL_2_2017` (+ `..._NIR`) | L8 / S2 | **2** ⚠️ dois candidatos |
| 2018 | `Mosaicos:LANDSAT_8_2018` **ou** `Mosaicos:SENTINEL_2_2018` | L8 / S2 | **2** ⚠️ dois candidatos (corrigido em 2026-08-05) |
| 2019 | `Mosaicos:SENTINEL_2_2019` | Sentinel-2 | **2** (fim da série) |
| 2020–2024 | `Mosaicos:SENTINEL_2_<ano>` (2020/2021 com `..._NIR`) | Sentinel-2 | **3** |

Notar: **não há lacuna de ano entre 2009 e 2019** (confirmado ao vivo em 2026-08-05) —
mas há **três trocas de sensor**. Mantendo Landsat 8 enquanto ele existe, as fronteiras
ficam em **2012** (L5→ResourceSat), **2013** (ResourceSat→L8) e **2019** (L8→S2), e é aí
que mora o risco de falso positivo. Escolher Sentinel-2 em 2016/2017 (decisão A2)
antecipa a terceira fronteira para 2016 e cria uma quarta — motivo pelo qual
`buildYearCatalog` prefere L8 por padrão e deixa o S2 como alternativo.

## 3. Descoberta obrigatória em runtime (não hardcodar)

Antes de qualquer análise da Fase 2/3, `pos2008/catalog.ts` deve:

1. chamar `GetCapabilities` (reusar `fetchSemamtCapabilitiesXml` /
   `getMapCapabilitiesData` de `backend/lib/map-utils.ts` — tem cache com TTL);
2. filtrar as camadas de mosaico e extrair o ano do nome;
3. casar com a tabela de aliases acima, preservando o **nome publicado** como
   proveniência;
4. validar cada ano candidato com **um `GetMap` real** na bbox do primeiro polígono do
   job (PNG válido, dimensão certa, não uniforme);
5. montar `catalogVersion` = SHA-256 da lista ordenada `ano→layer` efetivamente
   habilitada, e guardar com TTL (sugestão: 6 h);
6. declarar explicitamente `missingYears[]` no resultado.

**Ano que não passou no passo 4 não entra na série** — vira limitação registrada, nunca
um "sem mudança".

## 4. Regra de escolha quando há dois candidatos no mesmo ano (2016, 2017)

Proposta (decisão **A2** do doc 11):

1. preferir a **mesma família do ano anterior** para preservar comparabilidade
   (2016 e 2017 → Landsat 8, dando continuidade a 2013–2015);
2. registrar o candidato descartado em `alternativesAvailable[]`;
3. quando — e só quando — o redutor apontar transição exatamente na fronteira de troca
   de sensor, disparar uma **janela-ponte** (ver doc 05 §4) com o candidato alternativo
   para confirmar ou rebaixar a conclusão.

## 5. Comparabilidade das cenas (vale para as 3 fases)

Para o mesmo polígono, todas as cenas da série usam:

- **mesma bbox** (a do polígono, com o mesmo padding relativo);
- mesma proporção, mesmas dimensões (`calculateDynamicResolution` já existe em
  `wms-scenes.ts`), mesmo CRS;
- mesmo overlay: contorno fino do polígono (`buildAuasPolygonOverlaySvg`);
- rótulo `ano + sensor + layer` **gravado na imagem** e repetido no prompt;
- validação antes da visão: HTTP, magic bytes, dimensão, uniformidade, nuvem/oclusão,
  cobertura do polígono no quadro (`image-quality.ts`);
- proveniência persistida: layer, ano, sensor, `imageSha256`, largura/altura, score de
  qualidade, `fetchedAt` e **URL sem `authkey`**.

## 6. O que a diferença de sensor faz com a interpretação

| Efeito | Consequência prática |
|---|---|
| Resolução (L5 ~30 m → S2 ~10 m) | Um polígono pequeno pode ser "não observável" em 2009 e observável em 2019. Isso é **limitação**, não mudança |
| Paleta/composição diferente | Cor não é evidência. O prompt descreve o sensor de cada cena e proíbe conclusão baseada em tonalidade global |
| ResourceSat 2012 isolado | Transição detectada **apenas** entre 2011→2012 ou 2012→2013 exige confirmação com o par 2011↔2013 antes de virar ano confirmado |
| NIR só em alguns anos | Usar NIR **só na Fase 3** (estado atual), nunca dentro de uma série temporal mista |

Essas regras entram como **precondições do redutor**, não como texto de prompt: se a
transição cruza fronteira de sensor sem confirmação, o status cai para intervalo ou
inconclusivo por código.

## 7. Diagnóstico administrativo

Uma rota de leitura (`GET /api/simcar/imagery/catalog`, autenticada) devolve o catálogo
resolvido: anos habilitados, layer escolhida por ano, alternativas, anos ausentes,
`catalogVersion` e `expiresAt`. Serve para a prévia da UI (doc 07) e para depurar sem
abrir o GeoServer.

## 5. NIR é estilo, não camada (achado do levantamento F0.1)

`Mosaicos:Geoportal_Sentinel_2_2021_NIR` **não é uma camada**: é um `<Style>` do mosaico
`Mosaicos:SENTINEL_2_2021`. Pedir `layers=Mosaicos:Geoportal_Sentinel_2_2021_NIR`
devolve `ServiceException code="LayerNotDefined"`.

A forma correta é `layers=<mosaico RGB do ano>&styles=<estilo NIR>` — validada ao vivo
com `Mosaicos:SENTINEL_2_2025` + `Geoportal_Sentinel_2_2025_NIR` (PNG 800×800, 1,6 s).
`buildWmsGetMapUrl` passou a aceitar `styles` por isso.

Existem estilos NIR de **2016 a 2025** (a lista completa está no relatório). Atenção ao
prefixo: os de 2016–2018, 2020 e 2021 vêm como `Mosaicos:Geoportal_...`; os de 2019 e
2022–2025 vêm **sem** o prefixo do workspace. Nunca montar esse nome por concatenação —
ler do `GetCapabilities`.
