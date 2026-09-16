# Recorte SIMCAR — WFS oficial e falha fechada

Data: 2026-09-16

## Regra de produção

O modo **Recorte Automático SIMCAR** usa exclusivamente o WFS oficial da
SEMA-MT (`https://geo.sema.mt.gov.br/geoserver/ows`) como fonte das camadas
vetoriais ambientais.

- O limite enviado pelo usuário continua sendo usado para o recorte geométrico
  fino no backend.
- `AIR` e `ATP` continuam sendo cópias diretas do limite do imóvel, conforme o
  contrato do modelo.
- As demais camadas são descobertas por `GetCapabilities` e consultadas por
  `GetFeature` no WFS da SEMA-MT.
- Não existe fallback para WMS, raster, GeoServer local ou cópia mensal da base.

## Comportamento quando o WFS falha

Cada novo recorte força uma leitura atual de `GetCapabilities`. Se o WFS estiver
fora, devolver erro, resposta inválida ou dados truncados, o job é cancelado e a
interface mostra o motivo. Nenhum ZIP parcial é gerado.

Uma resposta vazia válida para uma camada continua significando que não há
feição daquela camada intersectando o imóvel. Isso é diferente de indisponibilidade
ou truncamento, que agora encerram o job.

## Proteções contra regressão

- `backend/simcar/sema-wfs-source.ts` centraliza a política de fonte obrigatória.
- `getCapabilitiesCached(true)` impede que cache antigo mascare uma queda atual.
- `fetchCompleteSemaWfsLayer` rejeita erro de rede, resposta inválida e
  `partial=true`.
- `backend/simcar/sema-wfs-source.test.ts` cobre disponibilidade, ausência de
  fallback, rejeição de resposta parcial e resposta completa.

## Verificação operacional

Antes de publicar, validar uma área conhecida no WFS com `AVN`,
`AREA_CONSOLIDADA` e ao menos uma camada hidrográfica. Depois do deploy, conferir
backend, Firebase Hosting, bundle público e um `GetFeature` real da SEMA-MT.
