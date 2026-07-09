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
- Busca aceita: `cpfCnpj` (CPF ou CNPJ), `cpfResponsavel` (CPF do responsável), `numeroApf` (formato `NNNNN/YYYY`), `carNumber` (CAR federal/estadual), `carType` (FEDERAL/ESTADUAL, default **ESTADUAL**).
- **Postback de rádio:** Quando `carType=ESTADUAL`, o módulo primeiro faz um postback `rblNumeroCar$1` para trocar o radio button e obter o VIEWSTATE atualizado antes de submeter a busca.
- Download suporta 2 tipos de PDF: `type=apf` (APF Rural) e `type=termo` (Termo).
- APFs canceladas exibem aviso e bloqueiam download (portal SEMA não permite baixar APFs canceladas).
- Validação de PDF pelo header `%PDF-` antes de servir ao cliente.
- Rotas registradas em `backend/index.ts`.

**Correções (v2):**
- Default do CAR alterado de FEDERAL para **ESTADUAL** (99% dos CARs em MT são estaduais).
- Adicionado postback de troca de rádio FEDERAL→ESTADUAL antes da busca por CAR.
- Parsing dos resultados reescrito com abordagem por índices (mais robusto que regex lazy).
- Download agora aceita `carNumber` e `carType` como query params.

---

## Frontend — ReceiptsHub com sub-tabs

Arquivos:

- `client/src/components/ReceiptsHub.tsx` (novo)
- `client/src/components/ApfReceiptDownloader.tsx` (novo)
- `client/src/pages/Dashboard.tsx` (modificado)

**Mudanças:**

- **ReceiptsHub** — wrapper com sub-tabs "SIMCAR" e "APF Rural" dentro da aba "Recibos".
- **ApfReceiptDownloader** — formulário de busca APF com campos: CPF/CNPJ, CPF responsável, número APF, CAR (select ESTADUAL por padrão).
- Cards de resultado com: número APF, status (colorido), imóvel, CAR, responsável, atividade, município, datas.
- Status "CANCELADA" exibe alerta âmbar e bloqueia botões de download.
- Dois botões por APF: "APF PDF" (azul) e "Termo PDF" (verde).
- Select CAR padrão **Estadual** (primeira opção).

---

## Testes realizados

| Teste | Resultado |
|---|---|
| `POST /api/apf/search` com CAR `MT226703/2022` | ✅ 3 APFs encontradas (1 REGULAR, 2 CANCELADA) |
| `GET /api/apf/download` APF 21844/2025 (REGULAR) | ✅ PDF 800KB, 2 páginas, válido |
| TypeScript check (`tsc --noEmit`) | ✅ Zero erros |
| Build completo (`npm run build`) | ✅ Frontend + Admin + Backend |
| Firebase deploy | ✅ ia-florestal (38 files) + geoforest-admin (31 files) |

---

## Deploy executado

```bash
npm run build
firebase deploy --only hosting
systemctl --user restart geoforest-backend.service
```

Resultado:
- `ia-florestal`: 38 arquivos publicados.
- `geoforest-admin`: 31 arquivos publicados.
- Backend local reiniciado via systemd na porta 3001.
- URLs: https://ia-florestal.web.app e https://geoforest-admin.web.app
- API: https://geoforest-api.cursar.space

---

## Arquivos alterados

| Arquivo | Status |
|---|---|
| `backend/apf-receipts.ts` | **Novo** — módulo de scraping APF |
| `backend/index.ts` | Modificado — import + registro de rotas APF |
| `client/src/components/ApfReceiptDownloader.tsx` | **Novo** — componente React de consulta/download APF |
| `client/src/components/ReceiptsHub.tsx` | **Novo** — hub com sub-tabs SIMCAR/APF |
| `client/src/pages/Dashboard.tsx` | Modificado — import ReceiptsHub |
| `docs/CHANGELOG_2026-07-09_APF_RURAL.md` | Este documento |

---

## Observações

- O portal APF é ASP.NET WebForms puro — o scraping depende dos IDs do Repeater (`repeater_divApfInterno_`, `repeater_labApfNumero_`, etc.). Se a SEMA alterar a estrutura, o parsing quebra.
- A troca de rádio FEDERAL→ESTADUAL exige um postback extra (`rblNumeroCar$1`) para obter VIEWSTATE válido.
- O backend usa `systemctl --user restart geoforest-backend.service` — NÃO matar o processo manualmente.
- APFs com status "CANCELADA" não permitem download — o portal da SEMA bloqueia nesse caso.
