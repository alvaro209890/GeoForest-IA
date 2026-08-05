# 02 — Arquitetura

## Visão geral

```
┌─ Navegador (usuário GeoForest) ──────────────────────────────────────┐
│ SimcarLotesPanel: badge "SIMCAR: EM USO por X / LIVRE" (poll 15s)    │
│ job SSE: fases aguardando_simcar / sessao_interrompida visíveis      │
└───────────────┬─────────────────────────────────────────────────────┘
                │ HTTPS (Cloudflare Tunnel)
                ▼
┌─ PC servidor (geoforest-backend) ────────────────────────────────────┐
│ backend/simcar-lotes/                                                │
│  monitor.ts      → lê presence do monitor (REST, READ-ONLY)          │
│  aguardar.ts     → espera o SIMCAR ficar livre (poll, cancelável)    │
│  job.ts          → gate R1 + retry R3 (fases novas)                  │
│  routes.ts       → + GET /api/simcar-lotes/monitor-status            │
└──────┬──────────────────────────────┬───────────────────────────────┘
       │ HTTPS (REST, sem auth)       │ HTTPS (SEMA — como hoje)
       ▼                              ▼
┌─ Firebase RTDB monitor-car ──┐   ┌─ SEMA (tecnico.api) ─────────────┐
│ presence/simcar/clients      │   │ Autenticar / ListarRasc / Download│
│ (escrito SÓ pelo userscript) │   └───────────────────────────────────┘
└──────────────────────────────┘
```

**Regra de ouro (R2):** a seta para o RTDB do monitor é **só de leitura**. O GeoForest nunca faz `set/update/remove` em `presence/*`. O bot é invisível por construção: a presença só é escrita pelo userscript (navegador humano).

## Fluxo do job com o gate

```
process (202 {jobId})
 └─ runLotesJob
     ├─ lendo: extrai recibos (sem SEMA, sem monitor)
     ├─ [NOVO] aguardando_simcar: se monitor ocupado → espera (poll 15s)
     │      • progress: fase='aguardando_simcar', por='<who>', percent congelado
     │      • sai quando LIVRE ou cancelado (isCancelRequested)
     ├─ comSessaoExclusiva(cpf, senha):  [fila por conta — como hoje]
     │   ├─ [NOVO] re-checagem rápida do monitor (corrida) → se ocupou, espera mais
     │   ├─ login (getSimcarTokenFor)
     │   └─ por lote:
     │       ├─ resolverCar + baixarArtefatosDoLote   (retry 401 único interno)
     │       ├─ [NOVO] catch 401/403 após o retry interno:
     │       │    → fase 'sessao_interrompida' (por='<who>')  [R3]
     │       │    → clearSimcarTokenCache(chave)
     │       │    → aguardarSimcarLivre (mostra no front; espera)
     │       │    → re-tentar o MESMO lote (loop; ilimitado até cancelar)
     │       └─ relatório + pastas (lotes concluídos preservados)
     ├─ zipando → saveUserBuffer → concluido
     └─ (site fechado? job segue: sem subscriber o progress só persiste)  [R4]
```

## Decisões de desenho

| # | Decisão | Detalhe |
|---|---|---|
| G1 | Espera **fora** da fila da conta | `aguardarSimcarLivre` roda antes do `comSessaoExclusiva` — não segura posição na fila enquanto espera o monitor; a re-checagem interna cobre a corrida (livre → alguém loga antes de nós) |
| G2 | Retry em **granularidade de lote** | Lote falhou por interrupção → re-resolve + re-baixa o lote inteiro. Lotes já concluídos (`pastas[]`) não são refeitos |
| G3 | Interrupção detectada por **401/403 do `SimcarHttpError`** após o retry único do `withSimcarAuthRetryFor` | Se o 2º login também der 401, a SEMA está com sessão ativa de outro lugar → confere o monitor: ocupado → aguarda; livre → mesmo assim tenta de novo (loop) |
| G4 | **Fail-open** no monitor (erro de rede → trata como livre e segue) | Travar downloads porque o RTDB do monitor caiu seria pior; R3 protege o conflito real. Logar o erro |
| G5 | Cache curto da leitura do monitor (~5s) | Evita martelar o RTDB a cada chamada do badge; o poll do job (15s) é o ritmo principal |
| G6 | Sem novas dependências | REST via `fetch`; sem firebase-admin/sdk do monitor |

## Segurança

- O endpoint novo `GET /api/simcar-lotes/monitor-status` exige `requireAuth` (Firebase) → `AUTH_REQUIRED_PATHS`.
- Nenhuma credencial nova no servidor: o monitor é lido sem auth (leitura pública do RTDB, como o próprio site faz).
- Nada do monitor é persistido no GeoForest além do cache em memória (5s).
