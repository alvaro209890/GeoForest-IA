# 03/08/2026 — Painel admin removido por completo

O GeoForest é sistema **de uso interno da empresa**. O painel administrativo era
uma superfície extra sem dono, exposta na internet e (como a auditoria de mais
cedo mostrou) sem autenticação. Em vez de consertar, foi removido: sobra o app
principal — recorte SIMCAR, oráculo, CBERS/Landsat, croqui, sobreposição etc.

---

## O que saiu

### Arquivos deletados

| Arquivo | O que era |
|---|---|
| `client/src/admin/**` (11 arquivos) | Painel React: `AdminRoot`, `AdminApp`, `AdminLogin`, `StorageTab`, `ServerTab`, `components`, `format`, `constants`, `types`, `hooks/useAdminAuth` |
| `client/admin.html` | Entry HTML do painel |
| `client/public/favicon-admin*.png/svg`, `apple-touch-icon-admin.png`, `site-admin.webmanifest` | Ícones e manifest do painel |
| `backend/admin-panel.html` | Painel HTML legado servido pelo backend |
| `backend/admin-routes.ts` | `/api/admin/login`, `/session`, `/users`, `/stats`, block/unblock |
| `backend/admin-auth.ts` | Senha + JWT do admin |
| `backend/admin-routes-guard.test.ts` | Teste do guard (não faz mais sentido) |
| `scripts/build-admin.mjs` | Build separado do painel |

### Rotas removidas

```text
GET    /api/admin/storage/summary
GET    /api/admin/storage/users/:uid/files
GET    /api/admin/cbers-storage/summary
GET    /api/admin/cbers-storage/users/:uid/images
DELETE /api/admin/cbers-storage/images/:imageId
GET    /api/admin/server/metrics
GET    /admin , /admin/ , /admin/*        (static do painel no backend)
```

Restam **0** rotas `/api/admin/*` — verificado registrando todas as rotas num app
falso (108 rotas no total).

### Código morto que veio junto

`backend/cbers/archive.ts`: 1.106 → 758 linhas. Saíram `AdminStorageFile`,
`isAdminUserIdCandidate`, `listUserProfiles`, `adminPublicStorageUrl`,
`adminFileCategory`, `listUserIdsForAdmin`, `listUserStorageFiles`,
`cbersArchiveFileForAdmin`, `summarizeAdminFiles`, `deleteCbersArchiveRecord`,
`removeFromCbersGroups` e `registerCbersArchiveAdminRoutes`.

### Configuração

- `firebase.json`: o site `geoforest-admin` saiu; sobra só `ia-florestal`.
- `vite.config.ts`: `GEOFOREST_BUILD_TARGET`/`isAdminBuild` e o segundo entry
  (`admin.html`) removidos — o build tem um alvo só.
- `package.json`: `build:admin` removido e `build` não chama mais `build-admin.mjs`.
- `backend/config.ts`: origens CORS de `geoforest-admin.web.app` /
  `.firebaseapp.com` removidas (lista e regex).
- `scripts/deploy-firebase-restart-backend.sh`: mensagens sem "admin".
- **No servidor** (`/home/server/.config/geoforest/auto-sync.sh`): o passo
  `cp backend/admin-panel.html dist/admin-panel.html` foi removido (backup
  `.bak-<timestamp>` ao lado). Sem isso o auto-deploy logaria erro a cada ciclo.

---

## Descoberta durante a remoção

`backend/admin-routes.ts` **nunca foi importado por lugar nenhum** — era código
morto. Ou seja, `POST /api/admin/login` e `GET /api/admin/session` não existiam em
runtime, e a tela de login que eu tinha acabado de escrever (commit `add5d08d`,
horas antes) nunca teria funcionado. O único login real de admin era o do
`admin-panel.html`, servido pelo próprio backend, contra rotas que também não
existiam.

Nada disso importa agora — mas explica por que o painel React funcionava sem
token: as rotas de dados estavam abertas e o login era decorativo.

---

## O que **não** foi removido, de propósito

**`adminDeletedAt` / `adminDeleteError` em `CbersArchiveRecord`.** São dados, não
interface. Registros de cenas já apagadas pelo antigo painel carregam essa marca, e
`backend/cbers/reuse.ts` a usa em `isActiveArchiveRecord` para não ressuscitar a
cena no WMS e no reaproveitamento. Removendo o campo, imagens excluídas voltariam
a aparecer. Ficam como campo legado, documentado em `docs/WMS_CBERS.md`.

**Efeito colateral aceito:** não existe mais exclusão definitiva de cena CBERS do
HD/WMS pela interface. É operação rara e destrutiva; hoje se faz na mão no PC do
WMS (passo a passo em `docs/WMS_CBERS.md`).

**`backend/firebase-admin.ts`, `adminAuth`, `adminDb`** — é o SDK Admin do
Firebase (verificação de token dos usuários), sem relação com o painel.

---

## Validação

- `npx tsc --noEmit` limpo.
- `npx vitest run`: **387 passando**, 8 skip (eram 392; −5 do teste do guard, que
  foi deletado junto com o alvo).
- `npm run build` verde, agora gerando só `dist/public/` + `dist/index.js`.
- Registro de rotas conferido: 108 rotas, **0** em `/api/admin/*`.
- `grep` por `admin` em `backend/`, `client/`, `scripts/`, `config/`,
  `vite.config.ts`, `package.json` e `firebase.json` só devolve
  `firebase-admin`, `adminAuth`/`adminDb`, `GEOSERVER_USER=admin`,
  `featureType: "administrative"` (estilo do Google Maps) e o campo legado
  `adminDeletedAt`.

---

## Deploy

- `firebase deploy --only hosting` agora publica apenas `ia-florestal`.
- O site `geoforest-admin.web.app` foi **desativado** (`firebase hosting:disable`)
  para não continuar servindo o painel velho. O site segue existindo no projeto —
  reativar é `firebase hosting:enable`, mas não há mais build para ele.
- Backend: `git pull` + `pnpm run build` + `systemctl --user restart
  geoforest-backend.service` no checkout de produção — o auto-sync do servidor faz
  isso sozinho em até 2 min depois do push (`docs/AUTO_SYNC.md`).
