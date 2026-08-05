# Plano — Aba "Lotes SIMCAR" (download automático de documentos do CAR)

> **Status:** ✅ CONCLUÍDO — implementado, testado e em produção (2026-08-05).
> Código: `backend/simcar-lotes/` + `client/src/components/SimcarLotesPanel.tsx`.
> Doc de referência: [`docs/SIMCAR_LOTES.md`](../../SIMCAR_LOTES.md) ·
> Changelog: [`docs/CHANGELOG_2026-08-05_SIMCAR_LOTES.md`](../../CHANGELOG_2026-08-05_SIMCAR_LOTES.md).
>
> **Data:** 2026-08-05
> **Autor:** Hermes (plano) · Claude (implementação), com Álvaro
> **Repo:** `alvaro209890/GeoForest-IA` — branch `main`

---

## Objetivo (1 frase)

Nova aba no GeoForest-IA onde o usuário arrasta o **recibo de inscrição do CAR** (1 PDF ou um ZIP com vários), o sistema **loga no SIMCAR técnico** com as credenciais informadas pelo usuário (salvas no navegador dele, como no sistema de acompanhamento-de-processos), **baixa os documentos do projeto de cada CAR** (Arquivo Enviado, Arquivo Processado, relatórios, croquis etc.) e devolve **um ZIP único com uma pasta por lote**.

## Fluxo do usuário (o que o vídeo de 2026-08-05 mostra, automatizado)

```
1. Abre a aba "Lotes SIMCAR" no GeoForest
2. Informa CPF + senha do SIMCAR (conta técnica — "login da Pamera") → salvo no navegador (localStorage)
3. Arrasta o(s) recibo(s): "CAR - Recibo de Inscrição ...pdf" (1 arquivo) ou um ZIP com vários recibos
4. Clique em "Analisar recibos" → o sistema extrai o nº do CAR de cada recibo e lista os lotes detectados
5. Clique em "Baixar documentos do lote" → barra de progresso (login → lote 1/N → baixando arquivo X/M)
6. Recebe um link para baixar `lotes_simcar_<data>.zip` com uma pasta por lote:
   ├── MT10005-2019 - LOTE_RURAL_81/
   │   ├── Arquivo Enviado.zip
   │   ├── Arquivo Processado.zip
   │   └── Recibo de Inscricao.pdf   (baixado do SIMCAR; fallback: cópia do recibo enviado)
   └── MT319367-2025 - FAZENDA_X/
       └── ...
```

## Decisões-chave já fechadas

| # | Decisão | Justificativa |
|---|---|---|
| D1 | **O trabalho pesado roda no backend** (PC servidor Linux, `server-desktop`), não no navegador | Pedido explícito do Álvaro; o backend já fala com a SEMA (IP Brasil) pelo `simcar-oraculo` |
| D2 | **Credenciais do usuário**: digitadas na UI, salvas em `localStorage` do navegador (**chave própria `geoforest_simcar_credenciais_v1`** — sem compartilhar nada com o acompanhamento-de-processos), enviadas por requisição ao backend e **nunca persistidas** no servidor | GeoForest é sistema separado; decisão A5 |
| D3 | **Reuso máximo do código existente**: `client.ts` do simcar-oraculo (login/retry/download) + `pdf-parse` + `archiver` — **nenhuma dependência nova** | Endpoints de download já validados ao vivo (doc 11 do plano oraculo) |
| D4 | **Pasta do lote** = `<CAR> - <Propriedade>` sanitizado | Nome legível e único; propriedade vem do recibo |
| D5 | **Artefatos por lote (decisão A1):** `Arquivo Enviado.zip`, `Arquivo Processado.zip` e `Recibo de Inscrição.pdf` — o recibo é **baixado do SIMCAR** (`Publico/DownloadReciboCar`, sem login, já usado na aba Recibos); se o download falhar, usa-se **cópia do recibo enviado** | Só o que a IMAP arquiva hoje; nada de relatórios/croquis por enquanto |
| D6 | Artefato ausente (HTTP 400 da SEMA) **não falha o lote** — pula e reporta | CAR em cadastramento não tem "Arquivo Processado"; é normal |

## Índice do plano

| Arquivo | Conteúdo |
|---|---|
| [01-contexto-e-objetivo.md](01-contexto-e-objetivo.md) | Problema, vídeo, o que já existe no repo e no acompanhamento-de-processos |
| [02-arquitetura.md](02-arquitetura.md) | Desenho geral: backend faz o trabalho, fluxo, sessão SIMCAR |
| [03-contrato-simcar.md](03-contrato-simcar.md) | Endpoints da SEMA: validados (tabela) + a confirmar (croquis/solicitação) |
| [04-backend.md](04-backend.md) | Módulo backend: arquivos, rotas, jobs SSE, refactor do `client.ts` |
| [05-frontend-ux.md](05-frontend-ux.md) | Aba nova, credenciais, dropzone, progresso, download |
| [06-testes-e-validacao.md](06-testes-e-validacao.md) | Unit, live opcional, frontend |
| [07-tarefas-implementacao.md](07-tarefas-implementacao.md) | Tarefas bite-sized em ordem (TDD, commits) |
| [08-deploy-e-ops.md](08-deploy-e-ops.md) | SSH `server-desktop`, build, restart, Firebase |
| [09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md) | Riscos (sessão única SEMA etc.) e perguntas em aberto |

## Verificação rápida (critérios de aceite)

- [x] Arrastar 1 recibo PDF → pasta do lote com os documentos do CAR
- [x] Arrastar ZIP com N recibos → N pastas num ZIP único
- [x] Credenciais salvas no navegador e reutilizadas (sem redigitar)
- [x] CAR sem algum artefato não falha o lote (relatório mostra o que faltou)
- [x] Progresso visível por lote/arquivo + cancelamento preservando o que já baixou
- [x] `pnpm run check` + `pnpm run build` verdes; testes unitários passando (56 do módulo, 453 na suíte)

> ⚠️ O e2e **ao vivo** com a conta técnica ficou pendente: `SIMCAR_SENHA` no
> `backend.env` do PC servidor está inválida (ver STATUS.md).
