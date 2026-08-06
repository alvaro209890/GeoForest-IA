# STATUS — Plano "Análise pós-recorte SIMCAR (3 fases)"

| Campo | Valor |
|---|---|
| Status | **📋 PLANEJADO** — nenhuma implementação nesta rodada |
| Criado em | 2026-08-05 |
| Atualizado em | 2026-08-05 |
| Autor | Claude (plano), com Álvaro |
| Repo | `alvaro209890/GeoForest-IA` — branch `main` |
| Pasta | `docs/planos/analise-pos-recorte/` |
| Planos-mãe | `Analise_pos_recorte/concluido/` (Fase 1) e `Analise_pos_recorte/fase/` (Fase 2 v1) |

## Escopo

Encadear em três botões a análise que roda **depois do recorte SIMCAR**:

1. **Fase 1 — AUAS 2003–2008:** houve desmate/antropização antes do marco?
   *(código já existe em `backend/analise-pos-recorte/`, flag desligada)*
2. **Fase 2 — AUAS 2008–2019:** quando ocorreu? *(a implementar)*
3. **Fase 3 — vegetação dentro da Área Consolidada** *(a implementar)*

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
- [ ] F0.1 — levantamento WMS ao vivo 2009→2019 (bloqueia F2 e F3)
- [ ] F0.3–F0.6 — fundação (polygons genérico, checkpoints com fase, rota de fases, painel)
- [ ] F1 — ligar a Fase 1 (conjunto dourado + live DeepSeek + flag no servidor)
- [ ] F2 — datação 2008–2019
- [ ] F3 — vegetação na Área Consolidada

## Dependências herdadas (já eram pendência antes deste plano)

| Item | Efeito |
|---|---|
| Conjunto dourado humano da Fase 1 | Bloqueia `SIMCAR_AUAS_V2_ENABLED=true` |
| Validação live do DeepSeek no fluxo real | Idem |
| `SIMCAR_AUAS_V2_ENABLED` ausente no `backend.env` do servidor | Em produção o botão AUAS ainda roda o V1 (2008–2024) |
| `AuasPre2008Summary.tsx` sem uso no front | O resultado da Fase 1 não teria onde aparecer |

## Decisões pendentes que mudam o desenho

**A1** início da série da Fase 2 (2009 × 2008) · **A2** Landsat 8 ou Sentinel-2 em
2016/2017 · **A3** limiar de vegetação declarada na AC · **A4** teto de polígonos por job.
As demais (A5–A10) têm default e não bloqueiam. Detalhe em
[11-riscos-e-decisoes-abertas.md](11-riscos-e-decisoes-abertas.md).

## Histórico

| Data | Evento |
|---|---|
| 2026-08-05 | Plano criado (status PLANEJADO) — 15 documentos em `docs/planos/analise-pos-recorte/` |
