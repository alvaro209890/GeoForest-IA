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

---

# Rodada 2 (2026-07-18) — precisão de data/join + robustez

## Fix #3 — Datas de alerta em UTC (evita off-by-one)

`fmtBr` usava getters locais; `new Date(alertDetectedDate)` com data pura
(`2020-03-17`) ou `Z` cairia no dia anterior em fuso negativo (Cuiabá UTC-4).
Agora `fmtBr` usa `getUTC*` e `parseAberturaToDate` constrói via `Date.UTC(...)`
— calendário UTC determinístico, independente do fuso do servidor. Teste de
regressão com alerta `2020-03-17T00:00:00Z` → `17/03/2020`.

## Fix #4 — Multi-parte/buracos no spatial join

`ringsToWgsFeature` empilhava todos os anéis num único Polygon: a 2ª casca de
uma feição multi-parte virava "buraco" e alertas sobre ela eram perdidos. Novo
`recordToWgsFeature` usa a classificação por profundidade de
`ringGroupsForRecord` (`vertices-proximas.ts`) para montar **MultiPolygon**
correto (cascas + buracos nas suas cascas). Teste com feição de dois quadrados
disjuntos: alerta na 2ª parte agora é detectado.

## Fix #5 — Scripts Python

- `gerar_pontos_sem_alerta.py`: `utm_epsg_for()` escolhe a zona UTM (20/21/22S)
  pela longitude do centroide em vez de `31982` fixo → `area_ha` correta no
  oeste de MT.
- `atualizar_datas_auas_sccon.py`: guarda a coluna `ID` (`has_id`) antes de
  `int(...)` → sem `KeyError` em AUAS sem campo `ID`.

## Fix #8 — Login SIMCAR concorrente

`getSimcarToken` (`simcar-oraculo/client.ts`) agora coalesce logins simultâneos
num único `loginInFlight`: endpoints read-only fora da fila serial não disparam
mais um 2º login que invalidaria a sessão única em uso por um pipeline.

## Revisado — sem alteração

- **#6/#7 `waitBaseRef`**: o retorno após 3 polls nulos é calibração deliberada
  (`null` = SEMA sem processamento ativo; preparação real reporta `[EXECUTANDO]`
  e é aguardada até `[CONCLUIDO]`). Forçar carência penalizaria todo job. Mantido.

## Verificação rodada 2

- 6 testes em `auas-sccon.test.ts` (2 novos: multi-parte e UTC); suíte total
  **188 passando**, `tsc` limpo, Python `py_compile` OK.
- Live: `runAuasSccon` com AUAS real segue OK (12/34 datadas, ABERTURA C/10).

## Pendências restantes

Nenhuma da lista original. Melhorias futuras possíveis (não bugs): rotear os
endpoints read-only do oráculo pela fila serial além do dedup de login; testes
E2E automatizados do AUAS com fixtures multi-parte/hole reais.
