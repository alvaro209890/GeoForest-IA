# Croqui — imagem de satélite quebrada + ponto de partida editável (2026-08-04)

## Problema

Croqui **Legom** (conta do Álvaro, Confresa/MT, job
`4af95378-f2c9-4f81-b75c-ffdcdef1894b`, upload
`3709c2d9-a22d-4f42-a409-40691fd7fc9b_Legom_Confresa.zip`) saiu com status
`completed` e roteiro correto, mas **sem imagem de satélite** — mapa com fundo
cinza neutro. ZIP final: **14.413 bytes** (PDF de 24 KB).

## Causa raiz

`GOOGLE_STATIC_MAPS_KEY` nunca foi configurada em `~/.config/geoforest/backend.env`,
então todo croqui cai no fallback Esri World Imagery
(`backend/croqui/basemap.ts`). `buildEsriExportUrl` pedia sempre
`4096×2871 px` (11,8 Mpx) — o `export` público do
`World_Imagery/MapServer` da Esri **rejeita pedidos grandes com HTTP 500
"Error: bytes"** acima de um orçamento de pixels não documentado.

Medido ao vivo contra o serviço público:

| Tamanho pedido | Pixels | Resultado |
|---|---|---|
| 2048×1436 | 2,9 Mpx | HTTP 200 |
| 2400×1683 | 4,0 Mpx | HTTP 200 |
| 2600×1823 | 4,7 Mpx | **HTTP 500** |
| 4096×2871 (constante antiga) | 11,8 Mpx | **HTTP 500** |

A falha era **totalmente silenciosa**: `fetchImage` engolia qualquer erro e
devolvia `null`, sem log nenhum — nem no PDF final, nem no mapinha de
satélite do `RoutePicker` no navegador (mesmo pipeline, mesmo bug). Como
nenhum croqui gerado sem `GOOGLE_STATIC_MAPS_KEY` tinha chance de passar
nesse orçamento, o problema não era exclusivo do Legom — afetava
sistemicamente todo croqui gerado só com o fallback Esri.

## Correção

**`backend/croqui/basemap.ts`**

- `buildEsriExportUrl` agora calcula largura/altura a partir de um orçamento
  de **3.000.000 px totais** (`ESRI_MAX_TOTAL_PX`), bem abaixo da fronteira
  medida (~4,0–4,7 Mpx), preservando o aspect ratio da área de mapa. Ainda
  sai bem mais nítido que os 640 px do preview do Google.
- `fetchImage` loga (`console.warn`/`console.error`) status HTTP, corpo da
  resposta e exceções — qualquer falha futura de provedor fica visível nos
  logs do `geoforest-backend.service`, em vez de silenciosa.

**`backend/croqui/render-pdf.ts` → `backend/croqui.ts`**

- `buildCroquiPdfBuffer` agora devolve `{ buffer, hasBasemapImage,
  basemapProvider }` em vez de só o `Buffer`.
- `generateCroquiArtifacts` repassa esses campos; `runCroquiJob` grava
  `hasBasemapImage`/`basemapProvider` no job e ajusta a mensagem final
  (`"...mas sem imagem de satélite — provedor indisponível no momento."`)
  quando algum provedor falhar mesmo depois do fix (ex.: instabilidade de
  rede pontual) — o usuário não fica mais sem saber.

**Frontend** (`CroquiPanel.tsx`, `RoutePicker.tsx`, `useCroquiJobs.ts`,
`routePreview.ts`, `mapDoc.ts`, `types.ts`)

- Banner de aviso quando o último croqui gerado saiu sem imagem
  (`hasBasemapImage === false`), com sugestão de recalcular.
- `basemapError` do backend vira `toast.warning` na hora de calcular rotas.

## Nova feature: mudar o ponto de partida do croqui

Pedido do Álvaro: poder mudar de onde o croqui começa e mandar recalcular os
caminhos a partir dali, vendo a imagem de satélite no navegador antes de
gerar.

