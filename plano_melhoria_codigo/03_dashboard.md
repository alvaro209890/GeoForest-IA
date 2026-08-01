# Plano: Desmembramento de `client/src/pages/Dashboard.tsx`

**Arquivo atual:** `client/src/pages/Dashboard.tsx` — 9,776 → 8,997 linhas
**Objetivo:** Separar layout, estado, navegação e sub-páginas em arquivos independentes
**Status:** 🟢 Passos 1–4 concluídos (2026-08-01, commit `54f7f811`) — próximo: Passo 5 (useSimcarClipJobs)

---

## Anatomia real (analisada 2026-08-01)

| Bloco | Linhas | % | Conteúdo |
|-------|--------|---|----------|
| Imports | 1–125 | 1% | ~50 imports (firebase, localFirestore, panels, hooks, lucide) |
| Tipos + consts + helpers puros | 126–997 | 9% | 47 declarações: tipos (ChatMessage, SimcarClipHistoryItem, VerticesHistoryItem, ContainmentHistoryItem, GeometryHistoryItem, ReceiptHistoryItem), consts (SIMCAR_MANDATORY_LAYERS, REQUIRED_MODELS, DEFAULT_ASSISTANT_MESSAGE), helpers puros (sanitizeMessagesForFirestore, renderRichText, normalizeImageCaption, formatSimcarAuasStatus, simcarAuasVerdictClass, buildIntegratedVectorizedReport...) |
| Estado + callbacks | 998–6.226 | 53% | ~1.050 consts: useState/useRef/useCallback de SIMCAR Clip, SIMCAR AI Analysis, AUAS, Vértices, Containment, Geometry, Chat, Billing, Settings |
| JSX (render) | 6.227–9.776 | 36% | Sidebar, header, histórico por aba, switch de activeView, modais |

**Aba do switch de views (JSX):** `simcar-clip` (maior), `cbers-wpm`, `landsat`, `sobreposicoes`, `croqui`, `vertices-proximas`, `simcar-receipts`, `features`, `settings`, `solicitacao-prioridade`.

## O que já está modularizado (NÃO MEXER — usar como está)

- `client/src/dashboard/panels/` — CbersPanel, LandsatPanel, CroquiPanel, SettingsPanel, SobreposicoesPanel
- `client/src/dashboard/hooks/` — useCbersJobs, useLandsatJobs, useCroquiJobs, useOverlapJobs, useDashboardNavigation
- `client/src/dashboard/types.ts` — tipos compartilhados (DashboardView, DashboardTabId)
- `client/src/dashboard/routes.ts` — definição de rotas + URL sync
- `client/src/pages/dashboard/` — sub-páginas (SimcarPage, CbersPage, etc.)

## ⚠️ Descoberta importante

O plano original (escrito em 31/07) propunha `DashboardLayout`/`DashboardContent`/`DashboardAuthGate` como
arquivos novos — mas as páginas em `client/src/pages/dashboard/` já existem como **stubs de 8 linhas**
(apenas `export default function XPage() { return <Panel />; }`). A extração de layout/switch **não deve**
duplicar isso: a arquitetura alvo é o Dashboard.tsx apenas **compor** as páginas já existentes.

## Sequência de extração (revisada — cada passo é 1 commit atômico)

### Passo 1: `dashboard/lib/format.ts` (baixo risco — puro)
- Extrair helpers puros das linhas 126–997: `sanitizeMessagesForFirestore`, `isPlainObject`,
  `stripUndefinedDeep`, `toCloudinaryDownloadUrl`, `toFileProxyUrl`, `resolveBackendDownloadUrl`,
  `renderInlineRichText`, `renderRichText`, `renderAnalysisRichText`, `normalizeImageCaption`,
  `normalizeBackendText`, `removeRoboticAuasLines`, `buildIntegratedVectorizedReport`
- **Validar:** `npx tsc --noEmit` + `npx vitest run --root . client/` + `npm run dev` abre

### Passo 2: `dashboard/lib/formatters-simcar.ts` (baixo risco — puro)
- Extrair formatadores SIMCAR: `formatSimcarAuasStatus`, `formatSimcarAcAvnVerdict`,
  `formatSimcarAcAvnConfidence`, `formatSimcarAuasVerdict`, `simcarAuasVerdictClass`
- **Validar:** idem passo 1

### Passo 3: `dashboard/types/history.ts` (baixo risco — tipo puro)
- Mover tipos de histórico: `SimcarClipHistoryItem`, `SimcarServerRuntimeState`, `VerticesHistoryItem`,
  `ContainmentHistoryItem`, `GeometryHistoryItem`, `ReceiptHistoryItem`, `SimcarAnalysisImage`,
  `SimcarAnalysisMessage`, `SimcarLayerSummary`, `SimcarClipSummary`
