# Provedores de IA do GeoForest — chaves, modelos e limites reais

> **Verificado ao vivo em 2026-08-05.** Todos os números desta página vieram de chamadas
> reais às APIs naquele dia, não da documentação dos provedores.
>
> ⚠️ **Nenhum valor de chave aparece aqui.** Só onde a chave mora e como identificá-la
> pelo prefixo/sufixo. O repositório é **público** — chave só em variável de ambiente.

## 1. Divisão de papéis

| Papel | Provedor | Modelo padrão | Onde é configurado |
|---|---|---|---|
| **Visão** (ler imagens de satélite) | **Groq** | `qwen/qwen3.6-27b` | `SIMCAR_AUAS_VISION_MODEL` |
| **Texto** (redigir laudos) | **DeepSeek** | `deepseek-v4-pro` | `SIMCAR_AUAS_TEXT_MODEL` |

Regra do projeto: **a Groq só enxerga, o DeepSeek só redige, o veredito é do código.**
O DeepSeek nunca recebe imagem, URL de imagem ou base64.

## 2. Chaves disponíveis (estado em 2026-08-05)

### Groq — duas chaves, ambas funcionando

| # | Onde mora | Impressão digital | Limites medidos | Uso |
|---|---|---|---|---|
| A | `~/.hermes/.env` (PC **acer**) | `gsk_ZhZd…sEDf` | **8.000 TPM** · `limit-requests: 1000` | Plano **gratuito**. Serve para desenvolver/testar neste PC |
| B | `~/.config/geoforest/backend.env` (PC **server**) | `gsk_KBMX…788R` | **250.000 TPM** · `limit-requests: 500000` | É a chave que o `geoforest-backend.service` usa em produção |

Ou seja: **já temos chave Groq funcionando para começar o desenvolvimento**, e a de
produção não é free tier — tem 250k tokens/minuto, ~31× o limite da conta gratuita.

Verificação usada (não imprime a chave):

```bash
set -a && source ~/.hermes/.env && set +a
curl -s -o /dev/null -w "%{http_code}\n" https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $GROQ_API_KEY"      # → 200
```

### DeepSeek — uma boa, uma inválida

| # | Onde mora | Impressão digital | Estado |
|---|---|---|---|
| A | `~/.hermes/.env` (PC **acer**) | `sk-5bb…6959` | ✅ **válida** — `GET /user/balance` → 200, saldo **US$ 13,21** |
| B | `~/.config/geoforest/backend.env` (PC **server**) | `sk-1c9…5027` | ❌ **401 Unauthorized** |

> 🔴 **Pendência de ops:** a chave DeepSeek que o backend do GeoForest usa em produção
> está inválida. Enquanto não for trocada pela chave A, qualquer laudo redigido por
> DeepSeek cai no **fallback determinístico** — o resultado estruturado continua correto,
> mas o texto sai mais pobre. Correção = copiar `DEEPSEEK_API_KEY` de `~/.hermes/.env`
> (PC acer) para `~/.config/geoforest/backend.env` (PC server), com backup do arquivo, e
> reiniciar `geoforest-backend.service`. **Não feito ainda** — depende do Álvaro.

## 3. Modelos disponíveis na conta Groq (2026-08-05)

15 modelos. Os que interessam ao projeto:

| Modelo | Papel |
|---|---|
| `qwen/qwen3.6-27b` | **visão** — é o único multimodal da conta |
| `openai/gpt-oss-20b` | texto barato — hoje usado como modelo de billing (`SIMCAR_OPERATION_BILLING_MODEL`) |
| `openai/gpt-oss-120b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `groq/compound` | texto, alternativas |
| `whisper-large-v3` / `-turbo` | áudio (não usado aqui) |

## 4. Limites reais medidos (não são os da documentação)

### Teto de 3 imagens é do MODELO, não do plano

Testado com a chave de produção (250k TPM), 4 imagens numa chamada:

```json
{"error":{"message":"Too many images provided.  This model supports up to 3 images",
          "type":"invalid_request_error"}}
