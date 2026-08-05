# Croqui — fim da rota sempre dentro do ATP (na sede quando houver) (2026-08-05)

## Problema

O croqui de acesso terminava **na divisa do imóvel** (na porteira): a última
coordenada e o último pushpin ficavam exatamente no ponto onde a rota cruza a
cerca. Nos croquis modelo (feitos à mão no Google Earth, ex. `chacara_02`),
o caminho termina **dentro** da propriedade, na sede.

## Correção

A última coordenada agora fica **sempre dentro do polígono da ATP** — na
**sede da propriedade** quando o shapefile trouxer o ponto, senão num ponto
interior (centroide, com fallback na superfície do polígono):

**`backend/croqui/routing.ts`**

- `interiorDestination(polygon, prefer?)` — escolhe o destino final: a sede
  quando o ponto informado cai dentro do polígono (≥ 1 m de qualquer divisa),
  senão o centroide (quando dentro), último recurso `pointOnFeature`.
- `extendRouteToInsidePoint(route, polygon, destination)` — completa o caminho
  da porteira até o destino interior em linha reta (o padrão dos croquis
  manuais). Idempotente: rota que já termina dentro volta intacta.
- `ensureRouteEndsInsidePolygon(route, polygon, destination?)` — garante o fim
  interior em qualquer ponto do fluxo: primeiro alcança a divisa (corte ou
  extensão existentes), depois leva até o destino interior.
- `CroquiRoute.destinationLabel` — "sede da propriedade" quando a rota termina
  na sede; entra no roteiro.

**`backend/croqui/sede.ts`** (novo)

- `readPointShapefile` — lê coordenadas de `.shp` de pontos (Point/PointZ/
  PointM e MultiPoint; polígonos e linhas são ignorados).
- `findSedePoint(zipBuffer, atpGeometry)` — procura no ZIP da ATP um layer de
  pontos; o primeiro ponto que cai dentro do polígono é a sede. Respeita o
  `.prj` do ZIP (reprojeção UTM → geográfica, como o parse do ATP).

**`backend/croqui/route-options.ts`**

- `discoverRouteOptions` ganhou `destination` (ponto da sede) e aplica a
  extensão interior **antes** de medir e rotular — o mapinha de escolha, o PDF
  e o KML mostram o mesmo traçado, com o total já contando o trecho até a sede.

**`backend/croqui.ts`**

- `/api/croqui/route-options` e o job (`runCroquiJob`) detectam a sede no ZIP
  (`findSedePoint`) e repassam para as opções e para a geração.
- `routeToBoundary` e `generateCroquiArtifacts` aplicam `ensureRouteEndsInsidePolygon`
  (idempotente — rotas guardadas não são alteradas, só rotuladas quando faltar).

**`backend/croqui/narrative.ts`**

- O fecho do roteiro vira `"...onde se encontra a sede da propriedade."`
  quando a rota termina na sede; continua `"...onde se encontra a propriedade."`
  nos demais casos.

## Testes

- `routing.test.ts` — termina na sede (coordenada + rótulo + waypoint arrive),
  cai no centroide sem sede, ignora sede fora do polígono, não altera rota que
  já termina dentro (idempotência), `interiorDestination` prefere sede→centroide.
- `sede.test.ts` (novo) — leitura de Point/MultiPoint, ignora polígono,
  encontra a sede dentro do ATP, devolve `null` com ponto fora ou sem layer de
  pontos, reprojeção UTM 22S via `.prj` (ida e volta com proj4).
- `narrative.test.ts` — fecho com "sede da propriedade".
- Suíte completa: 503 testes passando; `pnpm run check` (tsc) e `pnpm run build` limpos.

## Notas

- A sede é detectada **somente a partir do ZIP da ATP** (layer de pontos).
  Sem layer de pontos, o comportamento cai para o ponto interior (centroide).
- A mudança é backend-only: o mapinha do front já desenha as coordenadas que o
  backend devolve, então o traçado estendido aparece igual no mapa e no PDF.
