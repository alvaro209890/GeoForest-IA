# 2026-08-07 — Auditoria de bugs das fases pós-recorte (rodada 2)

Segunda rodada de caça a bugs sobre a análise pós-recorte SIMCAR, depois da
auditoria de segurança de `82b30110`. **Esta rodada não toca em segurança**: só
correção, precisão de laudo, custo e desempenho.

A diferença de método em relação à rodada anterior: a Fase 3 foi rodada contra
**shapefiles reais** — o recorte da Santa Clara em
`.oraculo-scratch/santa_clara/v24/` (33 `AREA_CONSOLIDADA`, 117 `AVN`, 88
`TIPOLOGIA_VEGETAL`, 117 `ARL`, 34 `AUAS`). Três dos achados abaixo só aparecem
com dado real; nenhum teste sintético os pegaria.

Flags continuam **desligadas** (`SIMCAR_AUAS_V2_ENABLED`,
`SIMCAR_AUAS_POS2008_ENABLED`, `SIMCAR_AC_VEG_ENABLED`): nada disso muda o
comportamento de produção hoje.

---

## 1. Deadlock: fase `STALE` nunca podia ser refeita 🔴

**Sintoma:** a fase envelhecida mostrava "O resultado anterior ficou
desatualizado. **Refaça esta fase**" e a rota respondia `409 PHASE_NOT_READY` —
para sempre. Refazer a fase anterior não ajudava: deixava esta ainda mais velha.

**Causa:** `checkPhaseGate` só liberava `AVAILABLE` e `COMPLETED`. `STALE` caía
no 409 genérico.

**Correção:** `STALE` tem dois significados e agora eles são distintos:

| Motivo | Estado | Rota |
|---|---|---|
| `phase_stale` — o resultado **desta** fase envelheceu | `STALE` | **libera** a re-execução |
| `previous_phase_stale` — a fase **anterior** envelheceu | `STALE` | continua barrada (quem roda é a de trás) |

Sem a separação, liberar `STALE` deixaria a Fase 3 rodar sobre uma datação da
Fase 2 que já não corresponde ao recorte.

`backend/simcar/phases.ts`. Regressão: 3 testes em `phases.test.ts`.

## 2. Fase 2 confirmava ANO exato sobre anos não consecutivos 🔴

**Sintoma:** transição relatada como 2010→2015 (intermediários fora do catálogo)
virava `CONFIRMADO_ANO 2015` — precisão que a série não sustenta, num laudo que
data desmate.

**Causa:** a regra 2 exigia "dois anos utilizáveis concordando" mas **não** que
fossem consecutivos. Pior: como a regra 2 capturava esse caso, a regra 3
(intervalo) só era alcançada quando os extremos **não** eram observáveis — ou
seja, as duas regras estavam invertidas na prática.

**Correção:** regra 2 exige `toYear === fromYear + 1`; regra 3 exige que os dois
extremos sejam utilizáveis e concordantes (nativo em A, antrópico em B) e agora
reporta corretamente `crossedSensorBoundary` no intervalo.

`backend/analise-pos-recorte/pos2008/evidence-reducer.ts`. Regressão: arquivo de
teste novo `pos2008/evidence-reducer.test.ts` (7 casos) — o redutor da Fase 2 não
tinha teste próprio.

## 3. Ano reprovado no GetMap apagava a troca de sensor 🔴

**Sintoma:** a janela-ponte deixava de ser exigida numa transição que atravessa
troca de sensor, e o polígono saía com ano exato onde deveria sair intervalo.

**Causa:** `knownSensorBoundaries` comparava **posições vizinhas do array**. Um
ano reprovado vira `preferred: null` no meio da série; com 2012 (ResourceSat)
fora, os pares (2011, 2012) e (2012, 2013) eram pulados e a fronteira real
2011 (L5) → 2013 (L8) simplesmente não existia.

**Correção:** a varredura compara anos **habilitados** consecutivos, pulando os
nulos sem perder a referência anterior.

