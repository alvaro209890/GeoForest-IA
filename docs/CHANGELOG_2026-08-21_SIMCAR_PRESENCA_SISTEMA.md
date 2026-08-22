# 2026-08-21 — Sistemas aparecem no Monitor SIMCAR como "Sistema"

## O que mudou

O painel [monitor-car.web.app](https://monitor-car.web.app) deixou de ser só
para gente no navegador. Qualquer sistema da casa que autentique na conta
compartilhada do SIMCAR **grava presença** com `who: "Sistema"` e some ao
terminar.

Antes o GeoForest era invisível de propósito (R2 de 05/08): lia o monitor e
nunca escrevia. A ordem nova do Álvaro inverte só a visibilidade — a espera
quando um humano está dentro continua.

## Comportamento

1. Espera o monitor ficar livre (ignora a própria entrada, para não deadlock).
2. `PUT presence/simcar/clients/sistema/<connId>` com `who: "Sistema"`, heartbeat 15 s.
3. Usa o SIMCAR.
4. `DELETE` ao terminar. Crash/abort: some em 40 s (STALE do site).

Onde entra no GeoForest:

- Job de **Lotes SIMCAR** (`job.ts`) — ocupa depois da espera, some se a sessão
  for derrubada, reaparece ao retomar.
- Qualquer chamada autenticada via `withSimcarAuthRetryFor` (oráculo, recorte,
  pipeline) — o mesmo refcount, uma entrada só no painel.

## Arquivos

| Arquivo | Papel |
|---|---|
| `backend/simcar-lotes/presenca.ts` | WRITE/DELETE + heartbeat + refcount |
| `backend/simcar-lotes/monitor.ts` | GET; agora aceita `ignorarConnIds` |
| `backend/simcar-lotes/aguardar.ts` | espera ignorando o próprio connId |
| `backend/simcar-lotes/job.ts` | ocupar / soltar em torno da sessão |
| `backend/simcar-oraculo/client.ts` | ocupar em `withSimcarAuthRetryFor` |

Testes: `presenca.test.ts` + caso `ignorarConnIds` em `monitor.test.ts`.
O teste de superfície que proibia escrita em `monitor.ts` permanece — a escrita
mora em `presenca.ts`.
