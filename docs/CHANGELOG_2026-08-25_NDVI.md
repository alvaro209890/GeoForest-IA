# 2026-08-25 — NDVI pós-recorte

## Entrega

O NDVI entrou como quarto card da análise pós-recorte, independente das três análises
visuais. Ele só roda por clique e não participa do fluxo automático do importador.

- fonte: Landsat Collection 2 Level-2 Surface Reflectance;
- cálculo Float32 com escala e offset antes da razão;
- máscara `QA_PIXEL` para fill, nuvem dilatada, nuvem, sombra, neve e cirrus em L8/L9;
- recorte remoto das bandas por `/vsicurl/`, sem baixar a cena inteira;
- publicação de Float32 + RGB numa biblioteca `RASTER → NDVI` do GeoServer;
- estatística por feição de `AREA_CONSOLIDADA`, `AVN`, `AUAS` e `ARL`;
- laudo Word próprio, com cena, metadados, estatísticas e limitações;
- quarto card com ano, progresso, cancelamento, NDVI médio + pixels válidos, Word e WMS.

## Correções feitas durante a revisão

1. O percentual válido zonal passou a usar como denominador os pixels esperados dentro
   da geometria. O nodata do retângulo fora de um polígono irregular não é mais contado
   como nuvem.
2. O SSE guarda o último evento e o entrega ao cliente que se conecta depois; um job
   rápido não deixa mais o frontend esperando indefinidamente.
3. O índice do acervo NDVI é filtrado pelo `uid` autenticado.
4. O `ndviJobId` é persistido para permitir reconexão do card após recarregar a página.
5. Artefatos locais de coordenação (`.codex-tmp` e `.commandcode`) foram retirados do
   versionamento e adicionados ao `.gitignore`.

## Validação local

- `pnpm test`: 973 testes passaram; 8 testes live ficaram ignorados por configuração;
- `pnpm check`: sem erros TypeScript;
- `pnpm build`: frontend Vite e backend esbuild concluídos;
- testes NDVI: matemática, QA, nomes, cena, SLD, laudo DOCX e cobertura zonal;
- testes de regressão: importação vetorizada não interpreta endpoints dos cards como
  etapas do cabeçalho.

## Limites da evidência

Build e testes locais não provam publicação GeoServer nem uma execução completa sobre
um CAR real. A primeira execução live deve validar criação do grupo `NDVI`, `GetMap`,
estatísticas no raster real e o DOCX resultante.
