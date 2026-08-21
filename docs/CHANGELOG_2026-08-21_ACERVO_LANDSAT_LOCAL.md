# 2026-08-21 — Acervo Landsat da casa no laudo SIMCAR (e cenas deslocadas)

Pedido: usar o WMS do GeoServer da IMAP no lugar do mosaico da SEMA, com
órbita/ponto certo e cuidado com anos que têm mais de uma cena — "normal só 1
está correta, as outras estão deslocadas". Decisão: **misturar**. Álvaro
pediu para olhar de verdade as deslocadas antes de publicar.

## O que o laudo ganha

Cena nativa tem data de passagem (`cena 20/07/2008, órbita/ponto 224/069,
acervo IMAP`) e não é reamostrada. O mosaico estadual continua nos anos sem
cena nossa (Sentinel, ResourceSat, órbitas fora do acervo, e os anos em que a
cena local estava deslocada).

## Deslocamento medido — não é teoria

GetMap 512×400 no envelope de um imóvel real de Querência (~17 m/px) +
correlação de fase nas bordas. O bbox da camada **não** vê isso (a variação
natural de enquadramento da órbita é 1–10 km e engole 30–300 m).

Achados que teriam ido para laudo se o rank automático mandasse:

- **2006 224/069 L2** (escolha primária): **1,1 km** contra a série 2003–2008.
  A de 17/09/2006 está alinhada (23 m).
- **2009 224/069 c543** (escolha primária): **1,4 km**. A `lt05…_geo` da mesma
  data está alinhada.
- **2023 224/069 L9**: **4,3 km** contra 2011/2021. A `_v2` também.
- **2004 L2**: 548 m contra as irmãs da mesma data.
- 2013–2021 Landsat 8 da 224/069: **0 m**.

Cenas descartadas não são servidas; o ano cai no mosaico da SEMA. `revisar:
true` em estado `automatico` também não entra em laudo — o rank já tinha
escolhido a deslocada em 2006 e 2009.

## Defesas da mistura de fontes

Prompt `MIXED_SOURCE_PROMPT_NOTE` (só concluir conversão quando a geometria
mudar) e quadro `imageSourceNote` no PDF/DOCX. Proveniência vai **no sufixo**
da legenda, nunca no prefixo (senão o anexo some de novo).

## Arquivos

`backend/simcar/acervo-local.ts`, `config/acervo-landsat.json`,
`scripts/levantar-acervo-landsat.ts`, `scripts/curar-acervo-deslocadas.py`,
`scripts/auditar-deslocamento-acervo.py`, `docs/ACERVO_LANDSAT_LOCAL.md`.
Env: `SIMCAR_ACERVO_LOCAL_ENABLED`, `ACERVO_WMS_BASE_URL`, `ACERVO_LANDSAT_JSON`.
