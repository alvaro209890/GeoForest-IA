# Plano — Análise pós-recorte SIMCAR em 3 fases

> ⚠️ **Atualização 23/08/2026:** as 3 fases deixaram de ser encadeadas — cada uma
> é desbloqueada por conta própria e tem laudo próprio. A decisão **A6** (F3 exige
> F2) foi revogada pelo Álvaro. Ver
> [FLUXO_3_ANALISES_INDEPENDENTES.md](FLUXO_3_ANALISES_INDEPENDENTES.md).

> **Status:** 🚧 EM IMPLEMENTAÇÃO — a fundação (F0.3–F0.6) já está no `main`; as fases 2
> e 3 ainda não existem. Ver [`docs/CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md`](../../CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md).
> **Data:** 2026-08-05
> **Autor:** Claude (plano), com Álvaro
> **Repo:** `alvaro209890/GeoForest-IA` — branch `main`
> **Pasta:** `docs/planos/analise-pos-recorte/`
> **Planos-mãe (não substituídos):** [`Analise_pos_recorte/concluido/README.md`](../../../Analise_pos_recorte/concluido/README.md)
> e [`Analise_pos_recorte/fase/PLANO_FASE_2_AUAS_DESMATAMENTO_POS_2008.md`](../../../Analise_pos_recorte/fase/PLANO_FASE_2_AUAS_DESMATAMENTO_POS_2008.md)

---

## Objetivo (1 frase)

Transformar o que hoje é **um botão solto de "Análise de AUAS"** depois do recorte
SIMCAR em um **fluxo de três análises independentes**, cada uma destravada pela
anterior: (1) desmate anterior a 2008 nas AUAS, (2) datação do desmate nas AUAS entre
2008 e 2019, (3) vegetação remanescente dentro da Área Consolidada.

## O fluxo do usuário

```
Recorte SIMCAR concluído (ATP → 28 camadas recortadas)
        │
        ▼
[ Análise AC/AVN ]  ← já existe hoje, não muda
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│ FASE 1 — botão "Análise de AUAS (2003–2008)"                  │
│ Para CADA polígono AUAS: Landsat 5 2003..2007 + SPOT 2008     │
│ Pergunta: já havia desmate/antropização ANTES do marco?       │
│ Saída: ALERTA_PRE_2008 / SEM_EVIDENCIA / INCONCLUSIVO         │
└───────────────────────────────────────────────────────────────┘
        │  conclui → destrava
        ▼
┌───────────────────────────────────────────────────────────────┐
│ FASE 2 — botão "Continuar: quando ocorreu (2008–2019)"        │
│ Para CADA polígono AUAS: série anual 2009..2019               │
│ Pergunta: em que ano (ou intervalo) a vegetação virou uso?    │
│ Saída: ano confirmado / intervalo / já antropizado / inconcl. │
└───────────────────────────────────────────────────────────────┘
        │  conclui → destrava
        ▼
┌───────────────────────────────────────────────────────────────┐
│ FASE 3 — botão "Vegetação dentro da Área Consolidada"         │
│ Para CADA polígono AREA_CONSOLIDADA: imagem atual + cruzamento│
│ geométrico com AVN/TIPOLOGIA_VEGETAL do próprio recorte       │
│ Pergunta: sobrou vegetação nativa dentro da AC declarada?     │
│ Saída: vegetação detectada (faixa de área) / sem / inconcl.   │
└───────────────────────────────────────────────────────────────┘
```

Os três botões vivem no mesmo card do recorte, ficam **visíveis desde o início** e
**desabilitados com motivo explícito** ("conclua a Fase 1 para liberar") — nada de
botão que aparece do nada.

## Por que 2019 fecha a Fase 2

A datação a partir de 2019 **já existe e é melhor**: o módulo
[`backend/auas-sccon.ts`](../../../backend/auas-sccon.ts) crava a data de `ABERTURA`
por alerta de desmate oficial da SCCON (dado vetorial datado, não interpretação de
imagem). A Fase 2 cobre exatamente a **lacuna 2009–2019** que a SCCON não alcança, e
o relatório deve dizer isso: acima de 2019, use a aba AUAS × SCCON.

## Decisões-chave já tomadas neste plano

| # | Decisão | Justificativa |
|---|---|---|
| D1 | **Uma fase por vez, sob clique explícito.** Nenhuma fase começa sozinha | Custo e tempo crescem com o nº de polígonos; o usuário precisa ver a prévia antes |
| D2 | **Reuso, não reescrita.** As três fases compartilham `backend/analise-pos-recorte/` (identidade de polígono, cenas WMS, qualidade de imagem, clientes Groq/DeepSeek, checkpoints) | A Fase 1 já está implementada e testada; duplicar cliente WMS foi o erro do monólito |
| D3 | **Groq só enxerga, DeepSeek só redige, o veredito é do código.** Vale igual nas 3 fases | Regra não-negociável herdada do plano-mãe |
| D4 | **Uma análise por polígono**, nunca a união da camada | Herdado do plano-mãe; o agregado do imóvel é derivado |
| D5 | **Ausência nunca vira "sem desmate".** Cena faltando, nuvem, JSON inválido → `INCONCLUSIVO` | Herdado do plano-mãe |
| D6 | **Fase 2 termina em 2019** e aponta para a aba AUAS × SCCON dali em diante | Alerta datado > interpretação visual |
| D7 | **Fase 3 é híbrida:** cruzamento geométrico determinístico (AC × AVN/TIPOLOGIA_VEGETAL do recorte) **+** leitura visual. O geométrico manda; a visão complementa | O recorte já tem as camadas; geometria não alucina |
| D8 | **Cada fase tem sua `rulesVersion` e seu bloco versionado** no resultado persistido; nenhuma sobrescreve a anterior | Auditoria: o pré-2008 tem de continuar legível depois da Fase 3 |
| D9 | **Rotas separadas por fase** (não um `phase` no corpo) | Allowlist de auth, estimativa de billing e SSE ficam distintos e simples |
| D10 | **Rollout por flag por fase** (`SIMCAR_AUAS_V2_ENABLED`, `..._POS2008_ENABLED`, `..._AC_VEG_ENABLED`) | A Fase 1 já está no `main` com a flag desligada; liga-se uma de cada vez |
| D11 | **Stack de IA fixa nas 3 fases: visão = Groq (modelo do plano gratuito) · texto = DeepSeek.** Nenhum outro provedor entra | Decisão do Álvaro (2026-08-05). Detalhe e implicações do free tier em [02 §9](02-arquitetura.md) |

## Critérios de aceite do plano inteiro

1. Depois do recorte, o usuário vê os três botões e entende, sem ler doc, o que cada
   um faz e por que está bloqueado.
2. Cada fase devolve **resultado por polígono** com: status, ano/intervalo, confiança,
   cenas usadas (layer + ano + hash), evidências e limitações.
3. Nenhum ano é analisado sem estar no `GetCapabilities` **e** ter devolvido `GetMap`
   válido naquela execução.
4. Nenhuma chamada de visão excede **3 imagens**.
5. Cancelar e retomar não repete janela já concluída nem cobra de novo.
6. O resultado das três fases sobrevive a recarregar a página (vem do histórico do job).
7. O PDF final traz as três seções, com metodologia e limitações, sem apresentar
   `INCONCLUSIVO` como ausência de desmate.
8. A fixture [`SIMCAR_Recorte_Digital.zip`](../../../Analise_pos_recorte/fase/SIMCAR_Recorte_Digital.zip)
   continua produzindo pelo menos um `ALERTA_PRE_2008` na Fase 1.

## Índice

Ver [INDEX.md](INDEX.md).
