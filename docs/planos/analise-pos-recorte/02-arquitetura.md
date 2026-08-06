# 02 — Arquitetura comum às três fases

## 1. Desenho geral

```mermaid
flowchart TB
    R[Job do recorte SIMCAR<br/>clippedGeometries: Map camada → Geometry[]] --> P1
    R --> P3

    subgraph P1[FASE 1 — AUAS pré-2008]
      A1[extractPolygons AUAS] --> B1[cenas 2003..2007 + SPOT 2008]
      B1 --> C1[3 janelas de visão] --> D1[redutor pré-2008]
    end

    D1 -->|COMPLETED| P2

    subgraph P2[FASE 2 — AUAS 2008–2019]
      A2[mesmos polígonos<br/>mesmo geometryHash] --> B2[cenas 2009..2019]
      B2 --> C2[5 janelas de visão] --> D2[redutor de cronologia]
    end

    D2 -->|COMPLETED| P3

    subgraph P3[FASE 3 — vegetação na AC]
      A3[extractPolygons AREA_CONSOLIDADA] --> B3[cruzamento geométrico<br/>AC × AVN / TIPOLOGIA_VEGETAL]
      A3 --> C3[cenas atuais + NIR]
      B3 --> D3[redutor de vegetação]
      C3 --> D3
    end

    D1 & D2 & D3 --> S[DeepSeek redige] --> Z[SSE + histórico + PDF]
```

Regra de ouro repetida das três: **a IA de visão observa, o código decide, o modelo de
texto redige o que o código já decidiu.**

## 2. Estrutura de arquivos proposta

```text
backend/analise-pos-recorte/
  # ── núcleo compartilhado (hoje é implicitamente "da fase 1"; passa a ser comum) ──
  config.ts                 # + flags/catálogos das fases 2 e 3
  polygons.ts               # NOVO: extractPolygonsFromLayer(map, layer, prefix)
  auas-polygons.ts          # mantém a API atual, passa a delegar em polygons.ts
  wms-scenes.ts             # + buildSceneForLayer(polygon, layerSpec) genérico
  image-quality.ts          # sem mudança
  groq-vision-client.ts     # + injeção de prompt/schema por fase
  deepseek-text-client.ts   # + injeção de template por fase
  checkpoint-store.ts       # + namespace de fase na chave
  types.ts / schemas.ts     # tipos comuns (cena, confiança, usabilidade)

  pre2008/                  # o que hoje está na raiz e é exclusivo da fase 1
    evidence-reducer.ts
    orchestrator.ts
    report-builder.ts

  pos2008/                  # NOVO — fase 2
    catalog.ts              # descoberta GetCapabilities + anos habilitados + TTL
    scenes.ts               # cena por ano usando o catálogo real
    timeline.ts             # janelas, lacunas, ordenação, ponte entre sensores
    schemas.ts              # contrato Zod da visão da fase 2
    evidence-reducer.ts     # ano / intervalo / status
    orchestrator.ts         # fila, checkpoint, cancelamento, progresso
    report-builder.ts

  ac-vegetacao/             # NOVO — fase 3
    geometry-evidence.ts    # AC × AVN / TIPOLOGIA_VEGETAL (turf, determinístico)
    scenes.ts               # cenas atuais (RGB + NIR) por polígono de AC
    schemas.ts
    evidence-reducer.ts     # combina geometria + visão
    orchestrator.ts
    report-builder.ts

  index.ts                  # barrel único
```

`backend/simcar/analysis.ts` continua sendo **só adaptador** (billing, SSE,
persistência, PDF), como já é para a Fase 1 em `handleAuasAnalyzeV2Route`. Nenhuma
regra temporal nova entra lá.

> **Refactor mínimo obrigatório antes da Fase 2:** `extractAuasPolygons` está preso à
> string `"AUAS"` e ao prefixo `AUAS-` (`auas-polygons.ts:37,60`). Generalizar em
> `polygons.ts` mantendo `extractAuasPolygons` como wrapper — os testes atuais
> continuam valendo e a Fase 3 ganha `AC-0001…` de graça.

