# Oráculo SIMCAR — Índice do plano (v2, atualizado 2026-07-17)

> **Status vivo:** [STATUS.md](./STATUS.md) ← ler primeiro (inclui T17 detalhado)
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
| P1.5 bugs bloqueantes (B1–B8; B9 fecha com T18) | ✅ T1–T3 |
| P2 município/abrangência (endpoints descobertos ✅) | ✅ T4–T6; live no 270069 |
| P3.5 pipeline único + parse PDF | ✅ T7–T9 |
| P4 front ORACULO-only | ✅ T10–T12 |
| P5 autofix import + DeepSeek + loop | ✅ T13–T16 (V23 live) |
| P6 autofix process (clip úmida) | ✅ fechado via D7 (17/07); V22 sem AREA_UMIDA processou sem erros |
| P7 deploy + E2E | ✅ T18–T19 (17/07) — backend+front deploy, E2E real, restore FINAL |

## Arquivos

| Arquivo | Conteúdo |
|---------|----------|
| [STATUS.md](./STATUS.md) | feito / falta / T17 / descobertas / como retomar |
| [00-README.md](./00-README.md) | visão, decisões D1–D7, fases |
| [01-arquitetura.md](./01-arquitetura.md) | diagrama, job states, o que morre |
| [02-modulo-simcar-oraculo.md](./02-modulo-simcar-oraculo.md) | módulo backend + bugs P1.5 |
| [03-api-contratos-e-eventos.md](./03-api-contratos-e-eventos.md) | rotas, SSE, snapshot |
| [04-municipio-e-abrangencia.md](./04-municipio-e-abrangencia.md) | P2 com endpoints reais |
| [05-frontend-ux.md](./05-frontend-ux.md) | UI, wiring Dashboard, copy |
| [06-autofix-roadmap.md](./06-autofix-roadmap.md) | ações mecânicas + DeepSeek + achados T17 |
| [07-tarefas-implementacao.md](./07-tarefas-implementacao.md) | T1–T19 bite-sized |
| [08-seguranca-ops.md](./08-seguranca-ops.md) | segredos (repo público!), deploy |
| [09-validacao-santa-clara.md](./09-validacao-santa-clara.md) | E2E com oráculos V22/V23/V24 + gates live |
| [10-aprendizados-oraculo-reuso.md](./10-aprendizados-oraculo-reuso.md) | calibrações + gotchas |
| [11-endpoints-sema-descobertos.md](./11-endpoints-sema-descobertos.md) | **contrato SEMA** |
| [12-checklist-mestre.md](./12-checklist-mestre.md) | aceite por fase |

## Continuar por

1. [STATUS.md](./STATUS.md) seção **T17** → 2. fechar gate V22 ou D7 em
[07](./07-tarefas-implementacao.md) → 3. T18/T19 → 4. contrato SEMA:
[11](./11-endpoints-sema-descobertos.md)
