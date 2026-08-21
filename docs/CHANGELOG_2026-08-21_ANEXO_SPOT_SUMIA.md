# CHANGELOG — O SPOT 2008 sumia do Anexo Fotográfico

**Data:** 2026-08-21
**Achado em:** laudo real de produção, job `8d67f503` (21/08/2026, 09:08 -03)
**Arquivo:** `backend/simcar/report.ts`

## Sintoma

O laudo saiu com **4 figuras** — Landsat 2003, 2004, 2005 e 2006 — e **sem o
SPOT 2008**, que é a cena de maior peso probatório do laudo inteiro (2,5 m de
resolução, base da Nota Técnica 001/2017/CGMA/SRMA/SEMA-MT e do marco do art.
3º, IV). Faltavam também 2007 e o Landsat 2008.

## O que o banco e o storage mostraram

A análise estava **correta e completa**. O documento do job traz as 7 cenas, com
a janela nova funcionando em produção:

```
analysisImages: 7
  Landsat 5 (2003) … (2004) … (2005) … (2006) … (2007) … (2008)
  SPOT 2008 — Visão Geral (AC + AVN + AUAS)
satelliteVerdicts: todos os 7 com status "used"
analysisRulesVersion: acavn-fixed-v5
```

E os 7 arquivos estavam íntegros e acessíveis (HTTP 200, de 392 KB a 1,2 MB) —
inclusive o SPOT. **Nada falhou no pipeline de análise nem no storage.** O
problema estava só na hora de escolher o que ia para o anexo.

## Causa

`selectPrincipalReportImages` pontuava as cenas por **palavra na legenda**:

| Regra | Pontos |
|---|---|
| legenda contém "Visão Geral" ou "context" | +5 |
| legenda cita AC / AVN / AUAS / ARL | +3 |
| legenda cita SPOT / Landsat / Sentinel | +1 |

Isso discriminava enquanto cada satélite gerava **3 vistas** com legendas
distintas ("Visão Geral", "Somente AC", "Somente AVN"). Desde o commit
`0e429b3b`, cada satélite gera **um único composite** rotulado
`"<sensor> — Visão Geral (AC + AVN + AUAS)"`.

Resultado: as três regras passam a valer para **todas** as imagens. Medido com
as legendas reais do job:

```
9  Landsat 5 (2003) — Visão Geral (AC + AVN + AUAS)
9  Landsat 5 (2004) …
9  Landsat 5 (2005) …
9  Landsat 5 (2006) …
9  Landsat 5 (2007) …
9  Landsat 5 (2008) …
9  SPOT 2008        …
```

Todas empatadas em 9. O `sort` é estável, então virou no-op, e o `.slice(0, 4)`
manteve as **quatro primeiras por ordem de array** — os anos mais antigos. O
SPOT, que fica no fim do array, era descartado.

**Por que só apareceu agora:** com a janela antiga (2006, 2007, SPOT, 2008) eram
4 cenas e o corte de 4 não cortava nada. A expansão para 2003–2008 (7 cenas),
feita no commit `af447922`, transformou um empate inofensivo num descarte
silencioso — e logo da cena mais importante.

É a **mesma família** do bug de `reduceImageSet` corrigido no mesmo dia:
heurística baseada em legenda que parou de discriminar depois do refactor de
composite único. Corrigi um e não procurei o irmão.

## Correção

1. **Ordem por peso probatório**, não por texto:
   1. SPOT 2008 (2,5 m, Nota Técnica 001/2017);
   2. a cena do marco (2008);
   3. a cena de 2003 (marco do pousio quinquenal);
   4. o resto por ano decrescente — o ano mais próximo do marco decide primeiro.

2. **Teto que cabe a janela inteira:** `AC_AVN_FIGURE_LIMIT = 8` (a janela tem
   7) e `AUAS_FIGURE_LIMIT = 5`. Cortar cena da série temporal esconde
   justamente a evidência que data a conversão.

3. **Fim da omissão silenciosa.** Cena que não desce vinha sendo pulada sem
   qualquer registro, e se todas falhassem o anexo simplesmente não existia. O
   laudo agora imprime um box amarelo dizendo quais cenas ficaram de fora e que
   a análise as considerou mesmo assim.

## Verificação

Regerei o anexo com as **URLs reais** das 7 cenas do job `8d67f503`:

| | Antes | Depois |
|---|---|---|
| Figuras no anexo | **4** | **7** |
| SPOT 2008 presente | não | **sim** |
| Tamanho do PDF | 2,0 MB | 3,9 MB |

`backend/simcar/report-figures.test.ts` — **8 testes** com as legendas exatas do
job de produção: o SPOT entra, entra em primeiro, a janela inteira cabe, os
marcos sobrevivem quando o corte é necessário, as cenas de AUAS não disputam
vaga com as de AC/AVN, e URL duplicada/vazia é descartada.

Suíte completa: **767 passed / 8 skipped, 0 falhas**. `tsc --noEmit` e
`pnpm run build` verdes.

## Para o laudo já gerado

O job `8d67f503` continua com as 7 imagens salvas — basta **Regerar** o laudo na
aba para o PDF sair completo. Nenhum dado precisa ser reprocessado.

## Nota sobre o DOCX

O DOCX **não traz anexo fotográfico**, por decisão registrada em
[`CHANGELOG_2026-08-21_LAUDO_DOCX_E_JANELA_2003.md`](CHANGELOG_2026-08-21_LAUDO_DOCX_E_JANELA_2003.md):
embutir os PNGs dobraria o tamanho do arquivo que o responsável técnico vai
editar. O PDF segue sendo a peça com as imagens. Se a preferência mudar, o anexo
é replicável em `report-docx.ts` com o mesmo `selectPrincipalReportImages`.
