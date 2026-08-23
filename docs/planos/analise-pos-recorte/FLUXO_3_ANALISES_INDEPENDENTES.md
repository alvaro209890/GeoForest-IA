# As 3 análises pós-recorte são independentes

> 2026-08-23 · validação completa do fluxo pedida pelo Álvaro
> Imóvel de teste: job `27ca02d3-a2a8-40bb-8f82-461e1c72d18e` (2 polígonos AUAS · 2 Áreas Consolidadas)

## O fluxo que o sistema tem de ter

Na aba **Recorte SIMCAR**: envia o polígono → executa o recorte → **abaixo do
recorte aparecem 3 análises, cada uma desbloqueada por conta própria**:

| # | Análise | Pergunta | Camada que lê |
|---|---|---|---|
| 1 | AUAS 2003–2008 | O polígono declarado como AUAS **é mesmo AUAS**, ou já havia uso/mexida na vegetação antes de 22/07/2008? | `AUAS` |
| 2 | Datação 2008–2019 | **Em que ano** a supressão ocorreu em cada polígono AUAS? | `AUAS` |
| 3 | Vegetação na AC | Sobrou **vegetação nativa dentro da Área Consolidada** declarada? | `AREA_CONSOLIDADA` |

Cada uma gera **o seu próprio laudo** (PDF + Word, papel timbrado IMAP),
baixável no card da própria análise.

## O que estava fora do fluxo

### 1. A Fase 3 exigia as Fases 1 **e** 2

`derivePhase3` abria com:

```ts
if (!isPhase1Completed(input.auasMeta)) return blocked("requires_PRE_2008");
if (!pos2008Meta?.completedAt)          return blocked("requires_POS_2008");
```

A pergunta mais simples e mais barata das três (~1 min/polígono) ficava trancada
atrás de ~7 min/polígono de duas análises que **não a respondem**. Pior: o
orquestrador da Fase 3 já aceitava `pos2008CompletedAt: null` — o encadeamento
era só do gate, não da lógica.

Havia ainda invalidação cruzada: refazer a Fase 1 marcava a Fase 2 como `STALE`
e a Fase 3 herdava `previous_phase_stale` (**barrada**, e refazer a própria fase
não resolvia).

**Corrigido:** o único pré-requisito de cada fase é a camada que ela lê. Sumiram
os motivos `requires_PRE_2008`, `requires_POS_2008`, `previous_phase_stale` e
`phase_stale`, e com eles a função `isStaleAfter`.

Quando uma fase vizinha já rodou, o resultado dela entra como **contexto**
(a F2 usa o alerta pré-2008 da F1; a F3 usa a data da F2 quando existe) —
contexto opcional, nunca requisito.

### 2. A Fase 3 estava desligada por flag

`SIMCAR_AC_VEG_ENABLED` não existia em `~/.config/geoforest/backend.env`, e o
default é `false` → o card mostrava *"Fase ainda não disponível nesta versão"*.
Ligada em 23/08/2026 (backup do env em `backend.env.bak-fase3-*`).

### 3. Cada análise apagava o laudo da anterior 🔴

O job tinha **um slot só** de laudo (`reportPdfUrl`), e toda geração chamava
`discardSupersededReportFiles`, que apagava do storage o arquivo anterior.
Enquanto as fases eram encadeadas isso passava; com elas soltas, rodar a Fase 3
**destruía o PDF da Fase 1**.

**Corrigido:** `generateAndPersistSimcarReport` recebe `phase` e guarda o
artefato em `phaseReports[fase]`, além do slot de topo (que segue apontando para
o laudo mais recente, para a UI antiga). A limpeza agora preserva a união de
tudo que está em `phaseReports` e só descarta o laudo anterior **da mesma fase**.

O payload de `GET /api/simcar/clip/phases/:jobId` ganhou `report` por fase
(`pdfUrl`, `docxUrl`, `generatedAt`, `filename`) e o `FaseCard` mostra
**"Laudo desta análise (PDF)"** + **"Word"** em cada card.

### 4. Efeito colateral de soltar as fases: corrida entre elas

Sem os gates de dependência, três fases ficam iniciáveis ao mesmo tempo — e uma
fase já `COMPLETED` continua `COMPLETED` enquanto outra roda, então o botão
"Refazer" dela dispararia uma segunda análise em paralelo. As duas gravam o
mesmo JSON do job (`persistSimcarClipArtifacts`) → *lost update*.

**Corrigido:** `checkPhaseGate` recusa com `PHASE_ALREADY_RUNNING` sempre que
**qualquer outra** fase está `RUNNING`, independente do estado da fase pedida; o
front desabilita o botão no mesmo caso. Uma fase por job, sempre — essa é a
única exclusão que sobrou.

## O que já estava certo (conferido, não mexido)

- **Conteúdo da Fase 1:** o quadro de achados abre com *"Uso do solo anterior a
  22/07/2008 em polígono AUAS"* e explica que, se confirmado, **a área é
  consolidada (AC), não supressão pós-2008** — é a resposta a "é mesmo AUAS?".
  O corpo traz uma seção por polígono (`AUAS-0001`, `AUAS-0002`…), a seção
  **"Áreas Passíveis de Discussão"** nomeia os polígonos com desmate
  parcial/gradual ou inconsistência geométrica, e o anexo fotográfico mostra
  **todas as cenas de cada polígono por ano** — ou seja, em qual polígono a
  vegetação foi mexida.
