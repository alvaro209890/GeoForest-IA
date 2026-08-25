# 08 — Fases de implementação, testes e critérios de aceitação

## 1. Fases

Cada fase entrega algo verificável sozinho. Não começar a seguinte sem os critérios da
anterior fechados.

---

### F0 — Preflight e estilo (meio dia)

| Tarefa | Arquivo |
|---|---|
| Acrescentar `gdaldem` e `gdal_calc.py` à lista de ferramentas | `scripts/cbers-doctor.sh:55` |
| Criar a rampa de cor | `config/geoserver-styles/ndvi_ramp.clr` |
| Criar o SLD equivalente | `config/geoserver-styles/ndvi_ramp.sld` |
| Confirmar no servidor que as duas ferramentas existem | — |
| `ensureNdviStyle()` publicando o SLD de forma idempotente | `backend/ndvi/geoserver.ts` |

**Aceite:** `scripts/cbers-doctor.sh` passa no servidor; `GET /rest/styles/ndvi_ramp.json`
responde 200; rodar `ensureNdviStyle()` duas vezes seguidas não dá erro.

> Se `gdal_calc.py` não existir, é aqui que se descobre — e o Plano B
> ([03 §3.1](03-pipeline-ndvi.md#31-ferramentas-gdal--conferir-antes-de-escrever-código))
> entra antes de qualquer outra coisa ser escrita.

---

### F1 — Núcleo NDVI (2–3 dias)

Módulos `constants.ts`, `types.ts`, `scene-select.ts`, `gdal.ts`, `compute.ts`.

Fluxo completo até ter, no disco temporário: cena escolhida → recortes NIR/RED/QA →
`ndvi.tif` Float32 → `ndvi_rgb.tif` → overviews.

**Aceite:**
- `gdalinfo -json -stats ndvi.tif` devolve mínimo ≥ −1 e máximo ≤ 1.
- Borda da cena e nuvem saem como nodata `-9999`, não como valor.
- Rodar sobre um imóvel real (§3) produz números plausíveis: floresta 0,7–0,8, solo
  exposto < 0,2 — as faixas que a reunião mostrou ao vivo (R4).
- Cancelar o job no meio mata o processo GDAL em até 2 s.

---

### F2 — Publicação no WMS (1–2 dias)

`geoserver.ts` e `archive.ts`.

**Aceite:**
- `GetCapabilities` do workspace `cbers` mostra `RASTER → NDVI → ndvi_orbit_… → …_y…`.
- `RASTER` continua com `CBERS-4A-Apos_2019` e `LANDSAT` intactos.
- GetMap PNG válido, **não uniforme**, nas duas camadas.
- Float32 abre com a rampa de cor; RGB abre com `raster`.
- `GetFeatureInfo` na camada Float32 devolve valor entre −1 e 1.
- Rodar o mesmo job duas vezes não duplica entrada em grupo nenhum.
- JSON do índice gravado; segunda execução com o mesmo `itemId` **reusa** e não recalcula.

---

### F3 — Estatística zonal (1–2 dias)

`zonal.ts`.

**Aceite:**
- Uma linha por feição — nunca uma linha para a união (R3).
- `validPct` presente em toda linha.
- Feição com `validPct < 60%` sai sem classe e com aviso.
- Feição com menos de `NDVI_MIN_PIXELS` sai como `area_pequena_demais`.
- `TIPOLOGIA_VEGETAL` **não aparece** em nenhuma linha.
- Média de uma feição inteiramente dentro de AVN fica em faixa arbórea; de uma feição de
  AUAS com solo exposto fica abaixo de 0,3.

---

### F4 — Laudo Word (2 dias)

`report-ndvi-docx.ts` + acréscimos em `report-theme.ts`.

**Aceite:**
- `.docx` válido: assinatura `PK`, tem `word/document.xml` e `[Content_Types].xml`.
- Timbrado IMAP no cabeçalho; endereço e número de página no rodapé.
- Tabela de estatísticas cabe em 453 pt sem estourar.
- **Seção de Limitações presente sempre**, inclusive no caso de sucesso total.
- Quadro de origem traz plataforma, órbita/ponto, data de passagem e a expressão de
  conversão de escala.
- Abre no Word e no LibreOffice sem aviso de reparo.
- Renderiza **sem rede** (só `loadTimbradoImapPng` toca o disco).

---

### F5 — Rota, flag e frontend (1–2 dias)

**Aceite:**
- Flag desligada ⇒ `409 PHASE_NOT_READY`; ligada ⇒ job roda.
- Rotas na allowlist de auth; requisição sem token dá 401.
- Job de outro usuário dá 404/403, não vaza dado.
- Botão mostra progresso via SSE e, ao fim, NDVI médio **com** `validPct` ao lado.
- Link do laudo baixa o `.docx`.

---

### F6 — Série temporal (1–2 dias, opcional)

**Aceite:**
- Tabela ano × média por feição.
- Colunas de **plataforma** e **data de passagem** presentes (obrigatórias).
- Troca de sensor entre anos aparece marcada.
- Ano sem cena aparece como lacuna declarada, nunca interpolada.

---

## 2. Testes

Vitest, projeto `backend` (`vitest.workspace.ts`), `npm test`. Type check: `npm run check`.

### 2.1 Unitários

**`backend/ndvi/ndvi-math.test.ts`** — o mais importante do conjunto.

```
✓ converte DN em reflectância: 10000 → 10000*0.0000275-0.2 = 0.075
✓ NDVI de reflectância conhecida bate com valor calculado à mão
✓ NDVI calculado no DN cru DIFERE do NDVI correto      ← trava a armadilha do offset
✓ offset zero faria os dois coincidirem (prova de que é o offset, não a escala)
✓ resultado sempre em [-1, 1] para DN na faixa válida
✓ DN 0 em qualquer banda → nodata
✓ qa_pixel com bit de nuvem → nodata
✓ qa_pixel com bit de água → NÃO mascara
```

O terceiro caso é o que impede a regressão mais cara. Deve falhar se alguém "simplificar"
a expressão removendo a conversão.

**`backend/ndvi/naming.test.ts`** — nomes de arquivo, store e layer; sufixo de job;
`cleanLayerName`. Detecção de plataforma com **lookaround, não `\b`** (o bug de
`..._l7_etm_...` já aconteceu uma vez em `backend/landsat/naming.ts`).

**`backend/ndvi/zonal.test.ts`** — parse do `gdalinfo -json -stats` a partir de JSON
fixado; `STATISTICS_VALID_PERCENT`; regras de `validPct` e `NDVI_MIN_PIXELS`.

**`backend/ndvi/scene-select.test.ts`** — ranqueamento: nuvem, proximidade de 22/07,
descarte de L7 SLC-off, cobertura parcial.

**`backend/ndvi/style-consistency.test.ts`** — lê `ndvi_ramp.clr` e `ndvi_ramp.sld` e
confirma que os pares valor→cor batem. Sem isso, mapa do laudo e camada do WMS divergem
silenciosamente.

**`backend/ndvi/report-ndvi-docx.test.ts`** — copiar o idioma de
`backend/simcar/report-docx.test.ts`: usar `extractZipEntries` de `../geo-utils` (não
`jszip`), `docxText()` para tirar as tags, e `fakePng(w, h)` — um PNG sintético de 33
bytes (assinatura + IHDR) que deixa `pngImageSize` ler dimensões sem imagem real.

```
✓ .docx válido, com word/document.xml
✓ seção de Limitações presente mesmo em caso de sucesso
✓ tabela traz média, validPct e classe
✓ TIPOLOGIA_VEGETAL não aparece
✓ figura entra em word/media/
✓ legenda sem buffer não gera figura fantasma
✓ vocabulário: "uso consolidado", nunca "área antropizada"
```

### 2.2 Script de prévia offline

`scripts/preview-laudo-ndvi.ts`, copiando `scripts/preview-laudo-pdf.ts` (207 linhas,
fixtures inline, `analysisImages: []` para não tocar rede):

```bash
npx tsx scripts/preview-laudo-ndvi.ts /tmp/laudo-ndvi.docx --serie
```

### 2.3 Validação com dado real — **obrigatória**

⚠️ O repositório tem uma lição cara registrada: **"Teste sintético não valida código
geométrico."** Bugs que passaram pela suíte inteira só caíram com shapefile real.

Dados reais versionados:

| Fonte | O que é |
|---|---|
| `.oraculo-scratch/santa_clara/v24/*.shp` | 28 camadas do CAR 270069 |
| `backend/fixtures/teste_1/*.zip` | ZIP de recorte |
| CAR aprovado 6816 | `docs/CHANGELOG_2026-08-08_CAR_APROVADO_6816.md` |

Ler com `readFullShapefile` / `parseUserShapefile` de `backend/simcar/shapefile-io.ts`,
rodar com `npx tsx`.

**O CAR 6816 é o melhor detector de falso positivo do acervo.** Ele já revelou 9 erros de
geometria falsos. Para o NDVI, o teste que mais vale:

> Rodar o NDVI num CAR **aprovado** e conferir se as feições de `AVN` saem em faixa
> arbórea e as de `AREA_CONSOLIDADA` saem abaixo delas. Se AC e AVN vierem com NDVI
> parecido, ou a máscara de nuvem está errada, ou a cena está deslocada, ou a conversão
> de escala foi esquecida.

Bônus: o `.dbf` da AUAS traz `ABERTURA` por polígono — gabarito de data declarada, útil
para conferir se a série temporal vê a queda de NDVI no ano que o CAR declara.

### 2.4 Nota sobre a suíte

Teste que falha em `npm test` mas passa isolado é quase sempre **timeout sob carga** (o
default do vitest é 5 s e `processar-projeto.test.ts` leva ~108 s), não bug de lógica.
Para testes de NDVI que chamam GDAL, definir timeout explícito.

---

## 3. Critérios de aceitação do plano inteiro

Antes de ligar `SIMCAR_NDVI_ENABLED=true` em produção:

**Correção**
- [ ] A conversão DN → reflectância acontece antes da divisão, travada por teste
- [ ] NDVI sempre em [−1, 1]; nodata nunca vira valor
- [ ] Nuvem, sombra, cirrus e fill mascarados; água **não** mascarada
- [ ] Estatística por feição, jamais pela união
- [ ] `TIPOLOGIA_VEGETAL` fora de tudo que é entregue

**Honestidade do dado**
- [ ] Cena sem NIR ⇒ falha declarada, nunca estimativa
- [ ] `validPct` em toda linha de estatística e em todo cartão da UI
- [ ] Seção de Limitações no laudo, sempre
- [ ] Origem do dado (plataforma, órbita/ponto, data, coleção) no laudo
- [ ] Nenhuma frase conclui AC/AVN/AUAS só com NDVI

**Infraestrutura**
- [ ] `cbers-doctor.sh` confere `gdaldem` e `gdal_calc.py`
- [ ] `RASTER → NDVI` no `GetCapabilities`, irmão de CBERS e LANDSAT
- [ ] `RASTER` não perdeu os outros dois grupos
- [ ] GetMap PNG válido e não uniforme nas duas camadas
- [ ] Reuso funciona: segunda execução não recalcula
- [ ] Acervo grava por cópia atômica, com `.ovr`

**Entrega**
- [ ] `.docx` abre no Word e no LibreOffice sem reparo
- [ ] Tabela cabe em 453 pt
- [ ] Timbrado IMAP correto
- [ ] Falha no laudo não derruba o raster já publicado
- [ ] Rotas na allowlist de auth; job de terceiro não vaza

**Validação real**
- [ ] Rodado no CAR 270069 (Santa Clara)
- [ ] Rodado no CAR aprovado 6816, com AVN e AC se separando como esperado
- [ ] Conferido por olho GIS em pelo menos 3 imóveis

---

## 4. Estimativa

| Fase | Dias |
|---|---|
| F0 Preflight e estilo | 0,5 |
| F1 Núcleo NDVI | 2–3 |
| F2 Publicação WMS | 1–2 |
| F3 Estatística zonal | 1–2 |
| F4 Laudo Word | 2 |
| F5 Rota, flag, frontend | 1–2 |
| F6 Série temporal (opcional) | 1–2 |
| **Total** | **8–13 dias** |

F1 é a de maior variância: depende de `gdal_calc.py` existir no servidor e de a leitura
`/vsicurl/` das cenas C2 L2 se comportar bem.
