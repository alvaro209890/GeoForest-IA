# Relatório fotográfico — 2026-11-24

> Autor: Cursor | 24/11/2026. Aba nova no painel. Quem entra no site não configura modelo nem chave.

## O que entrou

Aba **Fotos** (`/dashboard/fotos`). A pessoa escreve o objetivo do relatório, carrega até 50 fotografias e pode:

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


## Versão 2 — simples e didática (24/11/2026, tarde)

> Autor: Claude | 24/11/2026. Branch `feat/fotos-simples`.

**Lógica do relatório**

- A paginação agora é a da **Padronização IMAP 2026** do `Painel_Gerencial_IMAP_v5` (o bloco que, no fim do arquivo do painel, substitui o `planPages` antigo). A primeira versão tinha portado o `planPages` anterior: até duas linhas por página, medidas em polegadas e legenda 9 pt com espaçamento.
  - Duas fotos por página. Duas fotos em pé ficam lado a lado; qualquer outro par fica uma embaixo da outra.
  - Paisagem até 15 × 8,45 cm, retrato até 7,1 × 9,85 cm, topo a 4,55 cm.
  - Legenda "Figura N." em Arial 10 pt, centralizada, espaçamento simples, 0 pt antes e depois.
  - Tabela sem bordas e com margem de célula 0.
- A paginação passou a ser um módulo só, `shared/relatorio-fotografico/layout.ts`, usado pela prévia do painel e pelo Word. O antigo `backend/relatorio-fotografico/layout.ts` saiu.
- `limparLegenda` tira "Figura N." ou "Fig. N -" que a IA às vezes devolve, para não sair "Figura 1. Figura 1. …".
- Prompt da IA: explica o que é parcial e como o Word pagina, pede legenda no estilo de vistoria ("Vista parcial de …"), ordem de vistoria (acesso → estruturas → área objeto → detalhes) e motivo curto em linguagem simples para cada foto.
- A IA avisa a fase pelo SSE (`fase`: `recebidas`, `pensando`, `escrevendo`), pelo `onFase` do `collectOpenAiSse`.
- O navegador manda à IA uma cópia de 900 px de cada foto (antes, 1400 px). O Word continua recebendo a de 1400 px.

**Tela**

- Três passos numerados, com trilha no topo. O passo concluído ganha ✓.
- Passo 1 com exemplos de objetivo prontos para clicar.
- Passo 2: área de arrastar maior, miniatura da foto inteira com "Em pé"/"Deitada", desenho de como as fotos ocupam a página, e progresso da IA com relógio e as quatro fases.
- Fotos repetidas (mesmo nome e tamanho) são ignoradas. HEIC do iPhone recebe aviso para exportar em JPG. As fotos entram em ordem de nome.
- "Organizar eu mesmo" põe todas as fotos numa parcial só, com a legenda vazia para a pessoa escrever. Antes, o objetivo virava legenda.
- Passo 3:
  - Resumo da IA e explicação do que é parcial.
  - Cada parcial mostra a faixa de figuras ("Figuras 4 a 7"), sobe e desce, e pode ser apagada.
  - Cada foto mostra o número da figura e o motivo da IA.
  - "Fora do relatório" mostra o motivo, com "Pôr de volta em…".
  - Prévia das páginas no papel timbrado, ao lado. Botão "Baixar Word".
  - Aviso da parcial sem legenda.
- "Recomeçar" limpa tudo.

**Medido em 24/11/2026** com 24 fotos reais da Faz. Concórdia – Lote 142 (pendências 6382333/6382334, pomar), no backend local:

- A IA levou 348 s numa execução e 122 s na outra.
- Saíram 16 fotos em 4 ou 5 parciais, e 8 ficaram de fora, com motivo: tremida, contraluz, repetida, girada, antena.
- O Word teve 9 páginas, com capa e 8 páginas de 2 fotos.

## Versão 3 — quatro fotos em pé (24/11/2026)

> Autor: Cursor | 24/11/2026. Medido no `Relatório fotografico_MT_109 (1).pdf` (PEF da ponte na MT-109).

Fotos em pé saíam duas por página, lado a lado, com até 7,1 × 9,85 cm. No relatório da ponte são **quatro por página**: duas fileiras de duas, cada foto 170 × 283 pt (6 × 10 cm), centros a 7 cm e 15 cm da borda esquerda. A legenda fica acima da linha verde do rodapé (26,6 cm).

- Sequência de fotos em pé: de 4 em 4. Sobra de 1, 2 ou 3 na última página, no mesmo tamanho. A foto sozinha na fileira fica no centro da área útil (11 cm).
- Fotos deitadas seguidas: continuam duas por página, uma embaixo da outra, até 15 × 8,45 cm.
- Uma foto em pé isolada antes de uma deitada divide a página com ela.
- A prévia, o contador de páginas e o Word usam o mesmo `planPhotoPages`. O desenho do passo 2 mostra a grade de quatro.
- O prompt da IA pede para deixar as fotos em pé juntas, para a página encher.
- As duas fileiras saem na mesma tabela do Word. Em tabelas separadas, a fileira de baixo caía na página seguinte e o relatório voltava a ter duas fotos.

O relatório aceita até 50 fotografias. O corpo JSON do backend subiu de 25 MB para 48 MB, para o envio das 50 fotos caber numa requisição.
