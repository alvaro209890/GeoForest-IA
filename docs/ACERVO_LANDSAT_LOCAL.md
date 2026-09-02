# Acervo Landsat/SPOT da IMAP no laudo SIMCAR

**Data:** 2026-08-21
**Pedido:** usar o Landsat do nosso GeoServer em vez do mosaico da SEMA, com
cuidado de identificar órbita/ponto e de escolher a cena certa quando o ano tem
mais de uma — "normal só 1 está correta, outras estão deslocadas".
**Decisão do Álvaro:** misturar. Cena nossa no ano em que existe, mosaico da
SEMA no ano em que falta.

> **Atualização operacional — 2026-09-02.** As análises pós-recorte usam
> exclusivamente o acervo IMAP publicado no WMS local. Não há mais fallback
> silencioso para a SEMA: se o catálogo não tiver cena íntegra que cubra o
> imóvel, a fase informa a indisponibilidade para revisão técnica. A única
> exceção é a variável de recuperação explícita
> `SIMCAR_ALLOW_SEMA_WMS_FALLBACK=true`, que não é configurada em produção.
> Para 224/069 em 2007, a referência prioritária é
> `LC5_224_069_20070515_COMP543` (15/05/2007), validada visualmente pela equipe.

## Por que vale a pena

O GeoServer da casa roda no **mesmo host do backend** (Jetty 8081, backend 3001):
`localhost`, sem authkey, sem limite de taxa, sem túnel.

| | Acervo local |
|---|---|
| Cenas Landsat individuais | 104 (1996–2026) |
| Mosaicos/tiles SPOT 2008 | 535 entradas, 7 mosaicos municipais |
| Sentinel-2 / ResourceSat | nenhum |

Dois ganhos, um de imagem e um de prova:

1. **Nitidez.** O mosaico estadual é reamostrado e borra o limite do talhão; a
   cena nativa não.
2. **Data.** A cena de 2008 da órbita 224/069 é de **20/07/2008 — dois dias
   antes do marco do art. 3º, IV**. O laudo passa a citar "cena Landsat 5 TM,
   órbita/ponto 224/069, de 20/07/2008" no lugar de "mosaico LANDSAT_5_2008",
   de data indeterminável.

## Cobertura

| Órbita/ponto | Janela AC/AVN 2003–2008 | Fase 2 (2009–2019) |
|---|---|---|
| **224/069** | **completa (6/6)** | 10/11 |
| 225/068 | faltam 2004 e 2006 | 4/11 |
| 224/068 | faltam 2003, 2004 e 2006 | 8/11 |
| 224/070 | só 2008 | 8/11 |
| 226/069 | só 2008 | 4/11 |
| 224/071, 225/067, 225/070 | nada | nada |

Os **30 jobs com contexto** no banco caem todos entre lon −52,5…−52,1 e
lat −12,7…−12,5 — dentro da 224/069, a única órbita com a janela inteira. Na
prática, hoje, o acervo cobre 100% do que é analisado. Mas são 8 das ~60
órbitas que cobrem MT: fora da mancha, a fase fica **indisponível para revisão**
até que a cena seja incorporada ao acervo local; ela não consulta a SEMA.

## As quatro armadilhas, medidas

### 1. O path/row do nome da camada mente

Duas cenas arquivadas na órbita errada:

| Camada | Pasta | Realidade |
|---|---|---|
| `landsat_224_069_2004_landsat_5_20041229_002_069_l2_comp543` | 224/069 | bbox no Peru, **1.847 km** fora |
| `landsat_224_068_2011_l5_225_068_20111008_comp543_geo` | 224/068 | é 225/068, **165 km** fora |

**Só o bbox casa imóvel com cena.** `resolveAcervoLandsat` filtra por
`bboxContains`, nunca por path/row do nome. O script marca as duas como
`descartado`.

### 2. Deslocamento não se detecta por bbox

Medindo o desvio do centro de cada cena contra a mediana da sua órbita: a
variação **natural** de enquadramento entre datas da mesma órbita/ponto é de
**1 a 10 km**. Ela engole por completo os 30–300 m de erro de georreferenciamento
que são o problema real.

Ou seja: o bbox pega erro grosseiro (armadilha 1) e nada mais. O que o bbox
**consegue** fazer é denunciar o conflito — duas cenas da **mesma data** deveriam
ter footprint idêntico; quando não têm, uma está deslocada. Essas ficam com
`revisar: true` (lista abaixo).

Por isso a escolha final é **lista curada versionada**
(`config/acervo-landsat.json`), não heurística em tempo de requisição.

### 3. Bbox conter o imóvel não é cobrir o imóvel

| Camada | bbox contém o imóvel | render |
|---|---|---|
| `spot_sema_canarana_mosaico` | sim | **100% preto** |
| `spot_sema_querencia_19311ne` (tile) | sim | **60% branco** |
| `spot_sema_querencia_mosaico` | sim | 0% vazio ✓ |

