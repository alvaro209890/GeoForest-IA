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
- O recorte geométrico usa tolerância de snap zero: as coordenadas entregues
  pelo WFS não são expandidas artificialmente até a divisa do imóvel.

## Correção de fidelidade geométrica — 2026-09-17

O recorte ainda aplicava, depois da consulta oficial, um snap de 1,5 m entre os
polígonos temáticos e a divisa do imóvel. A intenção histórica era fechar frestas
entre SIGEF e SEMA, mas a operação alterava a topologia oficial: em imóveis com
rio encostado à divisa, AVN e Área Consolidada podiam ser estendidas para dentro
da hidrografia.

No `2.zip` usado para reproduzir o problema, o snap elevava a sobreposição entre
`RIO_10_A_50` e `AVN` de aproximadamente 0,10 m² (ruído numérico) para cerca de
274 m². O fluxo automático passou a usar tolerância zero para todas as camadas.
O utilitário de snap foi mantido apenas para usos explícitos e isolados; não faz
mais parte do recorte entregue ao usuário.

## Prioridade topológica da hidrografia — 2026-09-17

Mesmo sem o snap, a própria base WFS pode conter microinterseções entre classes
temáticas. Para o pacote entregue não reproduzir essas sobreposições, o pipeline
agora processa as classes `RIO_*` antes das demais camadas:

1. classes de rio posteriores perdem a área já ocupada por uma classe de rio
   anterior, seguindo a ordem canônica do modelo;
2. a união final dos rios é removida de todas as outras camadas poligonais;
3. `AIR` e `ATP` são exceções intencionais, pois representam o limite do imóvel
   e precisam conter as feições internas;
4. camadas de ponto, como `NASCENTE`, não possuem sobreposição de área;
5. qualquer falha na união ou diferença geométrica cancela o job, sem ZIP.

O recorte integral da fazenda do `2.zip` processou as 28 camadas, com 24 classes
encontradas no WFS, 676 feições no resultado e nenhuma resposta parcial. A QA
planar em SIRGAS 2000 / UTM 22S confirmou zero sobreposição de área dos rios com
`AVN`, `AREA_CONSOLIDADA`, `AUAS`, `ARL`, `AREA_UMIDA`, `LAGOA_NATURAL`,
`RESERVATORIO_ARTIFICIAL`, `UTILIDADE_PUBLICA` e entre as próprias classes de
rio (resíduo máximo numérico inferior a 0,01 m²).

## Verificação operacional

Antes de publicar, validar uma área conhecida no WFS com `AVN`,
`AREA_CONSOLIDADA` e ao menos uma camada hidrográfica. Depois do deploy, conferir
backend, Firebase Hosting, bundle público e um `GetFeature` real da SEMA-MT.
