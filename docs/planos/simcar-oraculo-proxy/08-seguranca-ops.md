# 08 — Segurança e operação (PC servidor)

## Segredos

| Item | Onde | Nunca |
|------|------|-------|
| `SIMCAR_CPF` / `SIMCAR_SENHA` | env do processo backend no PC (systemd/pm2/.env local gitignored) | git, Vite, Firebase, screenshots, WhatsApp |
| `SIMCAR_ORACULO_INTERNAL_TOKEN` (opcional) | se precisar de chamada machine-to-machine | front bundle |
| Firebase service account | já existente no backend | copiar para plano |

`.gitignore` já cobre `.env*` e `__tmp_*` / `.oraculo-scratch/`.

## Superfície de ataque

- Backend já exposto via Cloudflare Tunnel.
- Rotas oráculo: **auth Firebase** (mesmo `apiFetch` do front).
- Health público? **Não** — exigir login (ou admin).
- Rate limit: 1 job SIMCAR por vez global + opcional limite por uid (ex.: 5 jobs/hora).

## Isolamento do projeto-teste

```ts
const ALLOWED = new Set([process.env.SIMCAR_TEST_CAR_ID || "270069"]);
// qualquer mutação SIMCAR (import/prepare/process) só se carId ∈ ALLOWED
```

Logar todo import com: `uid`, `jobId`, `carId`, `fileName`, `timestamp`.

## Backup antes de mutar

Antes de `prepare` ou `import` no projeto-teste:

1. `Buscar` snapshot JSON → salvar em artefatos do job
2. (Opcional) baixar shape atual do CAR se API permitir

Se import destruir geometria anterior do teste: aceitável (é o propósito), mas snapshot ajuda debug.

## Concorrência

- Fila serial global SIMCAR (uma conta = uma sessão).
- Timeout import 15 min / process 30 min (configurável).
- Heartbeat no job para o front não achar que morreu.

## Observabilidade

Logs estruturados:

```
[simcar-oraculo] job=... step=import_poll status=[EXECUTANDO] elapsed=120s
```

Não logar token nem senha.

## Recuperação

| Falha | Ação |
|-------|------|
| Login 401 | renovar; se persistir, job failed |
| SEMA 5xx | retry 3× com backoff no poll |
| Tunnel down | front mostra “servidor offline” (já) |
| Job stuck | admin DELETE job; fila segue |

## CI

- `PROCESSAR_MODE=LOCAL` nos testes CI/GitHub se houver.
- Nunca rodar live SIMCAR em CI.

## Domínio / tunnel

Como o backend **já** roda no PC servidor:

- Confirmar que o hostname público do GeoForest API aponta para este processo.
- Documentar em `docs/SIMCAR_ORACULO.md` o unit systemd/pm2 se existir.
- Padrão de referência: `pareceres-api.cursar.space` (outro serviço) — reutilizar lições de CORS e HTTPS.
