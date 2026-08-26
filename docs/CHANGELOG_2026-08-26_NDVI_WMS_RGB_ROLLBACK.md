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
- Como o GeoServer rejeita `PUT` de um grupo vazio, o rollback calcula o esvaziamento sem persistir esse estado inválido, desprende primeiro a cadeia dos grupos pais e só então exclui os grupos vazios.
- A biblioteca `RASTER` e seus produtos CBERS, Landsat e SPOT são preservados.

## Evidência esperada

Uma publicação válida deve aparecer no `GetCapabilities` e responder `GetMap` com `image/png`. Uma publicação inválida deve falhar o job sem deixar camada ou arquivo parcial.

## Segunda falha: montagem RGB/SWIR

O job `f396e691-7f3e-41f3-8ef9-d3e84fd0e57a` confirmou que NDVI, NDFI e SAVI já publicavam corretamente com `raster`, mas caiu ao iniciar RGB. O `gdal_merge.py` não recebia `-separate` e produzia uma imagem de uma banda por sobreposição espacial; em seguida o `gdal_translate` recusava `-scale_2` e `-scale_3` com `-scale_XX has been specified with XX greater than the number of output bands`.

A montagem de RGB e SWIR agora usa `gdal_merge.py -separate`, criando exatamente três bandas antes do realce para Byte. Um teste de regressão exige a flag e a ordem RED/GREEN/BLUE.
