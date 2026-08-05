# Índice — Plano "Lotes SIMCAR"

| Arquivo | Conteúdo |
|---|---|
| [00-README.md](00-README.md) | Visão geral: objetivo, fluxo do usuário, decisões-chave, critérios de aceite |
| [01-contexto-e-objetivo.md](01-contexto-e-objetivo.md) | O problema (vídeo 2026-08-05), o que já existe no repo e no acompanhamento-de-processos |
| [02-arquitetura.md](02-arquitetura.md) | Desenho: backend (PC servidor) faz o trabalho; sessão SIMCAR; segurança |
| [03-contrato-simcar.md](03-contrato-simcar.md) | Endpoints SEMA: validados (tabela) + a confirmar (croquis, `BuscarPdfSolicitacao`) |
| [04-backend.md](04-backend.md) | Módulo `backend/simcar-lotes/`: rotas, parser, resolver, downloader, zip, refactor `client.ts` |
| [05-frontend-ux.md](05-frontend-ux.md) | Aba "Lotes SIMCAR": credenciais localStorage, dropzone, progresso SSE, download |
| [06-testes-e-validacao.md](06-testes-e-validacao.md) | Unit (vitest), live opcional (`SIMCAR_LIVE`), frontend, validação manual |
| [07-tarefas-implementacao.md](07-tarefas-implementacao.md) | Tarefas bite-sized em ordem (TDD, commits, fases 0–3) |
| [08-deploy-e-ops.md](08-deploy-e-ops.md) | Deploy via SSH `server-desktop`: pull, esbuild, systemctl, Firebase |
| [09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md) | Riscos com mitigação + 6 decisões em aberto (A1–A6) |
| [STATUS.md](STATUS.md) | Status do plano |

## Fluxo do usuário (resumo)

```
Recibo(s) PDF/ZIP → Analisar → lotes detectados → Baixar → ZIP com pasta por lote
```

## Ações imediatas sugeridas

1. Decisões fechadas: **A1** (só Enviado + Processado + Recibo) e **A5** (chave própria de credenciais) — registradas em 2026-08-05.
2. As abertas restantes (A2/A3/A4/A6) têm default proposto e **não bloqueiam o início**.
3. Começar direto pela Fase 1 do doc 07 (não há fase de descoberta: os 3 endpoints já estão validados).
