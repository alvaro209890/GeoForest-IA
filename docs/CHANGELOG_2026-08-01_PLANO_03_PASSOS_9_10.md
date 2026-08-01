# CHANGELOG — 2026-08-01 Plano 03 (continuação): Passos 9–10

**Resultado:** `Dashboard.tsx` 8.764 → 8.466 linhas nesta rodada (−298).
**Total acumulado do Plano 03:** 9.776 → 8.466 (−1.310, **−13,4%**), zero mudança funcional.

## Commits desta rodada (todos no main)

| Commit | Passo | Extração |
|--------|-------|----------|
| `611d4824` | 9 | `hooks/useSimcarClipActions.ts` — requestProcessCancel, cancelProcessingJobsForCard, persistSimcarClipHistoryEntry, markSimcarClipStatus, patchPersistedSimcarClip (padrão de deps injetadas: apiFetch, simcarClipsRef, userProfileUid, setSimcarClipHistory) |
| `523beb75` | 10 | `components/HistoryStatusBadge.tsx` (8 ocorrências) + `components/HistoryEmptyState.tsx` |
| `693319eb` | 10 | 9 empty states inline → `HistoryEmptyState` (CBERS, Landsat, Sobreposição, Croqui, Vértices, Containment, Geometry, Recorte, Recibos) |

## Estrutura final do módulo dashboard

```
client/src/dashboard/
├── components/   DashboardSidebarTabs, HistoryStatusBadge, HistoryEmptyState, CbersMapPreview
├── hooks/        useSimcarClipJobs, useSimcarAnalysis, useSimcarClipActions, useChat,
│                 useErrorsAnalysis, useCbersJobs, useLandsatJobs, useCroquiJobs, useOverlapJobs,
│                 useDashboardNavigation
├── lib/          format.tsx, formatters-simcar.ts, mappers.ts, normalizers-simcar.ts,
│                 download-actions.ts, chatDefaults.ts
├── types/        history.ts (20 tipos)
├── settings/ cbers/ landsat/ sobreposicoes/ croqui/   (submódulos existentes)
└── index.ts      barrel central
```

## Aprendizado da rodada (pitfall importante)

**⚠️ Extração de callbacks com script automático é perigosa.** Na primeira tentativa, um script
que procurava o fim do `useCallback` por padrão `}, [...]);` pegou a primeira ocorrência no JSX
(5.000+ linhas abaixo) e **removeu 5.093 linhas legítimas**. Recuperado com `git checkout` imediato.

**Regra validada:**
1. Sempre `git status` limpo antes de começar (ponto de restauração)
2. Extrair callbacks **com patch manual** (old_string completo), nunca com script de faixa
3. Após qualquer remoção: `npx tsc --noEmit` imediatamente
4. Substituições de JSX repetido: detectar padrões por índices de linha e verificar bloco antes

## Validação (a cada commit)

- `npx tsc --noEmit` ✅
- `npx vitest run --root . client/` → 51 testes verdes ✅
- `npx vite build` → ok ✅
- Suíte backend completa (rodada final) → 333 testes verdes ✅

## O que resta (fora do escopo seguro)

| Item | Linhas | Por que ficou |
|------|--------|---------------|
| `runAcAvnAnalysis` (309) + `runAuasAnalysis` (266) + `runVectorizedCompleteAnalysis` (284) + `sendSimcarFollowUpMessage` (179) | ~1.000 | Monólitos com 100+ deps cruzadas (chat, billing, conversas) — exigem refactor por fluxo, não por extração |
| JSX principal (sidebar, header, modais, painéis de análise) | ~3.500 | Lógica inline densa (delete com Cloudinary, SSE) — candidato a componentes com props, rodada futura |

**Próximo passo sugerido:** refactor dos monólitos de análise por **fluxo de negócio** (não por arquivo):
criar `useSimcarAnalysisFlow` que encapsula runAcAvnAnalysis + runAuasAnalysis + runVectorizedCompleteAnalysis
com deps injetadas — exige teste manual do fluxo completo (upload → análise → laudo).
