# Deploy + sincronização com o main — 2026-07-18

Sessão de operação no **PC servidor** (checkout que roda:
`/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`, serviço systemd
`geoforest-backend.service` na porta 3001, exposto pelo túnel Cloudflare
`geoforest-api.cursar.space`). Objetivo: colocar o serviço ativo e o site no ar
no último `main` do GitHub, com testes e verificação ao vivo. **Nenhuma mudança
de código** — o `main` já estava completo (plano SIMCAR-Oráculo P0–P7 concluído e
correções AUAS × SCCON já mergeadas); o que faltava era **build + deploy** do
código já commitado.

## Estado do repositório

- `main` em `571cbe6d` (*fix(auas-sccon): datas em UTC, multi-parte no join,
  scripts Python e login concorrente*). Checkout do servidor já estava neste
  commit e limpo (`0 ahead / 0 behind` de `origin/main`).
- Checkout secundário `/home/server/GeoForest-IA` (sandbox, **não** é o que roda)
  estava divergido de um force-push antigo (purga de CPF); foi ressincronizado
  com `reset --hard origin/main` após backup em branch/stash. Nada perdido — todo
  o trabalho local já estava no `origin` com hashes novos.

## Verificação (teste tudo)

- **Suíte vitest** (`npx vitest run --root . backend/`, offline):
  **188 passaram | 4 skipped** (os 4 são testes LIVE gated por `SIMCAR_LIVE` /
  DeepSeek — pulam offline por design). Duração ~108 s.
- **Typecheck** (`pnpm run check` → `tsc --noEmit`): **limpo (exit 0)**.

## Build

- `pnpm run build` (exit 0): `vite build` (front `dist/public`) +
  `build-admin` (`dist/admin`) + `esbuild` do backend (`dist/index.js`, ~1,0 MB).
- `VITE_API_BASE=https://geoforest-api.cursar.space` (de `.env.production`).

## Deploy backend

- `systemctl --user restart geoforest-backend.service` → **active**, novo
  processo com cwd no checkout do HD de 2T servindo `dist/index.js` recém-gerado.
- **Somente** o `geoforest-backend.service` foi reiniciado; os demais serviços do
  PC (pareceres-api :3030, vite :5173, etc.) não foram tocados.

### Health / verificação ao vivo

| Checagem | Resultado |
|----------|-----------|
| `GET /api/health` local (127.0.0.1:3001) | `{"ok":true}` |
| `GET /api/health` via túnel (`geoforest-api.cursar.space`) | `{"ok":true}` |
| `GET /api/knowledge/health` | 39 docs, `updatedAtIso` = horário do restart |
| `POST /api/auas-sccon/process` **sem** auth | **401** (fix de auth no ar) |
| `GET /api/auas-sccon/download/:id` **sem** auth | **401** |
| `GET /api/simcar-oraculo/health` **sem** auth | **401** (protegido) |

Os 401 confirmam que o código `571cbe6d` (correção de segurança das rotas AUAS,
que antes eram públicas) está efetivamente em produção.

## Deploy frontend (Firebase Hosting)

O site ao vivo estava **desatualizado**: bundle principal `index-DRuk8M87.js`
publicado vs `index-SCKv2yb6.js` recém-buildado (mudanças de front do `main`:
restauração do Dashboard clássico + UI do AUAS × SCCON não estavam publicadas).

- `npx firebase deploy --only hosting` (conta `alvarocanaisgames@gmail.com`, com
  acesso ao projeto `ia-florestal`) — exit 0.
- `ia-florestal.web.app` (39 arquivos) e `geoforest-admin.web.app` (32 arquivos)
  finalizados/released.
- Verificado: `ia-florestal.web.app` passou a servir `index-SCKv2yb6.js`;
  `geoforest-admin.web.app` → HTTP 200.

## Resultado

Serviço backend e ambos os sites (app + admin) no ar com o código de `571cbe6d`.
Plano SIMCAR-Oráculo (P0–P7) e correções AUAS × SCCON: **100% implementados,
buildados, deployados e verificados ao vivo**. Sem planos pendentes de
implementação — apenas melhorias futuras não-bug já registradas em
`docs/CHANGELOG_2026-07-17_AUAS_SCCON_FIXES.md` (rotear endpoints read-only pela
fila serial; E2E automatizado do AUAS com fixtures multi-parte/hole).
