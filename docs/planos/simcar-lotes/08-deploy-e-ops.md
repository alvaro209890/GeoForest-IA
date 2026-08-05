# 08 — Deploy e Ops

> O trabalho pesado roda no **PC servidor** (Linux) que já hospeda o GeoForest backend.
> Este PC (Windows) tem SSH até ele: alias **`server-desktop`** (`ssh server-desktop` → `100.65.138.58`, user `server`).
> Fonte: `docs/OPS_SERVIDOR_GEOFORREST.md`.

## Topologia atual

| Item | Valor |
|---|---|
| Repo em produção | `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA` |
| Unit systemd (user) | `geoforest-backend.service` |
| Entrypoint | `node dist/index.js` via `~/.config/geoforest/run-backend.sh` |
| Env | `~/.config/geoforest/backend.env` (não versionado; `SIMCAR_CPF`/`SIMCAR_SENHA` já existem para o oráculo) |
| API pública | `https://geoforest-api.cursar.space` (Cloudflare Tunnel → `127.0.0.1:3001`) |
| Front | Firebase Hosting (`ia-florestal`) → `dist/public` |

## O que NÃO muda no servidor

- **Nenhuma variável de env nova** — as credenciais da aba vêm do usuário (localStorage → request), não do `backend.env`.
- A conta do oráculo (`SIMCAR_CPF/SIMCAR_SENHA`) continua funcionando; o refactor do `client.ts` mantém `getSimcarToken()` com o comportamento atual.
- Pode ser preciso instalar nada: `pdf-parse` e `archiver` já estão no `package.json`.

## Deploy (sequência)

### 1. Local (este PC)
```bash
cd /c/GIS/GeoForest-IA
pnpm run check && pnpm run test && pnpm run build
git add -A && git commit -m "feat(simcar-lotes): <descricao>" && git push origin main
```

### 2. Servidor (via SSH)
```bash
ssh server-desktop

cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull --ff-only origin main

# rebuild do backend (esbuild, como no OPS doc):
npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
systemctl --user restart geoforest-backend.service

# healthcheck
curl -sS http://127.0.0.1:3001/api/health
curl -sS https://geoforest-api.cursar.space/api/health

# frontend (build + hosting) — se o front mudou:
npm run build && npx firebase deploy --only hosting
```

> Alternativa: rodar `scripts/deploy-firebase-restart-backend.sh` **no servidor** (ele faz pull → check → build → firebase deploy → restart → push). É interativo (`read -p`), então num SSH direto funciona bem; via agente, prefira os comandos manuais acima.

### 3. Pós-deploy
- Abrir `https://ia-florestal.web.app` → aba "Lotes SIMCAR" → fluxo manual (doc 06).
- Conferir logs: `journalctl --user -u geoforest-backend.service -n 50 --no-pager`.

## Rollback
```bash
ssh server-desktop
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git checkout <commit-anterior> -- backend/ client/src/
npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
systemctl --user restart geoforest-backend.service
```