## 3. Identidade do polígono é o contrato entre as fases

A Fase 2 **não recalcula** polígonos: ela recebe o mesmo `clippedGeometries` do job e
reexecuta `extractPolygons("AUAS")`, que é determinístico. O par
`(polygonId, geometryHash)` amarra tudo:

- se o `geometryHash` de um polígono não bater com o registrado na Fase 1 → o job da
  Fase 2 falha com `PHASE1_MISMATCH` em vez de produzir resultado desalinhado;
- o resultado da Fase 2 referencia o status pré-2008 daquele mesmo polígono;
- a Fase 3 usa polígonos de outra camada, então tem seu próprio espaço de IDs (`AC-*`).

## 4. Checkpoints e retomada

Chave de checkpoint (evolução da chave da Fase 1, que já existe em
`buildCheckpointKey`):

```text
<jobId>::<phase>::<rulesVersion>::<catalogVersion>::<geometryHash>::<windowId>::<sha256 das cenas da janela>
```

- `phase` ∈ `PRE_2008` | `POS_2008` | `AC_VEG` — impede colisão entre fases no mesmo job.
- `catalogVersion` entra porque a Fase 2 descobre os anos em tempo de execução: se a
  SEMA publicar/trocar um mosaico, o checkpoint antigo **não** pode ser reaproveitado.
- Guardar a **observação da janela**, não a imagem. Imagens só em memória + hash.
- Retomar = pular janela com checkpoint válido, sem nova chamada de visão e sem cobrar.

## 5. Fila e rate limit

Uma fila serializada por processo (não por job): com 8k TPM não adianta paralelizar.
Ordem sugerida de execução dentro de um job: polígono a polígono, janela a janela, para
que o progresso seja honesto ("polígono 3/17 · janela 2/5") e o cancelamento seja barato.

Antes de cada chamada: verificar `x-ratelimit-remaining-tokens` da última resposta e
dormir o `retry-after` quando vier 429. Os limites já estão parametrizados em
`backend/simcar/constants.ts` (`GROQ_RATE_LIMIT_*`) — reusar, não recriar.

## 6. Gating entre fases (onde a regra mora)

A regra de desbloqueio é do **backend**, e o frontend só reflete:

| Fase | Pré-condição verificada no servidor |
|---|---|
| 1 | Existe job de recorte hidratável e camada `AUAS` com ≥ 1 polígono |
| 2 | Existe `auasMeta.schemaVersion === 2` persistido para o job, com `completedAt` e status ≠ `FAILED` |
| 3 | Existe `auasPos2008Meta` persistido com `completedAt`, **e** camada `AREA_CONSOLIDADA` com ≥ 1 polígono |

Se a rota da Fase 2 for chamada sem a Fase 1 concluída → `409 { code: "PHASE_NOT_READY", requires: "PRE_2008" }`.
Idem para a Fase 3 (`requires: "POS_2008"`). O botão desabilitado é conveniência; a
porta trancada é a rota.

## 7. Fluxo de dados persistido

```text
history entry do job de recorte (local-storage JSON)
├── analysisMeta          (AC/AVN, já existe)
├── auasMeta              (Fase 1 — schemaVersion 2, já existe)
├── auasPos2008Meta       (Fase 2 — NOVO)
└── acVegetacaoMeta       (Fase 3 — NOVO)
```

Nenhum bloco sobrescreve outro. O PDF lê os três. Cards antigos (V1) continuam
abrindo — o normalizador do front já distingue `SimcarAuasMetaV1 | SimcarAuasMetaV2`
(`client/src/dashboard/types/history.ts:147-174`).

## 8. Segurança

- Três rotas novas entram na allowlist `AUTH_REQUIRED_PATHS` de `backend/app.ts`.
- Job é **server-owned**: o corpo manda `jobId`, nunca caminho de arquivo.
- URL de WMS persistida sempre **sem `authkey`** (a Fase 1 já sanitiza; manter).
- Nenhuma chave em log, SSE, fixture ou payload de retorno.

