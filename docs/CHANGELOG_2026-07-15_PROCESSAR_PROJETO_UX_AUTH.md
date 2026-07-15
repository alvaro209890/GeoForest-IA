# Changelog — Processar projeto: auth, cards, PDF GeoForest e UX (2026-07-15)

Documenta o pacote de correções e melhorias aplicadas no backend local do PC
(HD 2TB / `Servidores_NAO_MEXA/GeoForest-IA`) e publicadas no front Firebase
(`ia-florestal.web.app`), com API exposta via Cloudflare Tunnel
(`geoforest-api.cursar.space` → `127.0.0.1:3001`).

## Resumo

| Item | Situação |
|------|----------|
| Auth nas rotas `/api/processar-projeto/*` | Corrigido (401 “Usuário não autenticado”) |
| PDF de importação | Marca SEMA removida — identidade GeoForest |
| Histórico em cards (sidebar) | Igual às abas de Vértices / Geometria / Contenção |
| Reiniciar com outro ZIP | Botões dedicados |
| “Gerar camadas corrigidas” | Removido (não pertencia a esta aba) |
| Deploy | Backend reiniciado + hosting Firebase atualizado |

## 1. Correção de autenticação (backend)

### Problema

`POST /api/processar-projeto/upload` (e demais rotas da aba) respondiam
**401** com `"Usuário não autenticado."` mesmo com o usuário logado no front.

O front enviava `Authorization: Bearer <Firebase ID token>` via `apiFetch`, mas
as rotas **não estavam** na lista do middleware `requireAuth` em
`backend/index.ts`. Assim, `req.authUid` nunca era preenchido e o handler
rejeitava a requisição.

Outras abas (`/api/vertices/*`, `/api/geometry-errors/*`, `/api/containment/*`,
store, billing, etc.) já estavam protegidas corretamente.

### Correção

Inclusão em `requireAuth` de:

- `POST /api/processar-projeto/upload`
- `POST /api/processar-projeto/importar`
- `POST /api/processar-projeto/processar`
- `GET /api/processar-projeto/import/:importId/pdf`
- `GET /api/processar-projeto/jobs/:jobId/status`
- `GET /api/processar-projeto/jobs/:jobId/events`
- `GET /api/processar-projeto/download/:jobId`
- `DELETE /api/processar-projeto/jobs/:jobId`

### Arquivo

- `backend/index.ts`

### Comportamento esperado

- Sem token → `401` com `"Token de autenticacao obrigatorio."` (middleware)
- Com token Firebase válido → `authUid` setado; upload/import/processar seguem

## 2. PDF de importação sem marca SEMA

### Problema

O botão e o PDF citavam “estilo SEMA” / “SEMA-MT”, embora o produto seja
**GeoForest**.

### Correção

Textos visíveis e metadados do PDF passam a usar apenas **GeoForest IA** e
referência ao fluxo **SIMCAR** (sem “SEMA” no layout).

| Antes | Depois |
|-------|--------|
| `GeoForest IA · Projeto Geográfico (estilo SIMCAR / SEMA-MT)` | `GeoForest IA · Projeto Geográfico (SIMCAR)` |
| Keywords com `SEMA-MT` | Keywords: SIMCAR, importação, GeoForest |
| Rodapé “processamento oficial da SEMA” | “processamento oficial do SIMCAR” |
| Botão UI: “Baixar PDF (estilo SEMA)” | “Baixar PDF da importação” |

### Arquivos

- `backend/import-report-pdf.ts`
- `client/src/components/ProcessarProjetoAnalysis.tsx`

## 3. Cards de histórico na sidebar (como as outras abas)

### Problema

A aba Processar projeto não gravava/listava jobs nos cards laterais; as
demais abas de Análise de Erros (Vértices, Áreas Não Contidas, Erros de
Geometria) já faziam isso via `localFirestore` → `/api/store/*` e coleção
local por usuário.

### Solução

- Coleção: `users/{uid}/processar_projeto_jobs` (já usada pelo backend em
  `persistJob`)
