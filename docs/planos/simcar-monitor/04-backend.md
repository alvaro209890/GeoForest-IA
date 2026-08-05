# 04 — Backend

## Arquivos novos

### `backend/simcar-lotes/monitor.ts` — leitura do monitor (READ-ONLY)

```ts
const MONITOR_RTDB_URL =
  process.env.SIMCAR_MONITOR_RTDB_URL ||
  "https://monitor-car-default-rtdb.firebaseio.com";
const STALE_MS = Number(process.env.SIMCAR_MONITOR_STALE_MS || 40_000);
const SKEW_MARGIN_MS = 10_000;

export interface MonitorSimcarStatus {
  ocupado: boolean;
  por?: string;
  desde?: number;
  conexoes: number;
  checadoEm: number;
  erro?: string;
}

/** Lê presence/simcar/clients (+ fallback current) e decide se o SIMCAR está em uso. */
export async function lerOcupacaoSimcar(): Promise<MonitorSimcarStatus> { … }

/** Cache em memória de ~5s (decisão G5) — usado pelo endpoint do painel. */
export async function lerOcupacaoSimcarCached(): Promise<MonitorSimcarStatus> { … }
```

- `fetch` nativo com `AbortSignal.timeout(10_000)`; `User-Agent` browser-like (a SEMA exige, o RTDB não liga — inofensivo).
- NUNCA escreve em presence (R2) — verificação por teste (doc 06).
- Regra de ocupação e fallback: doc 03.
- **Fail-open:** qualquer erro de rede/parse → `{ocupado: false, erro}` + `console.warn`.

### `backend/simcar-lotes/aguardar.ts` — espera cancelável

```ts
/**
 * Espera o SIMCAR ficar livre, reportando progresso SSE.
 * Roda em loop até: monitor LIVRE, ou job cancelado. Ilimitado (decisão D2).
 */
export async function aguardarSimcarLivre(args: {
  uid: string;
  jobId: string;
  motivo: "antes_de_logar" | "sessao_interrompida";
  por?: string;
}): Promise<{ interrompido: boolean }> {
  for (;;) {
    const status = await lerOcupacaoSimcar();
    if (!status.ocupado) return { interrompido: false };
    progress(args.uid, args.jobId, {
      status: "processing",
      fase: args.motivo === "sessao_interrompida" ? "sessao_interrompida" : "aguardando_simcar",
      por: status.por,
      message:
        args.motivo === "sessao_interrompida"
          ? `Sessão interrompida por ${status.por || "outro login"} — aguardando o SIMCAR ficar livre para continuar.`
          : `SIMCAR em uso por ${status.por || "outro usuário"} — aguardando ficar livre.`,
    });
    if (isCancelRequested(args.jobId)) return { interrompido: true };
    await sleep(POLL_MS); // 15s (SIMCAR_MONITOR_POLL_MS)
  }
}
```

## Mudanças em `backend/simcar-lotes/job.ts`

1. **Gate R1 — antes da fila** (topo do `runLotesJob`, após `lendo`):
   ```ts
   if (monitorHabilitado()) {
     await aguardarSimcarLivre({ uid, jobId, motivo: "antes_de_logar" });
     if (isCancelRequested(jobId)) { cancelado = true; break; }
   }
   ```
2. **Re-checagem R1 — dentro da fila** (início do callback do `comSessaoExclusiva`, antes do `login`):
   ```ts
   if (monitorHabilitado()) {
     const st = await lerOcupacaoSimcar();
     if (st.ocupado) await aguardarSimcarLivre({ uid, jobId, motivo: "antes_de_logar", por: st.por });
   }
   ```
3. **Retry R3 — interrupção por lote.** Envolver o corpo do `for` dos lotes com um laço de tentativas:
   ```ts
   let tentativas = 0;
   for (;;) {
     try {
       …resolver + baixarArtefatosDoLote (como hoje)…
       break; // lote ok
     } catch (error) {
       if (!isSessaoDerrubada(error)) throw error;          // erro normal (mensagemDeErro)
       tentativas += 1;
       const st = await lerOcupacaoSimcar();
       clearSimcarTokenCache(simcarCredentialKey(cpf, senha));
       const { interrompido } = await aguardarSimcarLivre({
         uid, jobId, motivo: "sessao_interrompida", por: st.por,
       });
       if (interrompido) { cancelado = true; break; }
       // loop → re-tenta o MESMO lote (granularidade G2)
     }
   }
   ```
   - `isSessaoDerrubada(error)`: `error instanceof SimcarHttpError && (status === 401 || status === 403)` (ou regex 401/403 — mesmo critério do `client.ts`).
   - O `withSimcarAuthRetryFor` interno (resolver/downloader) continua dando o 1º retry imediato; o 401 persistente cai aqui.
   - `isCancelRequested` também dentro do laço, a cada tentativa.

## Mudanças em `backend/simcar-lotes/routes.ts`

- Novo endpoint (requireAuth via `authUid`):
  ```ts
  app.get("/api/simcar-lotes/monitor-status", async (req, res) => {
    if (!authUid(req)) { res.status(401).json({ error: "Usuário não autenticado." }); return; }
    res.json({ ok: true, monitor: await lerOcupacaoSimcarCached() });
  });
  ```

## Mudanças em `backend/app.ts`

- `AUTH_REQUIRED_PATHS` += `"/api/simcar-lotes/monitor-status"`.

## Config (env do servidor — todas opcionais)

| Var | Default | Uso |
|---|---|---|
| `SIMCAR_MONITOR_ENABLED` | `"1"` | `"0"` desliga o gate (escape de emergência) |
| `SIMCAR_MONITOR_RTDB_URL` | `https://monitor-car-default-rtdb.firebaseio.com` | trocar o banco se um dia migrar |
| `SIMCAR_MONITOR_STALE_MS` | `40000` | janela de "vivo" (espelha o site) |
| `SIMCAR_MONITOR_POLL_MS` | `15000` | intervalo de verificação da espera |
| `SIMCAR_MONITOR_MAX_RETRY` | `0` (ilimitado) | teto de re-tentativas por lote após interrupção |

## Mensagens de erro novas (mapa)

| Condição | Mensagem |
|---|---|
| Monitor ilegível (fail-open) | nenhuma ao usuário; `console.warn` no servidor |
| Aguardando login | "SIMCAR em uso por <por> — aguardando ficar livre (o download continua em segundo plano mesmo se fechar esta página)." |
| Interrompido | "Sessão interrompida por <por> — o download vai continuar automaticamente quando o SIMCAR ficar livre." |
