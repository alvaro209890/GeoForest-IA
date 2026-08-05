# 09 — Riscos e Decisões em Aberto

## Riscos (com mitigação)

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Sessão única SEMA**: oráculo (env) e aba Lotes usando a **mesma conta** se derrubam mutuamente (401 no meio) | Refactor do `client.ts` (sessão por credencial) + mutex por conta (`session-queue.ts`) + retry 401 único + mensagem clara "conta em uso" |
| R2 | **Credenciais transitam** navegador → backend (mesmo sendo só em memória) | HTTPS obrigatório (Cloudflare Tunnel); nunca logar/persistir; rotas com `requireAuth`; escopo: sistema interno |
| R3 | **SEMA muda endpoint/contrato** (já mudou no passado) | Endpoints centralizados no doc 03/11; testes live com guard `SIMCAR_LIVE`; se um endpoint mudar, atualizar os dois docs |
| R4 | **Lote grande** (N CARs × 3 artefatos × até 300s) → job longo | Job SSE com heartbeat 15s + progresso por lote/artefato; cancelamento entrega ZIP parcial (lotes concluídos) |
| R5 | **400 da SEMA = artefato ausente** confundido com erro | Skip + `faltantes[]` no relatório; UI mostra ⚠ por lote |
| R6 | **Recibo federal vs estadual** com layouts diferentes | Dois padrões de regex + fallback genérico; resolver usa público (`NUMERO_CAR_FERERAL`) quando só tem federal |
| R7 | **PDF parse falha** (recibo escaneado sem texto) | Mensagem por arquivo ("não foi possível identificar o CAR"); campo editável na UI (ver aberto A3) |
| R8 | **Mojibake/encoding** em arquivos gerados no Windows | Nomes de pasta/arquivo via `safeFilename` (normalização NFD); revisar com `search_files pattern='Ã'` antes do commit |

## Decisões fechadas (2026-08-05)

| # | Decisão |
|---|---|
| A1 | **Baixar só 3 artefatos por lote:** `Arquivo Enviado.zip`, `Arquivo Processado.zip` e `Recibo de Inscrição.pdf` (recibo via API pública; fallback = cópia do recibo enviado). Relatórios/croquis/etc. ficam para fase 2 |
| A5 | **Credenciais com chave própria** `geoforest_simcar_credenciais_v1` — GeoForest é sistema separado; nada compartilhado com o acompanhamento-de-processos |

## Decisões em aberto (precisam do Álvaro)

| # | Pergunta | Default proposto |
|---|---|---|
| A2 | **Cancelamento**: entregar ZIP parcial dos lotes concluídos? | Sim (marcado `cancelado`) |
| A3 | **CAR não identificado no recibo**: permitir digitar/editar o nº do CAR na tabela antes de baixar? | Sim (campo editável) |
| A4 | **Pasta do lote**: `<CAR> - <Propriedade>` serve? (ex.: `MT10005-2019 - LOTE_RURAL_81`) | Sim |
| A6 | **Onde salvar o ZIP**: só download pelo navegador (default) ou também gravar em pasta fixa no servidor (ex.: `~/GeoForest/lotes/`)? | Só download (YAGNI) |

## Fora de escopo (fase 2, se quiser)

- Agendamento ("baixar lotes de X em X horas")
- Salvamento direto no OneDrive / pasta do lote
- Leitura de lote a partir de planilha/lista de CARs (sem recibo)
- Fila de jobs persistente entre reinícios do backend
