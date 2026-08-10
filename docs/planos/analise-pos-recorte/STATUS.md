# STATUS — Plano "Análise pós-recorte SIMCAR (3 fases)"

| Campo | Valor |
|---|---|
| Status | **🚧 EM IMPLEMENTAÇÃO** — F2 (datação 2009–2019) e F3 (vegetação na AC) implementadas, auditadas e no `main`; decisões A1–A10 e fonte da declaração F3 **fechadas** (2026-08-10). Rollout: F1 pronta para ligar; F2 após F1 estável ≥1 semana; F3 após F2 + conferência GIS ≥3 imóveis |
| Criado em | 2026-08-05 |
| Atualizado em | 2026-08-10 (decisões A1–A10 e fonte F3 fechadas pelo Álvaro; rollout definido) |
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
- [x] **A1–A4 respondidas pelo Álvaro (2026-08-10)** — A1: série F2 começa em 2009 (L5 2008 só como referência) · A2: Landsat 8 em 2016/2017 (S-2 na janela-ponte) · A3: alerta ALTO com ≥1% da AC ou ≥0,5 ha, slivers < 500 m² · A4: sem teto de polígonos, com prévia de ETA e aviso >30
- [x] **F0.1 — levantamento WMS ao vivo 2009→2019 concluído (2026-08-05)**: 11/11 anos com `GetMap` válido; NIR é estilo, não camada. Relatório: [`docs/LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md`](../../LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md)
- [x] **F0.3 — `polygons.ts` genérico** (`extractPolygonsFromLayer`, `countLayerPolygons`); `extractAuasPolygons` virou wrapper
- [x] **F0.4 — checkpoint com namespace de fase + `catalogVersion`** (`buildPhaseCheckpointKey`)
- [x] **F0.5 — `GET /api/simcar/clip/phases/:jobId`** + `backend/simcar/phases.ts` + allowlist em `backend/auth-required-paths.ts`
- [x] **F0.6 — painel `AnalisePosRecortePanel`** com os 3 cards (só a Fase 1 ligada); Dashboard perdeu o botão solto
- [x] **F2 — datação 2008–2019 implementada (2026-08-07)**: `backend/analise-pos-recorte/pos2008/` (timeline 5 janelas + ponte, catálogo com cache/TTL, redutor determinístico, cenas anuais, Groq vision, laudo DeepSeek, orchestrator); rota `POST /api/simcar/clip/analyze-auas-pos2008`; front com runner SSE, progresso e cancelamento
- [x] **F3 — vegetação na Área Consolidada implementada (2026-08-07)**: `backend/analise-pos-recorte/ac-vegetacao/` (evidência geométrica turf com filtro de slivers < 500 m², redutor com precedência geométrica, 3 cenas S2 RGB/NIR + SPOT 2008, orchestrator); rota `POST /api/simcar/clip/analyze-ac-vegetacao` + `GET /api/simcar/imagery/catalog`
- [x] **Deploy do código (2026-08-07)**: commit `7097fb84` no `main`, auto-sync buildado/reiniciado, Firebase hosting no ar — flags continuam desligadas (F2/F3 respondem 409 `PHASE_NOT_READY`)
- [x] **Auditoria de bugs F2/F3 (2026-08-07)**: ownership/SSRF nas rotas de fase, flags independentes (`SIMCAR_AUAS_POS2008_ENABLED`/`SIMCAR_AC_VEG_ENABLED`), lock por `uid:jobId`, estado `STALE` transitivo, janela-ponte da F2 casada com a fronteira certa, validação de ano por `sceneId`, cenas WMS reais da F3, redutor visual (≥2 cenas positivas, sem falso alerta) e geométrico (buracos preservados), cache do catálogo por bbox. Changelog: [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md)
- [x] **Auditoria de bugs rodada 2 (2026-08-07)** — sem tocar em segurança: deadlock do estado `STALE` (fase mandava "refaça" e a rota recusava), regra do ano exato aceitando anos não consecutivos, fronteira de sensor sumindo com ano reprovado (e fronteira falsa vinda da lista estática), **Fase 3 validada contra os shapefiles reais da Santa Clara** — `TIPOLOGIA_VEGETAL` cobre ~100% de toda AC e fazia 100% delas saírem como alerta ALTO; evidência geométrica 52 s → 2 s; AC de 0,00 ha não paga mais cena/visão; nomenclatura ARL/AUAS corrigida no laudo; `pnpm test` voltou a ficar verde no `main`. Changelog: [`docs/CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md`](../../CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md)
- [x] **A decidir (Álvaro) resolvida (2026-08-10)**: área declarada da F3 fica **só com `AVN`** — `SIMCAR_AC_VEG_DECLARED_SOURCES` inalterado; a `TIPOLOGIA_VEGETAL` segue como contexto no JSON, nunca como gatilho (a soma satura o alerta, medido 2026-08-07)
- [ ] F1 — **liberada pelo Álvaro (2026-08-10)**: pendente só ligar a flag `SIMCAR_AUAS_V2_ENABLED=true` no servidor (dourado + live DeepSeek ok)
- [ ] F2 rollout — gate: `SIMCAR_AUAS_POS2008_ENABLED=true` após F1 estável ≥1 semana + dourado F2 conferido
- [ ] F3 rollout — gate: `SIMCAR_AC_VEG_ENABLED=true` após F2 estável + conferência GIS ≥3 imóveis