**Bug irmão, achado pelo próprio teste:** quando o catálogo não tinha nenhuma
fronteira, a função caía na lista **estática** (2011→2012, 2012→2013, 2018→2019)
e inventava trocas de sensor que aquele catálogo não tem — e fronteira falsa
rebaixa `CONFIRMADO_ANO` para `CONFIRMADO_INTERVALO` sem motivo. A lista estática
agora só vale quando nenhum catálogo foi passado.

`backend/analise-pos-recorte/pos2008/timeline.ts`. Regressão: 2 testes.

## 4. Fase 3: 100% das ACs saíam como alerta ALTO 🔴 *(só com dado real)*

**Medição na Santa Clara (33 ACs):**

| Camada dentro da AC | Resultado |
|---|---|
| `AVN` | **0,00 ha** em todas as 33 — o esperado (AC e AVN não devem se sobrepor) |
| `TIPOLOGIA_VEGETAL` | **~100% de cada AC**, somando 3.134,48 ha |

A `TIPOLOGIA_VEGETAL` da SEMA é o **mapa de tipologia do imóvel inteiro**,
incluindo classes antrópicas — não uma declaração de vegetação nativa. Como o
redutor somava `AVN ∪ TIPOLOGIA_VEGETAL` na "área declarada", **toda** AC batia o
limiar de 1% / 0,5 ha e saía `VEGETACAO_DECLARADA_DENTRO_DA_AC` / **ALTO**. Uma
fase cujo alerta dispara em 100% dos casos não discrimina nada.

**Correção:** a área declarada passa a considerar só a `AVN` por padrão — a
camada que o próprio plano (doc 06 §2.1) define como "vegetação nativa declarada
pelo projeto". A tipologia continua **medida e reportada** (área, fração,
`tipologias`), e quando cobre ≥95% da AC entra uma limitação explícita no laudo
dizendo que ali é camada de cobertura, não mancha declarada.

> **Ressalva ao plano:** o doc 06 §3 especifica `AVN ∪ TIPOLOGIA_VEGETAL` como
> gatilho do ALTO. O dado real mostra que essa premissa não se sustenta sem
> filtrar a tipologia pela **classe** (atributo do `.dbf`), que o pipeline
> geométrico atual não lê. O comportamento antigo continua disponível em
> `SIMCAR_AC_VEG_DECLARED_SOURCES=AVN,TIPOLOGIA_VEGETAL`. Decisão de manter ou
> reverter é do Álvaro — nada disso está ligado em produção.

`ac-vegetacao/geometry-evidence.ts`, `evidence-reducer.ts`, `config.ts`.

## 5. Fase 3: 1,5 s de CPU por AC, sempre 🟠 *(só com dado real)*

As uniões das camadas (117 AVN + 88 tipologia + 117 ARL + 34 AUAS) eram
recalculadas **para cada polígono de AC** — custo constante, independente do
tamanho da AC. As 33 ACs da Santa Clara levavam **52 s** de CPU pura.

**Correção:** as camadas são indexadas uma vez (`prepareLayerUnions`) e cada AC
só une/intersecta as feições cuja **bbox** realmente encosta nela.

| | Antes | Depois |
|---|---|---|
| 33 ACs (Santa Clara) | 52,0 s | **2,0 s** |
| por AC | ~1,55 s | ~0,06 s |

Números idênticos nas duas versões (conferido AC a AC); há teste garantindo que o
caminho indexado e o direto dão o mesmo `geometric`.

## 6. Fase 3: AC de 0,00 ha pagava 3 cenas WMS + 1 chamada de visão 🟠

O recorte real tem 5 ACs com área de ~0,00 ha (1 a 43 m²) — resíduo de topologia.
Cada uma disparava 3 `GetMap` e uma chamada de visão para um polígono que o
Sentinel-2 não resolve. O próprio doc 06 §3 já mandava classificar
"polígono menor que a resolução efetiva do sensor" como `INCONCLUSIVO`.

**Correção:** AC abaixo de `SIMCAR_AC_VEG_MIN_ANALYSABLE_AREA_HA` (default
**0,05 ha** = 500 m² ≈ 5 pixels do S2) sai como `INCONCLUSIVO` com limitação
explícita, **antes** de gerar cena — mantendo a evidência geométrica, que é de
graça. Janela registrada como `SKIPPED / POLYGON_TOO_SMALL`.

