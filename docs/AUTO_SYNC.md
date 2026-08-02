# Auto-Sync do GeoForest (servidor) — documentação do fluxo

> Verificado e corrigido em 2026-08-01 (commit desta doc).

## O que é

O PC servidor (`server-desktop`, Tailscale `100.65.138.58`, usuário `server`) monitora o
GitHub **a cada 2 minutos** e, quando detecta commit novo em `main`, executa sozinho:

1. `git reset --hard origin/main` no checkout de produção
2. `pnpm run build` (frontend app + admin + backend esbuild → `dist/`)
3. Copia `backend/admin-panel.html` → `dist/admin-panel.html`
4. `systemctl --user restart geoforest-backend`
5. `firebase deploy --only hosting` (ia-florestal + geoforest-admin)

Ou seja: **push no GitHub = deploy automático**. Nada de deploy manual no servidor
(na maioria das vezes).

## Componentes

| Peça | Path (servidor) |
|------|-----------------|
| Script | `/home/server/.config/geoforest/auto-sync.sh` |
| Service | `~/.config/systemd/user/geoforest-autosync.service` (oneshot) |
| Timer | `~/.config/systemd/user/geoforest-autosync.timer` (a cada 2 min) |
| Log | `/tmp/geoforest-autosync.log` |
| Lock | `/tmp/geoforest-autosync.lock` (evita execução concorrente) |
| Checkout prod | `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA` |

Comandos úteis:

```bash
ssh server-desktop 'systemctl --user list-timers geoforest-autosync.timer'
ssh server-desktop 'tail -50 /tmp/geoforest-autosync.log'
ssh server-desktop 'journalctl --user -u geoforest-autosync.service --no-pager -n 20'
```

## Verificação de saúde

```bash
# 1. Timer ativo?
ssh server-desktop 'systemctl --user is-active geoforest-autosync.timer'

# 2. Checkout de produção == main do GitHub?
ssh server-desktop 'cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA" && \
  echo "local:  $(git rev-parse --short HEAD)" && \
  echo "remote: $(git ls-remote origin main | cut -c1-7)"'

# 3. Backend saudável?
curl -s https://geoforest-api.cursar.space/api/health

# 4. Frontend com build recente?
curl -s https://ia-florestal.web.app | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

## ⚠️ Pitfall corrigido em 2026-08-01: PATH do firebase

**Sintoma:** `firebase deploy failed` no log, 3x seguidas (16:56, 17:00, 17:02), e o
frontend no ar ficava **desatualizado** mesmo com o backend buildado e reiniciado.

**Causa raiz:** o `firebase` CLI vive em `/home/server/.npm-global/bin/firebase`
(npm prefix global), mas o PATH padrão do systemd user **não inclui** esse diretório.
O script rodava `firebase deploy` → `comando não encontrado` → exit 1 → o `||` logava
"firebase deploy failed" e o script saía. O erro real ia pro journal do systemd (por
causa do `2>&1 >>` do script, que redireciona stderr pro journal ANTES de redirecionar
stdout pro log — ordem errada dos redirecionamentos).

**Correção:** adicionar no topo do script:

```bash
export PATH="/home/server/.npm-global/bin:/home/server/.local/bin:$PATH"
```

O `pnpm` funcionava porque está em `~/.local/bin` (já no PATH).

**Lição:** ao criar/editar scripts de systemd user que chamam CLIs npm globais, o PATH
do ambiente systemd **não** é o PATH interativo — exportar o diretório npm global
explicitamente. E para logs: usar `>> file 2>&1` (redireciona stdout PRIMEIRO, depois
stderr pro mesmo lugar) — `2>&1 >> file` redireciona stderr pro console do systemd,
não pro arquivo.

## ⚠️ Setup único que o auto-sync NÃO faz: venv da Solicitação

O auto-sync não cria o venv Python da aba Solicitação de Prioridade (o `.venv/` está
no `.gitignore`, não vem do git). **Depois de qualquer `git clean`/reinstalação, criar
manualmente**:

```bash
ssh server-desktop 'cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA/backend/solicitacao" && \
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt'
```

Sem isso, o job morre com `ModuleNotFoundError: No module named 'fitz'`.
(Verificado 2026-08-01: venv criado, PyMuPDF 1.28.0 ok.)
