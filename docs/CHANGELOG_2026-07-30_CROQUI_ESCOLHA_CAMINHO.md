# Croqui — escolha do caminho de acesso (2026-07-30)

## Motivo

No croqui da ATP do **Lote Rural nº 89-A, P.C. Querência III**, o traçado saía pelo caminho errado.
O sistema pegava sempre a rota mais curta do OSRM — que sobe pelo **oeste** (29,4 km) — enquanto o
acesso usado em campo desce de Querência, corta para leste e sobe pelo **corredor leste** (33,4 km).

Os dois chegam ao mesmo ponto de divisa, `(12°23'43.44"S, 52°8'54.79"O)` — o mesmo pin do print
conferido pelo técnico. Ou seja: não era erro de geometria nem de corte na divisa, era escolha de
corredor. E essa escolha não dá para automatizar: quem sabe por onde se entra na propriedade é quem
vai até lá.

## O que mudou

**O croqui agora pergunta.** Ao clicar em *Gerar croqui*, o sistema procura os caminhos de acesso
possíveis. Havendo mais de um, mostra o mapinha com os traçados sobre o contorno da ATP e para —
o usuário escolhe e só então o PDF, o Word e o KML são gerados com aquele traçado. Havendo um só,
segue direto, sem passo extra.

### Backend

| Arquivo | Mudança |
|---------|---------|
| `backend/croqui/route-options.ts` | **Novo.** Descoberta dos corredores: `alternatives` do OSRM + desvios forçados por ponto de passagem, limpeza do vai-e-volta, deduplicação por células de 400 m, poda de 3,5× e rótulo pelo lado do desvio |
| `backend/croqui/routing.ts` | `fetchDrivingRoutes` (vários pontos + alternativas), `fetchNearestOnRoad`, `flattenLegSteps` — o par `arrive`/`depart` que cada ponto de passagem cria some do roteiro |
| `backend/croqui.ts` | `POST /api/croqui/route-options`; `/process` aceita `routeOptionId`; `generateCroquiArtifacts` aceita uma rota pronta |
| `backend/local-storage.ts` | Área `croqui/routes` para o JSON dos caminhos |

O JSON com as rotas fica ao lado do upload: a geração usa **exatamente** o traçado que apareceu na
tela, sem recalcular.

### Front

| Arquivo | Mudança |
|---------|---------|
| `client/src/dashboard/croqui/RoutePicker.tsx` | **Novo.** Mapinha SVG com os traçados coloridos sobre a ATP + cartões de escolha |
| `client/src/dashboard/croqui/routePreview.ts` | **Novo.** Projeção Web Mercator do mapinha, sem biblioteca de mapa |
| `client/src/dashboard/hooks/useCroquiJobs.ts` | `loadCroquiRouteOptions`, estado da escolha, `routeOptionId` no `/process` |
| `client/src/dashboard/panels/CroquiPanel.tsx` | Passo de escolha, *Recalcular caminhos*, rótulo do botão conforme o estado |
| `client/src/pages/Dashboard.tsx` | Card do histórico mostra o caminho usado |

## Correções de passagem

- **`npm test` não rodava o backend.** `vite.config.ts` tem `root: client`, então `vitest run` só
  enxergava os testes do front — 37 de 293. `vitest.workspace.ts` junta os dois projetos.
  Com a suíte rodando de verdade, apareceu um teste desatualizado
  (`dashboard-history-cards.test.ts` ainda exigia `processarHistory`, removido em 2026-07-21);
  a lista agora acompanha as abas de hoje.
- **Mapinha achatado ~57× na vertical.** A projeção usava grau em `x` e radiano de Mercator em `y`.
  Pego pelo teste de proporção antes de ir para a tela.

## Conferência

```
município: Querência — 3 caminhos
  rota-1: Caminho principal — 29,4 km        (oeste — o que saía antes)
  rota-2: Caminho pelo sudeste — 33,4 km     (o correto, conferido no print)
  rota-3: Caminho pelo sudeste (2) — 33,7 km
```

Roteiro gerado pela rota-2, terminando no ponto do print:

> Inicia-se o croqui na rotatória entre a Av. Norte e a MT-109, no ponto (12°35'24.07"S,
> 52°13'10.61"O). Siga em frente por 1,12 km … Vire à direita e siga em frente pela Avenida Sul por
> 7,94 km … Na bifurcação, siga em frente por 9,32 km até o ponto (12°23'43.44"S, 52°8'54.79"O).
> O destino estará à direita.

- `npm test` — 293 passando, 4 pulados.
- `npx tsc --noEmit` — limpo.
- PDF, DOCX e KML gerados de ponta a ponta com a rota escolhida serializada em JSON (o mesmo
  caminho que os dados fazem em produção).

## Deploy

```bash
npm run build
npx firebase deploy --only hosting:ia-florestal --project ia-florestal --non-interactive
```

`version.json` sai com `buildId` novo e `Cache-Control: no-cache`; `setupAutoUpdate` recarrega as
abas abertas sozinho — **sem Ctrl+F5**.

Backend no PC servidor: `git pull`, rebuild com esbuild e
`systemctl --user restart geoforest-backend.service` (ver `docs/OPS_SERVIDOR_GEOFORREST.md`).

## Ajustes finos

```env
CROQUI_MAX_ROUTE_OPTIONS=4            # caminhos oferecidos
CROQUI_ROUTE_OPTIONS_BUDGET_MS=70000  # teto da busca
```

Um OSRM próprio com `alternatives` habilitado deixaria a descoberta quase instantânea — hoje as
alternativas nativas do servidor público não vêm, e os corredores precisam ser procurados por
ponto de passagem (~15–40 s).
