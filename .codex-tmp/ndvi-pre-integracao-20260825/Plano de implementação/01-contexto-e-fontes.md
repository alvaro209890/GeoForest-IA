# 01 — Contexto, fontes e requisitos

## 1. Por que este plano existe

Hoje o GeoForest prova uso consolidado × supressão por **leitura visual** de cenas
(análise de imagens via Groq Vision) e por vetores da SEMA. Não existe nenhuma medida
numérica reprodutível do estado da vegetação. O plano pós-recorte deixou isso
explicitamente de fora:

> "Comparação raster determinística pixel a pixel (**NDVI calculado por nós**)."
> — `docs/planos/analise-pos-recorte/11-riscos-e-decisoes-abertas.md:49`, seção
> *"Fora de escopo (não entra neste plano)"*

A reunião de 31/07/2026 mostrou o custo disso. A equipe da IMAP **calcula índice na
mão**, um polígono por vez, dentro do Google Earth Engine, e cola o número no laudo:

> "o NDVI, SAVI, tem algum script que facilita essa coisa? Porque assim a gente faz
> **na mão**, literalmente"
> — IMAP | Depto. Florestal, 26:55

Este plano automatiza exatamente esse trecho.

---

## 2. As fontes e como foram tratadas

| Fonte | O que é | Peso |
|---|---|---|
| `NDVI/Reunião … NDFI.docx` | Transcrição **oficial do Teams**, 457 falas, 1 h 03, com rótulo de locutor | **Autoritativa** |
| `NDVI/Reunião … .mp4` | Gravação; transcrita por `faster-whisper` (modelo `small`, pt, VAD) | Conferência cruzada |

Cópias das duas em [`fontes/`](fontes/). O Whisper confunde "NDVI" com "NDFI" em vários
pontos (são foneticamente próximos e o áudio é de call), por isso o DOCX manda. Onde os
dois concordam, a citação é segura — foi o caso dos dois trechos que mais pesam neste
plano (26:55/27:01 e 37:33–37:52).

**O NDFI do título da reunião está fora de escopo.** Só o método foi aproveitado:
como se escolhe cena, como se lê a escala do índice, como se extrai a média por
polígono e como isso entra no laudo.

---

## 3. O que a reunião ensinou → requisito técnico

| # | O que a reunião mostrou | Requisito que isso gera |
|---|---|---|
| R1 | Índice varia de **−1 a +1**; −1 = solo exposto, +1 = vegetação (08:46, 15:21) | Guardar NDVI como **Float32 real em [−1, 1]** — nunca byte esticado |
| R2 | A **média dentro do polígono** é o número que vai para o laudo. Valores citados ao vivo: **0,53**, **0,13**, **−0,23** (20:18–21:53) | Estatística zonal é obrigatória, não acessório |
| R3 | "é interessante você fazer o **polígono por vez**… tô misturando várias coisas aqui, tem três polígonos" (22:18) | Estatística **por feição**, jamais pela união das feições |
| R4 | Floresta estável fica em **0,7–0,8**; a queda para **0,6** denunciou fogo em 1995 (35:50) | Faixas de classificação calibradas; série anual comparável entre si |
| R5 | Nomenclatura de saída: "a **órbita/ponto, o ano, o mês e o dia, e a composição**" (17:36) | Nome de arquivo e de layer no mesmo padrão do acervo atual |
| R6 | Uso é **comparar ano a ano**, ou meses do mesmo ano (23:01) | Série temporal, não cena isolada |
| R7 | Escolher a cena com **menos nuvem** — "a melhor imagem, que é a que tem menos nuvem" (15:42) | Ordenar candidatas por nuvem + mascarar nuvem no cálculo |
| R8 | **Sentinel-2 só existe a partir de 2016** (07:03) | Sensor por ano precisa ser declarado, nunca presumido |
| R9 | ⚠️ "devido à escala do Landsat de **30 por 30**, ele acabava **mascarando** esse resultado… tinha que ser uma coisa mais avançada" (37:33–37:52) | **Limitação declarada no laudo**: pixel misto e saturação em 30 m |
| R10 | ⚠️ Ordem da narrativa: "**NDVI, SAVI** e por último você mata com o índice espectral" (31:59) | NDVI é **primeiro elo da cadeia de prova**, não prova única |
| R11 | ⚠️ O mosaico SPOT da SEMA "é muito **mistura de datas**… não dá para concluir nada" (31:14) | **Proibido** calcular NDVI sobre mosaico da SEMA |

### 3.1 Os três requisitos que mais mudam o desenho

**R9 e R10 juntos** definem o tom do produto. O NDVI **não decide** nada sozinho: ele
mede, declara a própria incerteza e entra como primeiro elemento. O laudo não pode ser
redigido em tom conclusivo — ver [06-laudo-docx.md](06-laudo-docx.md), seção de
Limitações, que é **obrigatória** e não pode ser suprimida.

**R11** elimina a fonte mais fácil de usar. O mosaico da SEMA é o que o resto do sistema
já consome, e é justamente o que não serve — ver [02](02-fonte-das-bandas.md).

**R3** é o detalhe que mais costuma passar batido em implementação: é tentador dissolver
os polígonos e tirar uma média só. O Bruno mostrou ao vivo o erro que isso causa
(22:18: três polígonos misturados devolveram 0,16, um número que não descreve nenhum
dos três).

---

## 4. O que já existe no repositório a favor

| Ativo | Onde | Serve para |
|---|---|---|
| Fórmula e interpretação do NDVI | `banco_de_dados/06_sensoriamento_remoto/indices_vegetacao.md` | Base das faixas de classificação |
| Guarda-corpo antifabricação | `client/src/pages/Dashboard.tsx:3563` — *"NÃO fabrique valores de NDVI… a menos que tenham sido calculados e fornecidos"* | Regra que este plano finalmente permite cumprir com dado real |
| Tile "NDVI Médio" já desenhado | `design/geoforest-ui.pen:2544` e `:9751` | O slot de UI já foi pensado |
| Executor GDAL com cancelamento e progresso | `backend/cbers/gdal.ts` — `runCommand`, `runCommandCapture` | Reuso direto, ver [03](03-pipeline-ndvi.md) |
| Pipeline STAC Landsat C2 L2 SR | `backend/landsat/` | Fonte das bandas, ver [02](02-fonte-das-bandas.md) |
| Publicação REST + grupos parametrizados | `backend/landsat/geoserver.ts` | Molde da publicação, ver [05](05-publicacao-wms.md) |
| Timbrado oficial IMAP | `backend/simcar/report-imap.ts` + `assets/timbrado_imap.png` | Laudo no papel certo, ver [06](06-laudo-docx.md) |

---

## 5. O que este plano **não** faz

- **Não implementa NDFI**, apesar do título da reunião.
- **Não implementa SAVI, EVI ou NDRE.** A reunião citou SAVI (26:55, 31:59) e a base de
  conhecimento descreve os quatro. Ficam para depois; a arquitetura deste plano é
  genérica o bastante para recebê-los (ver [09](09-riscos-e-decisoes-abertas.md)).
- **Não usa Google Earth Engine.** A reunião foi toda no GEE, mas o GeoForest tem
  pipeline GDAL próprio e acervo local; replicar o método sem a dependência externa é o
  ponto.
- **Não altera a análise AC/AVN nem as três fases pós-recorte existentes.**
- **Não recria o painel admin** nem religa o oráculo SIMCAR (ambos desativados).
