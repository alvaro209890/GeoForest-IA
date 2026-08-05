# Plano — Integração com o Monitor SIMCAR (fila por ocupação)

> **Status:** PLANEJADO — nenhuma implementação feita.
> **Data:** 2026-08-05
> **Autor:** Hermes (com Álvaro)
> **Repo:** `alvaro209890/GeoForest-IA` — branch `main`
> **Base:** funcionalidade "Lotes SIMCAR" já implementada (3 commits em `main`)

---

## Objetivo (1 frase)

Fazer o download de documentos da aba **Lotes SIMCAR** respeitar o **Monitor SIMCAR** (`monitor-car.web.app`): se alguém estiver logado no SIMCAR com o login compartilhado, o GeoForest **espera o SIMCAR ficar livre** para logar e baixar (barra de progresso "travada" informada), **sem aparecer no monitor para os outros usuários**; se a sessão for **interrompida por um login concorrente**, o job mostra isso no front e **tenta de novo automaticamente** quando liberar — mesmo que o usuário **feche o site**, o job continua no servidor até baixar.

## Requisitos do Álvaro (traduzidos 1:1)

| # | Requisito | Comportamento |
|---|---|---|
| R1 | "Se tiver alguém logado aparecendo no monitor, mesmo que qualquer usuário peça para o GeoForest baixar algo, a barra de carregando fique travada e só baixe quando o SIMCAR estiver desocupado" | Job entra em fase **`aguardando_simcar`** antes de logar; só loga quando o monitor mostra LIVRE |
| R2 | "Quando ele logar para baixar não deve mostrar aos outros usuários" | O bot do GeoForest é **invisível**: lê o monitor, **nunca escreve** presence (sem userscript = sem entrada no RTDB) |
| R3 | "Se ele estiver baixando recibos e alguém logar e interromper, deve mostrar isso no front (igual se o SIMCAR estiver ocupado) e, após desocupar, tentar de novo" | 401/403 → fase **`sessao_interrompida`** com quem interrompeu → aguarda LIVRE → **re-loga e retoma o lote** automaticamente |
| R4 | "Mesmo que o usuário feche o site, deve continuar funcionando até baixar" | Já é o comportamento (job roda `void` no servidor, estado persistido) — confirmar e garantir re-anexação no front |

## Como o Monitor SIMCAR funciona (verificado em 2026-08-05)

- **Site** `monitor-car.web.app`: lê o Firebase **Realtime Database** `monitor-car-default-rtdb.firebaseio.com`, nó `presence/simcar/clients`.
- **Userscript Tampermonkey** ("SIMCAR - Presença", v2.4.1 — está no OneDrive `Monitor_SIMCAR/Script_e_site.docx`): roda no navegador de quem abre `monitoramento.sema.mt.gov.br/simcar/*`; ao logar com o **CPF compartilhado** e entrar no `tecnico.app`, escreve `presence/simcar/clients/{uidAnonimo}/{connId}` = `{who, since, lastSeen, href, ua}` com heartbeat de **20s** e `onDisconnect().remove()`.
- **Online** = qualquer client com `lastSeen` a menos de **40s** (STALE_MS). Fallback legado: `presence/simcar/current`.
- **Leitura REST sem auth funciona** (validado). Escrita/delete sem auth também (usado para limpar fantasmas em 2026-08-05).

## Decisões-chave já fechadas

| # | Decisão | Justificativa |
|---|---|---|
| D1 | **GeoForest só LÊ o monitor** (RTDB via REST, sem SDK, sem auth) | R2 (invisibilidade); sem dependência nova; sem credencial do monitor no servidor |
| D2 | **Espera ilimitada** (até cancelar) antes de logar | R1+R4: "só baixe quando desocupado" + "continue até baixar" |
| D3 | **Retry automático por lote** após interrupção: re-loga e re-tenta o lote atual (lotes já concluídos ficam salvos) | R3; granularidade simples e robusta |
| D4 | **Fail-open** se o monitor estiver ilegível: prossegue e depende do mecanismo 401 | Monitor fora do ar não deve travar downloads para sempre; R3 cobre o conflito real |
| D5 | Sem mudanças no site/scripts do monitor | Integração é unilateral (leitura); nada a publicar lá |
| D6 | Sem novas dependências | `fetch` nativo; RTDB REST |

## Índice do plano

| Arquivo | Conteúdo |
|---|---|
| [01-contexto.md](01-contexto.md) | Monitor por dentro (userscript + RTDB + STALE), estado atual do simcar-lotes, requisitos |
| [02-arquitetura.md](02-arquitetura.md) | Fluxo: gate antes do login, 401→aguarda→retry, invisibilidade, job persistente |
| [03-contrato-monitor.md](03-contrato-monitor.md) | RTDB: schema, REST, timings, fallback, limpeza de fantasmas |
| [04-backend.md](04-backend.md) | `monitor.ts`, `aguardarSimcarLivre`, mudanças no `job.ts`, `monitor-status`, env |
| [05-frontend-ux.md](05-frontend-ux.md) | Fases novas na barra, badge do monitor, mensagens, re-anexação |
| [06-testes-e-validacao.md](06-testes-e-validacao.md) | Unit (monitor/aguardar/job), live opcional, manual |
| [07-tarefas-implementacao.md](07-tarefas-implementacao.md) | Tarefas bite-sized em ordem (TDD, commits) |
| [08-deploy-e-ops.md](08-deploy-e-ops.md) | Env opcionais no servidor, nada no monitor, deploy normal |
| [09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md) | Riscos (fail-open, relógio, oráculo) + decisões em aberto |
| [INDEX.md](INDEX.md) / [STATUS.md](STATUS.md) | Índice e status |

## Critérios de aceite

- [ ] SIMCAR ocupado (monitor EM USO) → job entra em "aguardando", barra fica parada com mensagem clara; ao liberar, loga e baixa sozinho
- [ ] Nenhuma escrita no RTDB do monitor pelo GeoForest (teste unitário garante)
- [ ] Login concorrente no meio do download → front mostra "sessão interrompida por X"; quando livre, retoma o lote sem intervenção
- [ ] Fechar o site no meio → job termina no servidor; reabrir mostra o estado (re-anexação)
- [ ] `pnpm run check` + testes verdes
