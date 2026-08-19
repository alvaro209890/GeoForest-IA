# 2026-08-19 — Download ZIP CBERS + exemplo de CAR estadual

(autor: Grok | 2026-08-19)

## Contexto

O clone de produção no server (`/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`)
estava no mesmo commit do GitHub `origin/main` (`0ea2e632`). O job CBERS
`0d292649-187e-4890-820c-273b12a61d57` concluiu hoje um GeoTIFF de **~6,2 GB**.

Na aba CBERS, clicar em **Baixar ZIP** não baixava nada. O placeholder do
campo "Nº do CAR estadual" mostrava o número **federal** do SICAR
(`MT-5107768-XXXXXXX...`).

## Causa do ZIP que não baixa

Três problemas se somavam:

1. **O clique não virava GET.** Em 14 dias de log do `geoforest-backend.service`
   não houve nenhum `GET /api/cbers-wpm/wms-download`. O botão "Baixar ZIP"
   era um `<span>` (ou um `a.click()` feito em JS) **dentro de um `<button>`**
   de card. HTML não permite controle interativo aninhado; o navegador engolia
   o clique. O `download` programático em URL **cross-origin**
   (`ia-florestal.web.app` → `geoforest-api.cursar.space`) também é ignorado
   pelo Chrome.

2. **O caminho que ainda usava `fetch` + `blob()` não serve para este arquivo.**
   `downloadSimcarZip` baixava o ZIP inteiro para a RAM. Uma folha CBERS-4A/WPM
   no acervo tem 4,5–6,6 GB. O `HEAD` do endpoint respondia 200; o `GET` via
   blob nunca virava arquivo no disco.

3. **Timeout do Node 18+.** `server.requestTimeout` default é 5 minutos.
   Um ZIP de vários GB pelo tunnel estoura esse teto no meio do stream.

O endpoint em si estava saudável: `HEAD` local e público
`https://geoforest-api.cursar.space/api/cbers-wpm/wms-download?imageId=…`
devolve 200 com `Content-Disposition: attachment` e 2 arquivos no ZIP
(GeoTIFF + sidecar).

## Correção

- Botões de ZIP da aba CBERS viraram **`<a href>` reais** para
  `/api/cbers-wpm/wms-download`, com `stopPropagation` no card.
  O clique do usuário é quem dispara o GET; o navegador grava o anexo
  direto no disco, sem carregar 6 GB na RAM.
- `downloadSimcarZip` detecta URLs de raster WMS (`cbers-wpm/wms-download`,
  `landsat/wms-download`, `/api/raster/`) e também usa download nativo,
  não `fetch`+`blob`.
- `server.requestTimeout = 0` e `req/res.setTimeout(0)` na rota de ZIP.
  Headers `Cache-Control: no-store` e `X-Accel-Buffering: no`.
- Placeholder do CAR: `Ex: MT274719/2025` (estadual SIMCAR), com texto
  explícito para não usar o federal SICAR.

## Como conferir

1. Aba CBERS → cena com "Disponível no WMS" → **Baixar ZIP**.
   O navegador deve iniciar o download (vários GB; demora).
2. Job concluído → **Baixar cena em ZIP** na coluna da direita: mesmo comportamento.
3. Campo "Nº do CAR estadual" mostra `Ex: MT274719/2025`.
4. `journalctl --user -u geoforest-backend.service` passa a registrar
   `GET /api/cbers-wpm/wms-download` depois do clique.
