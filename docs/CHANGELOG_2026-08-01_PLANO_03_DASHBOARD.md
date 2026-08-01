# CHANGELOG — 2026-08-01 Plano 03: desmembramento do Dashboard.tsx

**Resultado:** `Dashboard.tsx` 9.776 → 8.764 linhas (−1.012, ~10%) — zero mudança funcional.

## Commits (todos no main)

| Commit | Passo | Extração |
|--------|-------|----------|
| `54f7f811` | 1–4 | `types/history.ts` (20 tipos) + `lib/format.tsx` (15 helpers) + `lib/formatters-simcar.ts` (5 formatadores) |
| `47f6dfcf` | 5 | `hooks/useSimcarClipJobs.ts` — estado do recorte SIMCAR (32 variáveis + history + derivados + loadLayers) |
| `9f101583` | 6 | `hooks/useSimcarAnalysis.ts` — estado AI Analysis + AUAS (33 variáveis + refs) |
| `b2db0ad5` | 7 | `hooks/useChat.ts` (54 variáveis) + `lib/chatDefaults.ts` (DEFAULT_ASSISTANT_MESSAGE) |
| `7755fb64` | 8 | `hooks/useErrorsAnalysis.ts` — Vértices/Containment/Geometry (24 variáveis + resetVerticesDraft) |
| `72bb6878` | 4 | `lib/mappers.ts` — toIsoDateFromUnknown + 3 mappers doc→history |
| `cb53e120` | extra | `lib/normalizers-simcar.ts` — normalizeSimcarClipSummary + normalizeSimcarReportPatch + inferSimcarStageFromEndpoint |
| `fb7e2782` | extra | `lib/download-actions.ts` — downloadSimcarZip + openSimcarPdfInNewTab + downloadSimcarAnalysisImage |

## Padrão usado (replicável)

Cada hook de estado segue o padrão do `useCroquiJobs.ts`:
- Hook retorna **estado + setters + refs + derivados** (estado puro, sem callbacks pesados)
- Callbacks pesados (selectSimcarClipEntry, runSimcarAnalysis, handleSend, cancelProcessingJobsForCard) **permanecem no Dashboard** consumindo os setters retornados
- Export via barrel `dashboard/index.ts`
- 1 extração = 1 commit atômico

## Validação (a cada commit)

- `npx tsc --noEmit` ✅
- `npx vitest run --root . client/` → 51 testes verdes ✅
- `npx vite build` → ok (~4.2s) ✅

## O que resta (Passos 9–10)

| Item | Linhas estimadas | Risco |
|------|------------------|-------|
| Callbacks pesados (67 useCallbacks: selectSimcarClipEntry, cancelProcessingJobsForCard, runSimcarAnalysis, handleSend, loadConversation, billing...) | ~4.000 | Médio — exigem injetar muitas deps |
| JSX (sidebar, header, histórico por aba, modais) | ~3.500 | Médio |
| **Total restante** | ~7.500 | |

Próxima rodada sugerida: extrair callbacks por domínio (useSimcarClipActions, useChatActions) seguindo o mesmo padrão de deps injetadas — ou parar aqui se o objetivo era reduzir a complexidade de estado (já atingido).

## Nota operacional

Deploy **não foi feito** nesta rodada (só refactor + push). O Tailscale SSH ao servidor estava pedindo re-autenticação em 01/08 — verificar antes de deploy do backend. Frontend (Firebase Hosting) pode ser deployado a qualquer momento.
