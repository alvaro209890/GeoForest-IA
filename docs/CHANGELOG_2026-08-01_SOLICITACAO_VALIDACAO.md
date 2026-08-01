# CHANGELOG — 2026-08-01 Validação + correções Solicitação de Prioridade

**Commits:** `66dcd1cb` (fix solicitacao botão/auth/histórico) · este commit (validação + PyMuPDF venv)

## Contexto

Após pull do main, análise completa do GeoForest e correção da aba **Solicitação de Prioridade SEMA**,
que estava inutilizável no ar (sem botão de processar, auth quebrada, nada persistia).

## Bugs corrigidos

### 1. Painel sem botão de processar (crítico)
- **Antes:** ao selecionar o ZIP, o painel só trocava a cor da borda — não havia como iniciar o processamento.
- **Depois:** botão **"Processar ZIP"** (com opção "Remover") aparece quando um arquivo é selecionado.

### 2. Auth quebrada (401 garantido)
- **Antes:** `SolicitacaoPrioridadePanel.tsx` mandava `idToken = ''` e fetch sem header `Authorization`
  → `requireAuth` respondia 401 em todo upload.
- **Depois:** usa `apiFetch` (injeta Bearer token do Firebase) + `fileToBase64`.

### 3. UID sempre `anonymous` (isolamento entre usuários)
- **Antes:** backend lia `req.user?.uid` (nunca populado — o `requireAuth` seta `req.authUid`)
  → todos os jobs caíam em `anonymous`, qualquer usuário baixava o ZIP de outro.
- **Depois:** helper `getAuthUid(req)` nos 3 handlers (process + download).

### 4. Nada era persistido
- **Antes:** processamento era volátil — sem histórico no banco.
- **Depois:** cada job é persistido em `users/<uid>/solicitacao_prioridade_jobs/<jobId>` via
  `writeDocBySegments` (mesmo mecanismo do recorte SIMCAR em `simcar_clips`), com:
  `kind`, `status` (processing/completed/failed/cancelled), `filename`, `pdfCount`, `downloadUrl`,
  `error`, `timestamp`, `updatedAtMs`.

### 5. PyMuPDF ausente (falha silenciosa no servidor)
- **Antes:** `fill_templates.py` importava `fitz` mas o Python do sistema não tinha PyMuPDF
  → `ModuleNotFoundError` no meio do processamento.
- **Depois:**
  - `backend/solicitacao/requirements.txt` (novo) com `pymupdf>=1.24`
  - `resolvePythonExe()`: prefere venv local `backend/solicitacao/.venv/bin/python` (fallback `python3`)
  - `.gitignore` ganhou `.venv/` e `venv/`
  - Instalação no servidor: `cd backend/solicitacao && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`

### 6. Download sem auth no painel
- **Antes:** `<a href={downloadUrl}>` não enviava Bearer → 401 ao baixar.
- **Depois:** `downloadWithAuth` (fetch com token → blob → download), mesmo padrão do recorte SIMCAR.

## Histórico no painel (nova)

Cards por job persistido, padrão visual do recorte SIMCAR:
- Status colorido (Processando/Concluído/Falhou/Cancelado)
- Nome do arquivo + data + contagem de PDFs
- Download autenticado (ZIP) e botão remover (DELETE via `/api/store/doc`)
- Recarrega após cada processamento

## Validação executada (2026-08-01)

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ limpo |
| Suíte completa backend (42 arquivos) | ✅ 333 passando, 8 skipped |
| `npx vite build` (app) | ✅ 6s |
| `GEOFOREST_BUILD_TARGET=admin npx vite build` | ✅ 3.9s |
| Backend local smoke (health + rotas sem token) | ✅ health 200, process/download → 401 |
| Teste ponta-a-ponta `fill_templates.py` | ✅ ZIP com 2 DOCX preenchidos (PDFs sintéticos) |

## Teste ponta-a-ponta (script)

`/tmp/test_solicitacao.py` (não versionado) — gera 5 PDFs sintéticos (CAR, Matrícula, Procuração,
CNH, AI/TE) com dados realistas, empacota em ZIP, roda `fill_templates.py` com o venv e confere o ZIP
de saída. Extração validada: lote, proprietário, CPF, simcar, matrícula, endereço, AI/TE, processo IBAMA.

## Notas operacionais

- **Deploy backend no servidor:** além do pull/build/restart, rodar a criação do venv Python
  (comando acima) — senão a aba Solicitação falha com `ModuleNotFoundError: fitz`.
- **SSH ao servidor**: Tailscale pediu re-autenticação (`login.tailscale.com/a/...`) em 01/08 — verificar antes do deploy.
- O fluxo completo via API (com token Firebase real) ainda precisa de teste manual no navegador
  após deploy — o smoke local validou só auth (401) e o script Python (extração+preenchimento).

## Estado do plano de divisão de arquivos grandes

| # | Arquivo | Linhas | Status |
|---|---------|--------|--------|
| 01 | `backend/index.ts` | 2.956 → 1.536 | ✅ Plano 01 concluído (app.ts + routes/) |
| 02 | `backend/simcar-clip.ts` | 10.103 → 10.026 | 🟡 Plano 02 concluído (infra extraída), monólito principal intacto |
| 03 | `client/src/pages/Dashboard.tsx` | 9.776 | ⬜ **Próximo** (Plano 03) |
| 04–16 | Demais | ~15.000 | ⬜ Pendente |

**Próximo passo:** Plano 03 — Dashboard.tsx. Ver `plano_melhoria_codigo/03_dashboard.md`.
