# 08 — Segurança e operação (v2)

## ⚠️ Repo `alvaro209890/GeoForest-IA` é PÚBLICO (verificado 2026-07-16)

Consequência direta: **nenhum** CPF, senha, chave ou token em arquivo commitado — nem em
docs, nem em exemplo, nem em teste, nem em changelog. Antes de todo push desta frente,
rodar o grep de segredos comparando com os VALORES de `.oraculo-scratch/simcar-oraculo.env`
(o próprio padrão do grep não pode conter os valores — este doc é público):

```bash
set -a && source .oraculo-scratch/simcar-oraculo.env && set +a
git diff --cached | grep -inE "($SIMCAR_CPF|$SIMCAR_SENHA|sk-[A-Za-z0-9]{8,}|SENHA=.+|API_KEY=.+)" && echo VAZOU || echo ok
```

## Segredos

| Item | Onde fica | Nunca |
|------|-----------|-------|
| `SIMCAR_CPF` / `SIMCAR_SENHA` (conta técnica do Álvaro) | env do backend no PC servidor; cópia local NESTE PC em `.oraculo-scratch/simcar-oraculo.env` (dir gitignored, chmod 600) | git, Vite, Firebase, screenshots, WhatsApp |
| `DEEPSEEK_API_KEY` | copiar de `~/.hermes/.env` deste PC → env do backend no PC servidor (`grep '^DEEPSEEK_API_KEY' ~/.hermes/.env`). ⚠️ NÃO usar a do Atlas (inválida/401) | idem |
| `SIMCAR_TEST_CAR_ID=270069` | env (não é segredo, mas fica junto) | — |
| Firebase service account | já existente no backend | — |

Env completo do oráculo (valores reais só no PC servidor):

```bash
SIMCAR_CPF=            # CPF sem máscara da conta técnica
SIMCAR_SENHA=
SIMCAR_TEST_CAR_ID=270069
# SIMCAR_ROOT=https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api
SIMCAR_POLL_MS=5000
SIMCAR_IMPORT_TIMEOUT_MS=900000
SIMCAR_PROCESS_TIMEOUT_MS=1800000
SIMCAR_BASEREF_TIMEOUT_MS=1200000
SIMCAR_ABRANGENCIA_MARGIN_M=500
AUTOFIX_MAX_ROUNDS=3
DEEPSEEK_API_KEY=
```

## Deploy (PC servidor — este PC de dev NÃO roda o serviço; unit não existe aqui)

Conforme `.claude/CLAUDE.md` do repo: Express porta 3000 (prod), Cloudflare Tunnel →
`geoforest-api.cursar.space`; front Firebase Hosting `ia-florestal.web.app`; env em
`.env.production` (raiz) E `~/.config/geoforest/backend.env` (systemd) no servidor.

Checklist de deploy:

- [ ] No PC servidor: `git pull` no checkout QUE RODA (conferir `systemctl --user cat
      geoforest-backend.service` → WorkingDirectory/ExecStart; lição GeoForest: era
      `/media/server`, não `/home`)
- [ ] Adicionar env do oráculo em `~/.config/geoforest/backend.env` (e `.env.production` se o
      build lê de lá)
- [ ] `pnpm run build` → `systemctl --user restart geoforest-backend.service`
- [ ] `curl -s https://geoforest-api.cursar.space/api/simcar-oraculo/health` (autenticado) →
      `simcarConfigured:true, deepseekConfigured:true`
- [ ] Front: `npx firebase deploy --only hosting` (conta certa! gotcha CLI logada no
      AquiResolve → usar service account/XDG isolado como nas outras frentes)
- [ ] E2E de `09` no ambiente real

## Superfície de ataque / limites

- Rotas oráculo: Firebase auth obrigatório (já). Health também autenticado.
- Fila serial global = rate limit natural; opcional `SIMCAR_MAX_JOBS_POR_UID_DIA`.
- `assertTestCarId` em TODA mutação (prepare/import/process) — teste unitário garante.
- Logar por job: `uid, jobId, round, fileName, carId, steps` — **nunca** token/senha/chave.
- IP: SEMA só responde do Brasil — o PC servidor atende; jamais mover p/ Render/EUA.

## Sessão única SIMCAR

- Login do robô derruba a sessão do técnico logado no navegador (e vice-versa). Mitigação:
  token cache 25 min + fila serial + retry 401 (B6). Comunicar no front (copy em `05`).
- Se o Álvaro precisar usar o SIMCAR manualmente: esperar fila esvaziar (health mostra
  queueLength) — documentado na aba.

## Recuperação

| Falha | Ação |
|-------|------|
| 401 mid-job | `withSimcarAuthRetry`: relogin + 1 retry; persistir aviso na timeline |
| SEMA 5xx | retry 3× backoff no poll; depois job `failed` |
| Restart do backend | boot marca jobs `running` como `interrupted` (B7); front oferece reenvio |
| BaseRef `[ERRO]` | 1× `ReprocessarBaseRef`; depois `failed` |
| CAR-teste corrompido/estado estranho | reimportar fixture FINAL da Santa Clara (restaura shape); prepare re-ajusta município/abrangência no próximo job |
| DeepSeek fora | fallback determinístico; loop segue |

## CI

- Sem credenciais em CI → `simcarConfigured=false`; testes usam mocks/fixtures; nenhum teste
  live roda por padrão (`SIMCAR_LIVE=1` só manual no PC).
