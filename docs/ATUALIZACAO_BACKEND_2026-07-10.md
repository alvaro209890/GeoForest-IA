# Atualização consolidada — pronta para puxar no backend (2026-07-10)

Tudo já está mesclado no `main`. Este documento resume **todas** as mudanças do
lote 2026-07-09 → 2026-07-10 que entram no servidor com um único `git pull`,
com os passos de deploy ao final.

## Como atualizar o servidor

```bash
cd <checkout do servidor>          # o checkout que roda é o do /media/server
git pull
set -a && source .env.production && set +a && pnpm run build
systemctl --user restart geoforest-backend.service
# frontend (se for republicar): npx firebase deploy --only hosting
```

Após reiniciar, conferir no log (`journalctl --user -u geoforest-backend -f` ou
`/tmp/geoforest-backend.log`) que o serviço subiu sem erros.

## O que entra neste pull

### SIMCAR Clip — correções de recorte (backend)

| Commit | Mudança | Doc |
|--------|---------|-----|
| `1a9ff7fd` | **Fix recortes deslocados no ArcMap**: datum do `.prj` UTM era ignorado (assumia WGS84) — shapes SAD69/Córrego Alegre deslocavam o recorte inteiro ~65–80 m. Agora o datum é detectado e transformado com parâmetros oficiais IBGE; datum desconhecido e projeção não-UTM dão erro claro. 10 testes novos. | [CHANGELOG_2026-07-10_SIMCAR_DATUM.md](CHANGELOG_2026-07-10_SIMCAR_DATUM.md) |
| `036f8a9e` + `d7b81011` | **WFS: BBOX vira método primário** de busca de feições; `INTERSECTS` só como complemento (o GeoServer da SEMA rejeitava WKTs grandes com HTTP 400). | [CHANGELOG_2026-07-10_WFS_BBOX_FIX.md](CHANGELOG_2026-07-10_WFS_BBOX_FIX.md) |
| `dc911f39` | **WFS: fallback single-page** ao detectar timeout/erro de rede na paginação. | — |

### Análise de Erros / Contenção (backend + frontend)

| Commit | Mudança | Doc |
|--------|---------|-----|
| `47319988` | Nova análise **"Áreas Não Contidas"** (`backend/containment-analysis.ts`) + auto-update do front sem Ctrl+F5. | [CHANGELOG_2026-07-10_AREAS_NAO_CONTIDAS.md](CHANGELOG_2026-07-10_AREAS_NAO_CONTIDAS.md) |
| `e806d723` | `requireAuth` nas rotas `/api/containment/*` (estavam sem autenticação). | — |
| `5e8e7a72` | `containment_jobs` na whitelist do `local-storage`. | — |
| `6e34c18d` | **Histórico na sidebar** para Análise de Erros e Recibos. | — |

### Recibos / APF Rural / UI (principalmente frontend)

| Commit | Mudança | Doc |
|--------|---------|-----|
| `ee084263` | Seletores de recibos modernizados + responsividade mobile completa. | [CHANGELOG_2026-07-09_MOBILE_UI.md](CHANGELOG_2026-07-09_MOBILE_UI.md) |
| `11f6e432` + `5e3a2d7c` | APF Rural: frontend redesenhado; default CAR Estadual, postback do radio e parsing robusto (`backend/apf-receipts.ts`). | [CHANGELOG_2026-07-09_APF_RURAL.md](CHANGELOG_2026-07-09_APF_RURAL.md) |
| `423c0265` | Fix desalinhamento do seletor de abas. | — |
| (este commit) | Fix de tipo em `SimcarReceiptDownloader.tsx`: `item.carCodigo` não existe na resposta do backend (sempre caía no fallback) → `item.numeroCompleto`. `tsc --noEmit` volta a passar limpo. | — |

## Estado de verificação (2026-07-10)

- `npx vitest run --root . backend/` → **28/28 testes passando** (5 suítes,
  incluindo os 10 novos de `geo-utils.test.ts`).
- `npm run check` (tsc) → **limpo**.
- Bundle do backend (esbuild) compila sem erros.

Obs.: o vitest precisa de `--root .` porque o `vite.config.ts` aponta
`root: client/`.

## Observações pós-deploy

- Recortes que **continuarem** deslocados no ArcMap após esta atualização têm
  causa externa: falta de transformação geográfica no MXD (data frame com
  camadas SAD69) ou o próprio CAR mal georreferenciado na base da SEMA — ver
  seção "Casos que continuam deslocando" no changelog do datum.
- Shapefiles UTM com datum desconhecido ou projeção não-UTM agora são
  **rejeitados com mensagem clara** em vez de gerar recorte silenciosamente
  errado — é comportamento intencional.