## Dependências herdadas (já eram pendência antes deste plano)

| Item | Efeito |
|---|---|
| Conjunto dourado humano da Fase 1 | Bloqueia `SIMCAR_AUAS_V2_ENABLED=true` |
| Validação live do DeepSeek no fluxo real | Idem |
| `SIMCAR_AUAS_V2_ENABLED` ausente no `backend.env` do servidor | Em produção o botão AUAS ainda roda o V1 (2008–2024) |
| ~~`AuasPre2008Summary.tsx` sem uso no front~~ | **Não procede:** `SimcarAuasPre2008PanelV2` já é renderizado no card de resultado do recorte (conferido em 2026-08-05) |

## Decisões — todas fechadas (2026-08-10)

**A1** série F2 começa em 2009 · **A2** Landsat 8 em 2016/2017 · **A3** alerta ALTO com
≥1% da AC ou ≥0,5 ha · **A4** sem teto de polígonos · **A5** V1 legado somente-leitura ·
**A6** F3 exige F2 · **A7** só sugerir SCCON · **A8** só proveniência + hash (imagem nos
alertas) · **A9** laudo único com 3 seções · **A10** refazer fase com confirmação e
`stale`. **F3 extra:** área declarada só com `AVN`. Detalhe em
[11-riscos-e-decisoes-abertas.md](11-riscos-e-decisoes-abertas.md).

## Histórico

| Data | Evento |
|---|---|
| 2026-08-05 | Plano criado (status PLANEJADO) — 15 documentos em `docs/planos/analise-pos-recorte/` |
| 2026-08-05 | **F0.1 — levantamento WMS ao vivo** feito: série 2009–2019 completa e validada, NIR corrigido de camada para estilo. Ver [`docs/CHANGELOG_2026-08-05_LEVANTAMENTO_WMS_F0_1.md`](../../CHANGELOG_2026-08-05_LEVANTAMENTO_WMS_F0_1.md) |
| 2026-08-05 | **Fundação F0.3–F0.6 implementada e testada** (+46 testes; `pnpm test`/`check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md`](../../CHANGELOG_2026-08-05_ANALISE_POS_RECORTE_F0.md). Fases 2 e 3 seguem não implementadas; `SIMCAR_AUAS_V2_ENABLED` continua `false` |
| 2026-08-07 | **Fases 2 e 3 implementadas e testadas** (commit `7097fb84`, +33 testes novos; `pnpm test` 579 passed/8 skipped, `check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_F2_F3.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_F2_F3.md). Push + auto-sync + Firebase hosting concluídos; flags permanecem `false` |
| 2026-08-07 | **Auditoria rodada 2 (bugs, sem segurança)**: deadlock do `STALE`, regras 2/3 da datação, fronteiras de sensor, e Fase 3 confrontada com shapefile real (falso ALTO universal, 26× de desempenho, AC minúscula sem custo de IA). Suíte voltou a 100% verde. Ver [`docs/CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md`](../../CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md) |
| 2026-08-07 | **Auditoria de bugs F2/F3 corrigida** (ownership/SSRF, flags independentes, lock de fase, invalidação `STALE` transitiva, janela-ponte da F2, validação de ano por `sceneId`, cenas WMS reais da F3, redutor visual e geométrico, cache do catálogo por bbox; +8 arquivos de teste novos; `pnpm test` 591 passed/8 skipped, `check`/`build` verdes). Ver [`docs/CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md`](../../CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_BUGS.md) |
| 2026-08-10 | **Decisões A1–A10 + fonte da declaração F3 fechadas pelo Álvaro** (rodada de perguntas). Rollout definido: F1 pronta para ligar; F2 após F1 estável ≥1 semana; F3 após F2 + conferência GIS ≥3 imóveis. Atualizados `STATUS.md` e `11-riscos-e-decisoes-abertas.md` |
