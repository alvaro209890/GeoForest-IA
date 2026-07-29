# Croqui de acesso (ATP → PDF + Word + KML)

Gera automaticamente o croqui de acesso de um imóvel a partir do shapefile ATP, no padrão dos
croquis aprovados que estão em `Croquis/`. Aba **Croqui** do dashboard (`/dashboard/croqui`).

- [Os modelos](#os-modelos)
- [Fluxo](#fluxo)
- [Uso no dashboard](#uso-no-dashboard)
- [Ponto de partida](#ponto-de-partida)
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
- Seta N e barra de escala no canto inferior direito; atribuição da imagem no inferior-esquerdo.
- No roteiro, a distância de cada trecho vem seguida do DMS do **ponto de chegada** daquele trecho.

## Fluxo

1. **Parse do ATP** — `parseUserShapefile` reprojeta SIRGAS 2000, SAD69 e Córrego Alegre.
2. **Município** — malha IBGE local, com fallback no WFS da SEMA.
3. **Ponto de partida** — landmark curado → sede do município → centroide da malha.
4. **Rota** — OSRM até o centroide do imóvel, cortada onde cruza a divisa.
5. **Simplificação** — trechos na mesma via são fundidos e os curtos absorvidos.
6. **Artefatos** — PDF, DOCX e KML, empacotados num ZIP.

O job roda de forma assíncrona com progresso por SSE e histórico em `users/{uid}/croqui_jobs`.

## Uso no dashboard

Aba **Croqui** (`/dashboard/croqui`):

1. Informe **título** e **nome da propriedade**.
2. Envie o shapefile ATP em `.zip` — **arraste o arquivo para a área tracejada** ou clique em
   **Selecionar ZIP**. Só `.zip` é aceito (extensão ou `application/zip`).
3. Clique em **Gerar croqui** e acompanhe o progresso.
4. Baixe o ZIP com PDF, DOCX e KML.

Durante o upload/processamento a área de drop fica desabilitada. Soltar um arquivo que não seja ZIP
mostra erro e não troca a seleção atual.

## Ponto de partida

`resolveLandmark` consulta, nesta ordem:

1. **Landmark curado** (`LANDMARKS_BY_IBGE` em `backend/croqui/landmarks.ts`) — conferido à mão
   contra um croqui modelo. Hoje só Querência, com a rotatória da MT-109 com a Av. Norte.
2. **Sede do município** (`config/sedes-mt.json`) — 142 municípios, cada sede validada dentro do
   polígono da malha IBGE e encaixada na via mais próxima pelo OSRM (todas a ≤ 65 m de estrada).
3. **Centroide da malha** — último recurso; cai com frequência longe de qualquer estrada.

Use um landmark curado quando a sede não for o ponto de partida certo para aquele município.

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
| Pushpins | amarelos, ancorados na ponta, com o DMS ao lado |
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
| POST | `/api/croqui/process` | `{ uploadId, title, propertyName }` → `202 { jobId }` |
| GET | `/api/croqui/jobs/:id/status` | `{ job }` |
| GET | `/api/croqui/jobs/:id/events` | SSE: `snapshot`, `progress`, `heartbeat` |
| GET | `/api/croqui/download/:id` | ZIP com os 3 arquivos |
| DELETE | `/api/croqui/jobs/:id` | cancela o job e apaga os artefatos |

Histórico persistido em `users/{uid}/croqui_jobs`; entrada e saída em `croqui/input` e
`croqui/output` do storage local.

## Variáveis de ambiente

```env
GOOGLE_STATIC_MAPS_KEY=          # Maps Static API — base com rótulos, igual aos modelos
CROQUI_OSRM_BASE_URL=https://router.project-osrm.org
CROQUI_OSRM_RETRIES=3
CROQUI_MIN_STEP_M=300            # trechos menores viram parte do anterior
SEDES_MT_JSON=                   # opcional, sobrescreve config/sedes-mt.json
MUNICIPIOS_MT_GEOJSON=           # opcional, sobrescreve config/municipios-mt.geojson
```

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `backend/croqui.ts` | Rotas, job assíncrono, SSE, empacotamento do ZIP |
| `backend/croqui/basemap.ts` | Web Mercator, zoom, provedores de imagem, barra de escala |
| `backend/croqui/routing.ts` | OSRM, nomes de via, simplificação de trechos, corte na divisa |
| `backend/croqui/landmarks.ts` | Ponto de partida e rótulos de cidade dentro do quadro |
| `backend/croqui/narrative.ts` | Texto do roteiro |
| `backend/croqui/coords.ts` | DMS, distâncias, escape XML, nome de arquivo |
| `backend/croqui/render-pdf.ts` | Layout do PDF |
| `backend/croqui/render-kml.ts` | KML no formato do Google Earth Pro |
| `backend/croqui/render-docx.ts` | DOCX |
| `client/src/dashboard/panels/CroquiPanel.tsx` | Tela da aba |
| `client/src/dashboard/hooks/useCroquiJobs.ts` | Upload, SSE, histórico, download |
| `config/sedes-mt.json` | Sedes dos 142 municípios |
| `tools/gerar-sedes-mt.mjs` | Gera `sedes-mt.json` |
| `tools/croqui-preview.ts` | Gera os 3 arquivos localmente para conferência |

## Testes e conferência visual

```bash
npx vitest run --root . backend/croqui     # 32 testes, sem rede
npx tsc --noEmit
```

| Arquivo | O que cobre |
|---------|-------------|
| `basemap.test.ts` | Projeção ida-e-volta, conteúdo dentro do quadro, aspect da bbox, escala, URLs |
| `narrative.test.ts` | Reproduz o croqui Sebald; pareamento distância ↔ ponto seguinte; fechos |
| `routing.test.ts` | `ref` das vias, classificação de manobra, simplificação, corte na divisa |
| `render-kml.test.ts` | Envelope GE Pro, cores, ordem intercalada, rótulo DMS |
| `coords.test.ts` | DMS e formatação de distância |

Conferência visual ponta a ponta:

```bash
npx tsx tools/croqui-preview.ts                    # Croquis/ATP → $TMPDIR/croqui-preview
npx tsx tools/croqui-preview.ts <pasta> <saida>
```

Compare o PDF gerado com `Croquis/Fazenda Irmaos Sebald-lote 121B.pdf` e
`Croquis/Croqui_Chacara_Lotes_41 e 42..docx.pdf`. **A prova de que o enquadramento está certo é a
rota cair em cima das estradas da imagem de satélite.**

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
- **O ZIP precisa conter exatamente um polígono.** ATP com múltiplas partes é rejeitada.
- **`finishJob` recebe um objeto**, não argumentos posicionais — chamá-lo errado faz o job nunca
  ser finalizado no registro em memória, sem erro visível.
