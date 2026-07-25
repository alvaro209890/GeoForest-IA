# Changelog — 2026-07-24 — Painel Landsat

## Objetivo

Continuar a modularização do `Dashboard.tsx` espelhando a Fase 3 (CBERS), **sem mudar comportamento**.

## Frontend — Fase 4: painel Landsat

Extraído do `Dashboard.tsx` para módulos dedicados:

| Módulo | Caminho | Papel |
|--------|---------|--------|
| Tipos | `client/src/dashboard/landsat/types.ts` | `LandsatComposition`, `LandsatScene`, jobs/histórico |
| Filenames | `client/src/dashboard/landsat/filenames.ts` | ZIP filename + URL WMS archive |
| mapDoc | `client/src/dashboard/landsat/mapDoc.ts` | `normalizeLandsatScene` + `mapLandsatDocToHistoryItem` |
| Hook | `client/src/dashboard/hooks/useLandsatJobs.ts` | estado, SSE, poll, search/process/delete/download |
| Painel | `client/src/dashboard/panels/LandsatPanel.tsx` | UI completa (lazy) |

### Integração

- `Dashboard.tsx` chama `useLandsatJobs({ apiFetch, downloadZip, fileToBase64Payload })`.
- Histórico na sidebar continua no Dashboard (usa o retorno do hook).
- Bootstrap Firestore usa `hydrateFromDocs`.
- `LandsatPanel` entra via `lazy` + `Suspense` (mesmo padrão do `CbersPanel`).
- `downloadSimcarZip` é ligado por ref (`landsatDownloadZipRef`), como no CBERS.
- Continua reutilizando `CbersMapPreview` / `CbersGeoJsonGeometry` (não movidos).

### Tamanho

- `Dashboard.tsx`: ~10 681 → ~9 534 linhas (−~1 147).

## Testes

```bash
pnpm exec vitest run client/src/dashboard --root .
pnpm check
```

## Próximos passos

1. Painel SIMCAR (maior superfície).
2. Fetch sob demanda de históricos por `activeView`.
3. Painel Erros (vértices + wrappers).