Daí `isMostlyEmptyRender` ser gate obrigatório e não otimização. Responder HTTP
200 com um PNG não prova cobertura. O corte é em 10% de pixels saturados nos
três canais (`ACERVO_EMPTY_RENDER_MAX_RATIO`); a separação medida é limpa —
cena boa fica em 0,0%.

O gate roda **só para o acervo**: o mosaico estadual é contínuo e não tem esse
modo de falha.

### 4. Nem toda cena do ano presta

`l7_etm_224069_20030715_c543` é de **15/07/2003**, depois da falha do SLC
(31/05/2003) — tem faixas de vazio. Desvio-padrão medido: 100, contra 46 da
Landsat 5 do mesmo ano. As duas "existem" para 2003; uma presta.

⚠️ **Bug encontrado no caminho:** `platformFromText`
(`backend/landsat/naming.ts`) usava `\bl7\b`, e `_` é caractere de palavra em
JS — então `..._l7_etm_...` **nunca** casava. Com toda a plataforma voltando
indefinida, o ranqueamento premiou justamente a cena riscada, por ela estar 8
dias mais perto do 22/07. Corrigido com lookaround; travado em
`backend/landsat/naming.test.ts`.

## Como o pipeline resolve

```
bbox do imóvel
  → cenas do catálogo cujo bbox CONTÉM o imóvel, no ano pedido
  → filtra por família de sensor (não rotular L7 como "Landsat 5")
  → ordem do rank curado
  → renderiza
  → vazio? próxima candidata
  → esgotou? mosaico da SEMA
```

Código em `backend/simcar/acervo-local.ts`; o laço compartilhado é
`fetchSatelliteImage` em `backend/simcar/analysis.ts`, usado pelas duas análises
(AC/AVN e AUAS).

**Sentinel-2 e ResourceSat não têm acervo** e nunca caem no local: trocar por
Landsat mudaria o sensor sem mudar o rótulo.

## As duas defesas da mistura de fontes

Misturar fontes na mesma série é risco metodológico real: quem classifica
AC × AVN é o **ano da última atividade visível**, e a IA compara quadro a
quadro. Se 2003 vier nosso e 2004 da SEMA, mudam realce, nitidez e data dentro
do ano — e o modelo pode ler isso como conversão. Seria falso positivo criado
pela infraestrutura, no ano exato em que a fonte troca.

1. **No prompt:** `MIXED_SOURCE_PROMPT_NOTE`
   (`backend/analise-pos-recorte/groq-vision-core.ts`) manda o modelo só concluir
   conversão quando a **geometria** mudar — talhão novo, limite que avança,
   estrada que aparece — e baixar a confiança ao comparar anos de fontes
   diferentes.
2. **No laudo:** `imageSourceNote` (`backend/simcar/report-theme.ts`) imprime um
   quadro dizendo que a série é mista e que diferença de aparência entre fontes
   é processamento, não chão. Sai no PDF e no DOCX.

E cada figura declara a própria origem na legenda:

```
Landsat 5 (2008) — Visão Geral (AC + AVN + AUAS) · cena 20/07/2008, órbita/ponto 224/069, acervo IMAP
Landsat 5 (2005) — Visão Geral (AC + AVN + AUAS) · mosaico SEMA-MT
```

⚠️ **A proveniência é SUFIXO, nunca prefixo.** `selectPrincipalReportImages` e
`reduceImageSet` ordenam lendo o começo da legenda (SPOT, ano). Mexer na frente
da string quebra a seleção do anexo em silêncio — já custou o SPOT 2008 sumir de
um laudo (`CHANGELOG_2026-08-21_ANEXO_SPOT_SUMIA.md`). Travado em
`report-figures.test.ts`.

## O catálogo

`config/acervo-landsat.json`, versionado. Regenerar (**no servidor** — o
GeoServer só escuta em 127.0.0.1):

```bash
npx tsx scripts/levantar-acervo-landsat.ts
```

`status` por entrada:

| Valor | Significado |
|---|---|
| `confirmado` | cena conferida por humano |
| `automatico` | proposta do script — **é o estado de hoje**, e o pipeline serve assim mesmo |
| `descartado` | nunca servida |

### Curadoria medida em 21/08/2026 (GetMap + correlação de fase)

O bbox **não** pega deslocamento de 30–300 m. Medimos no chão: mesma janela
WMS (envelope de um imóvel real de Querência, ~17 m/px) e pico de correlação
nas bordas. Limiar: 3 px (~50 m). Álvaro confirmou que há cenas deslocadas —
e havia, inclusive como escolha primária do rank.

