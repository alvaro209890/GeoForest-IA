# 05 — Frontend / UX (aba "Lotes SIMCAR")

## Registro da aba (5 arquivos, padrão da skill `geoforest-frontend` → `references/adding-new-feature.md`)

| Arquivo | Mudança |
|---|---|
| `client/src/dashboard/types.ts` | `DashboardView`/`DashboardTabId` += `'simcar-lotes'`; `DASHBOARD_VIEW_LABELS['simcar-lotes'] = 'Lotes SIMCAR'` |
| `client/src/dashboard/routes.ts` | `DASHBOARD_PATH_TO_VIEW['/dashboard/lotes'] = 'simcar-lotes'`; `DASHBOARD_VIEW_TO_PATH['simcar-lotes'] = '/dashboard/lotes'` |
| `client/src/dashboard/components/DashboardSidebarTabs.tsx` | entrada em `DASHBOARD_TABS` (ícone `Package`/`FolderArchive` do lucide, gradiente/glow cyan igual às abas SIMCAR) |
| `client/src/pages/Dashboard.tsx` | `const SimcarLotesPanel = lazy(() => import('@/components/SimcarLotesPanel'));` + bloco `<Suspense>` em `activeView === 'simcar-lotes'` (2 pontos: chain principal + bloco de render, como `simcar-receipts`) |
| `client/src/components/SimcarLotesPanel.tsx` (novo) | o painel (abaixo) — `export default function` (lazy exige default export) |

> ⚠️ Pitfall wouter: rotas filhas usam **caminho absoluto** (`/dashboard/lotes`), nunca relativo — ver skill `geoforest-frontend`.

## O painel (`SimcarLotesPanel.tsx`)

Layout em 3 cards (seguindo o visual das abas SIMCAR existentes — `ReceiptsHub.tsx` / `SimcarFetchCard.tsx` como referência de UX):

### Card 1 — Credenciais SIMCAR (engrenagem/config)
- Campos **CPF** e **senha** + checkbox "Lembrar neste navegador" (default marcado).
- Persistência: `localStorage['geoforest_simcar_credenciais_v1']` — **chave própria do GeoForest** (decisão A5: nada é compartilhado com o acompanhamento-de-processos; mesmo comportamento de UX: salvar/limpar).
- Se salvas, campos vêm preenchidos; botão "Limpar".
- Aviso: "As credenciais ficam salvas apenas neste navegador e são enviadas apenas para gerar os downloads (nunca ficam no servidor)."

### Card 2 — Recibos (dropzone)
- Dropzone aceitando **`.pdf` e `.zip`** (múltiplos arquivos).
- Botão **"Analisar recibos"** → `POST /api/simcar-lotes/parse-recibos` `{zipBase64}` (client: se chegou 1+ PDF solto, embrulha num ZIP antes — padrão dos painéis existentes).
- Resultado: tabela/lista dos lotes detectados:
  | Arquivo | CAR estadual | Recibo federal | Propriedade | Município | Status |
  - Status: `ok` | `sem identificação` (permitir editar o CAR manualmente? **decisão em aberto** — ver doc 09; default: campo editável).
  - Excluir linha individual antes de processar.

### Card 3 — Download
- Botão **"Baixar documentos do lote"** (desabilitado sem lotes válidos) → `POST /api/simcar-lotes/process` `{zipBase64, cpf, senha}` → `jobId`.
- Progresso (SSE via `GET /api/simcar-lotes/jobs/:jobId/events`, padrão do skill):
  - `fase`: autenticando → resolvendo CARs → baixando (lote X de Y, arquivo N de M) → gerando ZIP
  - barra + contagem; **Cancelar** (mantém o que já baixou).
- Ao concluir: link **"Baixar ZIP (N lotes)"** → `GET /api/simcar-lotes/download/:jobId`; nome `lotes_simcar_<data>.zip`.
- Relatório final por lote (expandível): artefatos baixados ✓ / faltantes (400) ⚠ / erro (motivo).
- Estado do job preservado em recarregar (poll de `jobs/:jobId/status` como o `useCroquiJobs`).

## Fluxo de estado (resumo)

```
[credenciais] → salvas? → pré-preenchidas
[recibos] → Analisar → lotes detectados (tabela editável)
→ Baixar → SSE progresso → ZIP pronto → link download
```

## Erros na UI

- `401` da API própria → redirecionar/forçar login (padrão do app).
- Mensagens de erro do backend (doc 04) mostradas inline no card 3.
- Lote individual com erro não trava os demais (a UI mostra "N de M lotes concluídos").
