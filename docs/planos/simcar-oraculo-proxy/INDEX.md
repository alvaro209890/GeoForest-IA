# Oráculo SIMCAR — Índice do plano (v2, 2026-07-16)

> **Status vivo:** [STATUS.md](./STATUS.md) ← ler primeiro
> **Checklist mestre:** [12-checklist-mestre.md](./12-checklist-mestre.md)
> **Contrato SEMA canônico:** [11-endpoints-sema-descobertos.md](./11-endpoints-sema-descobertos.md)

**Goal:** aba Processar Projeto sem NENHUMA validação local — o ZIP do usuário vai ao SIMCAR
real (CAR-teste 270069): ajusta município (sem mudar o nome) e área de abrangência, importa,
processa, devolve PDFs/ZIPs oficiais; reprovou → botão/loop "Corrigir e reenviar" (mecânico +
DeepSeek V4 Pro explicando), automático até 3 rodadas.

## Progresso (resumo)

| Fase | Status |
|------|--------|
| P0/P1/P3 cliente+import+process API | ✅ |
| P1.5 bugs bloqueantes (B1–B9) | ⏳ **próximo** |
| P2 município/abrangência (endpoints descobertos ✅) | ⏳ |
| P3.5 pipeline único + parse PDF | ⏳ |
| P4 front ORACULO-only | ⏳ |
| P5/P6 autofix + DeepSeek | ⏳ |
| P7 deploy + E2E | ⏳ |

## Arquivos

| Arquivo | Conteúdo |
|---------|----------|
| [STATUS.md](./STATUS.md) | feito / falta / descobertas / bugs |
| [00-README.md](./00-README.md) | visão, decisões D1–D6, fases |
| [01-arquitetura.md](./01-arquitetura.md) | diagrama, job states, o que morre |
| [02-modulo-simcar-oraculo.md](./02-modulo-simcar-oraculo.md) | módulo backend + bugs P1.5 |
| [03-api-contratos-e-eventos.md](./03-api-contratos-e-eventos.md) | rotas, SSE, snapshot |
| [04-municipio-e-abrangencia.md](./04-municipio-e-abrangencia.md) | P2 com endpoints reais |
| [05-frontend-ux.md](./05-frontend-ux.md) | UI, wiring Dashboard, copy |
| [06-autofix-roadmap.md](./06-autofix-roadmap.md) | ações mecânicas + DeepSeek V4 Pro |
| [07-tarefas-implementacao.md](./07-tarefas-implementacao.md) | T1–T19 bite-sized |
| [08-seguranca-ops.md](./08-seguranca-ops.md) | segredos (repo público!), deploy |
| [09-validacao-santa-clara.md](./09-validacao-santa-clara.md) | E2E com oráculos V22/V23/V24 |
| [10-aprendizados-oraculo-reuso.md](./10-aprendizados-oraculo-reuso.md) | calibrações + gotchas |
| [11-endpoints-sema-descobertos.md](./11-endpoints-sema-descobertos.md) | **contrato SEMA** |
| [12-checklist-mestre.md](./12-checklist-mestre.md) | aceite por fase |

## Continuar por

1. [STATUS.md](./STATUS.md) → 2. T1 (P1.5) em [07](./07-tarefas-implementacao.md) →
3. antes de SEMA: [11](./11-endpoints-sema-descobertos.md)
