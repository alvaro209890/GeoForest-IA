# Aba "Erros de Geometria" — validações do SIMCAR (SEMA-MT)

Sub-aba da **Análise de Erros** do GeoForest que detecta (e quando possível corrige)
os erros que o **Importador GEO / processamento do Projeto Geográfico do SIMCAR**
reprova ao receber os shapefiles do CAR estadual de Mato Grosso.

Construída em 2026-07-11 com base em pesquisa das regras oficiais.

## Fontes

1. **Manual de Operação do SIMCAR – Projeto Geográfico** (SEMA-MT), em especial o
   **Anexo 01 "Validações GEO"** — baixado de
   `https://www.sema.mt.gov.br/site/phocadownload/SIMCAR/MANUAL DE OPERACAO DO SIMCAR - PROJETO GEOGRAFICO.pdf`
   (lista completa em sema.mt.gov.br → SIMCAR → Manuais).
2. **Engenharia reversa do `tecnico.app/js/bundle.js`** do SIMCAR
   (`monitoramento.sema.mt.gov.br/simcar/tecnico.app`): confirma o fluxo de
   upload de ZIP → processamento assíncrono → *"Arquivo ZIP com o Shapefile
   contendo os pontos de erro"*, *"pontos de sobreposição"*, *"pontos de erro de
   cálculo de APP"* e *"Arquivo PDF do relatório que identifica o resultado do
   processamento do projeto"*.
3. Base de conhecimento local `~/Documentos/Cerebro-Geo-IA` (sistemas SEMA).

## Como o SIMCAR importa e processa shapes (resumo da pesquisa)

- **Formato exigido**: shapefile em ZIP, **dimensão 2D**, sistema de coordenadas
  **geográfico SIRGAS 2000** (EPSG:4674). Todas as feições são POLÍGONO, exceto
  NASCENTE (ponto) e rascunhos (linha/ponto). Rios são sempre polígono, nunca linha.
- **Nomenclatura oficial das feições**: ATP, AIR, AVN, AUAS, AREA_CONSOLIDADA,
  AREA_PANTANEIRA, VEREDA, MANGUEZAL, RESTINGA, TIPOLOGIA_VEGETAL, NASCENTE,
  RIO_MENOR_10, RIO_10_ATE_50, RIO_50_ATE_200, RIO_200_ATE_600, RIO_MAIOR_600,
  LAGO_LAGOA_NATURAL, RESERVATORIO_ARTIFICIAL, AREA_DECLIVIDADE, BORDA_CHAPADA,
  AREA_TOPO_MORRO, AREA_ALTITUDE_1800, ARL, AREA_UTILIDADE_PUBLICA,
  AREA_INTERESSE_SOCIAL.
- **Obrigatórias**: ATP (**polígono único**) e AIR (uma ou mais; a soma das AIRs
  deve corresponder à ATP). Atributos obrigatórios: AIR → `TIPO` (M/P) e
  `IDENTIFIC`; ARL → `IDENTIFIC`, `AVERBACAO`, `SITUACAO`; TIPOLOGIA_VEGETAL →
  `TIPO` (Cerrado/Floresta).
- **Processamento**: o servidor cruza as geometrias, gera subáreas (APP com
  buffers por tipo de rio/lago/nascente, APPD, AURD, APPRL) e devolve
  *inconsistências* que precisam ser **corrigidas ou justificadas**; as
  impeditivas bloqueiam o envio.
- **Validações do Anexo 01** (impeditivas, salvo indicação):
  - AIR fora da ATP; AIR sobrepondo AIR.
  - AVN/AUAS/AREA_CONSOLIDADA/AREA_PANTANEIRA/UTILIDADE_PUBLICA/INTERESSE_SOCIAL
    fora da AIR.
  - VEREDA/MANGUEZAL/RESTINGA/ARL fora da AIR **e** fora da AVN.
  - Relevo (AREA_DECLIVIDADE, BORDA_CHAPADA, AREA_TOPO_MORRO, AREA_ALTITUDE_1800)
    fora da ATP.
  - Sobreposições proibidas entre feições diferentes: AVN×AUAS,
    AVN×AREA_CONSOLIDADA, AVN×PANTANEIRA, AVN×área inundada (rios/lagoas/
    reservatórios), AUAS×CONSOLIDADA, AUAS×inundada, VEREDA×MANGUEZAL×RESTINGA
    entre si, PANTANEIRA×relevo, relevo entre si, UTILIDADE_PUBLICA×INTERESSE_SOCIAL.
  - Justificáveis (dependem de bases de referência externas): ATP×Terra Indígena
    (FUNAI), ATP×Unidade de Conservação, ATP×CAR aprovado (tolerância 0,25 ha ou
    0,5% do menor). *Não implementadas aqui por exigirem as bases da SEMA/FUNAI —
    candidatas a integração futura via WFS.*

## Checks implementados

| Check (UI) | `checks.*` | Tipos de erro | Correção | Saída específica |
|---|---|---|---|---|
| Borda de polígono se cruza | `selfIntersection` | `borda_se_cruza` | unkink → `corrigido_<camada>.shp` | pontos |
| Vértices duplicados / anéis degenerados | `duplicateVertices` | `vertice_duplicado`, `anel_degenerado` | remoção/descarte na camada corrigida | pontos |
| Sobreposição na mesma camada | `overlaps` | `sobreposicao` | — | `poligonos_sobreposicao.shp` |
| Vazios/gaps na mesma camada | `gaps` | `vazio` | — | `poligonos_vazios.shp` |
| Conformidade SIMCAR | `simcarConformity` | `crs_ausente`, `crs_nao_conforme`, `dimensao_nao_2d`, `primitiva_incorreta`, `nomenclatura_desconhecida`, `atp_multipla`, `atributo_ausente`, `feicao_obrigatoria_ausente` | — | tabela/CSV/relatório (nível de camada) |
| Contenção do Anexo 01 | `simcarContainment` | `fora_do_continente` | — | `poligonos_regras_simcar.shp` (`regra=contencao`) |
| Sobreposições proibidas do Anexo 01 | `simcarCrossOverlaps` | `sobreposicao_proibida` | — | `poligonos_regras_simcar.shp` (`regra=sobreposicao`) |
| Soma AIR vs ATP | `airAtpArea` | `air_atp_area` | — | tabela/CSV/relatório (nível de camada) |

