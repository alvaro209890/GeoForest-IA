# Imagens e camadas do laudo SIMCAR — o que a lei pede e o que a SEMA publica

> Levantamento de 2026-08-20. Inventário de camadas lido do `GetCapabilities` de
> `https://geo.sema.mt.gov.br/geoserver/ows` na mesma data. Complementa
> [`LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md`](LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md),
> que cobre só a série 2009–2019 da Fase 2.

## 1. Os dois marcos temporais que definem a janela de análise

| Marco | Norma | O que exige do laudo |
|---|---|---|
| **22/07/2008** | Lei 12.651/2012, art. 3º, IV e art. 61-A | Área rural consolidada é a de **ocupação antrópica preexistente** a essa data. É a fronteira entre "consolidado" e "desmate que precisa de autorização". |
| **22/07/2003** | Lei 12.651/2012, art. 3º, **XXIV**, c/c IN SEMA-MT 04/2023, art. 42 §6º (Decreto estadual 288/2023, que alterou o Decreto 1.031/2017) | Fim da contagem do **pousio quinquenal** medida contra o marco de 2008. É o ano em que a conta de 5 anos fecha. |

### O pousio tem dois lados — e o laudo precisa dos dois

Não existe piso para a consolidação: área aberta em 1990 ou em 2007 é
igualmente consolidada, porque o art. 3º, IV só exige ocupação **preexistente**
ao marco. O que o marco de 2003 resolve é outra coisa — **por quanto tempo a
atividade ficou interrompida antes de 2008**:

| Última atividade visível | Interrupção até 2008 | Classificação |
|---|---|---|
| 2004 ou depois | até 4 anos | **AC** — pousio (art. 3º, XXIV) |
| 2003 | 5 anos | **AC**, mas no limite legal — sinalizar para o responsável técnico |
| anterior a 2003 (nenhuma atividade na série) | mais de 5 anos | **AVN** — a interrupção descaracterizou a consolidação |

O pousio do art. 3º, XXIV é a interrupção "por no máximo 5 anos". Dentro do
prazo, capoeira na cena de 2008 **não** tira a consolidação. Passando dele, tira:
a vegetação regenerada volta a ser AVN, **mesmo que ainda se vejam traços antigos
de talhão** (bordas retas, estradas remanescentes). Traço de talhão prova que a
área já foi usada; não prova que o uso continuava dentro da janela de 5 anos.

**Consequência prática:** um laudo que só olha 2006–2008 não consegue distinguir
*pousio* (área em descanso, consolidada) de *vegetação nativa regenerada* (que
passou dos 5 anos). Os dois aparecem como cobertura vegetal na cena de 2008. Só
a série **contígua de 2003 a 2008** separa os casos, porque quem decide é o **ano
da última atividade visível** — e um ano faltando pode mover a contagem de um
lado ao outro do limite.

Outras âncoras que o laudo cita:

- **Lei 12.651/2012, art. 26** — supressão de vegetação nativa para uso
  alternativo do solo depende de autorização prévia. Desmate datado **depois** de
  2008 só é regular se houver AUAS/AUTEX emitida; por isso a datação por ano
  importa tanto.
- **IN SEMA-MT 04/2023, art. 44** — admite expressamente **imagem de satélite**
  como meio de prova da consolidação; art. 45 prevê Termos de Referência padrão
  para os laudos técnicos.
- **Nota Técnica 001/2017/CGMA/SRMA/SEMA-MT** (revisada em 2018) — metodologia
  oficial de interpretação de imagem para delimitar área consolidada, construída
  sobre o **SPOT-5 de 2008 (2,5 m)**. É a razão de o SPOT 2008 ter peso maior que
  o Landsat na decisão.

## 2. Acervo de mosaicos publicado pela SEMA-MT (verificado no GetCapabilities)

| Período | Camada | Sensor | Observação |
|---|---|---|---|
| 1984–2000 | `Mosaicos:LANDSAT_5_<ano>` | Landsat 5 TM (30 m) | 17 anos contínuos |
| **2001** | — | — | **Não existe** mosaico publicado |
| **2002** | `Mosaicos:LANDSAT_7_2002` | Landsat 7 ETM+ (30 m) | Único ano de Landsat 7 |
| 2003–2011 | `Mosaicos:LANDSAT_5_<ano>` | Landsat 5 TM (30 m) | Cobre a janela do pousio |
| 2008 | `Mosaicos:MOSAICO_SPOT_SEPLAN` | SPOT-5 (2,5 m) | **Única camada em cor natural** |
| **2012** | `Mosaicos:RESOURCESAT_2012` | ResourceSat-2 LISS-3 (23,5 m) | **Não há Landsat em 2012** |
| 2013–2018 | `Mosaicos:LANDSAT_8_<ano>` | Landsat 8 OLI (30 m) | — |
| 2016–2025 | `Mosaicos:SENTINEL_2_<ano>` | Sentinel-2 MSI (10 m) | 2016–2018 concorrem com o Landsat 8 |

