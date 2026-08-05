# STATUS — Plano "Lotes SIMCAR"

| Campo | Valor |
|---|---|
| Status | **CONCLUÍDO** (implementado, testado e em produção) |
| Criado em | 2026-08-05 |
| Atualizado em | 2026-08-05 (fases 1–3 entregues + deploy) |
| Autor | Hermes (plano) · Claude (implementação), com Álvaro |
| Repo | `alvaro209890/GeoForest-IA` — branch `main` |
| Pasta | `docs/planos/simcar-lotes/` |
| Entregue em | `backend/simcar-lotes/` + `client/src/components/SimcarLotesPanel.tsx` |
| Doc | `docs/SIMCAR_LOTES.md` · Changelog: `docs/CHANGELOG_2026-08-05_SIMCAR_LOTES.md` |

## Progresso

- [x] Contexto levantado (vídeo 2026-08-05, acompanhamento-de-processos, doc 11 do oráculo)
- [x] Arquitetura e contrato SIMCAR mapeados
- [x] **Decisão A1** — artefatos por lote: `Arquivo Enviado.zip` + `Arquivo Processado.zip` + `Recibo de Inscrição.pdf`
- [x] **Decisão A5** — credenciais com chave própria `geoforest_simcar_credenciais_v1`
- [x] **Fase 1 — backend** (1.1–1.7): sessão por credencial, fila por conta, parser, resolver, downloader, zip, rotas + job SSE
- [x] **Fase 2 — frontend** (2.1–2.3): tipos/rotas/sidebar + `SimcarLotesPanel` com credenciais, análise, progresso e download
- [x] **Fase 3 — validação e docs**: 56 testes do módulo + 6 de sessão; suíte completa 453 verdes; `docs/SIMCAR_LOTES.md` + changelog
- [x] Deploy (doc 08): backend no PC servidor + frontend no Firebase Hosting

## Decisões restantes, resolvidas com os defaults do doc 09

| # | Decisão adotada |
|---|---|
| A2 | Cancelamento entrega **ZIP parcial** dos lotes concluídos + aviso no `RELATORIO.txt` |
| A3 | CAR não identificado → **campo editável** na tabela antes de baixar |
| A4 | Pasta do lote = `MT10005-2019 - LOTE_RURAL_81` |
| A6 | Só download pelo navegador (nenhuma pasta fixa no servidor) |

## Validação ao vivo (2026-08-05, conta técnica, CAR MT10005/2019)

Fluxo completo contra a SEMA real: login → `resolverCar` (`requerimentoId 10005`,
LOTE RURAL 81, Querência) → `Arquivo Enviado.zip` 32.803 B (156 shapefiles) +
`Arquivo Processado.zip` 36.954 B (148 arquivos) + recibo 665.078 B → ZIP final
654.219 B com a pasta `MT10005-2019 - LOTE_RURAL_81/` e `RELATORIO.txt`. Zero faltantes.

Descoberta que corrigiu a documentação: **os Ids técnico e público são diferentes**
(técnico 10005 via `ListarRasc`; público 470498 via `ListarRequerimento`, cujo `RId`
é 10005). Cada download usa o seu — o código já fazia as duas consultas separadas.

## Pendência operacional (fora do código, não afeta esta aba)

`SIMCAR_SENHA` do **oráculo** (CPF `04438470102`) no `~/.config/geoforest/backend.env`
segue **inválida** — a SEMA respondeu "Tentativa 2 de 3… o usuário será suspenso" e as
sondas foram interrompidas. O arquivo ficou como estava (backup
`backend.env.bak-2026-08-05`). A aba Lotes não depende disso (credencial vem do
usuário); o oráculo sim.

## Histórico

| Data | Evento |
|---|---|
| 2026-08-05 | Plano criado (status PLANEJADO) |
| 2026-08-05 | Decisões A1 (3 artefatos) e A5 (chave própria) fechadas |
| 2026-08-05 | Fases 1–3 implementadas, testadas e publicadas — status **CONCLUÍDO** |
