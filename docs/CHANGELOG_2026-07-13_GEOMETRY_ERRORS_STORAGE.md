# CHANGELOG 2026-07-13 — Fix `INVALID_DOC_PATH` no import de ZIP (Erros de Geometria) + histórico

## Resumo

1. **Bug corrigido:** upload de `.zip` na aba "Erros de Geometria" falhava com
   `INVALID_DOC_PATH` porque a collection `geometry_errors_jobs` não estava na whitelist de
   `backend/local-storage.ts`.
2. **Gap de paridade corrigido:** a aba "Erros de Geometria" não salvava/mostrava histórico
   de análises no painel lateral, ao contrário de SIMCAR clip/vértices/containment.

Ver `docs/ARMAZENAMENTO_LOCAL_FIRESTORE.md` para o funcionamento completo do armazenamento
local (não é Firestore real) e o checklist para não repetir esse tipo de bug em uma nova aba.

---

## 1. Causa raiz

`backend/geometry-errors.ts` sempre persistiu o job em
`["users", uid, "geometry_errors_jobs", jobId]` via `writeDocBySegments`. Mas
`resolveDocPathFromSegments`/`resolveCollectionDirFromSegments` (`backend/local-storage.ts`)
só resolvem collections numa lista fixa (`allowed`), e `geometry_errors_jobs` nunca tinha
sido adicionada ali — diferente de `simcar_clips`, `vertices_jobs`, `containment_jobs`,
`cbers_wpm_jobs`, `landsat_jobs`, que já estavam. Toda gravação retornava
`throw new Error("INVALID_DOC_PATH")`, incluindo a primeira chamada logo após o upload do
zip (`POST /api/geometry-errors/upload` → `persistGeometryJob`), o que fazia o import falhar
antes mesmo de qualquer análise de geometria rodar.

### `backend/local-storage.ts`
- `"geometry_errors_jobs"` adicionada ao `Set` `allowed` em `resolveDocPathFromSegments` e em
  `resolveCollectionDirFromSegments`.

---

## 2. Paridade de histórico com as outras abas

O componente `GeometryErrorsAnalysis` recebia apenas `apiFetch` e nunca reportava o
snapshot do job pra fora — diferente de `ContainmentAnalysis`, que tem a prop
`onJobSnapshot`. Consequência: mesmo depois de corrigido o `INVALID_DOC_PATH`, a análise
processada não aparecia na lista de histórico do Dashboard nem sobrevivia a um F5/relogin.

### `client/src/components/GeometryErrorsAnalysis.tsx`
- Nova prop `onJobSnapshot?: (job: Record<string, unknown>) => void`.
- `export type GeometrySummary` (antes não exportado, precisa ser importável pelo Dashboard).
- `applySnapshot` agora chama `onJobSnapshot?.(job)` no final, mesmo padrão de
  `ContainmentAnalysis`.

### `client/src/pages/Dashboard.tsx`
- Novo tipo `GeometryHistoryItem` (mesmo formato de `ContainmentHistoryItem`, com campos de
  `GeometrySummary`).
- Novos estados: `geometryHistory`, `geometryJobId`, `geometryJobsRef`.
- `mapGeometryDocToHistoryItem` (equivalente a `mapContainmentDocToHistoryItem`).
- `geometryJobsRef` criado no `onAuthStateChanged` (`collection(db, 'users', uid,
  'geometry_errors_jobs')`), resetado no logout, com carregamento do histórico salvo e
  retomada de job `processing` ao logar — mesmo padrão de containment/vértices.
- `<GeometryErrorsAnalysis onJobSnapshot={...}>` agora espelha o job em `geometryJobsRef`
  (`setDoc(..., { merge: true })`) e atualiza `geometryHistory` local, igual ao bloco de
  `ContainmentAnalysis`.
- Novo branch na lista lateral de histórico para `errorAnalysisTab === 'geometry'`
  (ícone `AlertTriangle`, cor âmbar), com exclusão (`deleteDoc`).

---

## Arquivos alterados

`backend/local-storage.ts`, `client/src/components/GeometryErrorsAnalysis.tsx`,
`client/src/pages/Dashboard.tsx`.

## Como verificar

1. Fazer upload de um `.zip` de shapefiles do CAR/SIMCAR na aba "Erros de Geometria" — não
   deve mais aparecer `INVALID_DOC_PATH`.
2. Rodar a análise até completar — o item deve aparecer na lista lateral de análises, com
   contagem de erros e camadas.
3. Recarregar a página (F5) — o histórico da análise deve continuar aparecendo.
