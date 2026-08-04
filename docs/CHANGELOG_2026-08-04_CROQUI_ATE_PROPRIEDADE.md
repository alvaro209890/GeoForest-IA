# Croqui — completar caminho até a propriedade (2026-08-04)

## Problema

No croqui **Estância MDM** (conta `alvarocanaisgames@gmail.com`, job
`3116742c-c7a3-4c99-b714-e00751090a9a`, ATP em
`croqui/input/9b12827e-…_ATP.zip`, Ribeirão Cascalheira) o job concluía 100%,
mas o traçado parava **~1,9 km antes da divisa**.

Causa: no rural de MT a rede OSM muitas vezes **não tem via até a porteira**.
O OSRM encaixa o destino na estrada asfaltada mais próxima e devolve uma rota
que **nunca entra** no polígono da ATP. `trimRouteAtPolygon` só corta quando há
cruzamento com a divisa — sem cruzamento, o croqui ficava curto.

O shapefile ATP em si estava correto (1 polígono SIRGAS 2000); o bug era do
roteamento, não do SHP.

## Correção

Novas funções em `backend/croqui/routing.ts`:

| Função | Papel |
|--------|--------|
| `extendRouteToPolygon` | Se o fim da rota está a mais de `CROQUI_REACH_TOLERANCE_M` (padrão 80 m) da divisa, acrescenta trecho em linha reta até o ponto da divisa mais próximo (porteira). |
| `ensureRouteReachesPolygon` | Corta na divisa se a rota entra no imóvel; senão chama `extendRouteToPolygon`. |

Usadas em:

- `routeToProperty` (`route-options.ts`) — escolha de caminhos e geração
- alternativas nativas do OSRM
- `routeToBoundary` (`croqui.ts`) — fallback sem opção escolhida

Comportamento alinhado aos croquis manuais do Google Earth: via mapeada até
onde a rede alcança, depois acesso rural até a porteira.

## Evidência (Estância MDM)

| | Antes | Depois |
|--|-------|--------|
| Fim da rota | `-51.80353, -13.010433` | `-51.81606, -13.02182` (divisa norte) |
| Gap até a ATP | ~1.856 m | 0 m |
| Distância total | 9,7 km | ~11,6 km |

## Testes

`backend/croqui/routing.test.ts` — casos novos:

- completa o caminho quando o OSRM para longe (cenário Estância MDM)
- não inventa trecho se o fim já está na divisa

```bash
pnpm exec vitest run backend/croqui/routing.test.ts
```

## Config

| Variável | Default | Uso |
|----------|---------|-----|
| `CROQUI_REACH_TOLERANCE_M` | `80` | Abaixo disso não estende (já está na porteira). |

## ATP de referência

Cópia do upload que falhou (para regressão local):

`users/Ed9LQ47ZvfPFV5x6TnUDQ10rWTI2/croqui/input/9b12827e-8a44-402a-91e9-d92ac85f3e6b_ATP.zip`
