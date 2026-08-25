# STATUS — Plano "Análise pós-recorte SIMCAR (3 fases)"

| Campo | Valor |
|---|---|
| Status | **✅ IMPLEMENTADO** — três análises visuais independentes, cada uma com seu card/laudo; importação vetorizada separada das análises; Fase 3 com enquadramento AC + AVN; NDVI adicionado como quarto card determinístico. A publicação de 25/08 está registrada no changelog correspondente. |
| Criado em | 2026-08-05 |
| Atualizado em | 2026-08-25 (loop vetorizado removido; zoom AC + AVN; card NDVI) |
| Autor | Claude (plano), com Álvaro |
| Repo | `alvaro209890/GeoForest-IA` — branch `main` |
| Pasta | `docs/planos/analise-pos-recorte/` |
| Planos-mãe | `Analise_pos_recorte/concluido/` (Fase 1) e `Analise_pos_recorte/fase/` (Fase 2 v1) |

## Escopo

Disponibilizar análises independentes que rodam **depois do recorte SIMCAR**:

1. **Fase 1 — AUAS 2003–2008:** houve desmate/antropização antes do marco?
   *(código já existe em `backend/analise-pos-recorte/`, flag desligada)*
2. **Fase 2 — AUAS 2008–2019:** quando ocorreu? *(implementada, flag desligada)*
3. **Fase 3 — vegetação dentro da Área Consolidada** *(implementada)*
4. **NDVI — medição determinística Landsat C2 L2** *(implementada em módulo próprio)*

Nenhuma análise exige a conclusão de outra. O bloqueio por camada ausente continua
válido; nas três fases visuais há mutex somente enquanto outra grava o mesmo job.

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
- [x] F1 — **LIGADA em produção (2026-08-10, Hermes-server)**: flag `SIMCAR_AUAS_V2_ENABLED=true` adicionada ao `~/.config/geoforest/backend.env` do servidor + `systemctl --user restart geoforest-backend.service` + validado (flag presente no `/proc/<pid>/environ` do processo, porta 3001 HTTP 200). Dourado + live DeepSeek ok (liberada pelo Álvaro). F2/F3 seguem com gates.
- [x] **Fix em produção (2026-08-12, Hermes-server):** `DEEPSEEK_API_KEY` do `backend.env` estava expirada (HTTP 401) → todos os laudos caíam no fallback determinístico (inclusive F1). Substituída pela chave válida do `~/.hermes/.env`; restart validado com laudo `deepseek-v4-pro`.
- [x] **Dourados F2/F3 gerados (2026-08-12, Hermes-server):** `tools/rodar-dourado-f2-f3.ts` (versionado) rodou as duas fases sobre o recorte real da Santa Clara (38 AUAS, 33 ACs) com WMS/Groq/DeepSeek reais. Saída: `docs/dourados/santa-clara/` (JSON + laudos .md). Ver `docs/CHANGELOG_2026-08-12_DOURADO_F2_F3.md`.
- [ ] **F2 rollout** — gate: `SIMCAR_AUAS_POS2008_ENABLED=true` após F1 estável ≥1 semana + **dourado F2 conferido pelo Álvaro** (laudo gerado 12/08 — conferência pendente)
- [ ] F3 rollout — gate: `SIMCAR_AC_VEG_ENABLED=true` após F2 estável + conferência GIS ≥3 imóveis (laudos gerados 12/08 — conferência pendente)

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
**A6** ~~F3 exige F2~~ (revogada 23/08/2026 — as 3 são independentes) · **A7** só sugerir SCCON · **A8** só proveniência + hash (imagem nos
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
| 2026-08-23 | **Fase 1 v2 — a IA passa a enxergar o SPOT 2008**: o modelo de visão estava preso ao literal `qwen/qwen3.6-27b` (ignorando o `VISION_MODEL` do ambiente) e a janela `W2007_2008`, a mais pesada da série, dava `TIMEOUT` em todos os polígonos — a cena SPOT do WMS era baixada, aparecia no anexo do laudo e **nunca era analisada**. Corrigidos: herança do `VISION_MODEL`, `conflicts` ausente no JSON da visão, limitação explícita quando a janela do marco falha, e glifos fora do WinAnsi no PDF (`2007→SPOT` saía `2007!’SPOT`). Validado no imóvel real (job `27ca02d3`): 6/6 janelas COMPLETED e `AUAS-0002` chega a `INCONCLUSIVO_NO_MARCO_2008` pela leitura do SPOT. Suíte 855 passed/8 skipped. Ver [`FASE1_V2_SPOT_MARCO_2008.md`](FASE1_V2_SPOT_MARCO_2008.md) |
| 2026-08-23 | **As 3 análises pós-recorte viraram independentes** (pedido do Álvaro): a Fase 3 exigia F1+F2 concluídas (`requires_PRE_2008`/`requires_POS_2008`) e herdava `previous_phase_stale`, apesar de o orquestrador dela já aceitar `pos2008CompletedAt: null`. Removido o encadeamento e a invalidação cruzada; `SIMCAR_AC_VEG_ENABLED` ligado no env. Achado 🔴 no caminho: havia **um slot só de laudo por job** e cada geração apagava o arquivo anterior — rodar a Fase 3 destruía o PDF da Fase 1; agora cada fase guarda o seu em `phaseReports[fase]` e o card oferece PDF+Word próprios. Como soltar as fases abria corrida entre elas, o gate passou a recusar `PHASE_ALREADY_RUNNING` sempre que outra fase está rodando. Validado no job real `27ca02d3` com as 3 executadas na ordem inversa (F3 sozinha primeiro). Ver [`FLUXO_3_ANALISES_INDEPENDENTES.md`](FLUXO_3_ANALISES_INDEPENDENTES.md) |
| 2026-08-23 | **Anexo fotográfico nas 3 análises**: só a Fase 1 persistia o `imageBuffer` da cena (a imagem com overlay que a IA olhou); as Fases 2 e 3 guardavam apenas a URL crua do WMS e saíam **sem figura nenhuma**. Helper único `scene-persistence.ts`, `uid` como dependência das duas, e o gate do anexo trocado de `kind === "AUAS_PRE2008"` para `reportPhotoAnnexHeading(kind)` no PDF e no DOCX. Como a Fase 2 tem 11 anos por polígono, as figuras passaram a ser recomprimidas em JPEG q82 ao embutir — sem isso 6 figuras já davam 5,55 MB de PDF (Fase 3: 5,55 → 0,62 MB; Fase 1: 1,77 → 0,48 MB, mesmas 12 figuras). Ver [`FLUXO_3_ANALISES_INDEPENDENTES.md`](FLUXO_3_ANALISES_INDEPENDENTES.md) |
| 2026-08-25 | **Loop vetorizado removido e foco AVN concluído:** o importador não relança mais AC/AVN/AUAS; cada endpoint pertence ao seu card. A cena RGB da Fase 3 enquadra AC + AVN no mesmo `zoom to layer`, sem quarta chamada de visão. NDVI entra como quarto card independente. Ver [`docs/CHANGELOG_2026-08-25_OVERLAY_AVN_FASE3.md`](../../CHANGELOG_2026-08-25_OVERLAY_AVN_FASE3.md). |
