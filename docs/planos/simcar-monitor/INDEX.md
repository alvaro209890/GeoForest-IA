# Índice — Plano "Integração com o Monitor SIMCAR"

| Arquivo | Conteúdo |
|---|---|
| [00-README.md](00-README.md) | Visão geral, requisitos R1–R4, como o monitor funciona, decisões D1–D6 |
| [01-contexto.md](01-contexto.md) | Monitor por dentro (userscript + RTDB + STALE 40s), estado atual do simcar-lotes, encaixe dos requisitos |
| [02-arquitetura.md](02-arquitetura.md) | Gate antes do login, retry por lote, invisibilidade (read-only), job persistente |
| [03-contrato-monitor.md](03-contrato-monitor.md) | RTDB: schema, REST, regra de ocupação, casos de borda, fantasmas |
| [04-backend.md](04-backend.md) | `monitor.ts`, `aguardar.ts`, mudanças no `job.ts`/`routes.ts`/`app.ts`, env |
| [05-frontend-ux.md](05-frontend-ux.md) | Badge do monitor, fases novas na barra, aviso ao iniciar, re-anexação (R4) |
| [06-testes-e-validacao.md](06-testes-e-validacao.md) | Unit (monitor/aguardar/job/routes), live opcional, aceite manual |
| [07-tarefas-implementacao.md](07-tarefas-implementacao.md) | 9 tarefas em 4 fases (TDD, commits) |
| [08-deploy-e-ops.md](08-deploy-e-ops.md) | Sem env obrigatória, sem mudanças no monitor, deploy padrão |
| [09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md) | Riscos (fail-open, corrida, skew) + decisões abertas A1–A5 |
| [STATUS.md](STATUS.md) | Status do plano |

## Resumo do comportamento (como fica)

```
SIMCAR ocupado ──► job "aguardando_simcar" (barra parada + banner "em uso por X")
                        │  (usuário pode fechar a página — job segue no servidor)
                        ▼  SIMCAR livre
                   login + downloads (invisível no monitor — R2)
                        │
   alguém logou no meio? ──► "sessao_interrompida" → espera livre → retoma o lote
                        ▼
                   ZIP pronto (histórico + link de download)
```

## Ações imediatas sugeridas

1. Responder A1–A5 (doc 09) — nenhuma bloqueia o início; defaults já propostos.
2. Fase 1 → 4 conforme o doc 07 (a Fase 1 não depende de nenhuma decisão).
