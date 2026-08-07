# STATUS — Plano "Análise pós-recorte SIMCAR (3 fases)"

| Campo | Valor |
|---|---|
| Status | **🚧 EM IMPLEMENTAÇÃO** — F2 (datação 2009–2019) e F3 (vegetação na AC) implementadas, auditadas e no `main`; aguardando rollout por flag |
| Criado em | 2026-08-05 |
| Atualizado em | 2026-08-07 (F2/F3 entregues + auditoria de bugs + deploy do código) |
| Autor | Claude (plano), com Álvaro |
| Repo | `alvaro209890/GeoForest-IA` — branch `main` |
| Pasta | `docs/planos/analise-pos-recorte/` |
| Planos-mãe | `Analise_pos_recorte/concluido/` (Fase 1) e `Analise_pos_recorte/fase/` (Fase 2 v1) |

## Escopo

Encadear em três botões a análise que roda **depois do recorte SIMCAR**:

1. **Fase 1 — AUAS 2003–2008:** houve desmate/antropização antes do marco?
   *(código já existe em `backend/analise-pos-recorte/`, flag desligada)*
2. **Fase 2 — AUAS 2008–2019:** quando ocorreu? *(implementada, flag desligada)*
3. **Fase 3 — vegetação dentro da Área Consolidada** *(implementada, flag desligada)*

Cada fase destrava a seguinte; a regra de desbloqueio é do backend, não só da UI.

## Progresso

- [x] Estado atual do código levantado (rotas, V1 × V2, módulo pré-2008, camadas do recorte)
- [x] Catálogo WMS da SEMA mapeado a partir do repo (1984→2024) e lacunas identificadas
- [x] Arquitetura das 3 fases desenhada (módulos, checkpoints, gating, identidade de polígono)
- [x] Contratos, rotas, SSE e persistência especificados
- [x] Matriz de testes, riscos (R1–R14) e decisões abertas (A1–A10) escritos
- [x] **Stack de IA confirmada pelo Álvaro (2026-08-05):** visão = **Groq** (modelo do plano
      gratuito, `qwen/qwen3.6-27b`) · texto = **DeepSeek** (`deepseek-v4-pro`) — decisão D11,
      detalhada em [02 §9](02-arquitetura.md)
- [ ] **A1–A4 respondidas pelo Álvaro** — bloqueiam o desenho final
- [x] **F0.1 — levantamento WMS ao vivo 2009→2019 concluído (2026-08-05)**: 11/11 anos com `GetMap` válido; NIR é estilo, não camada. Relatório: [`docs/LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md`](../../LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md)
- [x] **F0.3 — `polygons.ts` genérico** (`extractPolygonsFromLayer`, `countLayerPolygons`); `extractAuasPolygons` virou wrapper
- [x] **F0.4 — checkpoint com namespace de fase + `catalogVersion`** (`buildPhaseCheckpointKey`)
- [x] **F0.5 — `GET /api/simcar/clip/phases/:jobId`** + `backend/simcar/phases.ts` + allowlist em `backend/auth-required-paths.ts`
- [x] **F0.6 — painel `AnalisePosRecortePanel`** com os 3 cards (só a Fase 1 ligada); Dashboard perdeu o botão solto
- [x] **F2 — datação 2008–2019 implementada (2026-08-07)**: `backend/analise-pos-recorte/pos2008/` (timeline 5 janelas + ponte, catálogo com cache/TTL, redutor determinístico, cenas anuais, Groq vision, laudo DeepSeek, orchestrator); rota `POST /api/simcar/clip/analyze-auas-pos2008`; front com runner SSE, progresso e cancelamento
- [x] **F3 — vegetação na Área Consolidada implementada (2026-08-07)**: `backend/analise-pos-recorte/ac-vegetacao/` (evidência geométrica turf com filtro de slivers < 500 m², redutor com precedência geométrica, 3 cenas S2 RGB/NIR + SPOT 2008, orchestrator); rota `POST /api/simcar/clip/analyze-ac-vegetacao` + `GET /api/simcar/imagery/catalog`
- [x] **Deploy do código (2026-08-07)**: commit `7097fb84` no `main`, auto-sync buildado/reiniciado, Firebase hosting no ar — flags continuam desligadas (F2/F3 respondem 409 `PHASE_NOT_READY`)
- [x] **Auditoria de bugs F2/F3 (2026-08-07)**: ownership/SSRF nas rotas de fase, flags independentes (`SIMCAR_AUAS_POS2008_ENABLED`/`SIMCAR_AC_VEG_ENABLED`), lock por `uid:jobId`, estado `STALE` transitivo, janela-ponte da F2 casada com a fronteira certa, validação de ano por `sceneId`, cenas WMS reais da F3, redutor visual (≥2 cenas positivas, sem falso alerta) e geométrico (buracos preservados), cache do catálogo por bbox. Changelog: [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md)
- [ ] F1 — ligar a Fase 1 (conjunto dourado + live DeepSeek + flag no servidor)
- [ ] F2 rollout — `SIMCAR_AUAS_POS2008_ENABLED=true` (pré-requisito: F1 estável ≥1 semana + dourado F2)
- [ ] F3 rollout — `SIMCAR_AC_VEG_ENABLED=true` (pré-requisito: F2 estável + conferência GIS ≥3 imóveis)

