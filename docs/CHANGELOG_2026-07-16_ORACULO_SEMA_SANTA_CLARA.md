# Changelog — Oráculo SEMA ao vivo: calibração definitiva da importação (CAR Santa Clara)

**Data:** 2026-07-16
**Branch:** `main`
**Commits:** `750d6e8d` (1ª calibração, superada) → `c77d3b26` (regra definitiva)

## Resumo executivo

Usando o **importador real do SIMCAR** como oráculo (CAR 270069 — "Santa clara",
Querência, conta do Álvaro), descobrimos por **bissecção empírica** o que o
"Borda do polígono se cruza" da SEMA realmente detecta, corrigimos o validador
do GeoForest para paridade exata, corrigimos o shapefile do imóvel e obtivemos
**"Geometrias importadas com sucesso!"** (importação `[FINALIZADO]`) — seguido
do disparo do ProcessarGeo oficial.

## A descoberta central (vale para qualquer CAR)

O detector anterior (snap em grade 0,05 m + kinks, commit `d1e2ecc4`/`750d6e8d`)
batia com o PDF **por coincidência de contagem**. A verdade, provada com uploads
de sonda no importador real:

1. **Encoste pontual de vértice em borda NÃO reprova.** Feições com vértice a
   0,015–0,076 m de borda não adjacente do próprio anel (feições 45, 89, 100,
   102, 107, 108, 119…) foram isoladas em camadas-sonda e **passaram limpas**.
   É a regra ESRI: toque pontual da borda é geometria válida.
2. **O que reprova é anel COLAPSADO** (paredes que se sobrepõem na resolução
   do importador):
   - **micro-resíduo**: área ≤ ~0,01 m² (feição 111: triângulo de 0,58 m de
     perímetro e 0,0049 m²);
   - **agulha/sliver fino**: largura mínima (rotating calipers) ≤ ~0,02 m
     (feição 115: ida-e-volta de 186 m com largura 0,0173 m).
   Régua completa do oráculo (todos os anéis finos do pacote):

   | anel | área m² | largura m | SEMA |
   |---|---|---|---|
   | ARL:111 (e gêmea 232) | 0,0049 | 0,0344 | **reprova** |
   | ARL:115 (e gêmea 236) | 1,61 | 0,0173 | **reprova** |
   | AUAS:15 | 4,28 | 0,0231 | passa |
   | ARL:112 | 0,0208 | 0,051 | passa |
   | AREA_CONSOLIDADA:3 | 8,90 | 0,042 | passa |

3. **"A geometria contém pontos repetidos"** = vértices consecutivos a
   ≤ ~0,1 m (feições 66/187 tinham pares a 0,03–0,09 m; removidos → sumiu do
   PDF). Confirmado nas duas direções.
4. A contagem do PDF é **por local** (as gêmeas do bloco duplicado contam
   separadas: 2 sites × 2 cópias = 4).

Implementação em `backend/geometry-errors.ts`:
`SIMCAR_IMPORT_COLLAPSE_WIDTH_M = 0.02`, `SIMCAR_IMPORT_COLLAPSE_AREA_M2 = 0.01`,
`SIMCAR_IMPORT_DUP_TOLERANCE_M = 0.1`; kinks exatos continuam. O snap em grade
e a "justificativa por proximidade" foram removidos.

## Como descobrimos (método reutilizável)

1. Baixamos do SIMCAR o `[ARQUIVO_ENVIADO]` e o `[PDF_RELATORIO_IMPORTACAO]`
   do CAR (byte-idêntico à fixture `teste_1`).
2. Reproduzimos localmente, corrigimos o óbvio (pontos repetidos + vértices
   "quase encostando"), reenviamos → **pontos repetidos zeraram, bordas não**.
3. **Camadas-sonda**: as 5 feições suspeitas foram enviadas uma-por-camada
   vazia (VEREDA, RESTINGA, MANGUEZAL, AREA_USO_RESTRITO, BORDA_CHAPADA) —
   o PDF revela o veredito individual de cada uma. Todas passaram.
4. **Bissecção por baldes**: as 242 feições do ARL repartidas em 12 camadas
   vazias (~21 cada) → PDF apontou 2 baldes com erro → repetimos com 1 feição
   por camada → **feições 111 e 115 identificadas** (~2 min por iteração).
5. Medimos área/largura de TODOS os anéis finos → regra dual com margem.

## Correção final do imóvel (mínima, sem distorcer o desenho)

A partir do ZIP original enviado:
- ARL e AVN: **remove** os 2 vértices repetidos (feições 66/187) e **deleta**
  as 4 feições degeneradas (111/115/232/236 — resíduos sem representação real,
  1,6 m² no total).