- Re-exportar de `dashboard/types.ts` (barrel) para não quebrar imports existentes

### Passo 4: `dashboard/lib/mappers.ts` (baixo risco — puro)
- Extrair mappers doc→history: `mapVerticesDocToHistoryItem`, `mapContainmentDocToHistoryItem`,
  `mapGeometryDocToHistoryItem`, `mapReceiptDocToHistoryItem`
- **Validar:** testes de mappers (novos, se viável) + tsc

### Passo 5: `dashboard/hooks/useSimcarClipJobs.ts` (médio risco — maior bloco)
- Extrair estado + callbacks do SIMCAR Clip (linhas ~1.041–1.073 + handlers associados):
  `loadSimcarClipLayers`, `resetSimcarDraft`, `selectSimcarClipEntry`, `cancelProcessingJobsForCard`
- Seguir o padrão de `useCroquiJobs.ts` (deps injetadas: apiFetch, downloadZip, fileToBase64Payload)
- **Validar:** fluxo completo de recorte SIMCAR manualmente (upload → processar → baixar)

### Passo 6: `dashboard/hooks/useSimcarAnalysis.ts` (médio risco)
- Extrair estado + callbacks do SIMCAR AI Analysis + AUAS: `runSimcarAnalysis`, `runAuasAnalysis`,
  `sendSimcarChatMessage`, `appendSimcarEntriesToConversation`
- **Validar:** análise com imagem de teste + chat da análise

### Passo 7: `dashboard/hooks/useChat.ts` (médio risco)
- Extrair chat principal: `handleSend`, `loadConversation`, `handleInsufficientCredits`, billing state
- **Validar:** enviar mensagem no chat, histórico carrega

### Passo 8: `dashboard/hooks/useErrorsAnalysis.ts` (médio risco)
- Extrair Vértices/Containment/Geometry: `handleVerticesUpload`, `handleContainmentUpload`,
  `handleGeometryUpload`, mappers + select/reset
- **Validar:** cada aba de Erros processa um shapefile

### Passo 9: Simplificar `Dashboard.tsx` (baixo risco — mecânico)
- Reduzir a ~2.000 linhas: imports de hooks + JSX de composição
- **Validar:** todas as abas abrem, URL sync (`/dashboard/cbers`) funciona, mobile 375px OK

### Passo 10 (opcional): extrair JSX de histórico por aba em componentes
- `dashboard/components/SimcarHistoryCards.tsx`, `VerticesHistoryCards.tsx`, etc.
- **Validar:** visual idêntico antes/depois

---

## ⚠️ Cuidados

### 1. Performance — re-renders
Ao criar hooks, cuidado com:
- `value={{ ... }}` inline recria objeto a cada render → `useMemo`
- Estados que mudam com frequência (upload progress) não devem ir pro contexto global
- Manter os hooks como estão (useState locais), só mover para arquivo separado

### 2. Mobile vs Desktop
- `useMobile` hook já existe → usar, não recriar
- Sidebar colapsa automaticamente no mobile
- Touch targets mantidos (44px min)

### 3. URL sync
O dashboard usa `useDashboardNavigation` (já existe) que sincroniza abas com URL
(`/dashboard/cbers`, `/dashboard/landsat`). Isso **não muda** com o desmembramento.

### 4. Lazy imports
`SolicitacaoPrioridadePanel` e outros são `lazy(() => import(...))` — manter o lazy nos
novos arquivos (evita regressão de bundle).

### 5. Regra de ouro (do Plano 02 — aprendida na prática)
- 1 extração = 1 commit atômico, sem mudança funcional
- `npx tsc --noEmit` + testes + build entre cada passo
- Extrair **código puro primeiro** (format/mappers/types), hooks depois — reduz risco de merge hell

---

## Como validar

```bash
npm run dev                           # sobe dev server
# Testar cada aba manualmente
# Testar mobile (DevTools → iPhone 13)
# Testar login/logout
# Testar URL direta (/dashboard/cbers)

npx tsc --noEmit                      # TypeScript
npx vitest run --root . client/       # testes existentes
npx vite build                        # build app
GEOFOREST_BUILD_TARGET=admin npx vite build  # build admin
```

---

## Estimativa revisada

| Passo | Tempo | Risco |
|-------|-------|-------|
| 1–4 (puro: format, types, mappers) | ~30 min | Baixo |
| 5 (useSimcarClipJobs) | ~30 min | Médio |
| 6–8 (analysis, chat, errors) | ~45 min | Médio |
| 9 (simplificar Dashboard.tsx) | ~20 min | Baixo |
| 10 (opcional JSX cards) | ~30 min | Baixo |
| **Total** | **~2,5 h** | |
