# Correção da publicação WMS da cena NDVI — 2026-08-26

## Sintoma

O lote `SIGEF.zip` falhou ao publicar a cena Landsat 7 `LE07_L2SP_224069_20070928_02_T1`. O GeoServer criou uma camada, mas o `GetMap` devolvia uma exceção e o ArcMap não conseguia consumi-la.

## Causa raiz

NDVI, NDFI e SAVI são coloridos pelo GDAL antes do arquivamento e chegam ao GeoServer como GeoTIFF RGBA de 8 bits. O pipeline aplicava novamente os estilos SLD monobanda `ndvi_ramp`, `ndfi_ramp` e `savi_ramp`. O renderizador recusava essa combinação com `Source and Destination image must have the same Bands`.

Além disso, arquivo, coveragestore e grupos eram criados antes da validação do `GetMap`. Uma falha nessa etapa deixava artefatos órfãos no WMS e no HD.

## Correção

- As cinco composições de cena completa (NDVI, NDFI, SAVI, RGB e SWIR) usam o estilo neutro `raster`; as cores dos índices permanecem incorporadas pelos arquivos CLR durante o processamento.
- A validação redundante de `GetMap` foi removida; a publicação base continua validando a camada uma vez.
- O processamento agora registra cada artefato copiado e, se qualquer composição falhar, desfaz em ordem segura o índice, o TIFF, o `.ovr`, a camada, o coveragestore e somente os grupos NDVI que ficarem vazios.
- A biblioteca `RASTER` e seus produtos CBERS, Landsat e SPOT são preservados.

## Evidência esperada

Uma publicação válida deve aparecer no `GetCapabilities` e responder `GetMap` com `image/png`. Uma publicação inválida deve falhar o job sem deixar camada ou arquivo parcial.