- Nada mais muda (os deslocamentos de 0,5 m de iterações intermediárias foram
  revertidos — eram desnecessários).
- Removidos do pacote: `RELATORIO_CORRECAO_SIMCAR.txt/json` (relatório antigo)
  e `.sbn/.sbx/.shp.xml` das camadas alteradas (índices ficariam obsoletos).

Resultado no SIMCAR: **"Situação da importação: Geometrias importadas com
sucesso!"** (`ImportacaoResultado: [FINALIZADO]`), primeira aprovação do CAR.
ZIP final: `Recorte_SANTA_CLARA_FINAL_16-07-26.zip` (963 KB, ARL/AVN com 238
feições cada).

## Contrato da API do SIMCAR (Projeto Geográfico) — engenharia reversa validada ao vivo

Base: `https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api`
(mesma auth do módulo de pareceres do acompanhamento-de-processos: token
`TECNICO …` do `POST /Autenticacao/Autenticar` com corpo `{v: scramble(JSON)}`,
header `authorization` cru; sessão ÚNICA por conta; só IP brasileiro.)

| Operação | Endpoint | Notas |
|---|---|---|
| Detalhe do CAR | `GET /Requerimento/Buscar/{id}` | `SituacaoImportarGeo`, `SituacaoProcessamentoGeo`, `Arquivos[]` (categorias `[REQUERIMENTO_CARACTERIZACAO]` etc.) |
| Status dos jobs | `GET /Requerimento/BuscarStatusProcessamento/{id}` | `ImportacaoShapeStatus/Resultado`, `ProcessamentoStatus/Resultado` (`[AGUARDANDO]→[EXECUTANDO]→[CONCLUIDO]`; resultado `[EM_ABERTO]/[COM_PENDENCIA]/[FINALIZADO]`) |
| Upload de arquivo | `POST /Arquivo/Upload/` | multipart (campo `file`, Dropzone padrão), header `authorization`; resposta = array JSON, `[0]` = objeto Arquivo `{Id, Nome, Situacao}` |
| Importar shapefile | `POST /Requerimento/ImportarArquivoShape` | corpo `{RequerimentoId, Arquivo: <objeto do upload>}`; dispara job assíncrono |
| Processar (GEO) | `POST /Requerimento/ProcessarGeo/{id}` | só com importação `[FINALIZADO]`; job demorado (minutos) |
| ZIP enviado | `POST /Requerimento/DownloadArquivoEnviado/{id}` | binário; header `authorization` funciona (o app oficial usa form POST `toDoWithForms` com campo `Authorization`) |
| PDF da importação | `POST /Requerimento/DownloadPdfImportacaoShapefile/{id}` | o "Relatório de importação" com erros e inventário |
| Arquivo processado | `POST /Requerimento/DownloadArquivoProcessado/{id}` | ZIP principal do pós-processamento |
| PDF do processamento | `POST /Requerimento/DownloadPdfRelatorioProcessamento/{id}` | |
| Erros de topologia | `POST /Requerimento/DownloadArquivoErrosProcessamento/{id}` | |
| Erros de APP | `POST /Requerimento/DownloadArquivoErrosProcessamentoApp/{id}` | |
| Arquivo de conferência | `POST /Requerimento/DownloadArquivoConferencia/{id}` | |
| Cancelar importação | `POST /Requerimento/CancelarImportacaoShape/{id}` | |
| Cancelar processamento | `POST /Requerimento/CancelarProcessamentoGeo/{id}` | |

Cliente Node de referência usado nesta sessão: scramble importado de
`acompanhamento-de-processos/backend-email-render/simcar-scramble.js`; upload
com `FormData`/`Blob` nativos do Node 22.

## Iterações no oráculo (histórico dos uploads no CAR 270069)

| # | Pacote | Veredito SEMA |
|---|---|---|
| 0 | original (`teste_1`) | Reprovado — ARL/AVN 4 bordas + 2 pontos |
| 1 | v2 (dups removidos + 30 vértices afastados 0,5 m) | Reprovado — ARL/AVN 4 bordas (pontos zeraram) |
| 2 | sonda (5 candidatas isoladas + faixa ≤0,1 m limpa) | Reprovado — ARL/AVN 4; sondas limpas |
| 3 | baldes 12× (~21 feições cada) | Reprovado — BORDA_CHAPADA 2, AURD 2 (= feições 106–126 e 232–242) |
| 4 | baldes 1× (111–121 individuais) | Reprovado — VEREDA(111) 1, BORDA_CHAPADA(115) 1 |
| 5 | **final** (mínimo: −2 dups, −4 degeneradas) | **Aprovado — importação `[FINALIZADO]`** |

## Testes

