# Fase 1 v2 — Sinais de dúvida + zoom individual + DOCX com cenas

> 2026-08-22 · autor: Hermes-server · commits a partir de `auas-pre2008-v2`

## O que mudou

### 1. Status novo: `SINAL_DE_DUVIDA` (P1)

Antes, três sinais que a visão já relatava eram **descartados silenciosamente**
pelo `evidence-reducer.ts` — um desmate raso/parcial nunca aparecia no laudo:

| Sinal | Antes | Agora |
|---|---|---|
| `state: MIXED` (estado misto em algum ano) | ignorado | `SINAL_DE_DUVIDA` com fração no texto |
| `change: POSSIBLE_CHANGE` entre anos pré-2008 | ignorado (só importava no marco 2007→2008) | `SINAL_DE_DUVIDA` |
| `observableFraction` crescendo ≥ 15 p.p. entre cenas | campo validado e jogado fora | `SINAL_DE_DUVIDA` (`FRACTION_TREND_SUSPICIOUS`) |

Nova evidência geométrica determinística (sem IA): **AUAS∩AC / AUAS∩AVN**
(`geometry-checks.ts`, turf). Sobreposição > 0,01 ha é inconsistência objetiva
de declaração (o Manual do SIMCAR trata como validação impeditiva) e promove o
polígono de `SEM_EVIDENCIA_PRE_2008` para `SINAL_DE_DUVIDA`
(`DECLARATION_INCONSISTENCY`, confiança HIGH — medição geométrica).

Agregado: `summary.doubtCount` + `summary.doubtAreaHa`; status da propriedade
vira `SINAL_DE_DUVIDA` quando há dúvida sem alerta pleno. Alerta continua com
prioridade máxima.

### 2. Prompt da visão (P2)

`groq-vision-client.ts` agora pede ativamente sinais de desmate raso:
textura granulada (capoeira/rebrota), clareiras progressivas, cicatrizes de
queimada, aceiros/trilhas, solo exposto parcial. Instruções novas:
- usar `MIXED` + `observableFraction` sempre que houver sinal parcial;
- informar `observableFraction` em TODAS as cenas observáveis;
- usar `POSSIBLE_CHANGE` para alteração sutil consistente;
- **nota de troca de sensor**: Landsat falsa-cor → SPOT cor natural NÃO é
  mudança de cobertura — só transição 2007→2008 se a ESTRUTURA mudou.

`AUAS_RULES_VERSION` → `auas-pre2008-v2` (invalida checkpoints antigos).

### 3. Zoom individual por polígono

`wms-scenes.ts`:
- `CONTEXT_MARGIN_FRACTION` 0.15 → **0.08** (env `SIMCAR_SCENE_CONTEXT_MARGIN`);
- `calculateDynamicResolution`: long side 800/900/1200/1600 →
  **1200/1400/1600/2000** por faixa de área.

O polígono ocupa mais do quadro em todas as cenas (validado no imóvel real:
polígono bem enquadrado, textura legível).

### 4. Cenas persistidas + DOCX timbrado IMAP com galeria

- `orchestrator.ts` salva cada cena `USABLE` no storage do usuário
  (`simcar/analysis`, via `saveUserBuffer`) e preenche `scene.publicImageUrl`;
- novo módulo `backend/simcar/report-docx-auas.ts`:
  - seção **"Áreas Passíveis de Discussão"** (polígonos em dúvida + sinais);
  - **anexo fotográfico por polígono × ano** (Figuras com `Polígono X, ano Y
    (SENSOR)` + fração antropizada quando houver);
- `report-docx.ts` injeta os blocos quando `auasKind === "AUAS_PRE2008"`;
- `report-theme.ts`: rótulo "Sinal de dúvida" + finding de dúvida no quadro;
- front `AuasPre2008Summary.tsx`: badge laranja `SINAL_DE_DUVIDA`, sinais (❓)
  e sobreposição geométrica (📐) no detalhe do polígono.

## Validação (imóvel real do Álvaro — job `27ca02d3`, 265 ha, 3 AUAS/33,45 ha)

```
status: INCONCLUSIVO | pre2008Alert: false
polígonos: 2 analisáveis | alerta: 0 | dúvida: 0 | inconclusivos: 2
  - AUAS-0001: INCONCLUSIVO (8,3384 ha) · 📐 AC=0,0000 · AVN=0,0009
  - AUAS-0002: INCONCLUSIVO_NO_MARCO_2008 (25,1133 ha) · 📐 AC=0,0089 · AVN=0,0000
cenas persistidas: 12/12 | laudo: deterministic-fallback (cenas nubladas)
```

DOCX gerado com 14 imagens (galeria Figuras 1–12, todos os anos dos 2
polígonos) + papel timbrado IMAP. Nenhum polígono em dúvida neste imóvel
(IA inconclusiva por nuvem) — a seção de dúvidas não entra quando vazia.

## Testes

- `evidence-reducer-doubt.test.ts` (novo, 6 testes): MIXED → dúvida,
  POSSIBLE_CHANGE → dúvida, tendência ≥15 p.p. → dúvida, estável → sem
  evidência (anti-falso-positivo), agregado com doubtCount, prioridade do
  alerta.
- Suíte completa do backend: **776 passed / 8 skipped**. tsc limpo.

## Custos

Mesmo número de chamadas de IA (3 janelas × polígono). Zoom maior aumenta os
GetMap (largura de banda WMS) e o DOCX embute as cenas (sem custo de IA).
