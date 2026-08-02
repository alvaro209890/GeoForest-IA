# Plano: Desmembramento de `client/src/pages/Dashboard.tsx`

**Arquivo atual:** `client/src/pages/Dashboard.tsx` — 9,776 → **8,466 linhas**
**Objetivo:** Separar layout, estado, navegação e sub-páginas em arquivos independentes
**Status:** 🟢 Passos 1–10 concluídos (01/08) — redução de 13,4%; restam os **4 monólitos de
análise** (~981 linhas, medidos 01/08) e o **JSX principal** (~3.500)

---

## ✅ Estrutura real atual (medida 01/08)

### `client/src/dashboard/` — 50 arquivos

```
client/src/dashboard/
├── index.ts                        # barrel central (re-exporta tudo)
├── types.ts                        # DashboardView, DashboardTabId + re-export de types/history
├── routes.ts                       # rotas + URL sync (+ routes.test.ts)
├── types/
│   └── history.ts                  # 20 tipos de histórico (SimcarClipHistoryItem, etc.)
├── lib/
│   ├── index.ts                    # barrel
│   ├── format.tsx                  # renderRichText, sanitizeMessagesForFirestore, etc. (JSX → .tsx)
│   ├── formatters-simcar.ts        # formatSimcarAuasStatus, verdicts, confidence
│   ├── mappers.ts                  # mapVerticesDocToHistoryItem, etc.
│   ├── normalizers-simcar.ts       # normalizadores de texto SIMCAR
│   ├── download-actions.ts         # downloadSimcarZip, etc.
│   └── chatDefaults.ts             # DEFAULT_ASSISTANT_MESSAGE
├── hooks/
│   ├── useSimcarClipJobs.ts        # estado+setters+refs+derivados do SIMCAR Clip
│   ├── useSimcarAnalysis.ts        # estado da análise SIMCAR AI + AUAS
│   ├── useSimcarClipActions.ts     # 5 callbacks de persistência/cancelamento (deps injetadas)
│   ├── useChat.ts                  # chat principal + billing
│   ├── useErrorsAnalysis.ts        # Vértices/Containment/Geometry uploads
│   ├── useCbersJobs.ts             # CBERS
│   ├── useLandsatJobs.ts           # Landsat
│   ├── useCroquiJobs.ts            # Croqui (padrão de referência: deps injetadas)
│   ├── useOverlapJobs.ts           # Sobreposições
│   └── useDashboardNavigation.ts   # URL sync
├── components/
│   ├── DashboardSidebarTabs.tsx    # abas do sidebar
│   ├── HistoryStatusBadge.tsx      # badge de status (8 ocorrências substituídas)
│   ├── HistoryEmptyState.tsx       # empty state (9+ ocorrências substituídas)
│   └── CbersMapPreview.tsx
├── panels/                         # abas completas já extraídas
│   ├── CbersPanel.tsx / LandsatPanel.tsx / CroquiPanel.tsx
│   ├── SettingsPanel.tsx / SobreposicoesPanel.tsx
├── croqui/                         # domínio croqui (types, mapDoc, RoutePicker, routePreview, filenames)
├── cbers/ landsat/ sobreposicoes/  # domínios com types/mapDoc/filenames + testes
└── settings/types.ts
```

### `Dashboard.tsx` — como ficou

| Bloco | Linhas | Status |
|-------|--------|--------|
| Imports | 1–~160 | ✅ |
| `const { ... } = useSimcarClipJobs()` + 4 hooks | ~349–450 | ✅ (estado extraído) |
| Monólitos de análise (4 callbacks) | 3.063–4.294 | 🔴 **restam** |
| JSX principal (sidebar, header, modais, histórico) | ~4.300–8.466 | 🔴 **resta** |

---

## 🔴 O que falta — Passo 11: monólitos de análise (medidos 01/08)

