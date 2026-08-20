# CHANGELOG — SIMCAR Vision: 1 Composite por Satélite

**Data:** 2026-08-20
**Autor:** Hermes-server
**Commits:** `cee54247`, `51adba1b`, `0e429b3b`

## Problema

A análise de imagens SIMCAR (`/api/simcar/clip/analyze`) gerava **3 imagens por satélite**
(overview, AC-only, AVN-only) = **12 imagens totais** enviadas à API de visão. Isso causava:

- Alto custo de tokens (mesma base WMS repetida 3x)
- Modelos Groq `llama-4-maverick` e `llama-4-scout` removidos da API (404)
- Fills transparentes (só contorno) — modelo não via área dentro do polígono
- Sem legenda — modelo inferia cores pela caption

## Mudanças

### 1. Merge 3→1 composite por satélite
- Antes: 4 satélites × 3 views = 12 imagens
- Depois: 4 satélites × 1 composite = 4 imagens
- Cada composite mostra AC + AVN + AUAS + ARL (se presente) + propriedade

### 2. Legenda visual
- `buildPolygonOverlaySvg` ganhou parâmetro `options: { showLegend?: boolean }`
- Legenda no canto inferior esquerdo: fundo rgba(0,0,0,0.75), ícones 12×12, texto sans-serif 13px
- Itens: Propriedade (vermelho), Área Consolidada (magenta), AVN (cyan), AUAS (laranja), ARL (verde)

### 3. Fills semi-transparentes
- Todas as camadas agora usam fill com 12% de opacidade da cor do stroke
- Exemplo: magenta stroke → `rgba(255,0,255,0.12)` fill

### 4. Qualidade Cloudinary
- Antes: 800×600, JPEG q65
- Depois: 1024×768, JPEG q80
- Melhor detalhe para classificação de vegetação/uso do solo

### 5. Vision API configurável (commits anteriores)
- `VISION_API_URL` — endpoint (default: OpenRouter)
- `VISION_API_KEY` — chave de auth (fallback: GROQ_API_KEY)
- `VISION_MODEL` — modelo (default: google/gemini-2.5-flash)
- Resolve 404 dos modelos Groq removidos

## Impacto

- **Tokens:** redução de ~60% por análise (4 imgs em vez de 12)
- **Qualidade:** resolução maior + fills + legenda = melhor contexto para o modelo
- **Custo:** Gemini 2.5 Flash no OpenRouter é mais barato que Groq Vision
- **Compatibilidade:** AUAS analysis (Fase 1/2/3) também ganha legenda automaticamente