- Front carrega no login com `orderBy('updatedAtMs', 'desc')`
- Cards na sidebar quando `errorAnalysisTab === 'processar-projeto'`
- `onJobSnapshot` atualiza lista + `setDoc` no store local
- Clique no card restaura estado (status, erros, PDF, ZIP, progresso)
- Excluir chama `DELETE /api/processar-projeto/jobs/:id` + remove do store

### Status exibidos no card

| Status | Rótulo |
|--------|--------|
| `import_ok` | Import OK |
| `import_failed` | Import falhou |
| `processing` / `queued` | Processando |
| `completed` | Concluído |
| `failed` | Falhou |
| `cancelled` | Cancelado |

Uploads crus (`status: uploaded`) **não** viram card permanente; import e
process sim.

### Arquivos

- `client/src/components/ProcessarProjetoAnalysis.tsx` — tipo
  `ProcessarHistoryItem`, snapshots, restore
- `client/src/pages/Dashboard.tsx` — estado, load, sidebar, wire

## 4. Reiniciar com outro ZIP

Botões para limpar o rascunho e abrir o seletor de arquivo:

1. **Reiniciar com outro ZIP** — topo do painel (quando há trabalho em curso)
2. **Novo projeto (outro ZIP)** — seção de resultados

Comportamento: `resetDraft()` + click no input file.

## 5. Remoção de “Gerar camadas corrigidas”

### Problema

Checkbox **“Gerar camadas corrigidas (unkink / limpar vértices)”** na aba
Processar projeto, copiado da aba Erros de Geometria.

### Por que não deve existir aqui

- Em Processar projeto o backend **não lia** `settings.generateFixed`
- O fluxo ProcessarGeo sempre monta `arquivo_processado.zip` (projeto + APP*)
  e pacotes de erros — não há toggle de “shapes corrigidos”
- Opção legítima na aba **Erros de Geometria**, não nesta

### Correção

Checkbox e estado `generateFixed` removidos. Mantido apenas o filtro real:

- **Área mínima de sobreposição/vazio (m²)** → `settings.minOverlapM2`

## 6. Operação no servidor (contexto de deploy)

Não versionado como código, mas parte da entrega do dia:

| Ação | Detalhe |
|------|---------|
| Repo no HD 2TB | `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA` |
| Pull | `main` alinhado a `origin/main` antes das mudanças |
| Build backend | `esbuild backend/index.ts → dist/` |
| Serviço | `systemctl --user restart geoforest-backend.service` |
| Tunnel | `geoserver-wms-tunnel` / config `~/.cloudflared/config.yml` |
| Host público API | `https://geoforest-api.cursar.space` → `http://127.0.0.1:3001` |
| Front | `npx vite build` + `firebase deploy --only hosting` → `https://ia-florestal.web.app` |

Health check: `GET /api/health` → `{"ok":true}` (local e via tunnel).

## Arquivos alterados (este pacote)

```
backend/index.ts
backend/import-report-pdf.ts
client/src/components/ProcessarProjetoAnalysis.tsx
client/src/pages/Dashboard.tsx
docs/CHANGELOG_2026-07-15_PROCESSAR_PROJETO_UX_AUTH.md  (este arquivo)
docs/PROCESSAR_PROJETO_SIMCAR.md                         (atualização UX)
```

## Como validar

1. Login em https://ia-florestal.web.app  
2. Análise de Erros → **Processar projeto**  
3. Enviar ZIP → **Importar** (sem 401)  
4. Baixar PDF — cabeçalho GeoForest, sem SEMA  
5. Card aparece na sidebar após import/process  
6. **Reiniciar com outro ZIP** limpa e abre seletor  
7. Não existe mais checkbox de camadas corrigidas  

## Referências

- Fluxo completo ProcessarGeo: [`PROCESSAR_PROJETO_SIMCAR.md`](PROCESSAR_PROJETO_SIMCAR.md)
- Paridade importação: [`CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md`](CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md)
- PDF importação (geração inicial): [`CHANGELOG_2026-07-15_IMPORT_PDF_REPORT.md`](CHANGELOG_2026-07-15_IMPORT_PDF_REPORT.md)
- ProcessarGeo APP*: [`CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md`](CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md)
