# NDVI — plano de implementação (STATUS)

> **Leia este arquivo primeiro.** Ele é o índice e o quadro de estado do plano.
> O núcleo F0–F5 está implementado; os documentos abaixo preservam o contrato e as
> decisões que guiaram a implementação.

**Origem do pedido:** reunião IMAP × Bruno Cardoso (RestaurAgro), 31/07/2026,
sobre GEE e índices espectrais. O NDFI do título da reunião **está fora de escopo** —
só a metodologia foi aproveitada. O objetivo é **NDVI**.

**Data do plano:** 2026-08-25

---

## O que foi construído

1. Raster **NDVI** da área recortada, gerado com GDAL no mesmo padrão do pipeline
   CBERS/Landsat.
2. Publicação no GeoServer local numa biblioteca própria **`NDVI`**, no mesmo nível
   hierárquico de CBERS e Landsat (`RASTER → NDVI → …`), com validação `GetMap` PNG.
3. **Laudo próprio em Word (.docx)** com as figuras NDVI e as estatísticas por polígono.
4. **Aba dedicada no dashboard** (`/dashboard/ndvi`, commit `e1026b85`) que lista os
   recortes SIMCAR do usuário e calcula o NDVI de cada um, com progresso, cancelamento,
   laudo Word e WMS. Doc: `docs/CHANGELOG_2026-08-25_ABA_NDVI.md`.
5. **Aba refeita no fluxo CBERS** (commit `b2b7ab42`): importa o polígono (ZIP/SHP/CAR),
   busca cenas Landsat C2 L2 e gera a **cena completa** com **5 composições** publicadas
   no WMS — `NDVI` (rampa verde-amarelo-marrom), `NDFI` (área convertida fica **branca**,
   rampa nova `ndfi_ramp`), `SAVI` (ajustado ao solo, L=0,5 — rampa `savi_ramp`),
   `RGB` (cor natural) e `SWIR` (falsa-cor 6-5-4, banda 7).
   Organização no GeoServer: `RASTER → NDVI → órbita → ano → composição`.
   O NDVI pós-recorte deixou de publicar no WMS (mantém cálculo + laudo).
   Doc: `docs/CHANGELOG_2026-08-25_ABA_NDVI_FLUXO_CBERS.md`.
6. **Correção da busca por data** (commit `4ab045d1`): a busca agora consulta o STAC
   para **todos os anos entre `dateStart` e `dateEnd`** (antes usava só o ano corrente,
   então 2007/2008 devolvia "sem imagem").

---

## Decisões já tomadas (confirmadas pelo Álvaro em 25/08/2026)

| # | Decisão | Escolha | Onde está detalhada |
|---|---|---|---|
| D1 | Fonte das bandas NIR/RED | **Landsat Collection 2 Level-2 Surface Reflectance** (`landsat-c2l2-sr`) | [02](02-fonte-das-bandas.md) |
| D2 | Gatilho da geração | **Botão próprio, no padrão das fases pós-recorte** (flag + gate 409) | [03](03-pipeline-ndvi.md), [07](07-api-env-frontend.md) |
| D3 | Formato da camada no WMS | **Float32 + estilo SLD**, e **RGB color-relief em paralelo** para as figuras do laudo | [05](05-publicacao-wms.md) |

Estas três não estão em aberto. O que continua em aberto está em
[09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md).

---

## Ordem de leitura

| Doc | Assunto | Para quem |
|---|---|---|
| [01-contexto-e-fontes.md](01-contexto-e-fontes.md) | O que a reunião ensinou e os 11 requisitos que isso gera | todos |
| [02-fonte-das-bandas.md](02-fonte-das-bandas.md) | De onde vêm NIR e RED; o que **não** serve e por quê | todos |
| [03-pipeline-ndvi.md](03-pipeline-ndvi.md) | Passo a passo GDAL: recorte, cálculo, máscara, paleta, nomes | implementador |
| [04-estatisticas-zonais.md](04-estatisticas-zonais.md) | Estatística por polígono (o número que vai no laudo) | implementador |
| [05-publicacao-wms.md](05-publicacao-wms.md) | Biblioteca `NDVI` no GeoServer, SLD, acervo no HD, GetMap | implementador |
| [06-laudo-docx.md](06-laudo-docx.md) | Laudo Word: layout, figuras, metadados, módulo novo | implementador |
| [07-api-env-frontend.md](07-api-env-frontend.md) | Rotas, variáveis de ambiente, mudanças no frontend | implementador |
| [08-fases-e-aceitacao.md](08-fases-e-aceitacao.md) | Fases de entrega, testes e critérios de aceitação | todos |
| [09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md) | Riscos, armadilhas medidas e o que falta decidir | todos |

`fontes/` guarda as duas transcrições da reunião usadas para escrever o plano.

---

## Estado das fases

| Fase | Entrega | Estado |
|---|---|---|
| F0 | Preflight GDAL + SLD versionado no GeoServer | ✅ código/preflight local concluído; validação live registrada separadamente |
| F1 | Núcleo NDVI: recorte + cálculo + Float32 + RGB no HD | ✅ implementada |
| F2 | Publicação na biblioteca `NDVI` do WMS + validação GetMap | ✅ implementada; GetMap real depende da primeira execução live |
| F3 | Estatística zonal por polígono | ✅ implementada, incluindo denominador geométrico de `validPct` |
| F4 | Laudo Word próprio | ✅ implementada e testada |
| F5 | Rota, flag, botão no frontend | ✅ implementada: quarto card independente + progresso/cancelamento + **aba dedicada `/dashboard/ndvi`** (25/08) + **refeita no fluxo CBERS** (cena completa, 4 composições, commit `b2b7ab42`) |
| F6 | Série temporal multi-ano | ⬜ não iniciada (opcional) |

Detalhe de cada fase em [08-fases-e-aceitacao.md](08-fases-e-aceitacao.md).

---

## Três coisas que vão fazer o implementador errar se ele não ler

1. **O offset do Landsat C2 L2 não cancela na razão.** `ρ = DN × 0,0000275 − 0,2`.
   Calcular NDVI direto no DN dá número errado com cara de certo. Detalhe em
   [02](02-fonte-das-bandas.md#23-a-armadilha-do-fator-de-escala).
2. **O WMS da SEMA não serve para NDVI.** O "NIR" de lá é **estilo de cor**, não banda;
   o GetMap devolve PNG 8 bits já esticado. Detalhe em
   [02](02-fonte-das-bandas.md#21-o-que-nao-serve-e-por-que).
3. **`validPct` usa os pixels esperados dentro da geometria**, não todos os pixels do
   retângulo envolvente. Contar nodata externo ao polígono como nuvem produz falso
   `nuvem_excessiva` em feições irregulares.
