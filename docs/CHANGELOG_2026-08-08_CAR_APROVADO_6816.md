# 2026-08-08 — Bugs encontrados rodando um CAR **aprovado** de ponta a ponta

Terceira rodada de caça a bugs, com um método novo: em vez de partir do código,
partiu de um **CAR real já aprovado pela SEMA** (imóvel 6816, 62,46 ha, Querência
— `OneDrive_2026-08-08.zip`, projeto "Arquivo Enviado" completo com 28 camadas) e
percorreu o site inteiro com ele.

O critério de bug ficou objetivo: **num CAR que a SEMA aprovou, tudo que o
sistema acusa como erro é suspeito de ser falso positivo.** E o projeto ainda
traz gabarito para a datação — o `.dbf` da AUAS declara `ABERTURA` por polígono
(2016, 2016, 2019, 2021, 2021), o que permite medir a Fase 2 contra a verdade
declarada em vez de contra a própria opinião do modelo.

Como na rodada anterior, **nada aqui toca em segurança**: só correção, precisão
de laudo e custo.

Perfil do imóvel (medido, não declarado): ATP = AIR = 62,4610 ha · AUAS 5 feições
= 51,1143 ha · ARL 3 feições = 49,9685 ha (80% — bioma amazônico) · AC 1 feição =
9,8163 ha, **inteiramente dentro da ARL** · AVN 2 feições = 1,5305 ha ·
**`TIPOLOGIA_VEGETAL` vazia** (o oposto da Santa Clara, onde ela cobria tudo).

---

## 1. Erros de geometria: 9 erros — todos falsos — num CAR aprovado 🔴

A aba "Erros de geometria" reprovava o projeto com **9 erros em 5 feições**,
dois deles rotulados "validação **IMPEDITIVA** do Anexo 01 do SIMCAR".

### 1.1 "Vazio/gap" era o vão entre feições distantes

`detectGaps` calculava `envelope convexo − união`. O fecho convexo de feições
**espalhadas** cobre todo o espaço entre elas, e cada concavidade virava vazio.
Camadas do CAR não particionam o imóvel: AUAS são clareiras separadas, AVN são
remanescentes separados.

| Camada | "vazio" reportado | buracos reais (anéis interiores) |
|---|---|---|
| AVN (2 feições, 1,53 ha somados) | **7,62 ha** | 0 |
| AUAS (5 feições) | 4,68 ha | 0 |
| ARL (3 feições) | 0,11 ha | 0 |

O vazio da AVN era **cinco vezes maior que a própria camada**.

**Correção:** vazio passa a ser (a) **anel interior da união** — buraco de fato
cercado por geometria — ou (b) **fresta estreita** entre feições, ou seja, sobra
do fecho convexo cuja **largura mínima** (calipers sobre o fecho) fica abaixo de
`MAX_GAP_WIDTH_M` = 5 m. Duas feições que deveriam encostar e ficaram a 2 m são
erro; duas manchas a 300 m não são. Piso de área subiu de 1 m² para 10 m² —
havia frestas de 1,65 m² e 3,04 m² no projeto aprovado.

`backend/geometry/detectors/gaps.ts`.

### 1.2 `ARL ⊂ AVN` reprovava reserva legal **a recuperar**

A regra era aplicada a toda ARL, ignorando o `.dbf`. O dado prova a distinção
sozinho: as feições 1 e 2 (`SITUACAO="P"`, preservada) têm **exatamente** as
áreas das duas feições de AVN (1,0433 e 0,4872 ha); a feição 3
(`SITUACAO="A"`, a recuperar, 48,44 ha) era acusada de "48,2390 ha fora da AVN
— validação IMPEDITIVA". Reserva a recuperar é, por definição, a que **não** tem
vegetação nativa declarada.

**Correção:** a regra só vale para ARL com `SITUACAO` de reserva vegetada. Sem
`.dbf` a regra não se aplica (acusar seria repetir o falso positivo).

### 1.3 Contenção sem tolerância a resíduo de topologia