## Dependências herdadas (já eram pendência antes deste plano)

| Item | Efeito |
|---|---|
| Conjunto dourado humano da Fase 1 | Bloqueia `SIMCAR_AUAS_V2_ENABLED=true` |
| Validação live do DeepSeek no fluxo real | Idem |
| `SIMCAR_AUAS_V2_ENABLED` ausente no `backend.env` do servidor | Em produção o botão AUAS ainda roda o V1 (2008–2024) |
| ~~`AuasPre2008Summary.tsx` sem uso no front~~ | **Não procede:** `SimcarAuasPre2008PanelV2` já é renderizado no card de resultado do recorte (conferido em 2026-08-05) |

## Decisões pendentes que mudam o desenho

**A1** início da série da Fase 2 (2009 × 2008) · **A2** Landsat 8 ou Sentinel-2 em
2016/2017 · **A3** limiar de vegetação declarada na AC · **A4** teto de polígonos por job.
As demais (A5–A10) têm default e não bloqueiam. Detalhe em
[11-riscos-e-decisoes-abertas.md](11-riscos-e-decisoes-abertas.md).

## Histórico

| Data | Evento |
|---|---|
| 2026-08-05 | Plano criado (status PLANEJADO) — 15 documentos em `docs/planos/analise-pos-recorte/` |
| 2026-08-05 | **F0.1 — levantamento WMS ao vivo** feito: série 2009–2019 completa e validada, NIR corrigido de camada para estilo. Ver [`docs/CHANGELOG_2026-08-05_LEVANTAMENTO_WMS_F0_1.md`](../../CHANGELOG_2026-08-05_LEVANTAMENTO_WMS_F0_1.md) |
| 2026-08-05 | **Fundação F0.3–F0.6 implementada e testada** (+46 testes; `pnpm test`/`check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md`](../../CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md). Fases 2 e 3 seguem não implementadas; `SIMCAR_AUAS_V2_ENABLED` continua `false` |
| 2026-08-07 | **Fases 2 e 3 implementadas e testadas** (commit `7097fb84`, +33 testes novos; `pnpm test` 579 passed/8 skipped, `check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_F2_F3.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_F2_F3.md). Push + auto-sync + Firebase hosting concluídos; flags permanecem `false` |
| 2026-08-07 | **Auditoria de bugs F2/F3 corrigida** (ownership/SSRF, flags independentes, lock de fase, invalidação `STALE` transitiva, janela-ponte da F2, validação de ano por `sceneId`, cenas WMS reais da F3, redutor visual e geométrico, cache do catálogo por bbox; +8 arquivos de teste novos; `pnpm test` 591 passed/8 skipped, `check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md) |
