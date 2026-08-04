# 03/08/2026 — Planos 04–07 concluídos + auditoria de segurança

Duas frentes nesta rodada: terminar o desmembramento dos monólitos
(`plano_melhoria_codigo/`) e caçar bugs no que sobrou.

---

## 1. Desmembramento (planos 04, 05, 06 e 07)

Princípio de todos os planos: **nenhuma mudança funcional**. O recorte moveu
código verbatim, exportou os símbolos que passaram a cruzar módulos e recriou os
imports; a API pública de cada módulo continua idêntica (barrel).

| Plano | Origem | Resultado |
|-------|--------|-----------|
| 04 | `backend/geometry-errors.ts` (2.885) | `backend/geometry/` — 20 módulos: `types`, `constants`, `utils`, 11 detectores em `detectors/`, `runner`, `report`, `sse`, `job`, `routes`. O arquivo antigo virou barrel (46 linhas). |
| 05 | `backend/cbers-wpm.ts` (2.693) | `backend/cbers/` — 20 módulos: `stac-search`, `download`, `gdal`, `enhance`, `validate`, `publish`(em `pipeline`), `zip`, `archive`, `reuse`, `geoserver`, `wms`, `job`, `routes`… Barrel de 14 linhas. |
| 06 | `backend/landsat.ts` (1.621) | `backend/landsat/` — 13 módulos. O arquivo foi **removido**: `import ... from "./landsat"` resolve para `landsat/index.ts`. |
| 07 · item 7 | `backend/processar-projeto.ts` (1.489) | `backend/processar-projeto/` — 9 módulos (`import-phase`, `process-phase`, `report-builder`, …). |
| 07 · item 8 | `backend/overlap-analysis.ts` (1.364) | `backend/overlap/` — 9 módulos (`car-intersection`, `excel-builder`, `pipeline`, …). Os 2 importadores passaram a apontar para `./overlap`. |
| 07 · item 9 | `backend/simcar-oraculo/pipeline.ts` (1.187) | → 991 linhas + `pipeline-support.ts`. **Parcial — ver ressalva abaixo.** |
| 07 · item 10 | `client/src/admin/main.tsx` (1.310) | `main` (entry) + `AdminRoot`, `AdminApp`, `AdminLogin`, `StorageTab`, `ServerTab`, `components`, `format`, `constants`, `types`, `hooks/useAdminAuth`. |
| 07 · item 11 | `client/src/dashboard/panels/CbersPanel.tsx` (927) | 31 linhas de container + `panels/cbers/`: `CbersPanelHeader`, `CbersSceneSelector`, `CbersJobList`, `CbersPreviewMap`. |
| 07 · item 12 | `backend/vertices-proximas.ts` (1.104) | `backend/vertices-proximas/` — 9 módulos (era opcional no plano). |
| 07 · item 13 | `backend/cbers-archive.ts` (1.105) | movido para `backend/cbers/archive.ts`; o módulo de reaproveitamento de cena virou `backend/cbers/reuse.ts`. |

Itens 14 (`auas-sccon.ts`) e 15 (`knowledge-base.ts`) seguem como o plano previa:
coesos, mantidos como estão.

### ⚠️ Ressalva do item 9

`executePipeline` é **uma função de 780 linhas construída sobre closures** —
`persist`, `emit`, `updateRound`, `checkCancelled`, `planAndApply` e outras
capturam ~10 variáveis mutáveis do escopo. Quebrar em `pipeline-steps/` exigiria
substituir as closures por um objeto de contexto, ou seja, mudar comportamento em
vez de recortar, no núcleo mais sensível do sistema — e os testes ao vivo do
oráculo estão `skip` (dependem de login real no SIMCAR). Foi extraído o que dava
sem risco (`pipeline-support.ts`: tipos públicos, dependências injetáveis,
artefatos e helpers puros). A quebra da função fica como trabalho futuro, a fazer
junto com cobertura de teste do orquestrador.

### Bug introduzido e corrigido no próprio recorte

Os `proj4.defs("EPSG:4674"/"EPSG:4326")` que ficavam no topo de
`vertices-proximas.ts` e `overlap-analysis.ts` — efeito colateral de import que o
resto do backend dependia — **ficaram de fora do recorte**. Os testes de
`vertices-proximas` e `processar-projeto` pegaram na hora
(`Could not parse to valid json: EPSG:4674`).

Correção: `backend/proj-defs.ts` centraliza o registro global e é importado por
todo módulo que chama `proj4` nos pacotes desmembrados.
`backend/proj-defs.test.ts` cobre a regressão nos três pacotes.

---

## 2. Auditoria — 2 bugs de autenticação corrigidos

### 🔴 `DELETE /api/simcar/clip/:jobId` sem token e sem checagem de posse

