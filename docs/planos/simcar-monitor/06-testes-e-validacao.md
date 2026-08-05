# 06 — Testes e Validação

## Unit (Vitest — mesmo diretório do módulo)

| Arquivo | O que cobre |
|---|---|
| `backend/simcar-lotes/monitor.test.ts` | Mock de `fetch`: clients com `lastSeen` recente → `ocupado:true` + `por` (o mais recente); velho/vazio/null → `ocupado:false`; fallback `current` quando `clients` vazio; erro de rede → fail-open `{ocupado:false, erro}`; **prova de R2**: varrer o código-fonte do módulo e assertar que não há `set|update|remove|push|DELETE` para presence (teste de superfície) |
| `backend/simcar-lotes/aguardar.test.ts` | Fake de `lerOcupacaoSimcar` sequencial: ocupado→ocupado→livre → resolve; `isCancelRequested` true no meio → `{interrompido:true}`; progress chamado com `fase` e `por` corretos; `por` ausente → mensagem com fallback "outro usuário" |
| `backend/simcar-lotes/job.test.ts` (novo) | **R1:** monitor ocupado no início → job fica `aguardando_simcar` e só loga após liberar (fake de client: `getSimcarTokenFor` só é chamado depois do monitor livre). **R3:** `SimcarHttpError` 401 no 2º lote (após retry interno) → fase `sessao_interrompida`, token cache limpo, `aguardarSimcarLivre`, re-tentativa do mesmo lote com sucesso; lotes anteriores preservados no ZIP. **R4:** job conclui sem subscriber de SSE (progress só persiste) |
| `backend/simcar-lotes/routes.test.ts` | `monitor-status`: sem auth → 401; com auth → `{ok, monitor}` com shape; cache de 5s (2 chamadas → 1 fetch) |

> `job.test.ts` hoje não existe? Verificar (`ls backend/simcar-lotes`); se não, criar. Os testes de job existentes usam mocks de `client`/`session-queue` — seguir o padrão.

## Live (opt-in, guard `SIMCAR_LIVE=1` — convenção do repo)

| Teste | O que valida |
|---|---|
| `live-monitor.test.ts` | Lê o RTDB real: se ninguém usando → `ocupado:false`; shape correto |
| e2e manual | Com monitor livre: job roda normal. Abrir SIMCAR num navegador com userscript + logar com o CPF compartilhado **no meio** de um download de N lotes → front mostra interrupção; sair do SIMCAR → job retoma sozinho |

> Rodar live com `--no-file-parallelism` (sessão única da SEMA).

## Validação manual (aceite)

1. Monitor livre → job normal (sem mudança de comportamento percebida além do badge).
2. Logar no SIMCAR (navegador com userscript, CPF compartilhado) → badge vira EM USO em ≤15 s; iniciar download → job entra em "aguardando", barra parada com banner; sair do SIMCAR → em ≤30 s o job começa sozinho.
3. No meio de um download de 3+ lotes, logar no SIMCAR → banner "sessão interrompida por <você>"; sair → job retoma do lote interrompido; ZIP final contém todos os lotes.
4. Fechar a página durante a espera → reabrir → job ainda "aguardando"/processando com progresso atualizado; ao concluir, ZIP disponível no histórico.
5. `monitor-car.web.app` nunca mostra "GeoForest" (R2) — conferir durante os testes 2–3.

## Comandos

```bash
pnpm run check && pnpm run test && pnpm run build
```