| Órbita | Ano | Camada (encurtada) | vs referência | Decisão |
|---|---|---|---|---|
| 224/069 | 2003–05, 2007–08, 2011 | rank 0 de cada ano | 0–34 m vs 2008 geototal | **confirmado** |
| 224/069 | 2004 L2 | `…l2_comp543` | **548 m** vs as irmãs da mesma data | descartado |
| 224/069 | 2006 L2 (rank 0 antigo) | `…20060613…l2_band5_4_3` | **1147 m** vs a série | descartado |
| 224/069 | 2006 17/09 | `…20060917_comp654` | 23 m | **confirmado**, virou rank 0 |
| 224/069 | 2009 `…c543` (rank 0 antigo) | | **1446 m** vs 2008 | descartado |
| 224/069 | 2009 `lt05…_geo` | | 23 m vs 2008 | **confirmado**, virou rank 0 |
| 224/069 | 2010 | única cena | 101 m, correlação fraca | descartado → SEMA |
| 224/069 | 2013–2021 L8 | rank 0 | **0 m** vs 2011 e entre si | **confirmado** |
| 224/069 | 2023 L9 e `_v2` | | **4,3 km** e 2,4 km | descartado → SEMA |
| 225/068 | 2008 `…comp543_geo` | | 0 m vs 2003 | **confirmado** |
| 225/068 | 2008 tm / geo1 / geo2 | | 1,4 km / 410 m / 69 m | descartado |
| 225/068 | 2009 (as duas) | | 1,4 km e 69 m | descartado → SEMA |
| 225/068 | 2010 sem `_geo` | | 1,8 km | descartado |
| 225/068 | 2010 `_geo` | | 22 m | **confirmado**, virou rank 0 |

O pipeline **não serve** `revisar: true` em estado `automatico`. Regenerar o
JSON (`levantar-acervo-landsat.ts`) apaga a curadoria — reaplicar com
`npx tsx` não, o script é `python scripts/curar-acervo-deslocadas.py`.

### Escolhas primárias na janela AC/AVN

| Órbita/ponto | Ano | Data da cena | Sensor | Revisar |
|---|---|---|---|---|
| 224/068 | 2005 | 29/08/2005 | Landsat 5 | não |
| 224/068 | 2007 | 19/08/2007 | Landsat 5 | não |
| 224/068 | 2008 | 20/07/2008 | Landsat 5 | não |
| 224/069 | 2003 | 07/07/2003 | Landsat 5 | não |
| 224/069 | 2004 | 23/06/2004 | Landsat 5 | não (L2 irmã descartada, 548 m) |
| 224/069 | 2005 | 16/10/2005 | Landsat 5 | não |
| 224/069 | 2006 | 17/09/2006 | Landsat 5 | não (L2 de junho descartada, 1,1 km) |
| 224/069 | 2007 | 02/07/2007 | Landsat 5 | não |
| 224/069 | 2008 | 20/07/2008 | Landsat 5 | não |
| 224/070 | 2008 | 20/07/2008 | Landsat 5 | não |
| 225/068 | 2003 | 30/07/2003 | Landsat 5 | não |
| 225/068 | 2005 | 19/07/2005 | Landsat 5 | não |
| 225/068 | 2008 | 11/07/2008 | Landsat 5 | não (3 irmãs descartadas, até 1,4 km) |
| 226/069 | 2008 | 18/07/2008 | Landsat 5 | não |

### Critérios do ranqueamento

Do melhor para o pior, dentro de cada (órbita, ponto, ano):

1. cena não descartada por órbita errada;
2. **não** ser Landsat 7 posterior a 31/05/2003 (SLC-off, +100);
3. **não** ser cor natural (+50) — a série da SEMA é falsa-cor, e a mistura
   precisa ficar coerente;
4. **não** ser resíduo de reprocessamento `_geo1`/`_geo2`/`_v2`/`_c543_2` (+20);
5. data mais próxima de **22/07** (+dias/10) — o marco legal e o miolo da seca;
6. recorte parcial da cena vai para o fim (+200).

## Variáveis de ambiente

| Env | Efeito | Default |
|---|---|---|
| `SIMCAR_ACERVO_LOCAL_ENABLED` | `false` devolve tudo para a SEMA | ligado |
| `ACERVO_WMS_BASE_URL` | endpoint do GeoServer da casa | `GEOSERVER_BASE_URL` + `/wms`, senão `http://127.0.0.1:8081/geoserver/wms` |
| `ACERVO_LANDSAT_JSON` | caminho do catálogo. Apontar para arquivo inexistente **desliga** o acervo (não cai no do repositório) | `config/acervo-landsat.json` |
| `ACERVO_EMPTY_RENDER_MAX_RATIO` | fração de pixel vazio que reprova a cena | `0.1` |

## O que isso não resolve

- **Sentinel-2 e ResourceSat não existem no acervo** — Fase 2 e tudo pós-2019
  continuam na SEMA.
- **8 das ~60 órbitas de MT.**
- A cor do WMS local ainda não bate com a que o ArcMap mostra do mesmo TIFF, e a
  referência não foi decidida (registrado no vault, `03-gis-ambiental/wms-wfs.md`).
  Não bloqueia; mas se um dia padronizarem a cor, muda o que sai no laudo.
