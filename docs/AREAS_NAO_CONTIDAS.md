# Áreas Não Contidas (Containment SIMCAR)

Data: 2026-07-10

Este documento registra o módulo **Áreas Não Contidas**, criado para diagnosticar
o erro de topologia do validador da SEMA-MT/SIMCAR:

> *"Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA."*

O módulo é **genérico**: a camada que deve estar contida (alvo) e as camadas que
devem cobri-la (continentes) são escolhidas pelo usuário. Não é fixo em
`AREA_UMIDA` — serve para qualquer regra de containment entre shapefiles.

## Onde fica

Aba **Análise de Erros** (antiga "Vértices"), sub-aba **Áreas Não Contidas**. A
sub-aba **Vértices Próximas** continua no mesmo lugar, sem alterações.

## Regra verificada

Para cada feição da camada-alvo, o sistema calcula a diferença geométrica:

```text
alvo − união(continente₁, continente₂, …)
```

O que "sobra" são as **áreas não contidas** — exatamente as porções que o SIMCAR
reprova. Cada porção vira um polígono e um ponto no resultado.

- A área é medida no **CRS métrico** (UTM 22S para MT; estimado a partir do
  centroide quando o CRS de entrada é geográfico), coerente com o cálculo de
  área da SEMA.
- Fragmentos de borda menores que a **área mínima** (padrão **1 m²**) são
  descartados. Ao longo de bordas quase coincidentes o cálculo booleano gera
  "frestas" de poucos cm² que não são erros reais; o filtro remove esse ruído.
  Use `0` para ver absolutamente tudo.

## Interface

Fluxo da tela:

1. **Upload do ZIP** do CAR/SIMCAR (um ou mais shapefiles).
2. **Definição da regra**: uma tabela lista as camadas poligonais. Para cada
   linha há dois controles:
   - **Alvo** (radio): a camada que precisa estar contida — apenas uma.
   - **Continente** (checkbox): as camadas que devem cobrir o alvo — uma ou mais.
   Uma frase-resumo é montada ao vivo, ex.:
   *"AREA_UMIDA deve estar contida em AVN + AUAS + AREA_CONSOLIDADA"*.
3. **Área mínima (m²)** para filtrar frestas de borda.
4. **Processamento** com barra de progresso (SSE).
5. **Resultado**: cards de resumo (feições alvo, feições com erro, nº de
   polígonos, área total), tabela detalhada e download do ZIP.

## Saída (ZIP)

- `areas_nao_contidas.shp/.shx/.dbf/.prj` — polígonos das áreas não contidas.
  Campos: `alvo`, `feicao`, `parte`, `area_ha`, `area_m2`, `contido_em`, `erro`.
- `pontos_nao_contidos.shp/.shx/.dbf/.prj` — ponto representativo de cada
  polígono (para localizar rapidamente o erro no ArcMap/QGIS).
- `resumo_nao_contidas.csv` — resumo tabular.
- `relatorio_nao_contidas.txt` — relatório técnico com a regra, contagens e a
  área total não contida.

O CRS de saída é o mesmo da camada-alvo (tipicamente SIRGAS 2000 / EPSG:4674).

## API

Base: `/api/containment`. Todas as rotas exigem autenticação (Firebase ID token).

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/containment/upload` | Importa o ZIP (base64) e lista as camadas poligonais. Retorna `uploadId`. |
| `POST` | `/api/containment/process` | Inicia o job. Body: `uploadId`, `targetLayerId`, `containerLayerIds[]`, `minAreaM2`. Retorna `jobId` (202). |
| `GET` | `/api/containment/jobs/:jobId/status` | Snapshot do job. |
| `GET` | `/api/containment/jobs/:jobId/events` | Stream SSE de progresso e resultado. |
| `GET` | `/api/containment/download/:jobId` | Baixa o ZIP do resultado. |
| `DELETE` | `/api/containment/jobs/:jobId` | Cancela/remove o job. |

Os jobs são persistidos em `users/{uid}/containment_jobs/{jobId}` e os arquivos
em `containment/input` e `containment/output`.

## Implementação

- **Backend**: [`backend/containment-analysis.ts`](../backend/containment-analysis.ts).
  Reaproveita a leitura de shapefile do módulo de vértices
  (`getZipLayerGroups`, `parsePolygonRecords`, `detectCrs`,
  `ringGroupsForRecord`, `estimateUtmProjFromLonLat`) e usa `@turf/turf`
  (`difference`, `union`, `pointOnFeature`) para as operações booleanas. A área
  é calculada por shoelace após reprojeção para o CRS métrico.
- **Frontend**: [`client/src/components/ContainmentAnalysis.tsx`](../client/src/components/ContainmentAnalysis.tsx),
  componente autocontido montado dentro do `Dashboard` na sub-aba.

## Notas de precisão

- O resultado depende do estado atual dos shapefiles. Se as camadas forem
  editadas no SIMCAR entre uma execução e outra, o número de polígonos muda —
  o cálculo é determinístico para uma dada entrada.
- A classificação de casca/buraco dos anéis segue a mesma heurística de
  profundidade de aninhamento usada no módulo de vértices, validada contra
  dados reais (Fazenda Santo Antônio, AREA_UMIDA feição 5).
