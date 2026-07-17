# AUAS × Alertas SCCON — Datação automática de ABERTURA

Módulo que **data automaticamente** os polígonos AUAS (Área de Uso Alternativo
do Solo / SIMCAR) cruzando-os com os **alertas de desmate** da plataforma
pública SCCON (SEMA-MT), e gera um shape de **pontos das AUAS sem alerta**.

- Dashboard SCCON: <https://alertas.sccon.com.br/matogrosso/#/dashboard/view-map>
- Aba no sistema: **AUAS** (`/dashboard/auas`)
- Documentação de origem (referência Python): [`../Automacao_AUAS/`](../Automacao_AUAS/)

## O que faz

1. Usuário importa o **ZIP do shapefile AUAS** (com `.shp`, `.dbf`, `.prj` e a
   coluna `ABERTURA`).
2. O backend lê os polígonos, reprojeta para **EPSG:4674** e calcula o bbox.
3. Autentica no SCCON (token público, sem login de usuário final).
4. Consulta o **WFS/GeoServer** dos alertas no bbox → coleta `idt_local_alert`.
5. Busca `localAlerts/{id}` em paralelo → geometria + `alertDetectedDate`.
6. **Spatial join** (`intersects`): para cada AUAS, grava em `ABERTURA` a data
   **mais antiga** (MIN) dos alertas que tocam o polígono (configurável p/ MAX).
7. Devolve um **ZIP** com:
   - `AUAS.shp` **datado** (geometria idêntica à original);
   - `AUAS_SEM_ALERTA_SCCON_PONTOS.shp` (pontos das AUAS sem alerta);
   - `RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json` (auditoria por polígono);
   - `sccon_alertas.geojson` (cache dos alertas baixados, para conferência).

> **Preservação da geometria:** o módulo **não reconstrói** o `.shp`. Os bytes
> de `.shp/.shx/.prj` são preservados e **apenas o `.dbf` é reescrito** com a
> coluna `ABERTURA` atualizada. Assim a geometria de saída é bit-a-bit igual à
> de entrada — só as datas mudam.

## Arquitetura

| Camada | Arquivo | Papel |
|--------|---------|-------|
| Backend (core) | [`backend/auas-sccon.ts`](../backend/auas-sccon.ts) | Cliente SCCON, join espacial, escrita das saídas, rotas |
| Backend (teste) | [`backend/auas-sccon.test.ts`](../backend/auas-sccon.test.ts) | Testes do join / regra de data / DBF / pontos |
| Registro | [`backend/index.ts`](../backend/index.ts) | `registerAuasScconRoutes(app)` |
| Frontend | [`client/src/components/AuasSccon.tsx`](../client/src/components/AuasSccon.tsx) | Aba AUAS (upload, progresso SSE, download) |
| Rota | [`client/src/pages/DashboardRouter.tsx`](../client/src/pages/DashboardRouter.tsx) | `/dashboard/auas` → view `auas-sccon` |

O módulo **reutiliza** a infraestrutura já existente do sistema:

- Leitura de shapefile: `parsePolygonRecords`, `getZipLayerGroups`, `detectCrs`
  (de `vertices-proximas.ts`) + `proj4`.
- Leitura/escrita de tabela: `parseDbfSchema`, `readDbfRows`, `buildDbfBuffer`,
  `buildPointShpAndShx` (de `shapefile-writer.ts`).
- Geometria: `@turf/turf` (`booleanIntersects`, `bbox`, `area`, `pointOnFeature`).
- Empacotamento: `archiver`.

## Endpoints

Ambos **públicos** (não exigem login, seguindo o padrão de `/api/simcar/clip`).

### `POST /api/auas-sccon/process` — SSE

Body JSON:

```jsonc
{
  "auasZip": "<base64 do .zip>",   // obrigatório
  "dateRule": "min",                // "min" (padrão) | "max"
  "classes": ["CUT", "..."],        // opcional — usa DEFAULT_CLASSES se ausente
  "filename": "AUAS.zip"            // opcional — usado no nome do ZIP de saída
}
```

Eventos (Server-Sent Events, `data: {...}\n\n`):

```jsonc
{ "type": "progress", "stage": "wfs", "message": "…", "pct": 35 }
{ "type": "done", "jobId": "…", "filename": "AUAS_SCCON_datado.zip",
  "downloadUrl": "/api/auas-sccon/download/<jobId>", "report": { /* … */ } }
{ "type": "error", "message": "…" }
```