| Monólito | Linhas reais | Deps cruzadas |
|----------|--------------|---------------|
| `runAcAvnAnalysis` | 3.258–3.552 = **294** | chat, billing, conversas, análise |
| `runAuasAnalysis` | 3.568–3.820 = **252** | idem |
| `runVectorizedCompleteAnalysis` | 4.025–4.294 = **269** | idem |
| `sendSimcarFollowUpMessage` | 3.063–3.229 = **166** | chat, follow-up |
| **Total** | **~981** | 100+ deps entre eles |

**Abordagem recomendada (já validada no changelog):** refactor **por fluxo de negócio**, não
por extração mecânica — criar `useSimcarAnalysisFlow` que encapsula os 4 callbacks com deps
injetadas (padrão `useSimcarClipActions`), porque:

- Os 4 se chamam entre si e compartilham estado de chat/billing/conversas
- Extração direta quebraria deps em cascata (lição do incidente de 5.093 linhas no Passo 9)
- Exige **teste manual do fluxo completo**: upload → análise → laudo

### Sub-passos sugeridos (1 commit cada)

| Passo | O que | Validação |
|-------|-------|-----------|
| 11a | Mapear as deps reais dos 4 callbacks (quais estados/setters consomem) | grep + leitura |
| 11b | Criar `useSimcarAnalysisFlow(deps)` com os 4 callbacks movidos intactos | tsc + build |
| 11c | Dashboard consome o hook; remover as 4 declarações | tsc + build + teste manual upload→análise→laudo |
| 11d | Quebrar internamente os callbacks grandes em helpers puros (se viável) | tsc + vitest |

## 🟡 O que falta — Passo 12: JSX principal (~3.500 linhas)

Sidebar, header, modais, painéis de análise e histórico ainda inline. Candidatos a
componentes com props (rodada futura, depois do Passo 11):

- `DashboardSidebar` (props: activeView, onNavigate) — base `DashboardSidebarTabs` já existe
- `DashboardHeader` (user info, credits, logout)
- `SimcarHistoryCards.tsx` / `VerticesHistoryCards.tsx` / etc. (JSX de histórico por aba)
- Modais (delete Cloudinary, confirm, credits)

**Atenção:** NÃO duplicar `client/src/pages/dashboard/*Page.tsx` (stubs de 8 linhas que
compõem os panels). O Dashboard.tsx deve apenas **compor** páginas existentes.

---

## ⚠️ Cuidados (mantidos)

1. **Performance:** `value={{...}}` inline recria objeto → `useMemo`; estados de upload
   progress não vão pro contexto global
2. **Mobile:** `useMobile` já existe; sidebar colapsa; touch targets 44px
3. **URL sync:** `useDashboardNavigation` sincroniza com URL — não muda
4. **Lazy imports:** manter `lazy(() => import(...))` nos panels (evita regressão de bundle)
5. **Regra de ouro:** 1 extração = 1 commit atômico; `tsc` + `vitest` + `vite build` entre passos
6. **NUNCA** script de faixa para remover callbacks (incidente Passo 9 — 5.093 linhas perdidas).
   Extrair com **patch manual** (old_string completo até o `});`); após remoção: `grep -n "^};$"`
   + `npx tsc --noEmit` IMEDIATAMENTE

---

## Como validar

```bash
npm run dev                           # sobe dev server
# Testar cada aba manualmente (especialmente: upload → análise → laudo do SIMCAR)
# Testar mobile (DevTools → iPhone 13)
# Testar login/logout
# Testar URL direta (/dashboard/cbers)

npx tsc --noEmit                      # TypeScript
npx vitest run --root . client/       # 51 testes existentes
npx vite build                        # build app
GEOFOREST_BUILD_TARGET=admin npx vite build  # build admin
```

---

## Estimativa revisada (01/08)

| Passo | Tempo | Risco |
|-------|-------|-------|
| 11a–11b (hook de fluxo) | ~45 min | Médio |
| 11c (Dashboard consome) | ~30 min | Médio |
| 11d (quebra interna) | ~45 min | Alto |
| 12 (JSX componentes) | ~1,5 h | Médio |
| **Total** | **~3,5 h** | |
