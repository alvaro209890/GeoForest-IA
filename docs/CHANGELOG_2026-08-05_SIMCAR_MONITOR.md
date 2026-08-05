# 2026-08-05 — Lotes SIMCAR × Monitor SIMCAR (fila por ocupação)

Plano: [`docs/planos/simcar-monitor/`](planos/simcar-monitor/INDEX.md) ·
Módulo: [`docs/SIMCAR_LOTES.md`](SIMCAR_LOTES.md)

## Problema

A conta técnica do SIMCAR é compartilhada e a SEMA só aceita **uma sessão por
conta**. Quando o GeoForest logava para baixar os documentos de um lote, derrubava
quem estivesse trabalhando no navegador — e vice-versa: um login humano no meio do
job matava o download, que perdia o lote sem tentar de novo.

O [monitor-car](https://monitor-car.web.app) já sabia quem estava logado (um
userscript Tampermonkey grava presença no Realtime Database), mas nada disso
chegava ao GeoForest.

## O que mudou

- **Espera antes de logar (R1).** Se o monitor acusa EM USO, o job entra na fase
  `aguardando_simcar`, mostra quem está usando e só loga quando liberar. A espera
  acontece **fora** da fila serial da conta, para não segurar a vez de outro job, e
  é rechecada ao chegar a vez (corrida).
- **O bot é invisível (R2).** `backend/simcar-lotes/monitor.ts` só faz `GET` no
  RTDB. Um teste de superfície falha se algum dia aparecer escrita em `presence/*`.
- **Retomada automática (R3).** 401/403 que sobrevive ao retry do client significa
  que alguém logou e derrubou a sessão: o job limpa a sessão, espera o monitor
  liberar e **refaz o mesmo lote**. Os lotes anteriores continuam no ZIP.
- **Fechar a página não interrompe (R4).** O job já rodava no servidor; agora o
  painel também reabre o job ativo e reconecta o SSE ao voltar para a aba.
- **UI.** Badge LIVRE / EM USO por *fulano* / indisponível (poll de 15 s), banner
  âmbar (espera) ou vermelho (interrupção) com a nota "continua em segundo plano",
  barra pulsante no lugar do percent congelado, aviso ao iniciar com o SIMCAR
  ocupado e marcação nos cards do histórico.

## Bug de produção corrigido junto

Job `4e7fdb05` (4 recibos) terminou com **1 lote no ZIP**: os lotes 2–4 voltaram
`POST Requerimento/ListarRasc 401: "Usuário não autenticado ou sessão expirada."`

Causa: o job pegava um token **antes do laço** e passava essa string fixa para o
`resolverCar`. Como os downloads renovam a sessão em 401, o token capturado
envelhecia. Agora o resolve também passa por `withSimcarAuthRetryFor`; o login
antes do laço só aquece a sessão para falhar cedo com credencial errada.

## Contrato do monitor (validado ao vivo em 2026-08-05)

| Endpoint (REST, sem auth) | Uso |
|---|---|
| `…/presence/simcar/clients.json` | `{<uid>: {<connId>: {who, since, lastSeen, href, ua}}}` ou `null` |
| `…/presence/simcar/current.json` | nó legado `{status, lastSeen, who}` — fallback |

`ocupado` = existe client com `agora - lastSeen <= 40 s + 10 s` (o mesmo `STALE_MS`
do site, mais margem de skew de relógio). Fantasmas (`onDisconnect` que não rodou)
são ignorados, como o site já faz. Erro de rede → **fail-open**: `console.warn` e o
download segue.

## Config nova (env do servidor, todas opcionais)

`SIMCAR_MONITOR_ENABLED` (1) · `SIMCAR_MONITOR_RTDB_URL` · `SIMCAR_MONITOR_STALE_MS`
(40000) · `SIMCAR_MONITOR_POLL_MS` (15000) · `SIMCAR_MONITOR_MAX_RETRY` (0 =
ilimitado). Nada precisa ser configurado para o comportamento padrão.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `backend/simcar-lotes/monitor.ts` | novo — leitura read-only do RTDB + cache 5 s |
| `backend/simcar-lotes/aguardar.ts` | novo — espera cancelável com progresso |
| `backend/simcar-lotes/job.ts` | gate R1, retomada R3, sessão por chamada |
| `backend/simcar-lotes/routes.ts` | `GET /api/simcar-lotes/monitor-status` |
| `backend/simcar-lotes/types.ts` | fases `aguardando_simcar` e `sessao_interrompida` |
| `backend/app.ts` | rota nova em `AUTH_REQUIRED_PATHS` |
| `client/src/components/SimcarLotesPanel.tsx` | badge, banner, aviso, barra de espera |
| `client/src/pages/Dashboard.tsx` | card do histórico + reabertura do job ativo |

## Testes

`pnpm run check` + `pnpm run test` verdes (85 testes em `backend/simcar-lotes/`).
Novos: `monitor.test.ts` (9), `aguardar.test.ts` (6), `job.test.ts` (7) e o caso do
`monitor-status` em `routes.test.ts`.

O teste do 401 entre lotes foi verificado ao contrário: com o `job.ts` antigo ele
falha com `lotesConcluidos: 1`, exatamente o sintoma de produção.
