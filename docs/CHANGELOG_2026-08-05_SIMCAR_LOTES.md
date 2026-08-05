# 05/08/2026 — Aba "Lotes SIMCAR": download automático dos documentos do CAR

O que o vídeo de 05/08 mostrava à mão — logar no SIMCAR técnico, abrir cada CAR,
baixar `Arquivo Enviado.zip`, `Arquivo Processado.zip` e o recibo, e salvar na pasta
do lote — agora é uma aba: arrasta os recibos, recebe um ZIP com uma pasta por lote.

Implementa o plano `docs/planos/simcar-lotes/` (fases 1–3). Doc de referência:
[`docs/SIMCAR_LOTES.md`](SIMCAR_LOTES.md).

---

## O que entrou

### Backend — `backend/simcar-lotes/` (novo)

| Arquivo | Papel |
|---|---|
| `routes.ts` | `parse-recibos`, `process` (202 + job), `jobs/:id/status`, `jobs/:id/events` (SSE), `download/:id`, `DELETE jobs/:id` |
| `job.ts` | Orquestra: ler recibos → login → resolver → baixar → zipar; erro de um lote não derruba os demais |
| `recibo-parse.ts` | `pdf-parse` → nº CAR estadual/federal, propriedade, município, proprietário |
| `resolver.ts` | nº CAR → `RequerimentoId` via `Requerimento/ListarRasc` + fallback público por recibo federal |
| `downloader.ts` | Baixa os 3 artefatos; 400/404 = ausente → `faltantes`; valida magic bytes (`%PDF-`, `PK`) |
| `zip-builder.ts` | Pasta por lote (`MT10005-2019 - LOTE_RURAL_81/`) + `RELATORIO.txt` |
| `session-queue.ts` | Fila serial por conta SIMCAR (sessão única da SEMA) |
| `sse.ts`, `types.ts`, `index.ts` | Progresso/persistência, tipos e barrel |

### Backend — sessão por credencial (`simcar-oraculo/client.ts`)

O cache de token era **global** (uma conta só, a do env). Virou `Map` por credencial:

```ts
getSimcarTokenFor(cpf, senha)      // sessão do usuário da aba Lotes
getSimcarToken()                   // conta do env (oráculo) — comportamento intacto
withSimcarAuthRetryFor(cpf, senha, op)
clearSimcarTokenCache(chave?)      // sem chave = limpa tudo
simcarCredentialKey(cpf, senha)
```

Single-flight por chave: logins simultâneos da **mesma** conta são coalescidos (não
se derrubam); contas diferentes correm em paralelo.

### Frontend

| Arquivo | Mudança |
|---|---|
| `client/src/components/SimcarLotesPanel.tsx` (novo) | Credenciais (localStorage `geoforest_simcar_credenciais_v1`), dropzone PDF/ZIP, tabela editável de lotes, progresso SSE + cancelar, download do ZIP, relatório por lote |
| `client/src/dashboard/types.ts` | View/tab `simcar-lotes` + label "Lotes SIMCAR" |
| `client/src/dashboard/routes.ts` | `/dashboard/lotes` ↔ `simcar-lotes` |
| `client/src/dashboard/components/DashboardSidebarTabs.tsx` | Aba "Lotes" (ícone `FolderArchive`) |
| `client/src/pages/Dashboard.tsx` | `lazy()` + bloco `<Suspense>` da nova view |

### Infra

- `backend/local-storage.ts`: área `simcar-lotes/output` e coleção `simcar_lotes_jobs`.
- `backend/routes/_registry.ts`: `registerSimcarLotesRoutes`.
- `backend/app.ts`: 5 entradas novas em `AUTH_REQUIRED_PATHS` (todas as rotas exigem Firebase).

---

## Descobertas ao vivo (SEMA, 05/08/2026)

1. **`Publico/DownloadReciboCar` exige corpo.** Sem body a SEMA devolve
   **HTTP 411 Length Required**. O caminho bom é `POST` com `{}` e
   `Content-Type: application/json`.
2. **Layout do recibo no `pdf-parse`.** Rótulo e valor ficam em linhas separadas e
   as colunas vêm coladas:
   ```
   Nº CAR EstadualSituação EstadualTipo
   MT10005/2019AtivoDeclarado
   PropriedadeUFMunicípio
   LOTE RURAL 81MTQuerência
   ```
   Consequências no parser: lê a **linha seguinte** ao rótulo; o regex do CAR **não**
   pode terminar em `\b` (entre `2019` e `Ativo` não há fronteira de palavra); a UF
   é o **último** `MT` da linha, o que preserva propriedades cujo nome contém "MT".
3. **Id público = Id técnico.** `Publico/ListarRequerimento` para `MT10005/2019`
   devolve `Id: 470498` / `RId: 10005`; o `Id` é o `RequerimentoId` dos downloads.

---

## Comportamento

| Situação | Resultado |
|---|---|
| CAR sem "Arquivo Processado" (400) | Lote conclui com ⚠ faltante — não é erro |
| Recibo público indisponível | Fallback: cópia do PDF que o usuário enviou |
| CAR fora da conta técnica | Linha de erro no relatório; os outros lotes seguem |
| Cancelar no meio | ZIP parcial com os lotes concluídos + aviso no `RELATORIO.txt` |
| Conta em uso pelo oráculo | Espera na fila (120 s) e então erro "conta em uso" |
| PDF sem nº de CAR | Campo editável na tabela antes de baixar |

---

## Testes

`pnpm run check` + `pnpm run test` + `pnpm run build` verdes.

- **56 testes** em `backend/simcar-lotes/` (parser com o layout real, resolver com
  mock de fetch, downloader com 400/401/magic bytes/fallback, zip-builder, fila por
  conta e um **end-to-end de rota** com SEMA falsa: recibo → ZIP com as 3 pastas).
- **6 testes** novos em `backend/simcar-oraculo/client-session.test.ts` (sessão por
  credencial, single-flight, `getSimcarToken()` do env intacto).
- Suíte completa: **453 passed**.
- Smoke local: as 5 rotas novas respondem **401** sem token.

---

## Pendência operacional (não é do código)

A senha do SIMCAR em `~/.config/geoforest/backend.env` do PC servidor
(`SIMCAR_SENHA`, conta do oráculo) está **inválida**: a SEMA respondeu
`"Tentativa 2 de 3: após a 3ª tentativa de login inválido o usuário será suspenso."`
As sondas de login foram **interrompidas** para não suspender a conta.

Consequência: o teste end-to-end **ao vivo** com a conta técnica não foi executado.
O que foi validado ao vivo usa apenas a API **pública** (busca do requerimento e
download do recibo em PDF, 665 KB, conteúdo conferido). Os endpoints técnicos
(`DownloadArquivoEnviado`/`DownloadArquivoProcessado`) já estavam validados ao vivo
na bateria T9 do oráculo (doc 11) e aqui estão cobertos por testes com mock.

**Ação para o Álvaro:** atualizar `SIMCAR_SENHA` no `backend.env` do servidor e
rodar o fluxo manual da aba com um recibo real.
