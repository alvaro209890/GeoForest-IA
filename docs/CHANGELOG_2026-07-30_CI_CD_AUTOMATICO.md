# CI/CD Automático — GeoForest-IA

**Data:** 30/07/2026

## O que foi feito

Pipeline de deploy automático acionado por push no `main` do GitHub.

## Peças

| Componente | Caminho |
|---|---|
| Script | `/home/server/.config/geoforest/auto-sync.sh` |
| Service | `systemctl --user status geoforest-autosync.service` |
| Timer | `systemctl --user status geoforest-autosync.timer` |
| Log | `/tmp/geoforest-autosync.log` |

## Fluxo

1. **Timer** dispara o serviço a cada **2 minutos**
2. `git fetch origin main` — verifica se há novos commits
3. Se `LOCAL != REMOTE` → pipeline completo:
   - `git reset --hard origin/main`
   - `pnpm run build` (frontend público + admin + backend esbuild)
   - `cp backend/admin-panel.html dist/admin-panel.html`
   - `systemctl --user restart geoforest-backend.service`
   - `firebase deploy --only hosting`
4. Se `LOCAL == REMOTE` → sai sem fazer nada

## Cache-busting no Firebase

- `index.html` e SPA routes: `Cache-Control: no-cache`
- `assets/*.js` e `*.css`: `Cache-Control: public, max-age=31536000, immutable` (Vite gera hash no nome)
- Imagens: 7 dias

**Resultado:** não precisa de Ctrl+F5 após deploy — HTML sempre revalida, assets têm hash novo.

## URLs

- App: https://ia-florestal.web.app
- Admin: https://geoforest-admin.web.app
- API: https://geoforest-api.cursar.space
