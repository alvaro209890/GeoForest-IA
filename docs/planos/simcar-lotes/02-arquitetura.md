# 02 — Arquitetura

## Visão geral

```
┌────────────────────────────  Navegador (usuário)  ────────────────────────────┐
│  Aba "Lotes SIMCAR" (SimcarLotesPanel.tsx)                                     │
│  • credenciais SIMCAR (CPF/senha) → localStorage (como acompanhamento)         │
│  • dropzone: recibo(s) PDF ou ZIP                                              │
│  • "Analisar recibos" → lista lotes detectados (via backend)                   │
│  • "Baixar documentos" → SSE de progresso → link do ZIP final                  │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ HTTPS (Cloudflare Tunnel)
               ▼
┌────────────  PC servidor (server-desktop, IP Brasil) — geoforest-backend  ────┐
│  backend/simcar-lotes/                                                         │
│  ├─ index.ts          rotas: parse-recibos, process (SSE), download/:jobId     │
│  ├─ recibo-parse.ts   pdf-parse → nº CAR estadual/federal + propriedade        │
│  ├─ resolver.ts       nº CAR → Requerimento Id (ListarRasc / público)          │
│  ├─ downloader.ts     baixa artefatos do CAR (client.ts)                       │
│  └─ zip-builder.ts    archiver → pasta por lote → ZIP único                    │
│  └─ (refactor) backend/simcar-oraculo/client.ts → sessão por credencial        │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │ HTTPS + CORS liberado (a SEMA reflete a origem)
               ▼
┌────────────  SEMA-MT (monitoramento.sema.mt.gov.br/simcar/tecnico.api/api)  ──┐
│  Autenticacao/Autenticar · Requerimento/ListarRasc · Requerimento/Download*    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Por que o backend faz as chamadas e não o navegador?** Pedido explícito ("ele vai rodar no pc backend do server") + o backend do PC servidor **já fala com a SEMA** (IP brasileiro, exigência da SEMA) pelo `simcar-oraculo`. As credenciais do usuário viajam por requisição (HTTPS/Cloudflare) e **nunca são persistidas** no servidor.

## Fluxo detalhado do job

### Fase 0 — Analisar recibos (sem tocar na SEMA)
1. `POST /api/simcar-lotes/parse-recibos` `{zipBase64}`
2. `extractZipEntries` (reusa `backend/geo-utils.ts`) → filtra `*.pdf` (aceita aninhamento; dedupe por nome)
3. Para cada PDF: `pdf-parse` → regex de "Nº CAR Estadual" (`MT\d+/\d{4}`) ou "Nº Recibo Federal" (`MT-\d{7}-[A-F0-9]{20,}`) + propriedade/município
4. Retorna `[{filename, carEstadual, reciboFederal, propriedade, municipio}]` — a UI mostra os lotes detectados antes de qualquer login

### Fase 1 — Processar (job SSE)
1. `POST /api/simcar-lotes/process` `{zipBase64, cpf, senha}` (Firebase auth) → `202 {jobId}` (padrão `croqui.ts`)
2. Job em background:
   - `startJob({uid, endpoint: "/api/simcar-lotes/process"})`
   - Login SIMCAR **uma vez por job** com as credenciais do usuário (cache/single-flight por par credencial no `client.ts`)
   - Para cada recibo (na ordem de chegada):
     - **Resolver:** `Requerimento/ListarRasc` com `Filtros:{NUMERO}` (body do acompanhamento) → re-filtra `NumeroCompleto` exato → `RequerimentoId`
       - Se só tiver recibo federal: `Publico/ListarRequerimento` com `Filtros:{NUMERO_CAR_FERERAL}` (já existe em `simcar-receipts.ts`) → `NumeroCompleto` estadual → `ListarRasc`
     - **Baixar artefatos** (decisão A1 — só 3 por CAR): `Arquivo Enviado.zip` + `Arquivo Processado.zip` via sessão técnica (`simcarDownload`), `Recibo de Inscricao.pdf` via API **pública** (`Publico/DownloadReciboCar/{id}`, sem login — padrão da aba Recibos; fallback: cópia do PDF enviado); **400 = ausente → skip + registro**
     - **Montar pasta do lote** `<CAR> - <Propriedade>/` com: `Arquivo Enviado.zip`, `Arquivo Processado.zip`, `Recibo de Inscricao.pdf` (baixado ou cópia do enviado)
   - `archiver` → `lotes_simcar_<timestamp>.zip` gravado em `LOCAL_DATA_ROOT` (helpers `saveUserBuffer`/`STORAGE_ROOT` de `backend/local-storage.ts`)
   - `finishJob({jobId, status:"completed"})`
3. Progresso SSE: `{type:"progress", loteAtual, totalLotes, artefatoAtual, totalArtefatos, baixados, faltantes[]}` + heartbeat 15s
4. `GET /api/simcar-lotes/download/:jobId` → ZIP (Content-Disposition)

## Sessão SIMCAR — regras (crítico)

- **1 sessão por conta** (SEMA). O `client.ts` hoje tem cache global (`tokenCache`) da conta do env (`SIMCAR_CPF/SIMCAR_SENHA` do oráculo).
- **Refactor:** cache vira `Map<chaveCredencial, {token, expiresAtMs}>` + single-flight **por chave**:
  - `getSimcarToken(cpf?, senha?)` → usa env quando omitido (oráculo não muda)
  - `getSimcarTokenFor(cpf, senha)` → sessão do usuário do lote
- **Mutex por chave:** fila serial para chamadas da mesma conta dentro do processo (o job de lotes espera a vez; timeout com erro claro "conta SIMCAR em uso pelo oráculo/outro job").
- 401 → `withSimcarAuthRetry` (já existe) re-loga e repete 1×.

## Segurança

- Credenciais: só `localStorage` no navegador; no backend vivem **na memória do job** (não logar, não persistir, não ir para Firestore).
- Rotas protegidas por `requireAuth` (Firebase) — adicionar em `AUTH_REQUIRED_PATHS` (`backend/app.ts`).
- ZIP de saída sob `LOCAL_DATA_ROOT` por usuário (`users/<uid>/simcar_lotes/<jobId>.zip`), mesma política dos outros módulos.