- **Backend** — `POST /api/croqui/route-options` aceita `startLon`/`startLat`
  opcionais. `buildCroquiRouteOptions` usa esse ponto no lugar do landmark
  curado/sede do IBGE quando informado; a resposta traz `start`,
  `startLabel` (`"ponto escolhido no mapa"`, `"sede de Confresa"`, etc.) e
  `startSource`. Sem override, comportamento idêntico ao anterior.
- **Frontend** — botão **"Mudar ponto de partida"** no `CroquiPanel`; com o
  modo ativo, um clique sobre a imagem de satélite no `RoutePicker` converte
  o clique em lon/lat (`unproject`, inversa da projeção Web Mercator já usada
  para desenhar o traçado) e dispara `recalculateCroquiFromPoint`, que chama
  `route-options` de novo com o novo ponto. O pino de partida fica destacado
  (amarelo, círculo tracejado) nesse modo.
- `routePreview.ts`: as duas projeções (`buildProjection` por bounds e
  `buildProjectionFromFrame` alinhada ao basemap) agora expõem `unproject`
  além de `project`, com round-trip testado.
- Mapinha de escolha de rota (`RoutePicker`) passa a aparecer mesmo com um
  único caminho encontrado (antes só aparecia com 2+ opções) — é o que deixa
  a imagem de satélite visível no navegador antes de gerar, no caso comum.

## Evidência (Legom, regenerado localmente com o código corrigido)

```
hasBasemapImage: true
basemapProvider: esri
municipioNome: Confresa
Legom.pdf: 1.043.320 bytes   (antes: 24.337 bytes)
Legom.docx: 8.881 bytes
Legom.kml: 6.895 bytes
```

PDF renderizado (`pdftoppm`) conferido visualmente: imagem de satélite Esri
World Imagery cobrindo o mapa inteiro, traçado laranja, 6 pinos com DMS,
legenda, seta norte, barra de escala e roteiro no padrão fixo
("O presente croqui se inicia na cidade Confresa no ponto...").

## Testes

- `backend/croqui/basemap.test.ts` — 2 casos novos: orçamento de pixels do
  Esri fica ≤ 4.000.000 px e ≤ 4096 px por eixo, para os dois formatos reais
  (página do PDF 826×579 pt e mapinha do `RoutePicker` 560×420 pt).
- `backend/croqui/render-pdf.test.ts` — valida `hasBasemapImage`/
  `basemapProvider` no retorno.
- `client/src/dashboard/croqui/routePreview.test.ts` — 2 casos novos:
  round-trip `project → unproject` nas duas projeções.
- Suíte completa do módulo croqui (backend + client): **68/68 verdes**.
- Suíte completa do backend: **330 passando** (24 skipped, live/rede) — as 3
  falhas que apareceram rodando os ~50 arquivos juntos eram *hook timeout*
  por concorrência de CPU da máquina (não relacionadas a este fix);
  isoladas, os mesmos 3 arquivos passam 16/16.
- `tsc --noEmit` (client + backend juntos): limpo.
- `vite build` + `esbuild backend/index.ts`: build de produção ok.

```bash
pnpm exec vitest run --project backend backend/croqui
pnpm exec vitest run --project client client/src/dashboard/croqui
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run build
```

## Nota de ambiente

`vitest`/`tsc` **travam indefinidamente sob Node 22** (padrão do `PATH`
neste PC) sem nenhuma saída — nem o banner inicial. Rodar sempre com o Node
20 do nvm (o mesmo que `geoforest-backend.service` usa):

```bash
export PATH="/home/server/.nvm/versions/node/v20.20.0/bin:$PATH"
```

## Pendência opcional

Configurar `GOOGLE_STATIC_MAPS_KEY` em `~/.config/geoforest/backend.env`
continua valendo a pena: o Google Static Maps traz rótulo de cidade e escudo
de rodovia nativos (os croquis modelo usam essa base). O fallback Esri
agora funciona de verdade, mas sem esses rótulos — o código já desenha
rótulo próprio de cidade/rodovia nesse caso (`drawContextLabels`).
