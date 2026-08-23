# Índice — Plano "Análise pós-recorte SIMCAR (3 fases)"

| Arquivo | Conteúdo |
|---|---|
| [00-README.md](00-README.md) | Visão geral: objetivo, fluxo dos 3 botões, decisões D1–D10, critérios de aceite |
| [01-contexto-e-estado-atual.md](01-contexto-e-estado-atual.md) | O que já existe no código hoje (com números de arquivo/linha), o que está desligado e o que falta |
| [02-arquitetura.md](02-arquitetura.md) | Desenho comum às 3 fases: módulos, orquestração, identidade de polígono, checkpoints, gating e **stack de IA (Groq grátis para visão · DeepSeek para texto)** |
| [03-catalogo-wms.md](03-catalogo-wms.md) | Camadas SEMA por ano (1984→2024), a série 2009–2019 e o problema da troca de sensor |
| [04-fase1-pre2008.md](04-fase1-pre2008.md) | Fase 1 (já implementada): o que ela faz, o que falta para ligar, contrato de saída |
| [05-fase2-2008-2019.md](05-fase2-2008-2019.md) | Fase 2 (nova): datação do desmate em AUAS, janelas, redutor determinístico, contrato |
| [06-fase3-vegetacao-em-ac.md](06-fase3-vegetacao-em-ac.md) | Fase 3 (nova): vegetação dentro da Área Consolidada, híbrido geométrico + visual |
| [07-frontend-ux.md](07-frontend-ux.md) | Os 3 botões, regras de desbloqueio, prévia de custo, progresso, resultados, PDF |
| [08-contratos-e-persistencia.md](08-contratos-e-persistencia.md) | Tipos TS, rotas, eventos SSE, histórico do job, versionamento e migração |
| [09-testes-e-validacao.md](09-testes-e-validacao.md) | Matriz de testes por fase, fixture oficial, conjunto dourado, testes live |
| [10-deploy-e-ops.md](10-deploy-e-ops.md) | Variáveis de ambiente, deploy no `server-desktop`, rollout por flag, observabilidade |
| [11-riscos-e-decisoes-abertas.md](11-riscos-e-decisoes-abertas.md) | Riscos com mitigação + decisões A1–A10 que precisam do Álvaro |
| [12-tarefas-implementacao.md](12-tarefas-implementacao.md) | Tarefas bite-sized em ordem (F0 → F3), com gate de teste por tarefa |
| [FLUXO_3_ANALISES_INDEPENDENTES.md](FLUXO_3_ANALISES_INDEPENDENTES.md) | **As 3 análises são independentes** (23/08/2026): sem encadeamento F1→F2→F3, Fase 3 ligada, e um laudo baixável por análise |
| [FASE1_V2_SINAL_DUVIDA.md](FASE1_V2_SINAL_DUVIDA.md) | Fase 1 v2: status `SINAL_DE_DUVIDA`, zoom por polígono AUAS e anexo fotográfico no DOCX/PDF |
| [FASE1_V2_SPOT_MARCO_2008.md](FASE1_V2_SPOT_MARCO_2008.md) | Por que a IA não lia o SPOT 2008 (modelo de visão travado em literal) e as 5 correções |
| [STATUS.md](STATUS.md) | Status do plano e histórico |

## Fluxo do usuário (resumo)

```
                        ┌─ [Fase 1: AUAS 2003–2008]      é mesmo AUAS?
Recorte → AC/AVN ───────┼─ [Fase 2: AUAS 2008–2019]      em que ano foi o desmate?
                        └─ [Fase 3: vegetação na AC]     sobrou nativa dentro da AC?
```

As 3 são **independentes**: cada uma só precisa da sua camada e nenhuma espera a
outra (23/08/2026 — ver [FLUXO_3_ANALISES_INDEPENDENTES.md](FLUXO_3_ANALISES_INDEPENDENTES.md)).
A única exclusão é **uma fase por vez no mesmo job**.

## Ações imediatas sugeridas

1. Responder as decisões **A1–A4** do doc [11](11-riscos-e-decisoes-abertas.md) — são as
   únicas que mudam o desenho (janela da Fase 2, mistura de sensores, critério de
   "vegetação na AC" e limite de polígonos por job).
2. Rodar a **F0.1** do doc [12](12-tarefas-implementacao.md): `GetCapabilities` +
   `GetMap` real de 2009→2019 antes de fixar qualquer ano no código.
3. Fechar o **conjunto dourado** da Fase 1 (pendência que já bloqueia ligar a flag hoje)
   junto com o da Fase 2 — mesma sessão de conferência humana, mesmos polígonos.
