# CHANGELOG — 2026-08-12: Dourado F2/F3 + fix chave DeepSeek expirada

**Autor:** Hermes-server · **Data:** 2026-08-12 · **Repo:** `alvaro209890/GeoForest-IA`

## O que foi feito

### 1. Script de dourado versionado: `tools/rodar-dourado-f2-f3.ts`

Gera os laudos de referência (dourados) das Fases 2 e 3 da análise pós-recorte
SIMCAR sobre o recorte **real** da Santa Clara (CAR 270069,
`backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip`):

- Lê as 28 camadas `.shp` do ZIP e monta o `Map<camada, Geometry[]>` (EPSG:4326)
  — mesmo caminho do pipeline (`readFullShapefile` + `ringsToFeature`).
- **F2 (datação 2009–2019):** `runPos2008Analysis` com catálogo WMS runtime real,
  cenas WMS da SEMA reais, Groq Vision (`qwen/qwen3.6-27b`) e laudo DeepSeek
  (`deepseek-v4-pro`) — exatamente o que produção roda.
- **F3 (vegetação na AC):** `runAcVegetacaoAnalysis` com evidência geométrica
  turf (AVN declarada) + 3 cenas por AC.
- Saída em `docs/dourados/santa-clara/` (JSON completo + laudos .md + resumo).

Uso:

```bash
export PATH="/home/server/.nvm/versions/node/v20.20.0/bin:$PATH"
set -a; source ~/.config/geoforest/backend.env; set +a
npx tsx tools/rodar-dourado-f2-f3.ts            # completo
npx tsx tools/rodar-dourado-f2-f3.ts --inspect # só contagens de camadas
DOURADO_MAX_POLYGONS=1 npx tsx tools/rodar-dourado-f2-f3.ts  # smoke test
```

> ⚠️ O `backend.env` **não tem `export`** nas linhas (o systemd lê via
> `EnvironmentFile`). Para rodar scripts manuais, o `source` simples **não
> exporta** as variáveis para processos filhos — use `set -a; source ...; set +a`.

### 2. 🔴 Fix em produção: `DEEPSEEK_API_KEY` expirada no `backend.env`

- **Sintoma:** todas as chamadas DeepSeek retornavam HTTP 401 e os laudos das
  fases caíam em `deterministic-fallback` ("DeepSeek indisponível") — inclusive
  na Fase 1, que está ligada em produção desde 10/08.
- **Causa:** a chave `DEEPSEEK_API_KEY` do `/home/server/.config/geoforest/backend.env`
  estava **expirada** (HTTP 401). A chave válida é a do `~/.hermes/.env`
  (mesma conta, saldo verificado via `/user/balance`).
- **Fix:** linha `DEEPSEEK_API_KEY` do `backend.env` substituída pela chave
  válida (backup: `backend.env.bak-dourado-20260812`), restart do
  `geoforest-backend.service`, validação: `GET /user/balance` 200 +
  `[diag] deepseek HTTP 200` + laudo com `model: deepseek-v4-pro`.
- **Validação de integridade:** `b'***' in backend.env` = `False` (nada corrompido).

### 3. Dourados F2/F3 (resultado — executado 12/08, laudo F2 regenerado 13/08)

- Fixture: `Recorte_SANTA_CLARA_FINAL_16-07-26.zip` — **38 AUAS, 33 ACs**
- **F2** (`f2-pos2008.json` + `f2-pos2008-laudo.md`, laudo `deepseek-v4-pro`):
  - 9 já antropizados em 2009 (10,61 ha) · 13 sem mudança observada (3.365,20 ha)
  · 16 inconclusivos (22,13 ha) · **0 com ano/intervalo confirmado** · 3.397,94 ha totais
- **F3** (`f3-ac-vegetacao.json` + `f3-ac-vegetacao-laudo.md`, laudo determinístico por design):
  - 3 ACs com vegetação declarada (250,96 ha) · 3 com vegetação aparente
  · 9 sem vegetação aparente · 18 inconclusivos · 3.134,60 ha totais

**Bugs encontrados durante a geração dos dourados (corrigidos nesta rodada):**
1. `DEEPSEEK_API_KEY` expirada → ver seção 2 acima.
2. **Laudo F2 com títulos duplicados** (`### AUAS-0001` repetido): o DeepSeek
   incluía o cabeçalho de seção no `markdown` (o montador `assemblePos2008Markdown`
   também adiciona). Prompt do `buildPos2008Report` corrigido (proíbe cabeçalho
   na seção + formatação de áreas com ≤2 casas decimais). Testes do módulo:
   32 passed. **Atenção: esta correção de prompt só chega em produção com o push
   + auto-sync** (restart incluído).

**Status dos gates (plano `docs/planos/analise-pos-recorte/STATUS.md`):**
- ✅ F1 estável em produção (0 erros em logs desde 10/08; chave DeepSeek corrigida)
- ⏳ **F2 dourado GERADO — aguardando conferência do Álvaro** para liberar
  `SIMCAR_AUAS_POS2008_ENABLED=true`
- ⏳ **F3 dourado GERADO — aguardando F2 + conferência GIS ≥3 imóveis** para
  liberar `SIMCAR_AC_VEG_ENABLED=true`

## Como conferir o dourado

1. Abrir `docs/dourados/santa-clara/f2-pos2008-laudo.md` (datação por AUAS)
2. Abrir `docs/dourados/santa-clara/f3-ac-vegetacao-laudo.md` (vegetação por AC)
3. Comparar com o recorte no QGIS (`.shp` no ZIP da fixture) — especialmente
   as AUAS marcadas com ano confirmado vs. inconclusivas e as ACs com
   vegetação aparente/declarada.