**Falsa-cor:** exceto o SPOT 2008, todos os mosaicos saem em composição falsa-cor
(NIR no canal verde) — vegetação verde-neon, solo exposto magenta/roxo. Sem esse
aviso no prompt, o modelo de visão trata a cena como corrompida. A constante
`FALSE_COLOR_PROMPT_NOTE` (`backend/analise-pos-recorte/groq-vision-core.ts`) é a
fonte única desse texto e agora vale também para os prompts AC/AVN.

**NIR é estilo, não camada:** `layers=<mosaico RGB do ano>&styles=<estilo NIR>`.
Pedir `Mosaicos:Geoportal_Sentinel_2_2021_NIR` em `layers` devolve
`LayerNotDefined` (detalhe no levantamento F0.1).

## 3. Janela temporal do laudo — antes e depois

| Etapa | Antes | Depois | Motivo |
|---|---|---|---|
| AC/AVN (roda em produção) | 2006, 2007, SPOT 2008, 2008 | **2003, 2004, 2005, 2006, 2007**, SPOT 2008, 2008 | Série contígua: o pousio se mede pelo ano da última atividade, então nenhum ano pode faltar |
| Série AUAS | 2008–2024, **sem 2012** | 2008–**2025**, sem furo | 2012 é ResourceSat; 2025 é o mosaico mais recente |
| Catálogo de camadas | L5 1984–2011, L8 2013–2018, S2 2016–2024 | + `landsat7_2002`, + `resourcesat_2012`, + `sentinel2_2025` | Fecha os vãos reais do acervo |
| Fase 2 (datação) | fixa em 2009–2019 | configurável (`SIMCAR_AUAS_POS2008_SERIES_END`, até 2025) | Ver decisão pendente abaixo |

A janela AC/AVN é ajustável por `SIMCAR_ACAVN_SATELLITE_KEYS` (lista de chaves
separadas por vírgula). Cada chave = 1 imagem enviada à API de visão, então
mexer nela mexe direto no custo.

### Decisão pendente do Álvaro — fim da série da Fase 2

O default continua **2019** de propósito: a partir daí a datação oficial vem do
**alerta** (aba AUAS × SCCON), não da interpretação de imagem, e o laudo diz isso
explicitamente. Ligar `SIMCAR_AUAS_POS2008_SERIES_END=2025` estende a leitura
visual até o mosaico mais recente — as janelas passam a ser geradas
automaticamente (`W2019_2021`, `W2021_2023`, `W2023_2025`), sempre com no máximo
3 cenas por chamada. **Efeito colateral a decidir:** a partir de 2019 passa a
existir datação visual concorrendo com a do alerta oficial; a regra da casa é que
o alerta manda. Enquanto essa decisão não for tomada, a série visual para em 2019.

## 4. Camadas vetoriais da SEMA úteis ao laudo (ainda não integradas)

Todas conferidas no `GetCapabilities` — não são hipóteses. Nenhuma exige
credencial nova: saem do mesmo GeoServer já usado pelo recorte.

