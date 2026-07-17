# 01 — Arquitetura (v2: ORACULO-only)

## Contexto atual (repo GeoForest-IA)

| Peça | Caminho / fato |
|------|----------------|
| Backend Express | `backend/index.ts` (rotas oráculo registradas em :697; paths públicos :544-552) |
| Módulo oráculo (P0/P1/P3 prontos) | `backend/simcar-oraculo/` |
| Fluxo local a REMOVER do produto | `backend/processar-projeto.ts` (`runImportPhase`/`runProcessPhase` como veredito) |
| Detectores calibrados (ficam p/ aba Erros de Geometria) | `backend/geometry-errors.ts` |
| Jobs + SSE | `backend/processing-jobs.ts` |
| Storage local JSON | `backend/local-storage.ts` (⚠️ whitelist de coleções) |
| Front da aba | `client/src/components/ProcessarProjetoAnalysis.tsx` + wiring em `client/src/pages/Dashboard.tsx` |
| Contrato SEMA | **`11-endpoints-sema-descobertos.md`** (canônico) |
| CAR-teste | **270069** Santa clara / Querência (decisão D1) |
| Backend em produção | PC servidor + Cloudflare Tunnel → `geoforest-api.cursar.space` (front `ia-florestal.web.app`) |

## Diagrama

```
[Browser (Firebase Auth)]
   │  upload ZIP (base64)                       ┌──────────────────────────────┐
   ▼                                            │        PC servidor           │
[POST /api/processar-projeto/upload] ──────────►│ shape-context (local):       │
   │                                            │  bbox/centroid/camadas       │
   │                                            │  município (malha IBGE MT)   │
   ▼                                            └──────────────┬───────────────┘
[POST /api/simcar-oraculo/pipeline {uploadId}]                 │ fila serial (1 sessão)
   │            SSE /jobs/:id/events                           ▼
   │◄───────timeline por etapas────────┐        ┌──────────────────────────────┐
   ▼                                   │        │ SIMCAR tecnico.api (SEMA)    │
[Timeline no front]                    │        │ 1 login → token 25min        │
   • na fila                           │        │ 2 Buscar 270069              │
   • conferindo município              ├────────│ 3 SalvarGrupoPropriedade*    │
   • ajustando abrangência + BaseRef   │        │ 4 SalvarAreaAbrangencia*     │
   • enviando ZIP                      │        │   └ poll BaseRefStatus       │
   • importando na SEMA                │        │ 5 Arquivo/Upload + Importar  │
   • processando na SEMA               │        │   └ poll ImportacaoShape*    │
   • baixando artefatos                │        │ 6 ProcessarGeo (se import OK)│
   ▼                                   │        │   └ poll Processamento*      │
[Resultado + downloads SEMA]           │        │ 7 Download PDFs/ZIPs         │
[✨ Corrigir e reenviar (≤3 rodadas)]──┘        └──────────────────────────────┘
        │ *só se necessário
        ▼
[autofix: parse PDF → FixPlan (DeepSeek V4 Pro explica) → ações mecânicas → corrigido_rN.zip]
        │
        └────────────► reentra no passo 5 (e 6) automaticamente
```

## O que MORRE (decisão D2 — remover de vez)

| Antes | Depois |
|-------|--------|
| `PROCESSAR_MODE` LOCAL/ORACULO/HYBRID | **some** — a aba só tem o fluxo SIMCAR; sem credencial, rotas respondem 503 `SIMCAR_NOT_CONFIGURED` e o front mostra aviso |
| `POST /api/processar-projeto/importar` rodando `runImportPhase` | rota removida (ou 410 Gone apontando p/ pipeline) |
| `POST /api/processar-projeto/processar` rodando `runProcessPhase` | idem |
| Gate `assertImportAllowsProcess` + fallback auto-import local (processar-projeto.ts:1654-1665) | removidos |
| PDF de importação "estilo SEMA" gerado pelo GeoForest (`import-report-pdf.ts`) no fluxo da aba | substituído pelo PDF REAL da SEMA (o gerador pode ficar no repo p/ outros usos, sem rota na aba) |
| Seções de "relatório local" no front | removidas |

**Permanece intacto:** aba Erros de Geometria (`geometry-errors.ts` + rotas `/api/geometry-errors/*`),
`shapefile-writer.ts`, `vertices-proximas.ts` — o autofix (P5/P6) usa essas primitivas como
**motor de correção**, nunca como veredito.

## Job de pipeline (estados)

```
queued → preparing (município/abrangência) → basref_wait → uploading → importing
  → import_ok | import_fail
  → (se ok e autoProcess) processing → process_ok | process_fail
  → (se fail e autofix disponível e rodada < 3) fixing → uploading … (loop)
  → done | failed | cancelled
```

Persistência: doc `["users", uid, "simcar_oraculo_jobs", jobId]` com `timeline[]` acumulada
(append de verdade — bug P1.5), `rounds[]` (um por rodada de autofix, com zip + resultado),
`artifacts{}` (paths relativos + urls tokenizadas).

## Fila serial

`enqueueSimcar` (já existe, `queue.ts`) continua obrigatório para TODO acesso SEMA —
uma sessão por conta. O pipeline INTEIRO de um job roda dentro de um único `enqueueSimcar`
(login→prepare→import→process→downloads), para outro usuário não intercalar mutações no
mesmo CAR-teste. Rodadas de autofix re-enfileiram (deixam outros jobs passarem entre rodadas).

**Consequência de produto:** o CAR-teste é um recurso global compartilhado. 2 usuários
simultâneos = fila (posição mostrada no front). Timeout de fila configurável.

## Storage de artefatos (por job)

```
STORAGE_ROOT/users/{uid}/simcar-oraculo/{jobId}/
  r1/enviado.zip                       # ZIP da rodada (r1 = original do usuário)
  r1/relatorio_importacao_sema.pdf
  r1/relatorio_processamento_sema.pdf  # se chegou a processar
  r1/erros_processamento_sema.zip      # se a SEMA gerou
  r1/arquivo_processado_sema.zip       # opcional (400 = ausente)
  r1/arquivo_conferencia_sema.zip      # opcional
  r1/arquivo_pendencias_sema.zip       # opcional
  r2/corrigido.zip                     # rodada de autofix
  r2/fixplan.json                      # ações aplicadas + explicação DeepSeek
  ...
  job.json                             # snapshot final (status/timeline/rounds)
```
