# Remoção completa do Google Gemini — 2026-07-30

Escopo: análise de IA que roda **depois do recorte SIMCAR gerado a partir da ATP**
(`POST /api/simcar/clip/analyze`, `POST /api/simcar/clip/analyze-auas` e o chat da análise).

Toda a integração com o Google Gemini foi removida do backend. O sistema passa a ter a
**Groq como único provedor de IA** nesse fluxo — visão e texto.

---

## Motivação

O Gemini entrava como provedor duplo: fallback de visão quando a Groq batia rate limit e
provedor **preferencial** da síntese textual dos laudos. Isso trazia duas chaves, duas
contabilizações de billing, dois formatos de payload e duas cadeias de modelos para manter.
A decisão foi consolidar em um provedor só.

## Como o fluxo ficou

| Etapa | Antes | Depois |
|-------|-------|--------|
| Análise de imagens de satélite | Groq primeiro → Gemini no fallback | **Só Groq** (`llama-4-maverick`, `llama-4-scout`) |
| Síntese textual do laudo | Gemini preferido → Groq de reserva | **Só Groq** (`gpt-oss-120b`, `llama-3.3-70b`, `qwen3-32b`) |
| Continuação de resposta truncada | Groq → Gemini | **Só Groq** |
| Chat da análise (streaming e não-streaming) | Groq → Gemini | **Só Groq** (já era Groq no streaming) |

A cadeia de modelos de texto continua configurável por env; apenas o default mudou de nomes
Gemini para os modelos Groq já usados no resto do sistema.

---

## Mudanças no código

### `backend/simcar-clip.ts`

Removido:

- Constantes `GEMINI_API_BASE`, `GEMINI_VISION_MODELS`, `GEMINI_TEXT_SYNTHESIS_MODELS`,
  `GEMINI_IMAGE_SHARE`, `SIMCAR_REQUIRE_GEMINI` e as listas de fallback.
- Funções `normalizeGeminiModelName`, `buildGeminiModelChain`, `toGeminiContents`,
  `callGeminiTextOnce`, `callGeminiTextSynthesis`, `probeGeminiModel`,
  `resolveImageDataUrlForGemini`, `callGeminiVisionAnalysis`, `getCloudinaryGeminiUrl`.
- Código morto que só existia por causa do arranjo de dois provedores:
  `splitImagesByProviderWeight` (distribuía imagens entre Groq e Gemini) e
  `buildDualModelMergePrompt` (consolidava as duas análises).
- Campo `geminiUrl` do tipo `AiImage` — todas as imagens usam a URL única de visão (800×600 q65).
- Rota `GET /api/simcar/gemini/config` (com e sem `?probe=1`).

Renomeado / reescrito:

- `analyzeWithGroqAndGemini` → **`analyzeImagesWithVision`**: chama a visão Groq direto. Se todos
  os modelos de visão estiverem em cooldown de rate limit, falha com `GroqRateLimitError`
  informando o tempo de espera, em vez de cair para outro provedor.
- `callTextFollowUpGroqFirst` foi **absorvida** por `callTextFollowUp`, que agora aceita
  `{ contextLabel, modelChain, maxTokens }`.
- `callBestTextSynthesis` continua existindo como o caminho de síntese de maior qualidade, mas
  agora delega para `callTextFollowUp` com a cadeia `SIMCAR_SYNTHESIS_TEXT_MODELS` e teto de
  **8192 tokens** de saída (o caminho comum de follow-up segue em 2200), preservando o orçamento
  maior que a síntese tinha no Gemini.
- `getSimcarGeminiRuntimeConfig` → **`getSimcarAiRuntimeConfig`**, agora reportando
  `hasGroqApiKey`, `visionModels`, `textModels` e `synthesisTextModels`.

### `backend/billing.ts`

- `BillingProvider` passou de `"groq" | "gemini" | "cloudinary"` para `"groq" | "cloudinary"`.
- `buildUsageFromGemini` removida; `inferProviderFromModel` não tenta mais detectar
  `gemini`/`banana`.
- Os registros de uso estimado que declaravam `provider: "gemini"` passaram a `"groq"`.
  (O billing segue desabilitado em modo local — todo custo retorna 0 BRL.)

### `backend/index.ts`

`GET /api/runtime/version` deixou de expor `hasGeminiKey`, `requireGemini`, `geminiApiBase`,
`geminiImageShare`, `geminiVisionModels` e `geminiTextSynthesisModels`. No lugar entraram
`analysisMode`, `visionModels`, `textModels` e `synthesisTextModels`. `hasGroqKey` permanece.

---

## Impacto operacional

### Variáveis de ambiente que deixaram de ser lidas

Podem ser apagadas do Render, do `.env.production` e do `~/.config/geoforest/backend.env`:

```
GEMINI_API_KEY
GEMINI_API_BASE
GEMINI_MODELS
GEMINI_VISION_MODELS
GEMINI_TEXT_SYNTHESIS_MODELS
GEMINI_IMAGE_SHARE
SIMCAR_REQUIRE_GEMINI
```

`GROQ_API_KEY` passa a ser **obrigatória** para qualquer análise do recorte — sem ela, tanto a
visão quanto a síntese falham.

### Rota removida

`GET /api/simcar/gemini/config` responde **404** a partir desta versão. Para inspecionar a
configuração de IA em runtime, use `GET /api/runtime/version`.

### Comportamento sob rate limit

Este é o ponto de atenção real da mudança: **não existe mais fallback de provedor**. Quando os
modelos de visão da Groq entram em cooldown (429), a análise falha com uma mensagem informando
os segundos de espera, em vez de ser atendida pelo Gemini. O rastreamento de cooldown continua
sendo por modelo, então a falha só ocorre quando *todos* os modelos de visão estão limitados.

---

## Verificação

- `pnpm check` (tsc --noEmit) — sem erros.
- Bundle do backend com esbuild — OK.
- `pnpm test` — 286 testes passando, 4 pulados, nenhuma falha.
