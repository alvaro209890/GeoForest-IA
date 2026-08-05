# 03 — Contrato SIMCAR (endpoints)

> Fonte: `docs/planos/simcar-oraculo-proxy/11-endpoints-sema-descobertos.md` (extraído do `bundle.js` do `tecnico.app` em 2026-07-16 + sondas ao vivo).
> Base: `https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api`
> Headers obrigatórios em tudo: `authorization: TECNICO …` (valor cru) + browser-like (User-Agent Chrome, `Origin`/`Referer` monitoramento.sema.mt.gov.br) — já em `backend/simcar-oraculo/client.ts`.

## Autenticação / listagem

| Endpoint | Método | Payload | Status |
|---|---|---|---|
| `Autenticacao/Autenticar` | POST | `{v: scramble(JSON.stringify({Login: cpf_só_dígitos, Senha, NovaSenha:""}))}` → `"TECNICO …"` | ✅ validado ao vivo |
| `Requerimento/ListarRasc` | POST | `{Filtros:{NUMERO: "MT10005/2019"}, ItensPorPagina:10, Pagina:1, IsOrdenarCrescente:false, ColunaOrdenar:"NumeroCompleto", Colunas:[]}` | ✅ validado no acompanhamento-de-processos (body genérico dá 400 — usar o body completo acima) |
| `Requerimento/Buscar/{id}` | GET | objeto completo do requerimento (contém `Arquivos[]` com `Descricao`/`Categoria`) | ✅ validado ao vivo |

## Downloads (escopo da decisão A1 — só 3 por CAR)

| Artefato | Endpoint | Autenticação | Status |
|---|---|---|---|
| **Arquivo Enviado.zip** | `Requerimento/DownloadArquivoEnviado/{id}` | técnica (`authorization`) | ✅ validado ao vivo (oráculo T9: 641 KB) |
| **Arquivo Processado.zip** | `Requerimento/DownloadArquivoProcessado/{id}` | técnica | ✅ validado ao vivo; **400 = CAR sem processamento** |
| **Recibo de Inscrição.pdf** | `Publico/DownloadReciboCar/{requerimentoId}` | **pública, sem login** | ✅ validado (`simcar-receipts.ts`); fallback: cópia do recibo enviado |

`{id}` = `RequerimentoId` resolvido via `ListarRasc` (doc 04 — resolver).

**Regra geral:** HTTP **400 = artefato não existe no estado atual → skip + registrar no relatório do lote** (o oráculo já confirmou esse comportamento). Validação de conteúdo: `%PDF` para PDFs, `PK\x03\x04` para Zips.

> **Fora de escopo (fase 2, se quiser):** relatórios de importação/processamento (`DownloadPdfImportacaoShapefile`, `DownloadPdfRelatorioProcessamento`), conferência, pendências, erros, abrangência, modelo, croquis e `BuscarPdfSolicitacao`. Os endpoints já estão catalogados no doc 11 do oráculo — nenhuma descoberta necessária para a fase 1.