## 7. Correções menores de precisão de laudo 🟡

- **Nomenclatura errada das camadas.** A evidência dizia que a AC sobrepunha
  "área de preservação permanente" (era `ARL` = Área de **Reserva Legal**) e
  "área de uso restrito" (era `AUAS` = Área de **Uso Alternativo do Solo**).
  Nomes errados num laudo técnico do SIMCAR. *O teste existente travava
  justamente o texto errado — foi corrigido junto.*
- **`SEM_VEGETACAO_APARENTE` carimbava `confidence: "HIGH"` fixo**, mesmo apoiado
  só em cenas `MEDIUM`. Agora usa a pior confiança entre as cenas que sustentam a
  ausência.
- **`tipologias` era um placeholder sempre presente** (`["camada
  TIPOLOGIA_VEGETAL presente"]`), inclusive para AC que não encosta na camada —
  `[]` é truthy. Agora só sai quando há interseção, com a área medida.
- **Fallback do `union` do turf devolvia só `polys[0]`**, descartando o resto da
  camada em silêncio e subestimando a área declarada (o que empurra o polígono
  para um alerta menor sem deixar rastro). Agora monta um `MultiPolygon` com
  todas as partes.
- **Referência de datação inventada.** Sem Fase 2 concluída, a Fase 3 gravava
  `pos2008JobRef` com `completedAt = agora` — uma referência que nunca existiu.
  Agora é `null`, e `rulesVersion` vem da constante importada em vez de string
  solta.
- **Ano da cena atual fixo em 2024** enquanto a camada vinha de
  `SIMCAR_AC_VEG_SCENE_CURRENT`: um override por env rotulava a cena com o ano
  errado, e o validador do JSON compara o ano declarado com o da cena enviada.
  Agora o ano é lido do nome da camada.
- **Override de camada da Fase 2 inventava `sensor: "SENTINEL_2"`.** Um
  `SIMCAR_AUAS_LAYER_<ano>` apontando para camada não publicada era rotulado
  Sentinel-2 fixo, criando ou escondendo troca de sensor — e é a troca de sensor
  que exige janela-ponte. Agora o sensor sai do nome (`classifyMosaicLayer`), com
  `UNKNOWN` quando não casa, e o ano é sempre o da série.
- **`targets.indexOf(polygon)`** dentro do laço da Fase 3: O(n²) e índice errado
  quando dois polígonos são a mesma referência. Trocado por índice do laço.
- Constantes de ano do redutor da Fase 2 (`2009`/`2019` espalhados) passam a vir
  de `POS2008_SERIES_START`/`END`.

## 8. Suíte: `pnpm test` estava vermelho no `main` 🟠

`pos2008/orchestrator.test.ts` gera e redimensiona 12 PNGs com `sharp`. Sozinho
roda em ~1 s, mas o default de 5 s do vitest estourava quando o arquivo dividia
CPU com `processar-projeto.test.ts` (~108 s) na suíte completa — falha
intermitente, e o `main` estava efetivamente quebrado. Timeout explícito de 60 s
no caso, com o motivo no comentário.

---

## Verificação

```
pnpm run check   → limpo
pnpm test        → 612 passed / 8 skipped (0 falhas; 590 antes, com 1 falha intermitente)
pnpm run build   → verde
```

Sonda com dado real (não versionada): evidência geométrica das 33 ACs da Santa
Clara, antes e depois — mesmos números, 52 s → 2 s, área declarada de
3.134,48 ha (falsa) → 0,00 ha (correta).

## Variáveis de ambiente novas

| Variável | Default | Efeito |
|---|---|---|
| `SIMCAR_AC_VEG_DECLARED_SOURCES` | `AVN` | Camadas somadas na área declarada. `AVN,TIPOLOGIA_VEGETAL` restaura o comportamento anterior. |
| `SIMCAR_AC_VEG_MIN_ANALYSABLE_AREA_HA` | `0.05` | AC menor que isto não gera cena nem chamada de visão. |

Nenhuma delas precisa ser criada no servidor: os defaults são o comportamento
desejado.
