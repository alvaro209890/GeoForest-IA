# Correções AUAS × SCCON — 2026-07-17

Auditoria da feature nova **AUAS × Alertas SCCON** (commit `91c4bfd2`). Duas
correções de alta severidade, ambas verificadas com dado real
(`.oraculo-scratch/santa_clara/v24/AUAS.*`) e testes de regressão.

## Fix #1 — Rotas AUAS sem autenticação (segurança)

**Sintoma:** `POST /api/auas-sccon/process` e `GET /api/auas-sccon/download/:jobId`
não estavam na allowlist do `requireAuth` (`backend/index.ts`) e os handlers
nunca checavam `req.authUid` — diferente de todas as rotas irmãs
(`processar-projeto`, `simcar-oraculo`). Resultado: endpoint público e pesado
(faz chamadas externas ao SCCON com o token da organização) aberto a abuso/DoS,
e o `downloadCache` era global (um usuário poderia baixar o ZIP de outro pelo UUID).

**Correção:**
- `backend/index.ts`: adicionadas `/api/auas-sccon/process` e
  `^/api/auas-sccon/download/[^/]+$` à allowlist do `requireAuth`.
- `backend/auas-sccon.ts`: `uidOf(req)` obrigatório nos dois handlers (401 sem
  sessão) e `downloadCache` passa a guardar o `uid`; o download só entrega o
  artefato ao dono (404 caso contrário, sem vazar existência).
- O frontend já enviava `Authorization: Bearer` — nenhuma mudança de client.

## Fix #2 — Corrupção do campo ABERTURA (perda de dado)

**Sintoma (reproduzido ao vivo):** shapefiles AUAS reais trazem `ABERTURA` como
campo **Date (`D`, largura 8, `YYYYMMDD`)**. A ferramenta grava a data como texto
`DD/MM/YYYY` reusando o field def original; para tipo `D`, o `buildDbfBuffer`
(`shapefile-writer.ts`) faz `replace(/\D/g, "")` e produz `"02072023"` (ordem
DDMMYYYY) num campo lido como `YYYYMMDD` → data inválida. **Exatamente os
polígonos atualizados saíam com a data destruída**; os não-tocados ficavam ok.

Antes do fix (12 de 34 feições corrompidas):

| ID | Data calculada | Gravado (D/8) | Lido pelo GIS |
|----|----------------|---------------|---------------|
| 2613856 | 02/07/2023 | `02072023` | inválida |
| 2614173 | 18/01/2026 | `18012026` | inválida |

**Correção (`backend/auas-sccon.ts`):**
- `coerceAberturaFieldToChar()`: no DBF de saída o campo ABERTURA é sempre
  emitido como **Char largura ≥10**, alinhado ao script Python.
- `parseAberturaToDate()` / `normalizeAberturaBr()`: interpretam qualquer formato
  de entrada (`YYYYMMDD`, `DD/MM/YYYY`, ISO) e normalizam todos os valores —
  tocados e não-tocados — para `DD/MM/YYYY`, mantendo o campo consistente.
- `buildSemAlertaPoints` também normaliza o ABERTURA dos pontos.

Depois do fix (mesmo dado real): esquema `{type:"C",length:10}`, valores
`"02/07/2023"`, `"15/06/2023"` etc. — sem corrupção.

## Verificação

- `backend/auas-sccon.test.ts`: novo teste de regressão que injeta ABERTURA
  Date/8 e exige saída Char + data correta (`17/03/2020`, `15/06/2023`).
- Suíte completa: 186 testes passando; `tsc --noEmit` limpo.
- Live: `runAuasSccon` ponta a ponta com AUAS real — SCCON OK (359 alertas), DBF
  de saída correto.

## Pendências conhecidas (não neste commit)

- #3 `fmtBr` das datas de alerta usa timezone local (possível off-by-one em
  `alertDetectedDate` date-only/midnight-UTC).
- #4 `ringsToWgsFeature` achata multi-parte/buracos num único Polygon → join
  espacial impreciso em AUAS multi-parte.
- #5 scripts Python: UTM 31982 hardcoded; `int(auas.at[idx,"ID"])` sem guard.
- #6 `waitBaseRef` desiste após ~15s; endpoints read-only do oráculo fora da fila serial.