Observações:

- Os checks do SIMCAR (conformidade, Anexo 01 e **soma AIR×ATP**) analisam
  **o ZIP inteiro**, independentemente das camadas marcadas — as regras são do
  projeto todo. Sobreposição e **vazios/gaps** rodam nas camadas selecionadas.
- O campo **"Área mínima (m²)"** (padrão 1 m²) filtra ruído numérico de bordas
  quase coincidentes em checks de área (sobreposição, vazios, Anexo 01) e é o
  limiar **absoluto** de |soma(AIR) − ATP|.
- **Vazios/gaps**: diferença entre o envelope convexo das feições da camada e a
  união delas. Só reporta vazios tocados por **≥ 2 feições** (buraco interior
  intencional de uma única feição é ignorado). Fonte: topologia de shapefile/CAR
  (SEMA) — *“não deve haver buracos não intencionais entre polígonos adjacentes”*.
- **Soma AIR vs ATP**: Manual do Projeto Geográfico — ATP obrigatória (polígono
  único) e AIR (uma ou mais) com **soma das AIRs correspondente à ATP**. Erro
  quando `|soma(AIR) − ATP| > max(área mínima m², 0,01% × max(AIR, ATP))`.
  Tolerância relativa configurável em `settings.airAtpMaxDiffRatio` (padrão `1e-4`).
- Erros em nível de camada (conformidade, `air_atp_area`) não entram no
  shapefile de pontos — aparecem na tabela, CSV e relatório.
- A sub-aba **Áreas Não Contidas** continua existindo para containment *manual*
  (escolher alvo/continentes à mão); a Contenção do Anexo 01 é a versão
  automática pelas regras oficiais.

## Conteúdo do ZIP de resultado

- `pontos_erros_geometria.shp/.shx/.dbf/.prj` — um ponto por erro pontual;
- `poligonos_sobreposicao.shp` — sobreposições na mesma camada (`feicao_a`, `feicao_b`, `area_m2`, `area_ha`);
- `poligonos_vazios.shp` — vazios/gaps na mesma camada (`camada`, `feicoes`, `area_m2`, `area_ha`);
- `poligonos_regras_simcar.shp` — violações do Anexo 01 (`camada_a`, `feicao_a`, `camada_b`, `regra`, `area_m2`, `area_ha`);
- `corrigido_<camada>.shp` — camada corrigida (atributo `feicao` preserva o nº original; `corrigido` S/N);
- `resumo_erros.csv` e `relatorio_erros.txt`.

## Arquitetura

- **Backend**
  - `backend/geometry-errors.ts` — rotas `/api/geometry-errors/*` (upload →
    job assíncrono com SSE → download ZIP), detecções geométricas e motores das
    regras (contenção/sobreposição por nomenclatura).
  - `backend/simcar-rules.ts` — módulo **puro** com o conhecimento do SIMCAR:
    nomenclatura/aliases (`recognizeSimcarLayer`), metadados por feição
    (primitiva, atributos obrigatórios, ATP única), `checkSimcarConformity`,
    `SIMCAR_CONTAINMENT_RULES` e `SIMCAR_FORBIDDEN_OVERLAP_PAIRS`.
  - Reuso: parsing de shapefile e CRS em `vertices-proximas.ts`
    (`getZipLayerGroups` agora captura `.dbf`), escrita em `shapefile-writer.ts`.
- **Frontend**: `client/src/components/GeometryErrorsAnalysis.tsx`, 3ª sub-aba
  da Análise de Erros no `Dashboard.tsx` (`errorAnalysisTab === 'geometry'`).
- **Testes**: `backend/geometry-errors.test.ts` e
  `backend/simcar-rules.test.ts`. Rodar com
  `npx vitest run --root . backend/geometry-errors.test.ts backend/simcar-rules.test.ts`
  (o `--root .` é necessário porque o root do vite é `client/`).

## Como adicionar um novo check

1. Detecção pura em `geometry-errors.ts` (ou regra/dado em `simcar-rules.ts`);
2. Novo campo em `GeometryChecks` + wiring em `runGeometryJob` + `hasAnyCheck`;
3. Se o erro não for pontual, adicionar o tipo em `LAYER_LEVEL_TIPOS`;
4. Card em `CHECKS` e rótulo em `TIPO_LABEL` no componente;
5. Testes vitest; cada funcionalidade nova = commit/push separado no main.

## Histórico de commits

- `ddd907b9` borda de polígono se cruza (kinks + unkink)
- `6ed01183` vértices duplicados / anéis degenerados
- `13a92a77` sobreposição na mesma camada
- `546445dc` conformidade SIMCAR (CRS/2D/primitiva/nomenclatura/ATP única/atributos)
- `6d10e130` contenção do Anexo 01
- `a581ce2a` sobreposições proibidas do Anexo 01
- `2026-07-15` vazios/gaps na mesma camada + soma(AIR) vs ATP