`backend/processar-projeto.test.ts` trava o oráculo exato (12 linhas, feições
111/115/232/236 e 66/187 em ARL+AVN, nada nas demais camadas).

```bash
npx vitest run --root . backend/processar-projeto.test.ts \
  backend/geometry-errors.test.ts backend/simcar-rules.test.ts
```

## ProcessarGeo oficial: disparado e usado como 2º oráculo

Com a importação aprovada, disparamos `POST /Requerimento/ProcessarGeo/270069`
(job de ~5 min) e baixamos o relatório + `erros_processamento` + `conferencia`.
Resultado SEMA: **Reprovado** (pendências reais do dado, não de geometria):

| Erro (SEMA) | Qtde SEMA | GeoForest após paridade |
|---|---|---|
| RESERVATORIO_ARTIFICIAL sem barramento fora de AUAS/Consolidada | 12 | **12 (exato)** |
| (Campo SITUACAO) deve ser 'O' em reservatório sem barramento | 13 | **13 (exato)** |
| Soma AVN+AUAS+Consolidada+Hidrografia ≠ AIR tipo 'M' | 9 matrículas | **9 (mesmas matrículas: 8.157/8.158/8.160/8.162/8.163/10.636/10.637/13.514/13.515)** |
| AVN sobrepondo AVN / ARL sobrepondo ARL | 106 / 106 | 127/127 (semântica de contagem deles difere — ver abaixo) |
| AVN×Área Consolidada / AUAS×Área Consolidada | 8 / 2 | 14 / 5 (idem — limiar/agrupamento) |

Paridade implementada no GeoForest (commit `86cac433` + calibração):
- Checks novos com as mensagens EXATAS da SEMA: `detectReservatorioRules`
  (usa BARRAMENTO/SITUACAO do .dbf) e `detectAirCompositionConsistency`
  (mensagem com IDENTIFIC da matrícula).
- Relatório nas 4 seções oficiais (Erros espaciais / sobreposição e
  obrigatoriedades / atributos / Geometrias encontradas) com "X está
  sobrepondo Y n vezes.".
- `ERROS_DE_SOBREPOSICAO.shp` no `erros_processamento.zip` — mesmo nome e
  schema do arquivo oficial (pontos, `ID` + `DETALHES` "A com B"; o da SEMA
  tinha 222 registros = 106+106+8+2).
- **Sem autocorreção**: o arquivo processado replica as camadas como enviadas
  (o SIMCAR reprova na importação, não conserta o shape do técnico).
- Calibrações do oráculo: contenção ignora vazamentos < 100 m² (SEMA ignorou
  até 78 m²); sobreposição com hidrografia (AVN×RIO etc.) não entra no
  relatório de processamento (SEMA não reporta — fica na aba Erros de
  Geometria).

**Diferença conhecida (documentada, sem dado para fechar):** a contagem de
"n vezes" das sobreposições da SEMA (106 vs nossos 127 pares ≥1 m²) não bate
com nenhum limiar de área simples (na varredura, ≥100 m² ainda dá 114) —
provavelmente eles agrupam regiões contíguas ou dissolvem antes de contar.
Fechar isso exigiria outra rodada de sondas no ProcessarGeo (a ~6 min por
iteração), fica como próximo passo.

## Pendências REAIS do imóvel (para o Álvaro decidir — não é bug de geometria)

O ProcessarGeo oficial reprova o projeto da Santa Clara por dados:
1. **ARL e AVN têm o bloco inteiro duplicado** (cada polígono 2×: feições
   1–121 ≈ 122–242) → "sobrepondo 106 vezes" + soma de AVN dobrada (62.327 ha
   p/ ATP de 37.884 ha), o que derruba a conferência das 9 AIRs. Remover o
   bloco duplicado provavelmente resolve os dois grupos de erro.
2. **12 reservatórios sem barramento fora de AUAS/Área Consolidada** — exige
   redesenho do uso do solo ao redor (decisão cartográfica).
3. **13 reservatórios sem barramento com SITUACAO ≠ 'O'** — correção mecânica
   de atributo no .dbf.
4. AVN×Consolidada (8) e AUAS×Consolidada (2) — recortes entre usos.

## Limites / honestidade

- A regra dual (0,02 m / 0,01 m²) é **empírica** deste oráculo; margens
  medidas: área ×4, largura +34%. Anéis finos *curvos* longos (largura local
  pequena mas hull largo) não são cobertos — sem dado do oráculo para eles.
- Agulha "pendurada" em polígono normal (espiga local) também não tem dado de
  oráculo; o teste de espiga foi tentado e removido por superdetecção.
- O upload/ImportarArquivoShape do SIMCAR substitui o arquivo do CAR na hora —
  as sondas deixaram rastros temporários (o arquivo final restaurou tudo).
