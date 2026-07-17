# Oráculo SIMCAR no Backend Existente — Índice do plano

> **Repo:** `docs/planos/simcar-oraculo-proxy/`  
> **Implementação:** seguir `07-tarefas-implementacao.md` (subagent-driven-development).

**Goal:** No backend GeoForest (PC servidor + túnel/domínio), importar e processar o ZIP do usuário no projeto-teste SIMCAR (ex. CAR 270069), ajustando município e área de abrangência a partir do shape, com timeline no front e roadmap de auto-correção.

**Architecture:** Módulo `backend/simcar-oraculo/` no Express atual; fila serial; modo `PROCESSAR_MODE=ORACULO|LOCAL|HYBRID`; credenciais só em env do PC; reutiliza aprendizados do oráculo 16/07. Sem worker separado.

**Tech Stack:** Node/TS Express, scramble SIMCAR, jobs SSE, front `ProcessarProjetoAnalysis.tsx`.

---

## Arquivos

| Arquivo | Conteúdo |
|---------|----------|
| [00-README.md](./00-README.md) | Fases P0–P6 |
| [01-arquitetura.md](./01-arquitetura.md) | Diagrama, modos |
| [02-modulo-simcar-oraculo.md](./02-modulo-simcar-oraculo.md) | Módulo backend |
| [03-api-contratos-e-eventos.md](./03-api-contratos-e-eventos.md) | API + SSE |
| [04-municipio-e-abrangencia.md](./04-municipio-e-abrangencia.md) | Propriedade + caracterização |
| [05-frontend-ux.md](./05-frontend-ux.md) | Timeline e UI |
| [06-autofix-roadmap.md](./06-autofix-roadmap.md) | Auto-correção (P5/P6) |
| [07-tarefas-implementacao.md](./07-tarefas-implementacao.md) | Tasks bite-sized |
| [08-seguranca-ops.md](./08-seguranca-ops.md) | Env, fila, ops |
| [09-validacao-santa-clara.md](./09-validacao-santa-clara.md) | Checklist CAR 270069 |
| [10-aprendizados-oraculo-reuso.md](./10-aprendizados-oraculo-reuso.md) | Calibrações reutilizáveis |

## Começar por

1. `00-README.md` → `01-arquitetura.md` → `07-tarefas-implementacao.md`
2. Auto-fix: `06-autofix-roadmap.md` (não bloqueia P0–P4)

## Aceite P0–P4

Upload ZIP → prepare município/abrangência → import SIMCAR → PDF → process → PDF/ZIP erros → timeline; validação local desligável.
