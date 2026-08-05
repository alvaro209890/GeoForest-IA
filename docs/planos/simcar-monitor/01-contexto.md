# 01 — Contexto

## O Monitor SIMCAR por dentro (verificado em 2026-08-05)

### Componentes

| Peça | Onde | Papel |
|---|---|---|
| Site "IMAP • Status SIMCAR" | `monitor-car.web.app` (repo local `C:\GIS\Monitor_SIMCAR` + cópia no OneDrive) | Painel público: bolinha **EM USO** (vermelha) / **LIVRE** (verde) + quem está usando |
| Userscript "SIMCAR - Presença" v2.4.1 | Tampermonkey, instalado nos navegadores da equipe (fonte: `Monitor_SIMCAR/Script_e_site.docx` no OneDrive) | Detecta login com o **CPF compartilhado** e marca presença no RTDB enquanto a aba do SIMCAR estiver aberta |
| Firebase RTDB | projeto `monitor-car` → `monitor-car-default-rtdb.firebaseio.com` | Estado: `presence/simcar/clients` |

### Contrato do presence (userscript)

```jsonc
// presence/simcar/clients.json
{
  "<uidAnonimoFirebase>": {
    "<connId>": {
      "who": "Bruno",                       // rótulo que o usuário digitou (prompt)
      "since": 1781700000000,               // ServerValue.TIMESTAMP do primeiro set
      "lastSeen": 1781716256846,            // heartbeat a cada 20s (ServerValue.TIMESTAMP)
      "href": "https://monitoramento.sema.mt.gov.br/simcar/tecnico.app/...",
      "ua": "Mozilla/5.0 ..."
    }
  }
}
```

- **Online** = qualquer client com `lastSeen` a menos de **40 s** (STALE_MS no site).
- Fallback legado: `presence/simcar/current` `{status, lastSeen, graceUntil, who}` (hoje `null`).
- **Fantasmas:** quando o navegador morre sem rodar `onDisconnect().remove()` (PC desligado, crash, aba morta), a entrada fica no RTDB **para sempre** — o site a ignora (stale), mas ela acumula. Em 2026-08-05 haviam 2 fantasmas (Bruno, ~49 dias; outro, ~176 dias) — **apagados** com DELETE REST (sem auth). Nada a corrigir no app: o STALE já filtra.

### Acesso REST (validado ao vivo)

```
GET  https://monitor-car-default-rtdb.firebaseio.com/presence/simcar/clients.json   → objeto | null
GET  .../presence/simcar/current.json                                                → objeto | null (legado)
DELETE .../presence/simcar/clients/<uid>/<connId>.json                                → null (sem auth, usado p/ limpeza)
```

## Estado atual do simcar-lotes (implementado — base deste plano)

| Peça | Arquivo | Comportamento atual |
|---|---|---|
| Rotas | `backend/simcar-lotes/routes.ts` | `parse-recibos`, `process` (startJob + job `void` em background), `jobs/:id/status`, `jobs/:id/events` (SSE + heartbeat 15s), `download/:jobId`, `DELETE jobs/:id` (cancelamento com ZIP parcial) |
| Job | `backend/simcar-lotes/job.ts` | `comSessaoExclusiva` (fila por conta, timeout 120s) → login → por lote: `resolverCar` + `baixarArtefatosDoLote` → `montarZipLotes` → `saveUserBuffer`. Fases: `lendo`, `login`, `resolvendo`, `baixando`, `zipando`, `concluido`, `cancelado`, `erro` |
| Sessão | `backend/simcar-oraculo/client.ts` | `getSimcarTokenFor(cpf, senha)` (cache por credencial, single-flight), `withSimcarAuthRetryFor` (401 → re-loga 1× e repete; 2º 401 propaga) |
| Fila | `backend/simcar-lotes/session-queue.ts` | `comSessaoExclusiva` por chave de credencial; timeout da fila 120s → `CONTA_EM_USO` |
| Downloads | `backend/simcar-lotes/downloader.ts` | 3 artefatos (A1): Enviado/Processado (sessão técnica) + Recibo (API pública, fallback cópia); 400/404 = `faltantes` |
| Persistência | `backend/simcar-lotes/sse.ts` | `progress()` grava em `users/<uid>/simcar_lotes_jobs/<jobId>` + emite SSE; job segue sem subscriber (R4 já satisfeito) |
| Front | `client/src/components/SimcarLotesPanel.tsx` | Credenciais (chave própria), dropzone, análise, job com `FASE_LABEL`, histórico/cards no servidor |

## Requisitos → onde encaixam

| Requisito | Ponto de encaixe |
|---|---|
| R1 (aguardar livre antes de logar) | `job.ts`: antes do `comSessaoExclusiva` + re-checagem dentro da fila, antes do `login` |
| R2 (invisível) | Nenhuma escrita em presence — garantir por construção (`monitor.ts` só lê) + teste |
| R3 (interrupção → mostrar → retomar) | `job.ts`: capturar 401/403 após o retry único → fase `sessao_interrompida` → `aguardarSimcarLivre` → re-tentar o lote |
| R4 (continua com site fechado) | Já funciona (job `void` + persistência); falta garantir re-anexação no painel e testar |

## Fora de escopo (fase 2, se quiser)

- Gate de ocupação para o **oráculo** (`simcar-oraculo`, credenciais do env) — mesmo problema, outro consumidor
- Limpeza automática de fantasmas no RTDB (cron) — STALE já filtra a exibição
- Mostrar o bot como "EM USO (GeoForest)" no monitor — proibido por R2
