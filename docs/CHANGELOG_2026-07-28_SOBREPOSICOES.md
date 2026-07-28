# Changelog — Sobreposições SIGEF × CAR

**Data:** 2026-07-28

## O que entrou

- Nova aba **Sobreposições** no dashboard (`/dashboard/sobreposicoes`).
- Backend `overlap-analysis.ts`: upload ZIP/códigos SIGEF → WFS SEMA + SICAR → até 3 planilhas XLSX no ZIP.
- Cliente SIGEF unificado (`sigef-client.ts`) usado também pelo recorte SIMCAR; stubs para API SERPRO/Conecta.
- Camada federal confirmada: `sicar:sicar_imoveis_mt`.

## Arquivos principais

- `backend/sigef-client.ts`
- `backend/overlap-analysis.ts`
- `client/src/dashboard/panels/SobreposicoesPanel.tsx`
- `client/src/dashboard/hooks/useOverlapJobs.ts`
- `docs/SOBREPOSICOES_CAR_SIGEF.md`
