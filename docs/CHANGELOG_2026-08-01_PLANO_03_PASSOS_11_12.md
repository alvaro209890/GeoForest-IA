# CHANGELOG 2026-08-01 — PLANO 03 CONCLUÍDO (passos 11–12)

> Dashboard.tsx: **8.466 → 7.331 linhas (−1.135, −13,4% adicional)** · Plano 03 100% concluído
> Commits: `35635eec` (passo 11), `5edaa607` (passo 11d), `14be6660` (passo 12)

---

## Passo 11 — Monólitos de análise extraídos (`35635eec`)

### O que era

4 callbacks gigantes dentro do `Dashboard.tsx` que se chamavam entre si e concentravam
todo o fluxo de análise SIMCAR pós-recorte (~981 linhas):

| Callback | Linhas (antes) | Função |
|----------|----------------|--------|
| `sendSimcarFollowUpMessage` | 166 | Chat de acompanhamento da análise (SSE) |
| `runAcAvnAnalysis` | 294 | Análise AC/AVN: upload → processa → SSE → laudo |
| `runAuasAnalysis` | 252 | Análise AUAS: mesmo fluxo |
| `runVectorizedCompleteAnalysis` | 269 | Orquestra AC/AVN + AUAS + relatório integrado |

### O que foi feito

**Novo hook `client/src/dashboard/hooks/useSimcarAnalysisFlow.ts`** (~1.150 linhas):

- Encapsula os 4 callbacks **verbatim** (zero mudança funcional — hash do bloco verificado
  antes da remoção do Dashboard)
- Padrão `useSimcarClipActions`: **deps injetadas** via argumento (`UseSimcarAnalysisFlowDeps`)
- Recebe `analysis` (retorno de `useSimcarAnalysis`) como UMA dep e desestrutura só o que
  os callbacks usam — Dashboard continua com `useSimcarAnalysis()` para o JSX, sem estado duplicado
- Deps externas tipadas: apiFetch, readApiError, billing (handleInsufficientCredits,
  applyBillingToWallet), ações de persistência (patchPersistedSimcarClip,
  persistSimcarClipHistoryEntry, appendSimcarEntriesToConversation), estado do clip
  (simcarClipFile/JobId/History/FixedSatelliteKeys + setters), unified progress
- **Código morto removido:** `extractSimcarThinkingText` (declarado, nunca usado)

**Novo `client/src/dashboard/lib/analysis-helpers.ts`** — helpers puros que o Dashboard
também usa no JSX:

- `splitThinkContent` (moveu de callback local)
- `readFileAsDataUrl` / `readFileAsBase64Payload`
- `readSseEvents` + `SseStopError` (passo 11d, ver abaixo)

**Dashboard.tsx:** troca `useSimcarAnalysis()` por `useSimcarAnalysisState` + chamada do
hook de fluxo; imports dos helpers via lib. Removidos os 4 monólitos + helpers locais.

### Validação do passo 11

- `npx tsc --noEmit` ✅
- `npx vitest run --root . client/` → 51 testes ✅
- `npx vite build` ✅
- Suíte backend (processar-projeto + geometry-errors): 51 testes ✅

## Passo 11d — Leitor SSE comum (`5edaa607`)

Os 3 fluxos de análise duplicavam o loop SSE (`reader.read()` → buffer → split →
`JSON.parse` → dispatch por `event.type`). Extraído para:

```ts
readSseEvents(reader, (event) => { ... })   // lê stream, ignora frames malformados
throw new SseStopError()                    // substitui o antigo `break readLoop`
```

- `sendSimcarFollowUpMessage`, `runAcAvnAnalysis` e `runAuasAnalysis` usam o helper
- `SseStopError` preserva o comportamento de parada imediata do `break readLoop`
  (INSUFFICIENT_CREDITS / erro de stream)
- Hook final: ~1.145 linhas (−26)

## Passo 12 — HistoryCard genérico (`14be6660`)

O JSX de histórico por aba repetia o MESMO card 6x (ícone + título + % + badge + subtítulo
+ delete). Criado **`client/src/dashboard/components/HistoryCard.tsx`**:

- `HistoryCardProps`: theme (Icon + classes de cor por aba), active, title, percent, status,
  subtitle (ReactNode), onSelect, onDelete, extraActions, deleteTitle
- Substituídos: **CBERS, Landsat, Sobreposições, Croqui, Vértices e SIMCAR**
- SIMCAR mantém: PDF técnico (`extraActions`) + delete completo (cancelar jobs,
  Cloudinary, conversas vinculadas, reset do draft)
- **Receipts ficou inline** — estrutura muito diferente (download + tipo APF/SIMCAR),
  forçar o componente genérico seria pior

---

## Como testar (manual — precisa de conta Firebase com créditos)

1. `npm run dev` → login → aba **SIMCAR**
2. Upload de ZIP de recorte → processar
3. Botão **Analisar** (AC/AVN) → acompanhar SSE (thinking + progresso + imagens + laudo)
4. Botão **AUAS** → idem
5. **Análise vetorizada** (ZIP completo) → deve rodar AC/AVN + AUAS + relatório integrado
6. Follow-up no chat da análise
7. Cancelar processamento → mensagem de cobrança mínima
8. Excluir card → limpa Cloudinary + conversas vinculadas
9. Abas CBERS/Landsat/Sobreposições/Croqui/Vértices: histórico com badge, % e delete

## Estrutura final do módulo dashboard

```
client/src/dashboard/
├── index.ts                        # barrel central (agora com useSimcarAnalysisFlow + HistoryCard)
├── hooks/
│   ├── useSimcarAnalysisFlow.ts    # NOVO — 4 callbacks de análise com deps injetadas
│   ├── useSimcarAnalysis.ts        # estado puro da análise
│   ├── useSimcarClipJobs.ts / useSimcarClipActions.ts / useChat.ts / useErrorsAnalysis.ts
│   ├── useCbersJobs / useLandsatJobs / useCroquiJobs / useOverlapJobs / useDashboardNavigation
├── lib/
│   ├── analysis-helpers.ts         # NOVO — splitThinkContent, readFileAs*, readSseEvents, SseStopError
│   ├── format.tsx / formatters-simcar.ts / mappers.ts / normalizers-simcar.ts
│   ├── download-actions.ts / chatDefaults.ts
├── components/
│   ├── HistoryCard.tsx             # NOVO — card de histórico genérico (tema por aba)
│   ├── HistoryStatusBadge.tsx / HistoryEmptyState.tsx / DashboardSidebarTabs.tsx / CbersMapPreview.tsx
├── panels/ croqui/ cbers/ landsat/ sobreposicoes/ settings/ types/
```
