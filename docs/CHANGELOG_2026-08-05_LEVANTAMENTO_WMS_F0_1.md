# 2026-08-05 — F0.1: levantamento WMS ao vivo (2009–2019 + cenas da Fase 3)

Tarefa **F0.1** do plano [`docs/planos/analise-pos-recorte/`](planos/analise-pos-recorte/INDEX.md) —
a que bloqueava as fases 2 e 3. Continua sendo **só descoberta**: nenhuma análise nova,
nenhuma chamada de IA, nenhuma rota nova.

## Entregas

| Arquivo | O que é |
|---|---|
| `backend/analise-pos-recorte/pos2008/catalog-discovery.ts` | Parte pura: lê o `GetCapabilities`, separa camada de estilo, monta a série ano a ano e calcula o `catalogVersion` |
| `scripts/levantamento-wms-pos-recorte.ts` | Levantamento ao vivo: `GetCapabilities` + um `GetMap` real por candidato, com tempo, dimensão e uniformidade |
| `docs/LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md` | O relatório gerado (entregável da F0.1) |
| `pnpm run wms:levantamento` | Atalho para reproduzir |

## O que o servidor da SEMA respondeu (2026-08-05)

**A série 2009–2019 está completa: 11 anos, todos com `GetMap` válido** (PNG 800×800,
não uniforme, 0,7–1,4 s por cena na bbox de teste). Nenhum ano ausente.

```
2009–2011  LANDSAT_5        2012  RESOURCESAT      2013–2018  LANDSAT_8      2019  SENTINEL_2
```

Duas correções ao que o plano supunha:

1. **2018 também tem Landsat 8.** O doc 03 dizia que 2018 só existia em Sentinel-2, o
   que colocava a troca de sensor "entre 2016 e 2018". Mantendo L8 enquanto ele existe,
   as fronteiras reais são **2012, 2013 e 2019** — três, todas registradas pelo catálogo
   (`sensorBoundary`).
2. **NIR é estilo, não camada.** `Mosaicos:Geoportal_Sentinel_2_2021_NIR` aparece dentro
   de `<Style>` no capabilities; pedi-lo em `layers` devolve
   `ServiceException code="LayerNotDefined"` (confirmado ao vivo). O jeito certo é
   `layers=Mosaicos:SENTINEL_2_<ano>&styles=<estilo NIR>` — validado com
   `Mosaicos:SENTINEL_2_2025` + `Geoportal_Sentinel_2_2025_NIR`. Existem estilos NIR de
   2016 a 2025, e **o prefixo do workspace varia** (2016–2018, 2020 e 2021 vêm como
   `Mosaicos:Geoportal_…`; 2019 e 2022–2025 vêm sem prefixo) — não dá para montar esse
   nome por concatenação, tem que ler do capabilities.

Por isso `buildWmsGetMapUrl` ganhou um parâmetro opcional `styles`, e o
`SIMCAR_AC_VEG_SCENE_NIR` do doc 08 virou o par
`SIMCAR_AC_VEG_SCENE_NIR_LAYER` + `SIMCAR_AC_VEG_SCENE_NIR_STYLE`.

As cenas da Fase 3 (`Mosaicos:SENTINEL_2_2024`, NIR e `Mosaicos:MOSAICO_SPOT_SEPLAN`)
responderam todas.

## Decisão A2 continua com o Álvaro

2016, 2017 e 2018 têm **dois mosaicos** (Landsat 8 e Sentinel-2). O catálogo **não
decide**: escolhe L8 por padrão — o que mantém a série contínua e deixa só três trocas
de sensor — e devolve o Sentinel-2 como `alternates`, trocável por env sem mexer em
código. Escolher S2 em 2016/2017 antecipa a fronteira e cria uma quarta.

## Testes

`backend/analise-pos-recorte/pos2008/catalog-discovery.test.ts` — 15 testes offline, com
fixture que reproduz os nomes reais (inclusive os blocos `<Style>`): série sem lacuna,
fronteiras de sensor, ano ausente virando `missing`, override por ano, `catalogVersion`
estável e sensível, e o caso que motivou a correção — nome dentro de `<Style>` não pode
virar camada.

Gate da rodada: `pnpm test` (**564 testes passando**, 8 pulados), `pnpm run check` e
`pnpm run build` verdes; o levantamento rodou de verdade contra a SEMA duas vezes
(antes e depois da correção do NIR). Nesta execução a suíte terminou **sem** os 3
`[vitest-worker]: Timeout calling "onTaskUpdate"` de `backend/processar-projeto.test.ts`
mencionados no changelog anterior — confirmando que são intermitentes (o arquivo leva
40–83 s por teste e às vezes estoura o RPC do worker), não regressão.

## Próximo passo

As decisões **A1–A4** do [doc 11](planos/analise-pos-recorte/11-riscos-e-decisoes-abertas.md),
que agora dá para responder com número na mão: início da série (2009 × 2008), sensor de
2016–2018, limiar de vegetação na AC e teto de polígonos por job. Só depois a F2.1
(catálogo com TTL em runtime) começa.