## 9. Stack de IA — Groq (grátis) para visão, DeepSeek para texto

Decisão **D11** (Álvaro, 2026-08-05), vale igual nas três fases:

| Papel | Provedor | Modelo padrão | Por quê |
|---|---|---|---|
| **Visão** (ler as imagens WMS) | **Groq**, plano gratuito | `qwen/qwen3.6-27b` | Já validado ao vivo em 2026-07-30 nesta exata tarefa; multimodal e disponível no free tier |
| **Texto** (redigir o laudo) | **DeepSeek** | `deepseek-v4-pro` | Já é o modelo textual do projeto (oráculo, autofix); conta com saldo próprio |

Ambos são configuráveis por env (`SIMCAR_AUAS_VISION_MODEL` / `SIMCAR_AUAS_TEXT_MODEL`)
— trocar de modelo dentro do mesmo provedor é mudança de variável, não de código. Trocar
de **provedor** exigiria revisar este plano.

### ⚠️ Correção de premissa (medição ao vivo em 2026-08-05)

O quadro abaixo foi escrito supondo **8k TPM**. A medição real mostrou **duas chaves**:

| Chave | Onde | TPM | Papel |
|---|---|---|---|
| `gsk_ZhZd…sEDf` | `~/.hermes/.env` (acer) | **8.000** | plano gratuito — desenvolvimento/teste |
| `gsk_KBMX…788R` | `backend.env` (server) | **250.000** | é a que o backend usa em produção |

Ou seja: **o teto de 8k só vale para desenvolver neste PC.** Em produção o ritmo é ~31×
maior e o gargalo passa a ser o WMS da SEMA, não a Groq. O que **não** muda com tier
melhor: o teto de **3 imagens por chamada**, que é limite do modelo (`qwen/qwen3.6-27b`
devolve HTTP 400 "This model supports up to 3 images" mesmo na conta grande).

Portanto, mantenha do desenho: janelas de 3 cenas, checkpoint por janela, cancelamento e
retomada. **Ajuste:** o ETA mostrado ao usuário deve sair dos headers de rate limit da
chave em uso, não de uma constante de 8k. Detalhes e como reproduzir os testes:
[`docs/IA_PROVEDORES.md`](../../IA_PROVEDORES.md).

### O que o plano gratuito da Groq impõe ao desenho (cenário de desenvolvimento)

Não é detalhe de configuração — é o que define a arquitetura de fila e de UX:

| Limite medido (2026-07-30) | Consequência no desenho |
|---|---|
| **Máx. 3 imagens por chamada** (a API rejeitou 4 e 5) | Janelas de visão de 3 cenas; asserção local **antes** da requisição (U-16) |
| **~8.000 tokens/minuto** | Fila serializada por processo (paralelizar não ajuda); ETA honesto na prévia; ~2–3 min/polígono na Fase 1, ~4–6 min na Fase 2 |
| **429 acontece** | Respeitar `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-tokens` e `retry-after`; reusar `GROQ_RATE_LIMIT_*` de `backend/simcar/constants.ts` |
| Uma janela de 3 cenas ≈ **5,5k tokens de entrada** | Checkpoint **por janela**: uma queda não joga fora dezenas de chamadas caras |

Se um dia a conta virar paga, o único ajuste é a agressividade da fila — o contrato de
3 imagens por chamada e o checkpoint por janela continuam válidos.

### Divisão de papéis (não-negociável, herdada do plano-mãe)

- A Groq **só enxerga**: recebe imagens + instrução, devolve JSON de observação. Não
  recebe termo jurídico, não decide status, não vê resultado de outra fase.
- O DeepSeek **só redige**: recebe geometrias resumidas, metadados, observações
  validadas e o veredito **já calculado**. Nunca recebe imagem, URL de imagem ou base64;
  não pode alterar status, área, intervalo ou confiança.
- **O veredito é do código** (`evidence-reducer` de cada fase).
- DeepSeek fora do ar → relatório determinístico de fallback. **Nunca** usar modelo
  textual da Groq como substituto.
