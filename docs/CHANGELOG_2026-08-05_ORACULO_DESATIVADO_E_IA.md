# CHANGELOG — 05/08/2026 — Oráculo SIMCAR desativado para sempre + provedores de IA documentados

Só documentação. Nenhuma mudança de comportamento em código nesta entrega.

## 1. Fluxo "ZIP → SIMCAR do Álvaro → GeoForest" desativado para sempre

Decisão do Álvaro. O GeoForest **não envia mais** o ZIP do usuário ao SIMCAR real da SEMA
com a conta técnica dele para importar/processar e devolver o veredito. A aba
"Análise de Erros → Processar projeto" já tinha sido removida em 21/07/2026; agora a
desativação é **definitiva e documentada**, sem plano de retomada.

Documento novo, que é a fonte da regra:
[`docs/FLUXO_ORACULO_SIMCAR_DESATIVADO.md`](FLUXO_ORACULO_SIMCAR_DESATIVADO.md).

Avisos adicionados no topo de:

| Arquivo | O que passou a dizer |
|---|---|
| `.claude/CLAUDE.md` | Seção "Oráculo SIMCAR: DESATIVADO PARA SEMPRE" — é o primeiro doc que qualquer agente lê |
| `docs/SIMCAR_ORACULO.md` | Histórico técnico; não religar; não apagar `client.ts` |
| `docs/PROCESSAR_PROJETO_SIMCAR.md` | Aba removida, fluxo desativado, não recriar |
| `docs/planos/simcar-oraculo-proxy/00-README.md` | Plano arquivado; não executar as tarefas |
| `docs/planos/simcar-oraculo-proxy/STATUS.md` | Idem, no topo do status |
| `docs/planos/analise-pos-recorte/01-contexto-e-estado-atual.md` | Deixa explícito que as 3 fases novas **não** falam com o SIMCAR |

### Estado real do código (verificado hoje, não presumido)

- **Interface:** removida. `ProcessarProjetoAnalysis.tsx` existe no repo e **não é
  importado por ninguém**; não há rota de dashboard para ele.
- **Rotas de backend:** `/api/simcar-oraculo/*` continuam registradas
  (`backend/routes/_registry.ts` + allowlist em `backend/app.ts`) — inalcançáveis pelo
  app, mas vivas para quem chamar direto com token. Ficam como estão; a regra é **não
  usar e não religar**.
- **`backend/simcar-oraculo/client.ts` não pode ser apagado:** a aba **Lotes SIMCAR**
  (viva, e que usa a credencial do **próprio usuário**) depende dele para a sessão SEMA.
- **Credencial do oráculo** no `backend.env` do server segue inválida — e assim fica.

## 2. Provedores de IA documentados com medição ao vivo

Documento novo: [`docs/IA_PROVEDORES.md`](IA_PROVEDORES.md). Tudo verificado por chamada
real em 05/08/2026 — **nenhum valor de chave** aparece no repo (público).

### Chaves disponíveis

| Provedor | Onde | Estado |
|---|---|---|
| Groq `gsk_KBMX…788R` | `~/.config/geoforest/backend.env` (server) | ✅ **250.000 TPM** / 500k requests — é a que o backend usa |
| Groq `gsk_ZhZd…sEDf` | `~/.hermes/.env` (acer) | ✅ plano **gratuito**, 8.000 TPM — serve para desenvolver |
| DeepSeek `sk-5bb…6959` | `~/.hermes/.env` (acer) | ✅ válida, saldo US$ 13,21 |
| DeepSeek `sk-1c9…5027` | `~/.config/geoforest/backend.env` (server) | 🔴 **401 inválida** |

Ou seja: **há chave Groq funcionando para começar o desenvolvimento agora**, e a de
produção nem é free tier.

### Fatos medidos que mudam decisões

- **Teto de 3 imagens por chamada é do MODELO, não do plano.** Com a chave de 250k TPM,
  4 imagens devolvem HTTP 400 `"This model supports up to 3 images"`. Pagar mais não
  libera mais imagens — o desenho de janelas de 3 cenas é obrigatório em qualquer cenário.
- **Custo por cena:** um PNG 512×512 do WMS da SEMA + prompt curto = **1.361 tokens de
  entrada**. Três cenas ≈ 4–5,5k tokens, batendo com a medição de 30/07.
- **Premissa corrigida no plano das 3 fases:** os 8k TPM que ditavam o ETA são da conta
  gratuita do PC acer, não do backend. Em produção o gargalo passa a ser o WMS da SEMA.
  Registrado em `docs/planos/analise-pos-recorte/02-arquitetura.md` §9 e `10-deploy-e-ops.md`.
- **Caminho WMS → Groq Vision provado ponta a ponta:** cena real de Querência
  (Landsat 5 2003) analisada com `qwen/qwen3.6-27b`, `reasoning_effort: none` e JSON mode,
  devolvendo `{"state":"MIXED", ...}` válido.
- **Gotcha:** `urllib.request` do Python leva **403 (Cloudflare `error code: 1010`)** no
  POST `/chat/completions` mesmo com a chave certa; `curl` e o `fetch` do Node passam. Se
  um diagnóstico em Python falhar com 403, o problema é o cliente HTTP, não a chave.

### Pendência de ops (não executada)

Trocar a `DEEPSEEK_API_KEY` inválida do server pela válida do `~/.hermes/.env`, com
backup, e reiniciar `geoforest-backend.service`. Sem isso, laudo redigido por DeepSeek cai
no fallback determinístico — resultado estruturado correto, texto mais pobre.