| Camada | Por que entra num laudo | Base legal |
|---|---|---|
| `Geoportal:USO_CONSOLIDADO` / `USO_CONSOLIDADO_SEMA` | **Mapa oficial de uso consolidado da SEMA** (base SPOT 2008, Nota Técnica 001/2017). É o gabarito contra o qual a própria SEMA valida a AC declarada — comparar a AC do CAR com ele antecipa a divergência que o analista vai apontar. | IN 04/2023, art. 42; NT 001/2017 |
| `Geoportal:AUTORIZACAO_DESMATE_SEMA` | Desmate **autorizado** não é passivo. Sem essa camada, uma conversão datada em 2014 parece irregular mesmo quando havia AUAS emitida. | Lei 12.651/2012, art. 26 |
| `Geoportal:AUTEX_PMFS_SEMA`, `Geoportal:AUTORIZACAO_EXPLORACAO_SEMA` | Mesma lógica para exploração florestal e manejo (PMFS). | Lei 12.651/2012, art. 31; LC 233/2005 |
| `Geoportal:DESMATAMENTO_SEMA_2012` … `_2018` | Datação **oficial do estado**, por ano, para o intervalo que a Fase 2 cobre por imagem. Serve de conferência independente do veredito visual. | — |
| `Geoportal:AREAS_EMBARGADAS_SEMA`, `AREAS_EMBARGADAS_SIGA_POLIGONO`, `Geoportal:AREAS_DESEMBARGADAS_SEMA` | Embargo vigente muda o encaminhamento do processo inteiro. | Lei 9.605/1998; Decreto 6.514/2008 |
| `Geoportal:AUTOS_DE_INFRACAO_SIGA_POLIGONO` | Auto de infração sobre o imóvel é contexto obrigatório do parecer. | Lei 9.605/1998 |
| `Geoportal:TERRAS_INDIGENAS`, `Geoportal:UNIDADES_CONSERVACAO`, `TI_AMORTECIMENTO`, `UC_AMORTECIMENTO` | Sobreposição com TI/UC é impeditivo, não observação. | Lei 9.985/2000; CF art. 231 |
| `Geoportal:AREAS_USO_RESTRITO` | Uso restrito tem regime próprio (art. 10 e 11). | Lei 12.651/2012, art. 10–11 |
| `Geoportal:VEGETACAO_IBGE`, `VEGETACAO_RADAMBRASIL` | Tipologia de referência para a leitura de textura (Floresta × Cerrado × Campo). | — |

## 5. Fontes externas — o que vale e o que não vale a pena

| Fonte | Situação | Recomendação |
|---|---|---|
| **Alertas SCCON (SEMA-MT)** | **Já integrado** — aba AUAS × SCCON preenche `ABERTURA` por alerta oficial. | É a datação de referência a partir de 2019. Não duplicar por imagem. |
| **MapBiomas Alerta** | Não integrado. Valida cada alerta com imagem Planet (3,7 m) ou Sentinel-2 anterior/posterior ao evento e emite laudo por cruzamento com o CAR. | Vale como **conferência de segunda opinião** da datação, sobretudo onde o SCCON não tem alerta. Exige integração nova (API/plataforma). |
| **PRODES/INPE** | `PRODES_WFS_URL` já existe no ambiente. Incremento anual consolidado, corte em agosto. | Bom para **corroborar** o ano da Fase 2; ruim como fonte primária (não cobre Cerrado com a mesma malha e tem defasagem). |
| **DETER/INPE** | Não integrado. Alerta rápido, resolução grosseira, feito para fiscalização — não para delimitar polígono. | Só como indício; nunca para medir área no laudo. |
| **Planet / Pléiades** | Comercial, por cena. | Justificável apenas em caso contencioso, quando 10 m não resolve a borda. Não entra no fluxo padrão. |
| **Landsat via STAC** (`backend/landsat/`) | Já existe no projeto. | Alternativa quando o mosaico anual da SEMA reprova no GetMap (nuvem) e é preciso escolher outra passagem do mesmo ano. |

**Regra que não muda:** o mosaico da SEMA é a fonte de prova preferencial porque
é a mesma base que o analista do órgão enxerga. Fonte externa entra como
corroboração, e o laudo deve dizer de onde veio cada evidência.

## 6. O que o laudo PDF mostra hoje

Estrutura do `simcar-report-v2` (`backend/simcar/report.ts` + `report-theme.ts`):

1. Cabeçalho com job, arquivo e data.
2. **Painel de veredito** com semáforo (verde / amarelo / vermelho) e confiança.
3. Quatro métricas — área, camadas com dados, feições, **janela temporal**.
4. **Resumo executivo em bullets** (máx. 5 achados + contexto + aviso de revisão).
5. **Quadro de achados** — uma linha por indicador, com pílula colorida.
6. **Linha do tempo** — anos com cena, anos sem cena, anos com conversão datada e
   o marco de 22/07/2008 tracejado em vermelho; quando há datação, um box explica
   a consequência legal (art. 26).
7. Quantitativos por camada, com a natureza de cada uma (Restrição / Uso / Base).
8. Gráfico de áreas (quickchart), colorido pela natureza da camada.
9. Texto das análises de IA, com títulos e bullets preservados.
10. **Fundamentação legal aplicada** — as normas desta página.
11. Anexo fotográfico numerado (Figura N).
12. Limitações, em box de destaque.

Amostra local, sem rede e sem Firebase:

```bash
npx tsx scripts/preview-laudo-pdf.ts /tmp/laudo.pdf --fase=acavn   # ou pre2008 | pos2008 | acveg
```
