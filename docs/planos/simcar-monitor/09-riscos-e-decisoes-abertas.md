# 09 — Riscos e Decisões em Aberto

## Riscos (com mitigação)

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Monitor ilegível** (RTDB fora, regra mudou, rede) — se tratarmos como "ocupado" travamos downloads para sempre; se "livre", perdemos o gate | **Fail-open** (D4/G4): prossegue + `console.warn`; o mecanismo 401 (R3) continua protegendo o conflito real. Escape: `SIMCAR_MONITOR_ENABLED=0` |
| R2 | **Corrida**: monitor livre no check, humano loga antes do nosso login | Re-checagem dentro da fila (antes do login) + se cair no meio, o retry R3 cobre |
| R3 | **Skew de relógio** (lastSeen é timestamp do servidor RTDB; nosso relógio local) | Margem de +10s na janela (doc 03); janela total 50s ≫ skew típico |
| R4 | **Espera ilimitada** pode parecer "travado por bug" | UX explícita: banner + spinner pulsante + "continua em segundo plano"; cancelável |
| R5 | **Re-tentativa infinita** após interrupção com credencial quebrada (401 por senha errada, não por sessão) | `isSessaoDerrubada` só captura 401/403; senha errada dá 400 no login (não entra no loop). `SIMCAR_MONITOR_MAX_RETRY` como teto opcional |
| R6 | **Muitos jobs esperando** o mesmo SIMCAR livre | Fila por conta (`session-queue`) serializa depois do gate; esperas paralelas são inofensivas (não tocam a SEMA) |
| R7 | **Fantasmas no RTDB** acumulam (navegador morreu sem `onDisconnect`) | STALE já filtra; limpeza manual feita em 2026-08-05; cron de limpeza = fase 2 |
| R8 | **Oráculo** (`simcar-oraculo`) não respeita o monitor e disputa a mesma conta | Fora de escopo fase 1 — ver aberto A2 |

## Decisões em aberto (precisam do Álvaro)

| # | Pergunta | Default proposto |
|---|---|---|
| A1 | **Bot com conta diferente do CPF compartilhado**: esperar mesmo assim? (não dá para saber o CPF do humano pela presence; esperar é conservador) | Sim — sempre respeitar o monitor (conservador), independente da conta do bot |
| A2 | **Aplicar o mesmo gate ao oráculo** (credenciais do env, pipeline de processamento)? | Fora de escopo fase 1 — pode entrar depois com o mesmo `aguardarSimcarLivre` |
| A3 | **Limite máximo de espera** (ex.: 12 h) em vez de ilimitado? | Ilimitado (requisito R1/R4), cancelável pelo usuário |
| A4 | **Mostrar "aguardando desde <hora>"** no banner (usa `desde` do monitor)? | Sim, se `desde` existir; senão só a mensagem |
| A5 | **Limpeza automática de fantasmas** no RTDB (cron no servidor ou função do monitor)? | Fora de escopo fase 1 (não afeta o app — STALE filtra) |

## Fora de escopo (fase 2, se quiser)

- Gate para o oráculo (A2)
- Cron de limpeza de fantasmas (A5)
- Presença "bot" visível no monitor (proibido por R2 — nunca)
