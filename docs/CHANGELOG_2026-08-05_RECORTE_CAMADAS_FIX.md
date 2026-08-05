# CHANGELOG — 2026-08-05: Fix do recorte SIMCAR (camadas WFS + buffer)

## Problema

O sistema de recorte SIMCAR estava errado em produção:

1. **Fazia buffer na camada errada** — "AC" (AREA_CONSOLIDADA), APP e RESERVA_LEGAL
   recebiam o buffer de 500m que deveria ser só dos **rios**;
2. **Faltavam camadas no WFS** — o recorte puxava só 12 camadas (muitas com nomes
   inexistentes) em vez das **28 camadas** do Arquivo Modelo; rios e 13 outras
   camadas sumiam do resultado.

## Causa raiz

O commit `74a5c3b11` ("refactor: extrai types.ts e constants.ts do simcar-clip —
plano 02 passo 1", 2026-07-31) **inventou** os valores em vez de extrair os do
monólito `backend/simcar-clip.ts`:

| Constante | Valor correto (monólito) | Valor quebrado (74a5c3b11) |
|---|---|---|
| `TEMPLATE_LAYERS` | **28 camadas** (AIR, ATP, 5× RIO_*, ARL, ARLREM, AREA_UMIDA, AREA_DECLIVIDADE, BORDA_CHAPADA, AREA_TOPO_MORRO, AREA_ALTITUDE_1800, TIPOLOGIA_VEGETAL, MANGUEZAL, RESTINGA, VEREDA, INTERESSE_SOCIAL, UTILIDADE_PUBLICA, AREA_USO_RESTRITO, AUAS, AURD, AVN, AREA_CONSOLIDADA, NASCENTE, RESERVATORIO_ARTIFICIAL, LAGOA_NATURAL) | **12 camadas** com nomes inexistentes no template/WFS (`RESERVA_LEGAL`, `APP`, `HIDROGRAFIA`, `SERVIDAO_ADMINISTRATIVA`) |
| `RIVER_CLIP_LAYERS` | 5 rios: `RIO_ATE_10`, `RIO_10_A_50`, `RIO_50_A_200`, `RIO_200_A_600`, `RIO_ACIMA_600` | `APP`, `RESERVA_LEGAL`, `AREA_CONSOLIDADA` |

Como `clip-pipeline.ts` já importava essas constantes desde a extração, o recorte
ficou quebrado desde o Plano 02. As demais constantes (`DIRECT_COPY_LAYERS`,
`WHOLE_FEATURE_BUFFER_LAYERS`, `SPRING_LAYER_NAME`, `RIVER_CLIP_EXTENSION_METERS`,
WFS/cache) estavam corretas.

## Correções

### 1. `backend/simcar/constants.ts`

- `TEMPLATE_LAYERS` restaurado para as **28 camadas canônicas** do Arquivo Modelo
  (mesma ordem do monólito original);
- `RIVER_CLIP_LAYERS` restaurado para os **5 rios** (buffer de 500m só neles);
- comentário documentando a lista como canônica e o histórico do bug.

### 2. `backend/simcar/constants.test.ts` (novo — regressão)

5 testes que travam o comportamento:

- `TEMPLATE_LAYERS` tem exatamente as 28 camadas canônicas;
- não contém `RESERVA_LEGAL`/`APP`/`HIDROGRAFIA`/`SERVIDAO_ADMINISTRATIVA`;
- **cada camada do template tem `.shp` correspondente dentro do `Arquivo Modelo.zip`**
  (travado contra o arquivo real usado no recorte);
- `RIVER_CLIP_LAYERS` = só os 5 rios (e não contém APP/RL/AC), extensão 500m;
- categorias `DIRECT_COPY_LAYERS`/`WHOLE_FEATURE_BUFFER_LAYERS`/`SPRING_LAYER_NAME` intactas.

## Verificação

- `pnpm run check` (tsc --noEmit) ✅
- `pnpm run test` — 491 passed | 8 skipped (66 arquivos; +5 testes novos) ✅
- Deploy no PC servidor (`server-desktop`): `git pull` → `esbuild` → `systemctl --user restart geoforest-backend.service` → health OK ✅

## Ops

- Nenhuma env nova. A lista de camadas do front (checkbox `/api/simcar/layers`)
  passa a exibir as 28 camadas corretas automaticamente.
- Se a SEMA mudar o template, atualizar `Arquivo Modelo.zip` E rodar
  `pnpm run test` — o teste de regressão aponta imediatamente a divergência.
