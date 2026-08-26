# NDVI — recuperação de job interrompido e zeragem do acervo/WMS

Data: 26/08/2026

## Incidente

O job `87a6f2c3-fe1e-4626-a487-efcf6e88dab1`, enviado em 25/08/2026 às
17:28:25 para a cena `LE07_L2SP_224069_20080930_02_T1`, permaneceu visível em
15% até o dia seguinte.

O job não estava mais executando. Os artefatos temporários mostraram que a banda
NIR terminou e a RED estava sendo materializada. O journal do serviço registrou
o reinício do backend pelo auto-deploy às 17:31:59, durante essa etapa.

O mecanismo de boot já marcava o registro genérico em `processing_jobs` como
`failed`, com a mensagem "Processamento interrompido pelo reinicio do servidor".
Porém, ele só propagava essa interrupção para coleções específicas antigas, como
CBERS, e não para `ndvi_scene_jobs`. O painel consulta `ndvi_scene_jobs`; por isso
continuou exibindo o último progresso persistido, embora não existisse processo
GDAL ativo.

## Correção

`markPersistedRunningJobsInterrupted()` agora também:

- converte jobs ativos de `ndvi_scene_jobs` para `failed/interrupted` no boot;
- converte cada cena NDVI não terminal para `failed/interrupted`;
- preserva jobs e cenas que já estejam em estado terminal;
- recupera também registros NDVI órfãos quando o registro genérico não existe.

O teste de recuperação de jobs cobre a regressão: um NDVI em 15% é encerrado
corretamente e um NDVI concluído permanece intocado.

## Zeragem solicitada do NDVI

Antes da limpeza foram inventariados 8 coveragestores/camadas NDVI no workspace
`cbers`, 6 grupos da hierarquia NDVI e 8 GeoTIFFs sob
`/media/server/HD Backup/RASTER/NDVI`.

A limpeza operacional remove:

- a referência `cbers:NDVI` do grupo `cbers:RASTER`, sem alterar CBERS, LANDSAT
  ou SPOT;
- todos os grupos `NDVI` / `ndvi_orbit_*`;
- todos os coveragestores/camadas cujo nome começa com `ndvi_`;
- os GeoTIFFs e temporários NDVI;
- os índices `ndvi_archive` e `ndvi_scene_archive`;
- o histórico da aba (`ndvi_scene_jobs`) e os registros genéricos correspondentes.

As definições de estilo permanecem versionadas no GeoForest. O `ndvi_ramp` continua
instalado no GeoServer; `ndfi_ramp` e `savi_ramp` serão criados de forma idempotente
quando a primeira publicação nova exigir cada um deles. Estilos não são imagens.

## Aceitação

- teste de regressão de recuperação: verde;
- `pnpm check`: verde;
- suíte completa e build: verificados antes do push;
- produção: API, frontend, GetCapabilities e inventários de disco/índice
  verificados após o deploy e a limpeza.
