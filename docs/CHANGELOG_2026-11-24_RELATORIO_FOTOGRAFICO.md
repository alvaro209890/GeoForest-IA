# Relatório fotográfico — 2026-11-24

> Autor: Cursor | 24/11/2026. Aba nova no painel. Quem entra no site não configura modelo nem chave.

## O que entrou

Aba **Fotos** (`/dashboard/fotos`). A pessoa escreve o objetivo do relatório, carrega até 30 fotografias e pode:

- pedir ao DeepSeek v4.1 Flash que veja as fotos, escolha quais entram, a ordem e a legenda;
- ou usar todas, sem IA, com o objetivo como legenda.

O download é um Word no modelo oficial da IMAP (capa, retrato em pares, paisagem em linha própria). O nome do arquivo é o do empreendimento.

## IA

Igual ao Optimus-geo: OpenCode Go pelo 9Router da VPS.

| | |
|---|---|
| Endereço | `http://100.104.255.35:20128/v1` |
| Modelo | `ocg/deepseek-v4.1-flash` |
| Raciocínio | `max` |
| Stream | ligado (sem stream o raciocínio longo estoura o primeiro byte e o 9Router devolve 503) |

Endereço, modelo e esforço ficam no código (`backend/relatorio-fotografico/ninerouter.ts`). A chave não é pedida no painel. O backend lê, nesta ordem:

1. `NINEROUTER_API_KEY` do ambiente (o `backend.env` do systemd, se estiver preenchida);
2. `~/.config/geoforest/backend.env`;
3. `/srv/optimus-geo/optimus-geo.env` e `/srv/optimus-geo/hermes/.env`;
4. `/srv/optimus/hermes-optimus/.env`;
5. o `.env` do Hermes local (`%LOCALAPPDATA%\hermes\.env` ou `~/.hermes/.env`).

No server-desktop, em 24/11/2026, a chave estava nos arquivos do Optimus e do Hermes, e o `backend.env` do GeoForest seguia sem ela. O código usa a do Optimus.

## API

As duas rotas exigem login e entram no balde de rotas caras.

| Método | Rota | Resposta |
|--------|------|----------|
| POST | `/api/relatorio-fotografico/analisar` | SSE com a seleção |
| POST | `/api/relatorio-fotografico/docx` | `.docx` |

O cliente reduz a foto (lado maior 1400 px) antes de enviar. O servidor gira pelo EXIF, achata o fundo branco e gera um JPEG menor para a IA e outro para o Word.

## Arquivos

- `backend/relatorio-fotografico/` — layout, seleção, chamada ao 9Router, fotos e Word
- `backend/relatorio-fotografico/assets/modelo-relatorio-fotografico.docx` — modelo IMAP
- `client/src/components/RelatorioFotograficoPanel.tsx` — painel
- `client/src/dashboard/routes.ts` — `/dashboard/fotos`
- `config/geoforest-backend.env.example` — variáveis opcionais

## Publicação

O backend de produção é `node dist/index.js` (`geoforest-backend.service` no server-desktop). O `geoforest-autosync.timer` está desligado desde 16/10/2026, então push no `main` não publica sozinho: `git pull`, `npm run build`, `firebase deploy --only hosting` e `systemctl --user restart geoforest-backend.service`.

Quem abre o site não precisa de Ctrl+F5. O `index.html` e o `version.json` saem com `Cache-Control: no-cache`; os bundles têm hash. Aba já aberta compara o `buildId` (`client/src/lib/autoUpdate.ts`) e recarrega uma vez.

## Prova local (24/11/2026)

Três fotos de teste, objetivo de porteira, sede e vegetação. A seleção respondeu em 6,2 s com três parciais (porteira, sede, vegetação nativa) e o modelo `ocg/deepseek-v4.1-flash · raciocínio max`. O Word gerado tinha as três figuras e as duas seções do modelo.
