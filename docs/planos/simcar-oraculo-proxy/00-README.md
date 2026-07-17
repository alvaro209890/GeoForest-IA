# Plano: Oráculo SIMCAR no Backend Existente (PC servidor)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fazer o backend GeoForest (já no PC servidor, túnel Cloudflare + domínio) importar e processar o ZIP do usuário no **projeto-teste SIMCAR** (Santa Clara / CAR 270069 ou novo), ajustando município e área de abrangência a partir do shape, devolvendo status + PDFs/artefatos no front — com roadmap explícito de auto-correção.

**Architecture:** Não há worker separado nem Render para SIMCAR. O `backend/` atual (Express em `backend/index.ts`) ganha um módulo `simcar-oraculo/` que usa login técnico via env no PC, fila serial (1 sessão SIMCAR por vez), e as rotas `/api/processar-projeto/*` passam a operar em modo `ORACULO` (padrão configurável) em vez de só `runImportPhase`/`runProcessPhase` locais. Front (`ProcessarProjetoAnalysis.tsx`) mostra timeline de passos reais no SEMA.

**Tech Stack:** Node/TS Express existente, `simcar-scramble` (acompanhamento-de-processos), cliente SIMCAR (base `.oraculo-scratch/simcar-client.mjs`), jobs SSE (`processing-jobs.ts`), Firebase Auth, Cloudflare Tunnel (já no servidor).

---

## Correção importante (decisão do Álvaro)

| Antes (rascunho) | Agora (fechado) |
|------------------|-----------------|
| Worker separado do backend Render | **Tudo no backend já existente no PC servidor** |
| Domínio só no worker | Domínio/túnel **já** expõe este backend |
| Credenciais só em worker isolado | Credenciais em **env do PC servidor** (nunca no front) |

---

## Índice

| # | Arquivo |
|---|---------|
| 00 | `00-README.md` (este) |
| 01 | `01-arquitetura.md` |
| 02 | `02-modulo-simcar-oraculo.md` |
| 03 | `03-api-contratos-e-eventos.md` |
| 04 | `04-municipio-e-abrangencia.md` |
| 05 | `05-frontend-ux.md` |
| 06 | `06-autofix-roadmap.md` |
| 07 | `07-tarefas-implementacao.md` |
| 08 | `08-seguranca-ops.md` |
| 09 | `09-validacao-santa-clara.md` |
| 10 | `10-aprendizados-oraculo-reuso.md` |

---

## Fases

| Fase | Entrega |
|------|---------|
| **P0** | Módulo cliente SIMCAR no backend + health + login + Buscar |
| **P1** | Import shape no projeto-teste + poll + PDF import no job |
| **P2** | Município (Propriedade) + área de abrangência (Caracterização) a partir do shape |
| **P3** | ProcessarGeo + PDF process + ZIP erros |
| **P4** | Front: timeline + downloads; flag desliga validação local |
| **P5** | Auto-fix import (botão) — dups, anéis colados |
| **P6** | Auto-fix process (botão) — úmida etc. |

---

## Fora de escopo imediato

- Credenciais no Vite/Firebase/git
- Usar CAR de cliente de produção como teste
- Auto-fix silencioso sem botão
- Deploy em `/media/server` sem pedido