"ARL vetorizada fora da AIR: **0,0002 ha**" — 2 m² num imóvel de 62 ha, marcado
como impeditivo. **Correção:** `CONTAINMENT_SLIVER_TOLERANCE_M2` = 500 m²
(mesmo limiar do filtro de slivers da Fase 3), respeitando valor maior do usuário.

### 1.4 O `.dbf` nunca chegava aos detectores 🟠

`ruleLayers`, em `backend/geometry/job.ts`, era montado **sem** `dbf`. Com isso
`detectReservatorioRules` — que lê `BARRAMENTO`/`SITUACAO` — nunca teve atributo
para ler: a regra existia e estava muda. Corrigido junto (é o que viabiliza 1.2).

### 1.5 O limiar de sobreposição estava sendo usado para tudo 🟠

`minOverlapM2` (default **1 m²** na UI) alimentava contenção, sobreposição *e*
vazios. São grandezas diferentes. Agora contenção e vazios têm piso próprio.

**Resultado: o CAR aprovado passou de 9 erros para 0**, sem afrouxar as
detecções reais — a suíte de paridade com o oráculo da SEMA
(`processar-projeto.test.ts`, ZIP reprovado + ZIP aprovado) continua verde.

## 2. Análise pós-recorte: 1/3 das janelas de visão era jogada fora por texto 🔴

O achado mais caro da rodada. As três fases validam o JSON da visão com Zod, e
**qualquer** frase levemente fora do formato invalidava a janela inteira — que
custa 3 GetMap + 1 chamada de visão e vira `INCONCLUSIVO`.

| Fase | Janelas `INVALID_SCHEMA` (antes) |
|---|---|
| 1 (pré-2008) | **5 de 15** |
| 2 (datação) | **13 de 30** |
| 3 (vegetação na AC) | **1 de 1** |

Duas causas, ambas cosméticas:

1. **`FORBIDDEN_LEGAL_TERMS` casava por substring.** A lista tinha `"regular"` e
   `"legal"`. Resultado: `"padrão regular"` (descrição de textura) e
   `"Área de Reserva Legal"` (**o nome da camada ARL**) derrubavam a janela.
2. **Frase acima de 280 caracteres invalidava a observação.** No caso real da
   Fase 3, um `conflicts` de ~330 caracteres descartou uma análise perfeita: o
   modelo tinha lido corretamente SPOT 2008 = `LARGE_BLOCK` 0,85 e 2024/2025 =
   `PATCHES`.

**Correção:** `backend/analise-pos-recorte/text-sanitizer.ts`, compartilhado
pelas três fases. O texto é **saneado antes do Zod**: frase longa é truncada,
frase com conclusão jurídica de verdade é **descartada** (não a janela), e o
descarte fica contabilizado. Os padrões jurídicos passam a casar por **fronteira
de palavra** — `infração`, `ilegal`, `irregularidade`, `embargo`, `multa`,
`passivo ambiental` —, nunca `regular` ou `legal` soltos. O schema segue estrito
onde importa: enum, `sceneId`, ano e fração.

**Depois da correção: 0 janelas `INVALID_SCHEMA` nas três fases.**

## 3. Cenas: enquadramento sem contexto e reamostragem sem limite 🔴

As cenas usavam **exatamente o bbox do polígono**, sem margem, e
`calculateDynamicResolution` dimensionava só pela área — sem olhar a resolução
do sensor.

O caso real (AUAS-0004, 1,39 ha, 437 m × 106 m) pedia ao GeoServer **2021×480 px
de um mosaico Landsat 5 de 30 m**: uma ampliação de ~140×, para um polígono que
tem **3,5 pixels** de lado menor. A imagem devolvida é um gradiente verde liso —
e a resposta do modelo ("gradientes de cor sem dados visuais") estava **certa**.

Pior: `classifySceneUsability` marcava essas cenas como `USABLE`, porque um
gradiente interpolado tem variância de sobra para passar no teste de uniformidade.

**Correções** (`backend/analise-pos-recorte/wms-scenes.ts`, aplicadas nas 3 fases):

- `SENSOR_GROUND_RESOLUTION_M` — resolução nominal por sensor (L5/L8 30 m,
  ResourceSat 24 m, Sentinel-2 10 m, SPOT 5 m, CBERS-4A 2 m).