O handler apaga arquivos a partir das URLs enviadas **no corpo da requisição**, e
a rota não estava na allowlist do `requireAuth` nem verificava dono. Qualquer
chamador anônimo que conhecesse (ou adivinhasse) o caminho de um artefato
removia imagens, ZIPs e o PDF de laudo de outro usuário. O `getAbsoluteStoragePath`
impedia sair de `STORAGE_ROOT`, mas não impedia cruzar de um `users/<uid>` para
outro.

Correção:

- rota adicionada à allowlist (`/^\/api\/simcar\/clip\/[^/]+$/` em `backend/app.ts`);
- handler exige `getAuthUid(req)` e só apaga URLs sob `users/<uid>/`
  (`storagePathBelongsToUid`); o resto volta em `skipped`;
- `readPersistedSimcarClipForUid` substitui a busca que varria todos os uids;
- o Dashboard passou a usar `apiFetch` (envia o Bearer) nessa chamada — antes era
  `fetch` cru sem header.

Regressão: `backend/simcar/routes-delete.test.ts` (4 casos).

### 🔴 `/api/admin/*` de armazenamento e métricas sem autenticação nenhuma

`GET /api/admin/storage/summary`, `GET /api/admin/storage/users/:uid/files`,
`GET /api/admin/cbers-storage/summary`,
`GET /api/admin/cbers-storage/users/:uid/images`,
`DELETE /api/admin/cbers-storage/images/:imageId` e
`GET /api/admin/server/metrics` **não passavam por middleware algum** — enquanto
as rotas de `backend/admin-routes.ts` já usavam `requireAdminAuth`. Ou seja:
e-mail/nome/uso de todos os usuários, métricas do servidor (CPU, discos,
processos) e a exclusão de imagem do acervo estavam abertos na internet.

A causa de fundo: o painel React (`client/src/admin`) **nunca teve login** e
chamava tudo sem token — só funcionava porque as rotas estavam desprotegidas. O
painel HTML legado (`backend/admin-panel.html`) sempre mandou o JWT.

Correção:

- as 6 rotas passaram por `requireAdminAuth`;
- painel React ganhou sessão: `hooks/useAdminAuth` (login, validação em
  `/api/admin/session`, logout), tela `AdminLogin`, `AdminRoot` como gate e botão
  "Sair"; `fetchJson`/`adminDelete` mandam `Authorization: Bearer`.

Regressão: `backend/admin-routes-guard.test.ts` (5 casos, incluindo um que falha
se qualquer rota `/api/admin/*` do acervo for registrada sem `requireAdminAuth`).

### 🟡 Senha e segredo do admin hardcoded

`backend/admin-auth.ts` tinha `ADMIN_PASSWORD = "admin12345678"` e o **mesmo
valor** como `JWT_SECRET`, versionados em repositório público. Agora leem
`ADMIN_PANEL_PASSWORD` e `ADMIN_JWT_SECRET`, com o valor antigo como fallback
para não quebrar instalação existente.

**Ação pendente do Álvaro:** definir as duas variáveis no ambiente do backend
(`~/.config/geoforest/backend.env`) e reiniciar o serviço. Enquanto não fizer, a
senha continua sendo a que está no código.

### Verificado e mantido como está

- `/api/storage` é servido por `express.static` sem auth — é o modelo de
  capability-URL adotado pelo sistema (com bloqueio explícito para artefatos do
  oráculo, que exigem posse). Mudar quebraria todos os links de download.
- `/api/file-proxy` só redireciona para caminhos `/api/storage/` — não busca URL
  remota, então não há SSRF.
- `/api/auas-sccon/config` expõe o UUID da organização no SCCON (identificador de
  UI, não credencial; o token é obtido no servidor).
- `/api/cbers-wpm/wms-download` e `/api/landsat/wms-download` servem o acervo
  raster compartilhado, que já é público em `/api/raster`.

---

## Validação

- `npx tsc --noEmit` limpo.
- `npx vitest run`: **392 passando**, 8 skip (livres: os 8 skips dependem de
  credencial real de SIMCAR/DeepSeek). Eram 386 antes; +6 dos novos testes de
  regressão.
- `npx vite build` e `node scripts/build-admin.mjs` verdes.
- Smoke de import (esbuild bundle ESM) em todos os barrels novos, para pegar
  ciclo de import que o `tsc` não vê.
- Conferido que nenhum barrel tem colisão de nome entre módulos (`export *`
  descarta símbolo ambíguo em silêncio).

> Nota: em máquina lenta o `vitest` pode reportar
> `[vitest-worker]: Timeout calling "onTaskUpdate"` durante
> `processar-projeto.test.ts` (dois casos de ~45 s cada). É ruído de RPC do
> runner, não falha de teste — o arquivo passa.

---

## Deploy

Nada é automático. No servidor do WMS, no checkout que roda de fato
(`/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`):

```bash
git pull --rebase --autostash origin main
scripts/cbers-doctor.sh
npm run build
systemctl --user restart geoforest-backend.service
```

Frontend (inclui o painel admin com o login novo): `npx firebase deploy --only hosting`.
