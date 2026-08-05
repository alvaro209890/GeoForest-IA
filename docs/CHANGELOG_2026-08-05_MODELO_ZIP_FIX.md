# CHANGELOG — 2026-08-05: Fix do recorte SIMCAR (Arquivo Modelo.zip)

## Problema

Ao fazer um recorte de um SIMCAR no GeoForest (produção), o backend respondia:

> `Arquivo Modelo.zip não encontrado no servidor.`

e o recorte abortava sem gerar as camadas esperadas.

## Causa raiz

O "Arquivo Modelo.zip" (template de shapefiles da SEMA usado pelo pipeline de recorte)
é lido em `backend/simcar/constants.ts` (`MODELO_ZIP_PATH`).

O path era resolvido como `path.resolve(__dirname, "..", "..", "Arquivo Modelo.zip")`:

| Onde roda | `__dirname` | Resolução antiga | Resultado |
|---|---|---|---|
| Dev (fonte) | `backend/simcar/` | `../../Arquivo Modelo.zip` | ✅ raiz do repo |
| **Produção** (esbuild → `dist/index.js`) | `dist/` | `../../Arquivo Modelo.zip` | ❌ **pasta ACIMA do repo** |

O arquivo existia na raiz do repo do servidor (`/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA/Arquivo Modelo.zip`),
mas o código de produção procurava um nível acima — daí o "não encontrado".

O bug veio da modularização do Plano 02 (o módulo `simcar/` ficou um nível mais fundo;
o ajuste de `..` foi feito pensando só na execução por fonte).

## Correções

### 1. `backend/simcar/constants.ts` — resolução robusta de `MODELO_ZIP_PATH`

Agora resolve por candidatos, na ordem:

1. `SIMCAR_MODELO_ZIP_PATH` (env, override explícito);
2. fonte: `backend/simcar/../../Arquivo Modelo.zip` → raiz do repo;
3. produção: `dist/../Arquivo Modelo.zip` → raiz do repo;
4. cwd: raiz do repo (systemd `WorkingDirectory` / dev server).

Usa o **primeiro que existir** no disco. Funciona em dev e produção, com e sem
empacotamento esbuild.

### 2. `backend/simcar/clip-pipeline.ts` — mensagem de erro com o path

O erro agora mostra o caminho que foi procurado:

> `Arquivo Modelo.zip não encontrado no servidor (<path>).`

### 3. `backend/simcar/analysis.ts` — remoção de constante morta

`MODELO_ZIP_PATH` local (duplicada, com resolução errada em dev, sem nenhum uso)
removida — o módulo usa a exportada por `constants.ts`.

### 4. `Arquivo Modelo.zip` — substituído pela versão atual da SEMA

O template em uso foi trocado pelo arquivo baixado em 2026-08-05 (28 camadas:
ATP, AIR, AREA_CONSOLIDADA, AREA_UMIDA, ARL, ARLREM, APP, AVN, AUAS, NASCENTE,
RESERVATORIO_ARTIFICIAL, RIO_* (6 faixas), UTILIDADE_PUBLICA, VEREDA, etc. — 112 arquivos).

## Verificação

- `pnpm run check` (tsc --noEmit) ✅
- `pnpm run test` — 486 passed / 8 skipped ✅
- Resolução do path validada em dev (`backend/simcar/`) e produção (`dist/`) ✅
- Deploy realizado no PC servidor (`server-desktop`): `git pull` → `esbuild` → `systemctl --user restart geoforest-backend.service` ✅

## Ops

- Env opcional novo: `SIMCAR_MODELO_ZIP_PATH` — só para apontar o template para outro
  local (não configurado; o default resolve para a raiz do repo).
- O template é versionado no git (`Arquivo Modelo.zip` na raiz), então o deploy por
  `git pull` já atualiza o arquivo — nenhuma cópia manual no servidor é necessária.