- `expandBboxForContext` — margem de contexto: o quadro passa a ter ao menos
  `MIN_CONTEXT_SENSOR_PIXELS` (24) pixels nativos no lado menor, com ≥15% de
  folga, teto de 5 km. O polígono deixa de encostar na borda e há paisagem para
  comparar.
- Teto de reamostragem de **4× a resolução nativa**.
- Nova usabilidade **`BELOW_MIN_RESOLUTION`**: polígono com menos de
  `MIN_POLYGON_SENSOR_PIXELS` (4) pixels no lado menor **não gera cena nem paga
  visão**. O corte é por sensor, não por polígono — o mesmo AUAS-0004 é
  descartado no Landsat (3,5 px) e analisado no SPOT (21 px).

## 4. Fase 2 datava desmate onde só houve troca de sensor 🔴

Achado que só apareceu **depois** da correção do §2 — com as janelas voltando a
ser aproveitadas, o redutor passou a receber a série completa e mostrou o
problema real:

> Os quatro polígonos analisáveis saíram como **"CONFIRMADO_INTERVALO 2011–2012,
> confiança HIGH"**. As datas declaradas no `.dbf` são 2016, 2016, 2019 e 2021.

2012 é o **único ano ResourceSat** da série (2009–2011 Landsat 5, 2013–2018
Landsat 8, 2019 Sentinel-2). O modelo lia 2011 nativo, 2012 antropizado, 2013
nativo de novo — e o redutor tomava o primeiro `NATIVE_TO_ANTHROPIZED` como
conversão, **sem verificar se ela persistia**. Laudo confiante e errado é pior
que laudo inconclusivo.

**Correção:** uma transição só vale se **persistir** no ano observável seguinte.
Se o ano seguinte volta a ser vegetação nativa, o que houve foi variação de
aparência (paleta do sensor, fenologia, queimada sazonal) — a transição é
descartada com limitação explícita. Transição no último ano da série continua
válida, porque nada pode desmenti-la.

**Bug irmão, na janela-ponte:** `plan.bridgeWindow` era fixado no **primeiro**
limite de sensor do catálogo com candidato alternativo, não naquele que a
transição atravessa. No CAR 6816 isso dava `WBRIDGE=[2018,2019]` para confirmar
uma transição em **2011→2012**: a ponte não tinha como confirmar nada, toda
transição em troca de sensor era rebaixada, e a limitação registrada ("a
janela-ponte não confirmou") era enganosa. Agora a ponte roda **depois** das
janelas normais e escolhe a fronteira que a transição observada de fato cruza.

## 5. Fase 3: o fato mais relevante do laudo não saía no laudo 🟡

A AC do CAR 6816 está **100% dentro da Área de Reserva Legal declarada** (9,82 de
9,82 ha). O redutor levantava a flag `AC_SOBREPOE_ARL`, mas só a transformava em
texto no ramo de alerta ALTO; nos demais `evidence` saía **vazio**.

**Correção:** a evidência geométrica (ARL e AUAS, com área e percentual medidos)
entra em **todos** os vereditos, inclusive `SEM_VEGETACAO_APARENTE` e
`INCONCLUSIVO` — ela é medida, é de graça e independe da visão.

## 6. Correções menores

- **Recorte SIMCAR apagava o `SITUACAO` real da ARL.** `applyLayerAttributeRules`
  gravava `SITUACAO="P"` e `AVERBACAO="NA"` **por cima** do que veio do WFS. A
  causa era outra: o WFS da SEMA publica `SITUACAO_VEGETAL` e
  `SITUACAO_AVERBACAO`, nomes que o mapeador não reconhecia, então o valor real
  chegava nulo e o default entrava. Agora há tabela de apelidos
  (`SOURCE_FIELD_ALIASES`) e o default só preenche lacuna
  (`setMappedAttributeIfEmpty`).
- **HTTP 400 da Groq era opaco.** O erro virava "Groq rejeitou o payload (HTTP
  400)", descartando `error.code` e `failed_generation` — justamente o que diz o
  que corrigir. Agora o detalhe (truncado, sem imagem) entra na mensagem.