```

HTTP **400**. Ou seja: **pagar mais não libera mais imagens por chamada.** O desenho de
"janela de visão com até 3 cenas" continua obrigatório em qualquer cenário.

### Custo por imagem

Uma cena PNG **512×512** do WMS da SEMA (Landsat 5 2003) + prompt curto consumiu
**1.361 tokens de entrada**. Três cenas numa janela ≈ **4–5,5k tokens**, batendo com a
medição de 2026-07-30.

Consequência prática por chave:

| Chave | TPM | Janelas de 3 cenas por minuto | Ritmo aproximado |
|---|---|---|---|
| Gratuita (acer) | 8.000 | ~1,5 | ~2–3 min por polígono (3 janelas) |
| Produção (server) | 250.000 | ~45 | dezenas de polígonos por minuto — o gargalo passa a ser o WMS da SEMA |

> 📌 Isso **corrige** a premissa do plano `docs/planos/analise-pos-recorte/`, escrito
> antes desta medição: 8k TPM é o limite da conta gratuita do PC acer, não o do backend.
> A fila serializada e o checkpoint por janela continuam valendo (protegem contra queda e
> contra o rate limit do WMS), mas o ETA em produção é **muito** menor que o estimado.

### Headers a respeitar (ambas as contas devolvem)

```
x-ratelimit-limit-tokens / x-ratelimit-remaining-tokens / x-ratelimit-reset-tokens
x-ratelimit-limit-requests / x-ratelimit-remaining-requests / x-ratelimit-reset-requests
retry-after   (em 429)
```

Os parâmetros de espera já existem em `backend/simcar/constants.ts`
(`GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS` etc.) — reusar, não recriar.

## 5. Gotchas verificados

- **`urllib.request` do Python leva 403 (Cloudflare `error code: 1010`)** na
  `api.groq.com/openai/v1/chat/completions`, mesmo com a chave certa. O `GET /models`
  passa; o POST não. **Use `curl` ou o `fetch` do Node** (que é o que o backend usa).
  Se um script de diagnóstico em Python falhar com 403, o problema é o cliente HTTP,
  **não a chave**.
- **`.env.production` na raiz do repo não tem `GROQ_API_KEY` nem `DEEPSEEK_API_KEY`.**
  Para rodar o backend localmente com IA:
  ```bash
  set -a && source .env.production && source ~/.hermes/.env && set +a && pnpm run build
  ```
- **JSON mode + `reasoning_effort: "none"` funciona** no `qwen/qwen3.6-27b` e elimina o
  bloco `<think>` da resposta — confirmado de novo em 2026-08-05.
- A **`authkey` do WMS da SEMA** está com valor default em `backend/simcar/constants.ts`
  e funciona (GetMap 200, PNG 512×512 válido). Ainda assim, **nunca** persistir URL com
  `authkey` em log, laudo ou JSON de proveniência.

## 6. Como reproduzir o teste de visão ponta a ponta

```bash
# 1) baixa uma cena real do WMS da SEMA
curl -s -o /tmp/cena.png "https://geo.sema.mt.gov.br/geoserver/ows?service=WMS&version=1.1.1\
&request=GetMap&layers=Mosaicos:LANDSAT_5_2003&styles=&bbox=-52.30,-12.70,-52.24,-12.64\
&width=512&height=512&srs=EPSG:4326&format=image/png&authkey=<authkey>"

# 2) manda para a Groq (monte o JSON com o base64 da imagem) — use curl, não urllib
curl -s https://api.groq.com/openai/v1/chat/completions \
  -H "Authorization: Bearer $GROQ_API_KEY" -H "Content-Type: application/json" \
  --data-binary @req.json
```

Resposta obtida em 2026-08-05 para uma cena real de Querência (JSON pedido no prompt):

```json
{"state": "MIXED",
 "evidence": "fragmentos de vegetação natural intercalados com extensas áreas
              antrópicas de agricultura e pastagem"}
```

O caminho **WMS → base64 → Groq Vision → JSON validado** está provado ponta a ponta.

## 7. Regras permanentes

1. Chave só em env do backend. Nunca em código, log, fixture, SSE, payload ou frontend.
2. Repositório é público — nem sequer prefixo+sufixo completos de chave em commit.
3. Trocar de **modelo** dentro do mesmo provedor é mudar variável de ambiente.
   Trocar de **provedor** exige revisar `docs/planos/analise-pos-recorte/`.
4. DeepSeek fora do ar ou com chave inválida → **fallback determinístico**. Nunca usar
   modelo textual da Groq como substituto do DeepSeek.
