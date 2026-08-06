# 2026-08-05 — Análise pós-recorte: fundação (F0.3 → F0.6)

Primeira rodada de **código** do plano [`docs/planos/analise-pos-recorte/`](planos/analise-pos-recorte/INDEX.md).
Escopo: **só a base** — nada de IA nova, nenhum ano novo de imagem, nenhuma fase nova
rodando. As fases 2 e 3 continuam **não implementadas** e agora aparecem na tela
desabilitadas, com o motivo em texto.

## O que entrou

| Tarefa do plano | Entrega |
|---|---|
| **F0.3** | `backend/analise-pos-recorte/polygons.ts` — extração genérica de polígonos por camada; `auas-polygons.ts` virou wrapper |
| **F0.4** | `checkpoint-store.ts` — chave de checkpoint com namespace de fase e `catalogVersion` |
| **F0.5** | `GET /api/simcar/clip/phases/:jobId` + `backend/simcar/phases.ts` (regra de desbloqueio) + allowlist de auth |
| **F0.6** | Painel `AnalisePosRecortePanel` com os 3 cards, ligado só à Fase 1; o Dashboard perdeu o botão solto de AUAS |

### F0.3 — polígonos genéricos

`extractPolygonsFromLayer(clippedGeometries, layer, prefix)` faz o que
`extractAuasPolygons` fazia, para qualquer camada do recorte. O prefixo do
`polygonId` sai de `LAYER_ID_PREFIXES` (`AUAS` → `AUAS-0001…`, `AREA_CONSOLIDADA` →
`AC-0001…`), então a Fase 3 já tem seu espaço de IDs. `extractAuasPolygons` continua
existindo com a mesma assinatura e o mesmo resultado — os testes antigos passam sem
alteração e um teste novo compara as duas saídas item a item.

Também entrou `countLayerPolygons`, que conta polígonos sem calcular área/hash — é o
que a rota de fases usa para montar a prévia.

### F0.4 — checkpoint por fase

A chave passou de um SHA-256 solto para:

```text
<phase>::<rulesVersion>::<catalogVersion>::<sha256 de {jobId, geometryHash, windowId, imagens}>
```

`phase` ∈ `PRE_2008 | POS_2008 | AC_VEG`; `catalogVersion` é `static-pre2008` na Fase 1
(catálogo fixo em `config.ts`) e será o catálogo descoberto ao vivo nas fases 2 e 3.
Consequência prática: mudar regra ou catálogo **invalida** o checkpoint em vez de
reaproveitar observação feita sobre outra imagem. Chaves gravadas por versões
anteriores continuam legíveis no arquivo do job (o store não interpreta a chave);
elas só não colidem com as novas — na prática uma janela antiga é recomputada.

### F0.5 — estado das fases no servidor

```
GET /api/simcar/clip/phases/:jobId   (exige token Firebase)
```

Devolve o contrato do doc 08 §1: contagem de polígonos (`AUAS` e `AREA_CONSOLIDADA`) e,
por fase, `state` + `blockedReason` + `blockedMessage` + `estimate` + `summary`.
**A regra de desbloqueio mora aqui**, em `backend/simcar/phases.ts`:

- Fase 1 disponível quando o recorte tem ≥1 polígono AUAS; concluída quando existe
  `auasMeta` **V2 com `completedAt`** — card antigo (V1, janela 2008–2024) não conta;
- Fase 2 exige a Fase 1 concluída; Fase 3 exige a Fase 2 concluída **e** camada
  `AREA_CONSOLIDADA`;
- camada vazia é motivo explicado, não erro;
- resultado de fase posterior a uma fase refeita vem marcado como `stale` — nunca some.

`checkPhaseGate()` já devolve o `409 PHASE_NOT_READY` / `PHASE_ALREADY_RUNNING` que as
rotas das fases 2 e 3 vão usar quando existirem.

