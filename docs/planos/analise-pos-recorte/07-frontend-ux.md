# 07 — Frontend e experiência do usuário

## 1. Onde isso vive

Card do recorte SIMCAR no Dashboard (`client/src/pages/Dashboard.tsx`), logo abaixo do
resultado da análise AC/AVN — exatamente onde hoje está o botão solto de AUAS
(`Dashboard.tsx:5894`).

Dada a dimensão do arquivo (7.553 linhas), o bloco novo deve nascer **fora dele**:

```text
client/src/dashboard/panels/analise-pos-recorte/
  AnalisePosRecortePanel.tsx     # o card com as 3 fases
  FaseCard.tsx                   # cabeçalho + botão + estado + progresso de uma fase
  Fase1Pre2008Result.tsx         # reusa/embrulha AuasPre2008Summary.tsx (hoje órfão)
  Fase2Pos2008Result.tsx         # tabela por polígono + histograma de anos
  Fase3AcVegetacaoResult.tsx     # tabela por polígono + flags
  usePhaseFlow.ts                # estado das 3 fases, gating, SSE
```

O Dashboard só renderiza `<AnalisePosRecortePanel jobId={...} />`.

## 2. Os três botões

```
┌─ Análise pós-recorte ───────────────────────────────────────────┐
│                                                                  │
│  ①  Análise de AUAS (2003–2008)                     [ Analisar ] │
│      17 polígonos AUAS · 6 imagens cada · ~45 min                │
│      ✅ Concluída em 05/08 14:20 — 3 com evidência pré-2008      │
│                                                                  │
│  ②  Quando ocorreu o desmate (2008–2019)            [ Continuar ]│
│      17 polígonos · 11 anos · 5 janelas cada · ~1 h 20           │
│      🔒 Conclua a Fase 1 para liberar                            │
│                                                                  │
│  ③  Vegetação dentro da Área Consolidada            [ Analisar ] │
│      9 polígonos de AC · ~9 min                                  │
│      🔒 Conclua a Fase 2 para liberar                            │
└──────────────────────────────────────────────────────────────────┘
```

Regras:

- **Os três aparecem sempre**, desde que o recorte tenha concluído. Nada surge do nada.
- Bloqueado = `disabled` + cadeado + **motivo em texto** ("Conclua a Fase 2 para
  liberar"), nunca um botão morto sem explicação.
- Só uma fase roda por vez: enquanto uma está em execução, as outras ficam desabilitadas
  com "Aguardando a Fase N terminar".
- Botão de fase concluída vira **"Refazer"** (secundário, com confirmação), porque
  refazer a Fase 1 invalida as fases 2 e 3 — ver §6.

## 3. Prévia antes do clique (obrigatória)

Antes de cobrar tempo do usuário, cada fase mostra o que vai fazer. Fonte dos números:
rota de catálogo (doc 03 §7) + contagem de polígonos do job.

| Fase | Prévia exibida |
|---|---|
| 1 | nº de polígonos AUAS · 6 cenas por polígono · anos ausentes · ETA |
| 2 | nº de polígonos · anos habilitados no catálogo · anos ausentes · nº de janelas · ETA · aviso de troca de sensor |
| 3 | nº de polígonos de AC · cenas escolhidas (2024 / NIR / SPOT 2008) · ETA · aviso de que o cruzamento geométrico sai mesmo sem IA |

O ETA é honesto e derivado do rate limit (doc 02 §5), com a frase "pode variar conforme
a fila da API".

## 4. Durante a execução

Reusar o padrão que já existe para a Fase 1 (barra + mensagem SSE em
`Dashboard.tsx:5921`), acrescentando:

```
Fase 2 · polígono 7/17 (AUAS-0007) · janela 3/5 (2013–2015) · 41%
[████████████░░░░░░░░░░░░░░░░]        restante ~38 min      [ Cancelar ]
```

- Cancelar é imediato do lado do cliente e **preserva os checkpoints**: ao voltar, o
  botão diz "Retomar (12 de 17 polígonos já analisados)".
- Fechar a aba não mata o job: ao reabrir, o painel consulta o histórico e reconecta ao
  job ativo — mesmo mecanismo que a aba Lotes SIMCAR já usa.

## 5. Resultados

### Fase 1
Reaproveitar `client/src/components/AuasPre2008Summary.tsx` (existe, 173 linhas, hoje
sem uso). Destaque obrigatório quando houver alerta:
**"Evidência de desmate/antropização anterior a 2008"** (doc 04 §5).

### Fase 2
Tabela por polígono, ordenável e filtrável:

| Polígono | Área (ha) | Pré-2008 | Resultado | Confiança | Cenas |
|---|---|---|---|---|---|
| AUAS-0007 | 42,1 | — | **2014** | ALTA | 2013, 2014 (L8) |
| AUAS-0011 | 8,4 | ⚠️ alerta | já antropizada em 2009 | MÉDIA | 2009 (L5) |
| AUAS-0013 | 15,7 | — | entre 2016 e 2018 | MÉDIA | troca de sensor |
| AUAS-0002 | 3,2 | — | inconclusivo | — | nuvem 2011–2013 |

Filtros: confirmados · intervalo · já antropizados · sem mudança · inconclusivos.
Acima da tabela, o histograma de anos e o encaminhamento para a aba AUAS × SCCON.
Clicar numa linha abre as cenas usadas com ano/sensor/qualidade.

### Fase 3

| Polígono AC | Área (ha) | Status | Vegetação declarada | Aparente | Flags |
|---|---|---|---|---|---|
| AC-0003 | 120,5 | 🔴 declarada dentro da AC | 4,8 ha AVN (4,0%) | blocos | AC_SOBREPOE_ARL |
| AC-0001 | 88,0 | 🟠 aparente | — | manchas 2–10 ha | ripária |
| AC-0005 | 12,3 | ✅ sem vegetação aparente | — | — | — |

A coluna "declarada" é número exato (geometria); "aparente" é faixa (visão). A UI deve
deixar essa diferença visível — é o ponto que separa fato de leitura de imagem.

## 6. Invalidação em cascata

Se o usuário refizer o recorte, ou refizer a Fase 1, ou a Fase 2:

- as fases seguintes voltam para **bloqueadas** e seus resultados ficam marcados como
  `stale` (mostrados em cinza com aviso "resultado de uma execução anterior"), nunca
  apagados silenciosamente;
- o backend detecta pelo `geometryHash` / `completedAt` do bloco anterior e recusa
  encadear com `409 PHASE1_MISMATCH`.

## 7. PDF

O laudo ganha três seções novas, na ordem das fases, cada uma com: metodologia (fontes,
anos, sensores), tabela por polígono, evidências, limitações e a frase de que se trata
de **evidência técnica de interpretação de imagens, não conclusão jurídica**.
`INCONCLUSIVO` nunca é apresentado como ausência de desmate.

## 8. Acessibilidade e estados de erro

- Botões com `aria-disabled` + `title` explicando o bloqueio.
- Erro de fase não derruba as outras: card da fase mostra o erro, com "Tentar novamente"
  reaproveitando checkpoints.
- Sem camada no recorte (ex.: projeto sem `AREA_CONSOLIDADA`): card da Fase 3 aparece
  com "Este recorte não tem Área Consolidada" e botão desabilitado — não é erro.
