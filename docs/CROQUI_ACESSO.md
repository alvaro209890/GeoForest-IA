# Croqui de acesso (ATP → PDF + Word + KML)

Gera automaticamente o croqui de acesso de um imóvel a partir do shapefile ATP, no padrão dos
croquis aprovados que estão em `Croquis/`. Aba **Croqui** do dashboard (`/dashboard/croqui`).

- [Os modelos](#os-modelos)
- [Fluxo](#fluxo)
- [Uso no dashboard](#uso-no-dashboard)
- [Ponto de partida](#ponto-de-partida)
- [Escolha do caminho](#escolha-do-caminho)
- [Roteiro](#roteiro)
- [Base do mapa](#base-do-mapa)
- [Layout do PDF](#layout-do-pdf)
- [KML e DOCX](#kml-e-docx)
- [API](#api)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Arquivos](#arquivos)
- [Testes e conferência visual](#testes-e-conferência-visual)
- [Regenerar as sedes municipais](#regenerar-as-sedes-municipais)
- [Armadilhas](#armadilhas)

---

## Os modelos

`Croquis/` guarda os croquis aprovados que servem de especificação. Eles foram feitos à mão no
Google Earth Pro; o gerador reproduz esse padrão.

| Modelo | Arquivos |
|--------|----------|
| Chacará 02 | `chacara_02.pdf`, `chacara_02.kml`, `Chacara_02.docx` |
| Fazenda Irmãos Sebald – Lote 121B | `Fazenda Irmaos Sebald-lote 121B.pdf`, `..._kml.kml`, `Fazenda_Irmãos Sebald_lote 121 B.docx` |
| Chácara Lotes 41 e 42 | `Croqui_Chacara_Lotes_41 e 42..docx.pdf`, `.kml`, `.docx` |

`Croquis/ATP/Aruana_l_MAT_4242.*` é a ATP de teste (Fazenda Aruanã I, 7.442,14 ha,
Ribeirão Cascalheira, SIRGAS 2000 / UTM 22S) usada para validar o gerador ponta a ponta.

O que foi medido nos modelos e virou especificação:

- Página **A4 paisagem, 842×595 pt**, mapa ocupando a página inteira com margem de ~8 pt.
- Caixa branca no topo-esquerdo com **título em negrito (~15 pt)** e o roteiro (~9 pt).
- Caixa **"Legenda"** no topo-direito, com "Caminho" e "Coordenadas" (presente em 2 dos 3 modelos).
- Polígono do imóvel em **vermelho** sem preenchimento; caminho em **laranja**.
- Pushpins amarelos com o **DMS escrito ao lado** de cada ponto.
  O PDF usa o ícone oficial `ylw-pushpin.png` do Google Earth (o mesmo URL do KML),
  ancorado na ponta da agulha — não um círculo vetorial inventado.
- Seta N e barra de escala no canto inferior direito; atribuição da imagem no inferior-esquerdo.
- No roteiro, a distância de cada trecho vem seguida do DMS do **ponto de chegada** daquele trecho.

## Fluxo

1. **Parse do ATP** — `parseUserShapefile` reprojeta SIRGAS 2000, SAD69 e Córrego Alegre.
2. **Município** — malha IBGE local, com fallback no WFS da SEMA.
3. **Ponto de partida** — landmark curado → sede do município → centroide da malha.
4. **Caminhos de acesso** — descobre os corredores viários distintos até o imóvel, cada um
   cortado onde cruza a divisa. Havendo mais de um, **o usuário escolhe**.
5. **Simplificação** — trechos na mesma via são fundidos e os curtos absorvidos.
6. **Artefatos** — PDF, DOCX e KML, empacotados num ZIP.

O job roda de forma assíncrona com progresso por SSE e histórico em `users/{uid}/croqui_jobs`.

## Uso no dashboard

Aba **Croqui** (`/dashboard/croqui`):

1. Informe **título** e **nome da propriedade**.
2. Envie o shapefile ATP em `.zip` — **arraste o arquivo para a área tracejada** ou clique em
   **Selecionar ZIP**. Só `.zip` é aceito (extensão ou `application/zip`).
3. Clique em **Gerar croqui**. O sistema procura os caminhos de acesso (alguns segundos):
   - **um caminho só** → segue direto para a geração;
   - **mais de um** → mostra o mapinha com os traçados e para. Escolha o caminho certo e clique
     em **Gerar croqui com este caminho**. **Recalcular caminhos** refaz a busca.
4. Baixe o ZIP com PDF, DOCX e KML.

Durante o upload/processamento a área de drop fica desabilitada. Soltar um arquivo que não seja ZIP
mostra erro e não troca a seleção atual. Trocar o ZIP descarta os caminhos já calculados.

## Ponto de partida

`resolveLandmark` consulta, nesta ordem:

1. **Landmark curado** (`LANDMARKS_BY_IBGE` em `backend/croqui/landmarks.ts`) — conferido à mão
   contra um croqui modelo. Hoje só Querência, com a rotatória da MT-109 com a Av. Norte.
2. **Sede do município** (`config/sedes-mt.json`) — 142 municípios, cada sede validada dentro do
   polígono da malha IBGE e encaixada na via mais próxima pelo OSRM (todas a ≤ 65 m de estrada).
3. **Centroide da malha** — último recurso; cai com frequência longe de qualquer estrada.

Use um landmark curado quando a sede não for o ponto de partida certo para aquele município.

## Escolha do caminho

**O caminho mais curto não é sempre o certo.** No Lote 89-A do P.C. Querência III o OSRM sobe pelo
oeste (29,4 km), mas o acesso que se usa em campo desce, corta para o leste e sobe pelo corredor
leste (33,4 km) — os dois chegam ao mesmo ponto de divisa `(12°23'43.44"S, 52°8'54.79"O)`.
Quem sabe qual é o certo é o técnico, então o croqui pergunta antes de gerar.

`backend/croqui/route-options.ts` descobre os corredores assim:

1. **Rota principal** — OSRM até o centroide, cortada na divisa (o comportamento antigo).
2. **Alternativas nativas** — `alternatives=3` no OSRM. O servidor público quase sempre devolve
   uma rota só; quando há um OSRM próprio com o recurso ligado, elas entram de graça.
3. **Desvios forçados** — pontos de passagem jogados perpendicularmente à rota principal
   (frações 0,3/0,5/0,7 do percurso × ±8 km e ±20 km), cada um encaixado na via mais próxima
   pelo `/nearest` (descarta encaixe > 6 km) e roteado como `partida → passagem → imóvel`.
4. **Limpeza do vai-e-volta** — o desvio forçado costuma produzir um trecho que sai e retorna pelo
   mesmo lugar. `stripOutAndBackSpurs` o remove (o trecho sai e volta ao mesmo nó, então o que
   sobra continua percorrível) e a rota é **refeita** mirando o ponto que identifica o corredor
   descoberto. Se ainda vier suja, o candidato é descartado.
5. **Deduplicação** — traçados são comparados por células de 400 m; ≥ 65 % de células em comum é a
   mesma rota e a mais longa cai fora.
6. **Poda e rótulo** — rota acima de 3,5× a mais curta é descartada; as demais são ordenadas por
   distância e nomeadas pelo lado do desvio (`Caminho pelo sudeste — 33,4 km`), com ordinal quando
   duas saem para o mesmo lado.

O teto é de 4 opções e ~70 s de busca (a requisição atravessa o túnel Cloudflare e não pode
estourar). As rotas ficam num JSON em `croqui/routes`, e a geração usa **exatamente** o traçado
que o usuário viu — recalcular arriscaria devolver outro.

No front, `RoutePicker.tsx` desenha os traçados sobre o contorno da ATP num SVG próprio
(`routePreview.ts`, Web Mercator em radianos nos dois eixos). Não há biblioteca de mapa envolvida.

## Roteiro

Parágrafo corrido, no padrão dos modelos `chacara_02` e `Fazenda Irmãos Sebald`:

```
Inicia-se o croqui na MT-243, no ponto (12°35'56.51"S, 52°13'10.50"O).
Siga em frente por 1,1 km até o ponto (12°36'31.72"S, 52°13'10.41"O).
Vire à direita e siga por 5,1 km até o ponto (12°37'43.69"S, 52°15'18.81"O).
O destino estará à esquerda.
```

Regras:

- A abertura nomeia a via do primeiro passo. Quando ela já foi nomeada ali, o primeiro trecho
  **não a repete** — como nos modelos. Com landmark curado, a abertura usa o texto do landmark e
  o primeiro trecho mantém a via.
- Cada trecho termina no **DMS do ponto seguinte**, nunca no do próprio ponto de partida.
- O fecho é `O destino estará à esquerda/direita.` quando o OSRM informa o lado; senão o último
  trecho termina em `..., onde se encontra a propriedade.`
- Nome da via: `name` do OSRM e, quando vier vazio (o normal no rural de MT), a primeira sigla de
  `ref` (`"BR-158 | BR-242"` → `BR-158`).
- Distâncias: até 2 casas, com vírgula e sem zeros à direita — `706 m`, `1,1 km`, `1,67 km`, `3 km`.

`backend/croqui/narrative.test.ts` reproduz o texto do croqui Sebald palavra por palavra.

## Base do mapa

`backend/croqui/basemap.ts` enquadra o mapa por **centro + zoom em Web Mercator**, que é o contrato
dos dois provedores, e projeta os vetores com a mesma matemática. É o que garante que a rota caia
em cima das estradas da imagem.

| Provedor | Quando | Resolução | Rótulos |
|----------|--------|-----------|---------|
| **Google Static Maps** (`maptype=hybrid`) | há `GOOGLE_STATIC_MAPS_KEY` | 640×N lógicos, `scale=2` → ~1280 px (~111 dpi no A4) | cidade e escudo de rodovia, na própria imagem; logo do Google embutido |
| **Esri World Imagery** | fallback | até 4096 px (~357 dpi) | nenhum — o gerador desenha o nome da cidade e a sigla das rodovias por conta própria |

Sem nenhum dos dois (falha de rede) o PDF sai com fundo neutro em vez de quebrar.

> ⚠️ **Não use os `.lyr` de `Croquis/Layers ArcGIS` como fonte de imagem.** Cinco deles apontam
> para `http://mt0.google.com/vt/lyrs=s,h&x={col}&y={row}&z={level}`, o servidor de tiles **interno**
> do Google: sem chave, sem billing, fora dos termos do Maps Platform e sujeito a bloqueio a
> qualquer momento — o que derrubaria a geração em produção. O caminho licenciado para ter a
> imagem e os rótulos do Google é a Maps Static API com chave. O sexto arquivo,
> `World_Imagery.lyr`, é o serviço do Esri que já está implementado.

A barra de escala não é decorativa: `pickScaleBar` escolhe um valor redondo (100/200/500 m,
1/2/4/5/10/20/40/50/100/200 km) e devolve a **largura correspondente** em pontos.

## Layout do PDF

Área de mapa `(8, 8, 826, 579)` numa página `842×595`.

| Elemento | Posição |
|----------|---------|
| Caixa do título + roteiro | topo-esquerdo, largura ~690 pt, **altura calculada** pelo texto |
| Caixa "Legenda" | topo-direito, 118×56 pt |
| Polígono do imóvel | contorno `#FF0000`, 2 pt, sem preenchimento |
| Caminho | `#FF5500`, 3 pt |
| Pushpins | ícone oficial `ylw-pushpin.png` do Google Earth (24 pt no mapa, 14 pt na legenda), hotspot na ponta da agulha (`x=20`, `y=2` a partir da base, igual ao KML), com o DMS ao lado |
| Seta N | canto inferior direito |
| Barra de escala | canto inferior direito, abaixo da seta |
| Atribuição | canto inferior esquerdo (só no fallback Esri) |

O enquadramento **reserva a faixa do topo** ocupada pelas caixas (`topInsetPt`), para nenhum ponto
da rota nascer escondido atrás delas. Os rótulos DMS desviam das caixas e uns dos outros; têm
prioridade sobre os rótulos de contexto (cidade e rodovia), que só são desenhados se sobrar espaço.

## KML e DOCX

**KML** — mesmo envelope dos modelos, que saíram do Google Earth Pro:

- `<name>` do Document = nome do arquivo `.kml`, com `<open>1</open>` e o `<atom:link>` do GE Pro.
- Pasta "Meus lugares" com o bloco `<Style><ListStyle>`.
- Placemarks **intercalados**: ponto → trecho ("Medida do caminho") → ponto → trecho → ponto.
- Polígono do imóvel ao final, no estilo `falseColor` (`ff0000ff`); trechos em `inline` (`ff0055ff`).
- Primeiro e último ponto com pushpin destacado (`m_ylw-pushpin`); os do meio com `msn_ylw-pushpin`.
- Rótulo do ponto: grau **literal**, com `'` e `"` como entidade — `12°35&apos;56.51&quot;S,  52°13&apos;10.50&quot;O`.

**DOCX** — só o roteiro, em parágrafo único, Calibri 11 (`sz 22`), margens de 2 cm. Sem título e
sem imagem, exatamente como os modelos.

Os três arquivos saem nomeados pelo título do croqui (`LOTE 04.pdf`, `LOTE 04.docx`, `LOTE 04.kml`).

## API

Todas as rotas estão atrás do `requireAuth`.

| Método | Rota | Corpo / retorno |
|--------|------|-----------------|
| POST | `/api/croqui/upload` | `{ zipBase64, filename }` → `{ uploadId, polygonCount }` |
| POST | `/api/croqui/route-options` | `{ uploadId }` → `{ municipioNome, options[], atp, start }` (síncrono, ~15–40 s) |
| POST | `/api/croqui/process` | `{ uploadId, title, propertyName, routeOptionId? }` → `202 { jobId }` |
| GET | `/api/croqui/jobs/:id/status` | `{ job }` |
| GET | `/api/croqui/jobs/:id/events` | SSE: `snapshot`, `progress`, `heartbeat` |
| GET | `/api/croqui/download/:id` | ZIP com os 3 arquivos |
| DELETE | `/api/croqui/jobs/:id` | cancela o job e apaga os artefatos |

Cada opção traz `{ id, label, side, totalDistanceM, roads[], recommended, coordinates[] }` — a
geometria vem reduzida a ≤ 160 pontos, só para o mapinha. Sem `routeOptionId`, o `/process` calcula
a rota sozinho, como antes; com ele, usa o traçado gravado.

Histórico persistido em `users/{uid}/croqui_jobs`; entrada, caminhos e saída em `croqui/input`,
`croqui/routes` e `croqui/output` do storage local.

## Variáveis de ambiente

```env
GOOGLE_STATIC_MAPS_KEY=          # Maps Static API — base com rótulos, igual aos modelos
CROQUI_OSRM_BASE_URL=https://router.project-osrm.org
CROQUI_OSRM_RETRIES=3
CROQUI_MIN_STEP_M=300            # trechos menores viram parte do anterior
CROQUI_MAX_ROUTE_OPTIONS=4       # teto de caminhos oferecidos ao usuário
CROQUI_ROUTE_OPTIONS_BUDGET_MS=70000  # teto de tempo da busca por caminhos
SEDES_MT_JSON=                   # opcional, sobrescreve config/sedes-mt.json
MUNICIPIOS_MT_GEOJSON=           # opcional, sobrescreve config/municipios-mt.geojson
```

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `backend/croqui.ts` | Rotas, job assíncrono, SSE, empacotamento do ZIP |
| `backend/croqui/basemap.ts` | Web Mercator, zoom, provedores de imagem, barra de escala |
| `backend/croqui/routing.ts` | OSRM (rota, alternativas, `/nearest`), nomes de via, simplificação, corte na divisa |
| `backend/croqui/route-options.ts` | Descoberta, limpeza, deduplicação e rótulo dos caminhos |
| `backend/croqui/landmarks.ts` | Ponto de partida e rótulos de cidade dentro do quadro |
| `backend/croqui/narrative.ts` | Texto do roteiro |
| `backend/croqui/coords.ts` | DMS, distâncias, escape XML, nome de arquivo |
| `backend/croqui/render-pdf.ts` | Layout do PDF |
| `backend/croqui/assets/ylw-pushpin.png` | Ícone oficial do Google Earth (fonte) |
| `backend/croqui/assets/ylw-pushpin-data.ts` | Mesmo PNG em base64, embutido no bundle esbuild |
| `backend/croqui/render-kml.ts` | KML no formato do Google Earth Pro |
| `backend/croqui/render-docx.ts` | DOCX |
| `client/src/dashboard/panels/CroquiPanel.tsx` | Tela da aba |
| `client/src/dashboard/croqui/RoutePicker.tsx` | Mapinha e cartões de escolha do caminho |
| `client/src/dashboard/croqui/routePreview.ts` | Projeção e cores do mapinha |
| `client/src/dashboard/hooks/useCroquiJobs.ts` | Upload, caminhos, SSE, histórico, download |
| `config/sedes-mt.json` | Sedes dos 142 municípios |
| `tools/gerar-sedes-mt.mjs` | Gera `sedes-mt.json` |
| `tools/croqui-preview.ts` | Gera os 3 arquivos localmente para conferência |
| `tools/croqui-pin-preview.ts` | Preview do pushpin (sem rede) |

## Testes e conferência visual

```bash
npm test                                   # front + backend (vitest.workspace.ts)
npx vitest run --root . backend/croqui     # só o croqui, sem rede
npx tsc --noEmit
```

| Arquivo | O que cobre |
|---------|-------------|
| `basemap.test.ts` | Projeção ida-e-volta, conteúdo dentro do quadro, aspect da bbox, escala, URLs |
| `narrative.test.ts` | Reproduz o croqui Sebald; pareamento distância ↔ ponto seguinte; fechos |
| `routing.test.ts` | `ref` das vias, classificação de manobra, simplificação, corte na divisa |
| `route-options.test.ts` | Sobreposição de traçados, remoção de vai-e-volta, pontos de passagem, lado do desvio, rótulos |
| `render-kml.test.ts` | Envelope GE Pro, cores, ordem intercalada, rótulo DMS |
| `render-pdf.test.ts` | PNG oficial embutido no PDF; PDFKit aceita o ícone com alpha |
| `coords.test.ts` | DMS e formatação de distância |
| `client/src/dashboard/croqui/routePreview.test.ts` | Enquadramento do mapinha: norte em cima, leste à direita, proporção preservada |

Conferência visual ponta a ponta:

```bash
npx tsx tools/croqui-preview.ts                    # Croquis/ATP → $TMPDIR/croqui-preview
npx tsx tools/croqui-preview.ts <pasta> <saida>
npx tsx tools/croqui-pin-preview.ts                # só o pushpin, sem rede
```

Compare o PDF gerado com `Croquis/Fazenda Irmaos Sebald-lote 121B.pdf`,
`Croquis/Croqui_Chacara_Lotes_41 e 42..docx.pdf` e o modelo externo
`Croqui_Lote_04_P.A_Pingo D'água.pdf`. **A prova de que o enquadramento está certo é a
rota cair em cima das estradas da imagem de satélite.** Os pinos devem ser o thumbtack
3D amarelo do Google Earth (cabeça arredondada + agulha prateada inclinada), não um
círculo com haste.

`render-kml.test.ts` compara com o KML modelo quando `Croquis/` está presente e pula essas
asserções quando não está.

## Regenerar as sedes municipais

```bash
node tools/gerar-sedes-mt.mjs
```

Para cada município da malha IBGE: consulta o Nominatim (1 req/s, conforme a política de uso), só
aceita o resultado que cai **dentro do polígono** do município e encaixa o ponto na via mais
próxima com o OSRM `/nearest`. Os reprovados saem listados no final para conferência manual —
melhor faltar uma sede do que gravar uma sede errada. Leva ~4 minutos.

## Armadilhas

- **O `export` do ArcGIS expande a bbox pedida** para casar com o aspect do `size`: pedindo
  `-52.3..-52.1` ele devolve `-52.907..-51.492`. Foi a causa do desalinhamento entre imagem e
  vetores. Por isso o enquadramento é centro + zoom, e não bbox.
- **`step.distance` do OSRM é a distância a partir da manobra**, não até ela. A frase do trecho
  tem que citar o DMS do waypoint seguinte.
- **`&deg;` não é entidade XML.** No KML o grau vai literal; só `'` e `"` viram entidade.
- **`router.project-osrm.org` é servidor de demonstração**: tem limite de uso e não tem SLA. Para
  volume, hospedar OSRM próprio e apontar `CROQUI_OSRM_BASE_URL`.
- **`alternatives=3` no OSRM público devolve uma rota só.** Foi verificado no Lote 89-A: `3`,
  `true` e `false` retornam os mesmos 29,7 km. É por isso que os corredores alternativos são
  descobertos por ponto de passagem, e não pedidos ao roteador.
- **Ponto de passagem fora de rota gera vai-e-volta.** O OSRM vai até ele e volta pelo mesmo
  caminho. Entregar esse traçado ao usuário seria mostrar um desvio que ninguém faz — daí o
  `stripOutAndBackSpurs` + reroteamento pelo ponto que identifica o corredor.
- **Web Mercator mistura unidade com facilidade.** No mapinha de escolha, `x` em grau e `y` em
  radiano achatava o traçado ~57× na vertical. Os dois eixos têm que estar em radiano
  (`routePreview.test.ts` cobre isso).
- **O ZIP precisa conter exatamente um polígono.** ATP com múltiplas partes é rejeitada.
- **`finishJob` recebe um objeto**, não argumentos posicionais — chamá-lo errado faz o job nunca
  ser finalizado no registro em memória, sem erro visível.
- **Não redesenhe o pushpin em vetor.** Os croquis modelo saíram do Google Earth Pro com o
  ícone `ylw-pushpin.png` rasterizado na exportação. O PDF precisa embutir o mesmo PNG
  (`backend/croqui/assets/ylw-pushpin.png`, hotspot na ponta) — um círculo amarelo com haste
  fica diferente do thumbtack 3D e falha na conferência visual contra o modelo.