A allowlist de auth saiu de `backend/app.ts` para `backend/auth-required-paths.ts`
(com `requiresAuth()`), para poder ser testada sem subir o registry inteiro de rotas.
O comportamento é o mesmo: `app.use(AUTH_REQUIRED_PATHS, requireAuth)`.

### F0.6 — painel dos 3 botões

`client/src/dashboard/panels/analise-pos-recorte/`:

- `phase-state.ts` — puro: traduz o payload do servidor em cards (prévia, ETA, rótulo
  do botão, motivo do bloqueio). Não decide liberação: só reflete o servidor.
- `FaseCard.tsx` / `AnalisePosRecortePanel.tsx` — os 3 cards, sempre visíveis, com
  `aria-disabled` + `title` quando bloqueados.

O botão solto "Análise de AUAS" do `Dashboard.tsx` foi substituído pelo painel. Duas
mudanças de comportamento visíveis:

1. o painel aparece **assim que o recorte conclui**, não só depois da análise AC/AVN
   (a análise AC/AVN, quando existe, continua sendo enviada como contexto);
2. depois de rodar, o botão da Fase 1 vira **"Refazer"** em vez de sumir.

Se a consulta de fases falhar, a Fase 1 **continua clicável** — indisponibilidade de
API não pode esconder a funcionalidade que já existia.

## O que **não** entrou (de propósito)

- Fases 2 e 3: nenhuma linha de análise. Aparecem como `phase_not_implemented`.
- Nada da tarefa F0.1 (levantamento WMS 2009→2019) — continua bloqueando F2/F3.
- `SIMCAR_AUAS_V2_ENABLED` **continua `false`**: em produção o botão da Fase 1 segue
  disparando o fluxo V1 (2008–2024). Ligar a Fase 1 depende do conjunto dourado humano
  e da validação live do DeepSeek (F1.3/F1.4), que exigem conferência do Álvaro.
- Nenhuma rota nova de análise, nenhum custo de IA novo.

## Correção de um fato do plano

O doc [01 §2](planos/analise-pos-recorte/01-contexto-e-estado-atual.md) diz que
`client/src/components/AuasPre2008Summary.tsx` está órfão. **Não está**: o
`SimcarAuasPre2008PanelV2` já é renderizado no card de resultado do recorte
(`Dashboard.tsx`). Por isso o painel novo mostra só o resumo de estado da fase e não
duplica a tabela por polígono. A tarefa F1.1 já está atendida.

## Testes

- `backend/analise-pos-recorte/polygons.test.ts` — U-01 e U-02 (9 testes)
- `backend/analise-pos-recorte/checkpoint-store.test.ts` — U-13 + leitura de chave antiga (8 testes)
- `backend/simcar/phases.test.ts` — R-03 e o gating de U-15 (15 testes)
- `backend/simcar/routes-phases.test.ts` — contrato da rota, incluindo R-01 (5 testes)
- `client/src/dashboard/panels/analise-pos-recorte/phase-state.test.ts` — F-01 e F-02 (11 testes)

Gate da rodada: `pnpm test` (542 testes passando, contra 496 antes), `pnpm run check`
e `pnpm run build` verdes. Smoke ao vivo: backend compilado subiu e
`GET /api/simcar/clip/phases/job-teste` sem token devolveu `401 UNAUTHENTICATED`
(prova que a regex da allowlist casa no Express), enquanto `/api/simcar/layers`
seguiu 200.

> ⚠️ O `pnpm test` termina com 3 `Unhandled Error: [vitest-worker]: Timeout calling
> "onTaskUpdate"` vindos de `backend/processar-projeto.test.ts` (o arquivo leva ~83 s
> sozinho e passa). Isso **já acontecia no `main` antes desta rodada** — verificado
> rodando a suíte com a árvore limpa. Nenhum teste falha.

## Próximo passo

F0.1 (levantamento WMS ao vivo 2009→2019) e as decisões A1–A4 do doc 11 — as duas
coisas que bloqueiam começar a Fase 2.
