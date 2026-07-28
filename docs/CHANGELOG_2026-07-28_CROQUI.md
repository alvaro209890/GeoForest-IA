# Changelog — Croqui de acesso

**Data:** 2026-07-28

## O que entrou

- Nova aba **Croqui** (`/dashboard/croqui`).
- Backend `croqui.ts` + módulos `backend/croqui/*`: ATP → município → OSRM → PDF/DOCX/KML → ZIP.
- Histórico em `users/{uid}/croqui_jobs` com cards no sidebar.

## Arquivos principais

- `backend/croqui.ts`
- `backend/croqui/routing.ts`, `render-pdf.ts`, `render-docx.ts`, `render-kml.ts`
- `client/src/dashboard/panels/CroquiPanel.tsx`
- `client/src/dashboard/hooks/useCroquiJobs.ts`
- `docs/CROQUI_ACESSO.md`
