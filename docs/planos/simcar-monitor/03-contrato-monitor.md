# 03 — Contrato do Monitor SIMCAR (RTDB)

> Validado ao vivo em 2026-08-05 (leitura REST sem auth; DELETE usado para limpar fantasmas).

## Endpoints REST

| Endpoint | Método | Retorno |
|---|---|---|
| `https://monitor-car-default-rtdb.firebaseio.com/presence/simcar/clients.json` | GET | `{<uid>: {<connId>: {who, since, lastSeen, href, ua}}}` ou `null` |
| `https://monitor-car-default-rtdb.firebaseio.com/presence/simcar/current.json` | GET | `{status, lastSeen, graceUntil, who}` ou `null` (legado; hoje `null`) |
| `…/clients/<uid>/<connId>.json` | DELETE | `null` (sem auth — usado apenas em limpeza manual) |

> ⚠️ O GeoForest **nunca** usa o DELETE nem escreve em presence (R2). O DELETE acima é documentado apenas como referência de limpeza manual.

## Regra de ocupação (espelha o site do monitor)

```
ocupado = existe client com (agoraServidor - lastSeen) <= STALE_MS + MARGEM_SKEW
```

| Parâmetro | Valor | Origem |
|---|---|---|
| `STALE_MS` | 40 000 (40 s) | `index.html` do monitor (constante no site) |
| Margem de skew de relógio | +10 s (50 s no total) | lastSeen é timestamp do servidor RTDB; nosso relógio local pode diferir alguns segundos |
| `POLL_MS` (intervalo de verificação do job) | 15 000 (15 s) | heartbeat do userscript é 20 s; 15 s garante detectar LIVRE em ~2 ciclos |
| Cache do `monitor-status` (endpoint do painel) | 5 s | evita martelar o RTDB |

## Formato do resultado (interno ao GeoForest)

```ts
interface MonitorSimcarStatus {
  ocupado: boolean;
  por?: string;        // who do client mais recente (rótulo humano, ex.: "Bruno")
  desde?: number;      // since (ms) do client mais recente
  conexoes: number;    // clients vivos
  checadoEm: number;   // Date.now() local
  erro?: string;       // presente quando o monitor não respondeu (fail-open)
}
```

## Casos de borda

| Caso | Comportamento |
|---|---|
| `clients.json` → `null` (vazio) | `ocupado: false` |
| Todos os clients com `lastSeen` velho (fantasmas) | `ocupado: false` (STALE filtra — como o site faz) |
| `clients` vazio mas `current` legado com `status:"online"` fresco | `ocupado: true` (fallback do site) |
| Rede/erro 5xx ao ler o RTDB | `ocupado: false, erro: "monitor indisponível"` (fail-open — decisão G4) |
| Dois clients vivos | `ocupado: true`, `por` = o de `lastSeen` mais recente (mesmo critério do site) |

## Limpeza de fantasmas

- Fenômeno: `onDisconnect().remove()` do userscript não roda quando o navegador morre sem aviso → entrada eterna no RTDB.
- O site já as ignora (stale), então **não há bug**; mas acumulam.
- Ação pontual feita em 2026-08-05: apagados 2 fantasmas (Bruno ~49 d, anônimo ~176 d) via DELETE REST.
- Fora de escopo: rotina automática de limpeza (cron) — pode virar fase 2 (documentado no doc 01).