### `GET /api/auas-sccon/download/:jobId`

Retorna o ZIP final (`application/zip`). O resultado fica em cache por
**30 minutos** após o `done`.

### `GET /api/auas-sccon/config`

Retorna as constantes públicas (org UUID, data inicial, classes padrão).

## Relatório (`RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json`)

```jsonc
{
  "fonte": "SCCON Alertas Mato Grosso (SEMA-MT)",
  "regra_data": "ABERTURA = data mais antiga (min) …",
  "periodo_alertas_inicio": "2019-07-22",
  "n_alertas_bbox": 194,
  "n_alertas_com_data": 194,
  "classes_alertas": { "CUT": 120, "SELECTIVE_EXTRACTION": 50, "…": 24 },
  "n_auas": 32,
  "n_atualizados": 9,
  "n_sem_intersecao": 23,
  "n_pontos_sem_alerta": 23,
  "area_ha_sem_alerta": 41.6,
  "crs_auas": "EPSG:4674",
  "warnings": [],
  "detalhes": [
    {
      "index": 0, "ID": "2613856",
      "ABERTURA_antes": "01/01/2016", "ABERTURA_depois": "02/07/2023",
      "n_alertas_intersect": 4, "data_alerta_min": "02/07/2023",
      "data_alerta_max": "15/09/2024", "classes": "CUT,SELECTIVE_EXTRACTION",
      "atualizado": true
    }
  ]
}
```

## Shape de pontos sem alerta

`AUAS_SEM_ALERTA_SCCON_PONTOS.shp` (EPSG:4674):

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `ID` | C | ID do polígono AUAS |
| `ABERTURA` | C | data atual (não atualizada) |
| `area_ha` | N | área do polígono (ha, geodésica) |
| `idx_auas` | N | índice 0-based na camada AUAS |
| `motivo` | C | `sem_alerta_SCCON` |

## Configuração (variáveis de ambiente, opcionais)

Todos têm default embutido (valores da SEMA-MT). Sobrescreva se necessário:

```env
SCCON_ORG_UUID=597953b9-ee78-4113-80f9-803dbbaa60a0
SCCON_START_DATE=2019-07-22
SCCON_TOKEN_URL=https://plataforma.sccon.com.br/gama-api/auth/token-public-layer
SCCON_USER_URL=https://plataforma-alertas.sccon.com.br/gama-api/users/user
SCCON_WFS_URL=https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs
SCCON_WFS_LAYER=dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt
SCCON_LOCAL_ALERT_URL=https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}
SCCON_HTTP_CONCURRENCY=12
SCCON_HTTP_TIMEOUT_MS=60000
```

## Regras de negócio

| Regra | Valor |
|-------|-------|
| Predicado espacial | `intersects` (turf `booleanIntersects` + prefiltro por bbox) |
| Data gravada | `MIN(alertDetectedDate)` (padrão) ou `MAX` |
| Formato `ABERTURA` | brasileiro `DD/MM/YYYY` |
| Classes padrão | CUT, SELECTIVE_EXTRACTION, DEGRADATION_SELECTIVE_CUT, BURN_SCAR, MINERAL_EXTRACTION, DEGRADATION_CHEMICAL_AGENT, FOCUS_OF_BURN, LANDSLIDES, BLOW_DOWN |
| Período mínimo | desde 2019-07-22 |
| Sem interseção | não inventa data; mantém a original e gera ponto |

## Limitações

1. **Pré-2019:** o SCCON não cobre; conversões antigas mantêm a data original.
2. **Fragmentos pequenos** de AUAS podem não intersectar o polígono do alerta.
3. **Teto do WFS:** o GeoServer retorna no máximo 10.000 feições por bbox — se
   atingido, o relatório inclui um `warning` sugerindo processar por partes
   (não ocorre em AUAS de uma propriedade, cujo bbox é pequeno).
4. **Serviço de terceiros:** indisponibilidade / rate-limit / mudança de layer
   podem quebrar o fluxo. A data é **indicativa** (disclaimer da SCCON).

## Verificação

- Testes unitários: `npx vitest run --root . backend/auas-sccon.test.ts`
  (join, regra MIN/MAX, reescrita do DBF, geração de pontos).
- Validado **ponta a ponta** contra a API SCCON real (token → WFS → localAlerts
  → join → ZIP), com um AUAS sintético sobre Mato Grosso.
