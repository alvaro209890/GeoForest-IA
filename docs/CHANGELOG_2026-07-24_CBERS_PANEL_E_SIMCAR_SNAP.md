# Changelog — 2026-07-24 — Painel CBERS + snap SIMCAR

## Objetivo

Continuar a quebra dos monólitos em produção (`Dashboard.tsx` e `simcar-clip.ts`), **sem mudar comportamento**, com testes e documentação.

## Frontend — Fase 3: painel CBERS

Extraído do `Dashboard.tsx` (~1,5k linhas) para módulos dedicados:

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos | `client/src/dashboard/cbers/types.ts` | `CbersEstimate`, `CbersScene`, jobs/histórico |
| Filenames | `client/src/dashboard/cbers/filenames.ts` | nomes TIF/ZIP e URL de archive |
| mapDoc | `client/src/dashboard/cbers/mapDoc.ts` | `mapCbersDocToHistoryItem` puro |
| Hook | `client/src/dashboard/hooks/useCbersJobs.ts` | estado, SSE, poll, search/process/delete |
| Painel | `client/src/dashboard/panels/CbersPanel.tsx` | UI completa + modal preview (lazy) |

### Integração

- `Dashboard.tsx` chama `useCbersJobs({ apiFetch, requestProcessCancel, downloadZip, fileToBase64Payload })`.
- Histórico na sidebar continua no Dashboard (usa o retorno do hook).
- Bootstrap Firestore usa `hydrateFromDocs`.
- `CbersPanel` entra via `lazy` + `Suspense` (mesmo padrão do `SettingsPanel`).
- `downloadSimcarZip` é ligado por ref (hook monta antes da função de download no componente).

### Tamanho

- `Dashboard.tsx`: ~12 265 → ~10 681 linhas (−~1 584).

## Backend — primeiro slice de `simcar-clip.ts`

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Snap de geometria | `backend/simcar-clip-snap.ts` | `snapClippedGeometryToBoundary` + `CLIP_SNAP_TOLERANCE_METERS` |

- `simcar-clip.ts` importa e reexporta (consumidores externos intactos).
- Teste `backend/simcar-clip-snap.test.ts` importa o módulo novo.
- `simcar-clip.ts`: ~10 712 → ~10 553 linhas.

## Testes

```bash
pnpm exec vitest run client/src/dashboard/cbers client/src/dashboard/routes.test.ts backend/simcar-clip-snap.test.ts --root .
pnpm check
```

Resultado (2026-07-24): **28 passed** (filenames 6 + mapDoc 2 + routes 13 + snap 7); `tsc --noEmit` OK.

## Próximos passos

1. ~~Painel Landsat (espelhar CBERS).~~ → feito em `docs/CHANGELOG_2026-07-24_LANDSAT_PANEL.md`.
2. Fetch sob demanda de históricos por `activeView`.
3. Próximo slice backend: helpers SSE ou `parseUserShapefile` (com testes).
4. Painel SIMCAR (maior superfície).
