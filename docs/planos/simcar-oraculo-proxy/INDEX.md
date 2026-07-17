# Oráculo SIMCAR no Backend Existente — Índice do plano

> **Repo:** `docs/planos/simcar-oraculo-proxy/`  
> **Status vivo:** [STATUS.md](./STATUS.md) ← **ler primeiro**  
> **Ops:** [docs/SIMCAR_ORACULO.md](../../SIMCAR_ORACULO.md)

**Goal:** No backend GeoForest (PC servidor + túnel/domínio), importar e processar o ZIP do usuário no projeto-teste SIMCAR (ex. CAR 270069), ajustando município e área de abrangência a partir do shape, com timeline no front e roadmap de auto-correção.

**Architecture:** Módulo `backend/simcar-oraculo/` no Express atual; fila serial; modo `PROCESSAR_MODE=ORACULO|LOCAL|HYBRID`; credenciais só em env do PC.

---

## Progresso (2026-07-16)

| Fase | Status |
|------|--------|
| P0 cliente+health+buscar | ✅ |
| P1 import API | ✅ (rotas) |
| P2 município/abrangência | ⏳ |
| P3 process API | ✅ (rotas) |
| P4 front | ⏳ |
| P5–P6 autofix | ⏳ |

Detalhes: [STATUS.md](./STATUS.md)

---

## Arquivos do plano

| Arquivo | Conteúdo |
|---------|----------|
| [STATUS.md](./STATUS.md) | **Feito / falta / validado** |
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

## Continuar por

1. [STATUS.md](./STATUS.md)  
2. P2 → [04-municipio-e-abrangencia.md](./04-municipio-e-abrangencia.md)  
3. P4 → [05-frontend-ux.md](./05-frontend-ux.md)
