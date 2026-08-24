# Modelo de Visão da Análise Pós-Recorte — auditoria de custo e troca (2026-08-24)

(autor: Hermes-windows | 2026-08-24)

## Contexto

Uso caro detectado na conta OpenRouter. Auditoria apontou o consumidor: o **backend
GeoForest** (`geoforest-backend.service`, systemd do usuário `server` no server-desktop),
no pipeline `backend/analise-pos-recorte/` (SIMCAR AUAS).

## O que era caro

| Fase | Variável | Valor anterior | Preço (in/out por M tokens) |
|---|---|---|---|
| 1 | `VISION_MODEL` (`~/.config/geoforest/backend.env`) | `google/gemini-2.5-flash` | $0.30 / $2.50 |
| **2 (supressão pós-2008)** | `SIMCAR_AUAS_VISION_MODEL` | *(default hardcoded)* `qwen/qwen3.6-27b` | $0.32 / **$3.20** |

O default da Fase 2 estava hardcoded em dois pontos do código:

- `backend/analise-pos-recorte/config.ts:81`
- `backend/analise-pos-recorte/pos2008/orchestrator.ts:207`

Como a variável não existia no `.env`, produção rodava sempre no Qwen 27B.

## Troca aplicada em 24/08/2026

Em `~/.config/geoforest/backend.env` (fora do repo, backup `backend.env.bak-vision-*`):

```env
# Visao Fase 2 (pos-2008) — trocado de qwen/qwen3.6-27b (caro, $3.20/M out)
SIMCAR_AUAS_VISION_MODEL=qwen/qwen3-vl-32b-instruct
```

- Novo modelo validado por **chamada real** com imagem via a mesma chave antes do restart
  (respondeu JSON correto; custo da chamada teste ≈ $0,0000148).
- Serviço reiniciado (`systemctl --user restart geoforest-backend.service`) e variável
  confirmada dentro do processo novo.
- Economia: ~**85%** no custo de saída ($3.20 → $0.42 por M tokens).

## Plano seguinte: DeepSeek vision

`deepseek/deepseek-v4-flash-vision-exp` ($0.22/$0.66) existe no OpenRouter e é o alvo,
mas está **bloqueado pela política de privacidade da conta**:

```
"error": {"message": "No endpoints available matching your guardrail restrictions and data policy", "code": 404}
```

Para migrar: liberar endpoints em https://openrouter.ai/settings/privacy (só o dono da
conta pode), depois trocar a linha acima para o modelo DeepSeek + restart do serviço.

## Notas sobre a API do OpenRouter

- `/api/v1/key` → uso agregado da chave (funciona com key normal).
- `/api/v1/activity` → exige **management key** (403 com key normal); breakdown por
  modelo só no painel web.

## Ferramentas locais que também fixam o modelo antigo

Os scripts de análise em `tools/` têm `qwen/qwen3.6-27b` hardcoded
(`analisar-timeline-lote355.ts`, `test-groq-*.ts`, `debug-groq-window.ts`) — são
ferramentas de uso manual; atualizar se voltarem a ser usadas.
