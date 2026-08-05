# STATUS — Plano "Integração com o Monitor SIMCAR"

| Campo | Valor |
|---|---|
| Status | **IMPLANTADO** (produção, 2026-08-05) |
| Criado em | 2026-08-05 |
| Autor | Hermes (plano) · Claude (implementação) |
| Repo | `alvaro209890/GeoForest-IA` — branch `main` |
| Pasta | `docs/planos/simcar-monitor/` |

## Progresso

- [x] Monitor SIMCAR dissecado (site, userscript, RTDB, STALE 40s, acesso REST validado)
- [x] Fantasmas do RTDB limpos (2026-08-05: Bruno ~49d + anônimo ~176d; `clients.json` vazio)
- [x] Estado atual do simcar-lotes mapeado (job, fila, fases, persistência)
- [x] Arquitetura e contrato do monitor desenhados (R1–R4)
- [ ] Decisões A1–A5 respondidas (doc 09) — nenhuma bloqueia
- [x] Fase 1 — backend leitura do monitor (`monitor.ts` + `aguardar.ts`, 15 testes)
- [x] Fase 2 — gate R1 + retomada R3 no job (`job.test.ts`, 7 testes)
- [x] Fase 3 — frontend (badge, banner, aviso, reabertura do job ativo)
- [x] Fase 4 — validação e docs (`docs/CHANGELOG_2026-08-05_SIMCAR_MONITOR.md`)
- [x] Deploy (backend no PC servidor + hosting)

## Pendente para a validação com gente de verdade

O e2e "logar no SIMCAR no meio de um download" depende de alguém abrir o SIMCAR com
o userscript. Enquanto isso, o comportamento foi provado por teste com monitor
falso, e a leitura do RTDB real foi conferida ao vivo (`clients.json` → `null`).

## Histórico

| Data | Evento |
|---|---|
| 2026-08-05 | Plano criado (status PLANEJADO); RTDB do monitor limpo de fantasmas |
| 2026-08-05 | Implementado e implantado (R1–R4) + fix do 401 entre lotes (job `4e7fdb05`) |
