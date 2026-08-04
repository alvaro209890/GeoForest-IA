# Croqui — mapa de satélite navegável para escolher o ponto de partida (2026-08-04)

## Pedido

Depois do fix da imagem de satélite ausente, o Álvaro pediu para poder
**navegar livremente pelo mapa no navegador** para escolher o ponto de
partida do croqui — o preview anterior (imagem estática do Esri Static
Export, enquadrada pelo backend) só deixava clicar dentro do quadro que já
tinha sido calculado; não dava pra arrastar/dar zoom pra fora dele.

## O que mudou

**Nova dependência:** `leaflet@1.9.4` + `react-leaflet@5.0.0` (compatível com
React 19 já usado no projeto) + `@types/leaflet` como devDependency.

**Novo componente** `client/src/dashboard/croqui/StartPointMap.tsx`:

- Mapa Leaflet com tiles de satélite Esri World_Imagery carregados **direto
  do navegador** (`server.arcgisonline.com/.../MapServer/tile/{z}/{y}/{x}`),
  o mesmo provedor que já era usado no fallback do backend — pan/zoom livres,
  sem depender de mais nenhuma chamada ao backend só pra navegar.
- Desenha o polígono do ATP e as polylines de cada caminho encontrado
  (mesma paleta de cores de antes).
- Pino de partida arrastável (`Marker draggable`) — soltar em outro lugar
  chama `onMoveStart` e recalcula os caminhos a partir dali.
- Clique em qualquer ponto vazio do mapa também move a partida pra lá
  (`useMapEvents` + `stopPropagation` no clique da rota, pra não competir
  com a seleção de caminho).
- `FitToData`: reenquadra o mapa (bounds do ATP + rotas + partida) toda vez
  que uma nova resposta de `route-options` chega — inicial ou depois de um
  recálculo.

**`RoutePicker.tsx`** trocou a projeção SVG estática pelo `StartPointMap`;
ficou bem mais simples (175 → poucas linhas), sem lógica de projeção própria.

**Backend (`backend/croqui.ts`, endpoint `/api/croqui/route-options`)** —
removido o bloco que buscava uma imagem de satélite em base64
(`resolveMapFrame` + `fetchBasemapImage`) só para o mapinha do navegador:
como os tiles agora vêm direto do Esri para o cliente, essa chamada extra ao
provedor (mais lenta + payload JSON maior) ficou só desperdício. A resposta
do endpoint perdeu os campos `basemap`/`basemapError`; `hasBasemapImage`/
`basemapProvider` do **job final** (PDF) continuam intactos — aquele
pipeline não mudou, só o preview do navegador.

**Limpeza:** `routePreview.ts` perdeu as funções de projeção Web Mercator
própria (`buildProjection`, `buildProjectionFromFrame`, `unproject`,
`toPolylinePoints`, `boundsOf`) — ficaram órfãs depois da troca pro Leaflet.
Sobrou só `routeColor`/`formatKm`/`ROUTE_COLORS`, ainda usados pela lista de
opções. O botão "Mudar ponto de partida" (modo explícito) também saiu —
arrastar o pino ou clicar no mapa já é a ação explícita, sem precisar de
toggle antes.

## Por que não quebra nada

Leaflet só distingue clique de arrastar-pra-navegar pela tolerância de
movimento do próprio gesto — dar pan no mapa (mousedown+arrasta+solta) não
dispara `click`, só um clique de verdade dispara. Não tem risco de mover o
pino sem querer só de navegar pelo mapa.

## Testes

- `client/src/dashboard/croqui/routePreview.test.ts`: reduzido às 2 funções
  que sobraram (cor por rota, formatação de km) — 2/2 verdes.
- Suíte croqui completa (backend+client): **59/59 verdes**.
- `tsc --noEmit`: limpo.
- `vite build` + `esbuild backend/index.ts`: build de produção ok; CSS do
  Leaflet foi corretamente para o chunk lazy do `CroquiPanel`
  (`CroquiPanel-*.css`, ~15,6 kB), não inflou o bundle principal.

```bash
pnpm exec vitest run --project backend backend/croqui --project client client/src/dashboard/croqui
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run build
```

## Nota

Instalar dependências novas (`pnpm add`) nesta máquina ficou bem mais lento
que o normal por causa da carga de CPU concorrente (~4-5 min pra resolver a
árvore inteira) — não é sinal de problema, só paciência.
