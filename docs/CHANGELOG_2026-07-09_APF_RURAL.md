# GeoForest IA — APF Rural (Autorização Provisória de Funcionamento)

**Data:** 2026-07-09
**Branch:** `main`
**Repositório:** https://github.com/alvaro209890/GeoForest-IA
**Hosting publicado:** `https://ia-florestal.web.app` e `https://geoforest-admin.web.app`

---

## Resumo

Este release adiciona consulta e download de APF Rural (Autorização Provisória de Funcionamento) do portal da SEMA-MT, integrado à aba "Recibos" do Dashboard com sub-tabs SIMCAR e APF.

---

## Backend — APF Rural Scraping

Arquivo principal: `backend/apf-receipts.ts`

**Fonte:** Portal ASP.NET WebForms da SEMA-MT
```
https://monitoramento.sema.mt.gov.br/apfruralconsulta/index.aspx
```

**Novas rotas:**

| Método | Rota | Função |
|---|---|---|
| `POST` | `/api/apf/search` | Consulta APFs por CPF/CNPJ, CPF responsável, número APF ou número CAR |
| `GET` | `/api/apf/download` | Baixa PDF da APF ou do Termo |

**Detalhes de implementação:**

- **Scraping ASP.NET:** O portal APF não possui API REST. O módulo faz scraping completo do ciclo ASP.NET WebForms: GET inicial para VIEWSTATE, POST do formulário de busca, parse do Repeater de resultados, e POST de download com `__doPostBack`.
- Busca aceita: `cpfCnpj` (CPF ou CNPJ do proprietário), `cpfResponsavel` (CPF do responsável), `numeroApf` (formato `NNNNN/YYYY`), `carNumber` (CAR federal ou estadual), `carType` (FEDERAL/ESTADUAL).
- Download suporta 2 tipos de PDF: `type=apf` (APF Rural) e `type=termo` (Termo).
- APFs canceladas exibem aviso e bloqueiam download (portal SEMA não permite baixar APFs canceladas).
- Validação de PDF pelo header `%PDF-` antes de servir ao cliente.
- Rotas registradas em `backend/index.ts`.

---

## Frontend — ReceiptsHub com sub-tabs

Arquivos:

- `client/src/components/ReceiptsHub.tsx` (novo)
- `client/src/components/ApfReceiptDownloader.tsx` (novo)
- `client/src/pages/Dashboard.tsx` (modificado)

**Mudanças:**

- **ReceiptsHub** — wrapper com sub-tabs "SIMCAR" e "APF Rural" dentro da aba "Recibos".
- **ApfReceiptDownloader** — formulário completo de busca APF com campos: CPF/CNPJ proprietário, CPF responsável, número APF, CAR (federal/estadual).
- Cards de resultado com: número APF, status (colorido), imóvel, CAR, responsável, atividade, município, datas de emissão/validade/atualização.
- Status "CANCELADA" exibe alerta âmbar e bloqueia botões de download.
- Dois botões por APF: "APF PDF" (azul) e "Termo PDF" (verde).
- Dashboard importa `ReceiptsHub` no lugar de `SimcarReceiptDownloader` direto.

---

## Deploy executado

```bash
npm run build
firebase deploy --only hosting
```

Resultado:
- `ia-florestal`: 38 arquivos publicados em `dist/public`.
- `geoforest-admin`: 31 arquivos publicados em `dist/admin`.
- URLs: https://ia-florestal.web.app e https://geoforest-admin.web.app

---

## Backend local

O backend foi rebuildado e reiniciado na porta 3001:

```bash
npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
PORT=3001 NODE_ENV=production node dist/index.js
```

A API pública `https://geoforest-api.cursar.space` roteia via Cloudflare Tunnel para `localhost:3001`.

---

## Arquivos alterados

| Arquivo | Status |
|---|---|
| `backend/apf-receipts.ts` | **Novo** — módulo de scraping APF |
| `backend/index.ts` | Modificado — import + registro de rotas APF |
| `client/src/components/ApfReceiptDownloader.tsx` | **Novo** — componente React de consulta/download APF |
| `client/src/components/ReceiptsHub.tsx` | **Novo** — hub com sub-tabs SIMCAR/APF |
| `client/src/pages/Dashboard.tsx` | Modificado — import ReceiptsHub no lugar de SimcarReceiptDownloader |
| `docs/CHANGELOG_2026-07-09_APF_RURAL.md` | **Novo** — este documento |

---

## Observações

- O portal APF é ASP.NET WebForms puro (sem API REST) — o scraping é frágil e pode quebrar se a SEMA alterar a estrutura HTML do portal.
- Em caso de falha no scraping, verificar se os IDs do Repeater (`repeater_divApfInterno_`, `repeater_labApfNumero_`, etc.) foram alterados.
- APFs com status "CANCELADA" não permitem download — o portal da SEMA bloqueia o PDF nesse caso.