- **Conteúdo da Fase 2:** uma seção por polígono com `Status`, `Primeiro ano
  observado de conversão` e `Intervalo observado`, mais o histograma por ano no
  resumo.
- **Fase 3:** lógica intocada — segue cruzando AVN declarada com a cena atual,
  como já era feito.
- Os 3 cards já ficavam **abaixo do recorte** no painel do SIMCAR
  (`AnalisePosRecortePanel` em `Dashboard.tsx`).

## Validação no imóvel real

Estado das fases logo após o recorte, sem nenhuma análise rodada:

```
camadas: AUAS=2  AC=2
PRE_2008  | AVAILABLE | gate: LIBERADO | laudo: não
POS_2008  | AVAILABLE | gate: LIBERADO | laudo: não
AC_VEG    | AVAILABLE | gate: LIBERADO | laudo: não
```

Antes, `AC_VEG` vinha `BLOCKED / requires_PRE_2008`.

As três foram executadas **na ordem inversa (3 → 2 → 1)**: se a Fase 3 roda
primeiro e sozinha, a independência está provada de fato, não só no gate.

**Fase 3 sozinha** (sem F1 nem F2 no job): rodou, persistiu `acVegetacaoMeta` e
gerou o próprio laudo. **Fase 2 em seguida**: rodou e gerou o dela. Os dois
arquivos coexistem no storage —

```
simcar/output/1787521739592_SIMCAR_Laudo_Tecnico_27ca02d3.pdf   321.913 B  (Fase 3)
simcar/output/1787521739772_SIMCAR_Laudo_Tecnico_27ca02d3.docx   94.083 B  (Fase 3)
simcar/output/1787523139590_SIMCAR_Laudo_Tecnico_27ca02d3.pdf   326.181 B  (Fase 2)
simcar/output/1787523139761_SIMCAR_Laudo_Tecnico_27ca02d3.docx   94.566 B  (Fase 2)
```

— e o estado das fases passa a ser:

```
PRE_2008  | AVAILABLE | gate: LIBERADO | laudo: não
POS_2008  | COMPLETED | gate: LIBERADO | laudo: sim
AC_VEG    | COMPLETED | gate: LIBERADO | laudo: sim
```

Por fim a **Fase 1**, fechando as três. Os 6 arquivos coexistem e cada PDF traz
a seção da sua própria análise:

```
1787523223696_..._27ca02d3.pdf  1.771.962 B  "Fase 1 — AUAS anterior ao marco de 2008 (série 2003–2008)"
1787523139590_..._27ca02d3.pdf    326.181 B  "Fase 2 — Datação da conversão por polígono AUAS"
1787521739592_..._27ca02d3.pdf    321.913 B  "Fase 3 — Vegetação remanescente dentro da Área Consolidada"
```

(o da Fase 1 é maior por causa do anexo fotográfico por polígono/ano)

```
PRE_2008  | COMPLETED | gate: LIBERADO | laudo: sim
POS_2008  | COMPLETED | gate: LIBERADO | laudo: sim
AC_VEG    | COMPLETED | gate: LIBERADO | laudo: sim
```

No comportamento antigo o PDF da Fase 3 teria sido **apagado** ao gerar o da
Fase 2, esse por sua vez ao gerar o da Fase 1 — sobraria um só — e a Fase 1
sequer apareceria destrancada antes das outras duas.

### Achado extra no laudo da Fase 1

`STATUS_LABEL` no `deepseek-text-client.ts` não conhecia `SINAL_DE_DUVIDA` (o
status criado em 22/08): o laudo determinístico imprimia o **enum cru** na linha
que o RT lê para saber se houve desmate parcial. E os `doubtSignals` — que
dizem *em qual polígono* a vegetação foi mexida — existiam só na seção visual,
nunca no corpo do texto. Corrigidos os dois, com o `doubtCount` no resumo
executivo.

## Testes

- `backend/simcar/phases.test.ts` (24) — reescrito para a regra nova: as 3
  nascem `AVAILABLE` juntas; a F3 roda sem AUAS no recorte; refazer a F1 não
  invalida as outras; nenhum `requires_*` sobra no payload; o gate recusa até
  fase `COMPLETED` enquanto outra roda; as 3 reagem igual a uma execução alheia.
- `backend/simcar/phase-reports.test.ts` (10, novo) — um laudo por fase, sem
  herdar o da vizinha; gerar a F3 **não** apaga os laudos da F1/F2; refazer a
  mesma fase apaga só os arquivos dela; fluxo clássico sem fase preservado;
  nunca apaga arquivo de outro usuário.
- `client/.../phase-state.test.ts` (14) — cards: rótulo "Analisar" nas três,
  botão de fase concluída desabilitado enquanto outra roda, laudo no card certo.
- `backend/analise-pos-recorte/evidence-reducer-doubt.test.ts` (+1) — rótulo e
  sinais de dúvida no corpo do laudo.
- Suíte completa: **874 passando / 8 skipped**; `tsc --noEmit` limpo.
