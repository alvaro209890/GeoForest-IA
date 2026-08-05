# 08 — Deploy e Ops

> Mesmo fluxo do plano anterior (`docs/planos/simcar-lotes/08-deploy-e-ops.md`) — nada muda na topologia.

## O que muda no servidor

| Item | Mudança |
|---|---|
| `~/.config/geoforest/backend.env` | **Nada obrigatório** — as vars `SIMCAR_MONITOR_*` são opcionais (defaults no código). Adicionar só se quiser tunar (ex.: `SIMCAR_MONITOR_POLL_MS`) |
| Dependências | **Nenhuma** (fetch nativo) |
| Monitor (`monitor-car`) | **Nenhuma mudança** — integração unilateral de leitura (D5); nada a publicar/deployar lá |
| Credenciais | Nenhuma nova no servidor (RTDB lido sem auth) |

## Deploy

### 1. Local (este PC)
```bash
cd /c/GIS/GeoForest-IA
pnpm run check && pnpm run test && pnpm run build
git add -A && git commit -m "feat(simcar-monitor): <descricao>" && git push origin main
```

### 2. Servidor (via SSH `server-desktop`)
```bash
ssh server-desktop

cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull --ff-only origin main

npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
systemctl --user restart geoforest-backend.service

curl -sS http://127.0.0.1:3001/api/health
curl -sS http://127.0.0.1:3001/api/simcar-lotes/monitor-status   # novo endpoint
curl -sS https://geoforest-api.cursar.space/api/simcar-lotes/monitor-status

# front (se mudou):
npm run build && npx firebase deploy --only hosting
```

> Alternativa: `scripts/deploy-firebase-restart-backend.sh` no servidor (interativo).

### 3. Pós-deploy
- Abrir a aba Lotes → conferir badge (LIVRE) e fluxo do doc 06.
- Logs: `journalctl --user -u geoforest-backend.service -n 50 --no-pager` — procurar `[monitor-simcar]` warnings (fail-open).

## Rollback
Igual ao plano anterior (`git checkout <commit-anterior> -- backend/ client/src/` + esbuild + restart). Para emergência, `SIMCAR_MONITOR_ENABLED=0` no env desliga o gate sem mudar código.