- **Prompt de visão não dizia que a imagem é falsa-cor.** Os mosaicos da SEMA
  **não têm estilo em cor natural**: o GetCapabilities mostra `semamt:LANDSAT_5`,
  `Mosaicos:LANDSAT_8`, `RESOURCESAT_2012_432` e
  `Geoportal_Sentinel_2_<ano>_NIR` como estilo padrão e único — todos com
  infravermelho próximo no canal verde. Só o SPOT sai em cor natural. A chave de
  leitura agora declarada no prompt foi **medida**, cruzando o SPOT 2008 com o
  Landsat 5 2007 no mesmo recorte: floresta ⇒ RGB≈(33,168,51), solo exposto ⇒
  RGB≈(117,119,176).

---

## Antes e depois, no mesmo CAR

| | Antes | Depois |
|---|---|---|
| Erros de geometria (CAR aprovado) | 9 (2 "impeditivos") | **0** |
| Janelas perdidas por schema (F1+F2+F3) | 19 de 46 | **0** |
| Fase 1 — polígonos com veredito | 0 de 5 | **4 de 5** |
| Fase 2 — datas confiantes **erradas** | — | **0** |
| Fase 2 — data batendo com o `ABERTURA` declarado | 1 (AUAS-0002, 2016) | 1 (AUAS-0002, **2016**) |
| Fase 3 — janela de visão | `INVALID_SCHEMA` | `COMPLETED`, veredito `SEM_VEGETACAO_APARENTE` |

O resultado da Fase 1 é o esperado pelo gabarito: as cinco AUAS têm `ABERTURA`
entre 2016 e 2021, ou seja **nenhuma** é anterior ao marco de 2008 — e quatro
saíram `SEM_EVIDENCIA_PRE_2008`. A quinta (1,39 ha) ficou `INCONCLUSIVO` por
honestidade: o Landsat não a resolve, e agora isso é dito em vez de ser
disfarçado de análise.

## Verificação

```
pnpm run check   → limpo
pnpm test        → 625 passed / 8 skipped (0 falhas; 612 antes)
pnpm run build   → verde
```

Testes de regressão novos: `text-sanitizer.test.ts` (7), enquadramento por
resolução em `wms-scenes.test.ts` (4), persistência da conversão em
`pos2008/evidence-reducer.test.ts` (3), contexto geométrico em
`ac-vegetacao/evidence-reducer.test.ts` (1) e falsos positivos do CAR aprovado em
`geometry-errors.test.ts` (5).

Os 3 `Errors` que o vitest reporta no fim são os `Timeout calling "onTaskUpdate"`
de `processar-projeto.test.ts` — pré-existentes, nenhum teste falha.

## Variáveis de ambiente novas

| Variável | Default | Efeito |
|---|---|---|
| `SIMCAR_SCENE_MIN_SENSOR_PIXELS` | `4` | Lado menor mínimo, em pixels nativos, para o polígono valer uma cena. |
| `SIMCAR_SCENE_MIN_CONTEXT_PIXELS` | `24` | Pixels nativos que o quadro inteiro deve ter no lado menor (margem de contexto). |

Nenhuma precisa ser criada no servidor: os defaults são o comportamento desejado.
As três flags das fases continuam **desligadas**, então nada disso muda a
produção hoje — exceto as correções de **erros de geometria**, que estão em uso.

## Fora do escopo do código

- A `DEEPSEEK_API_KEY` do `backend.env` do servidor continua **inválida (401)**,
  então os três laudos saíram com `model: "deterministic-fallback"`. A chave em
  `~/.hermes/.env` deste PC responde **200** com `deepseek-v4-pro` — é trocar a
  do servidor. Decisão e ação são do Álvaro.
- `parseCachedContextFromOutputZip` (importação de ZIP vetorizado) monta cada
  registro com `turfPolygon(rings)`, tratando todo anel extra como buraco,
  enquanto o resto do código usa `ringsToFeature`, que separa ilha de buraco pela
  orientação. Nos dois conjuntos de dados reais disponíveis não há registro
  multipart, então o bug é **latente** e não foi mexido — corrigir sem caso de
  teste real seria trocar um comportamento conhecido por um não verificado.
