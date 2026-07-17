# Endpoints SCCON — catálogo para integração

Base do dashboard público: `https://alertas.sccon.com.br/matogrosso/`  
Config embutida: `GET https://alertas.sccon.com.br/matogrosso/assets/config/env/app.config.matogrosso.json`

## 0. Configuração da aplicação (sem auth)

```http
GET https://alertas.sccon.com.br/matogrosso/assets/config/env/app.config.matogrosso.json
User-Agent: Mozilla/5.0 ...
```

Trecho relevante:

```json
{
  "DASHBOARD_ACCESS": "PUBLIC",
  "ORGANIZATION_NAME": "matogrosso",
  "ORGANIZATION_ID": ["597953b9-ee78-4113-80f9-803dbbaa60a0"],
  "STARTDATE": "2019-07-22",
  "API": {
    "GAMA": "https://plataforma-alertas.sccon.com.br/gama-api",
    "GAMA_PLATAFORMA": "https://plataforma.sccon.com.br/gama-api",
    "DEFORESTATION": "https://deforestation-data-mt.sccon.com.br/api-v2",
    "DEFORESTATION_V1": "https://deforestation-data-mt.sccon.com.br/api"
  }
}
```

Constantes:

| Chave | Valor |
|-------|--------|
| `ORG_UUID` | `597953b9-ee78-4113-80f9-803dbbaa60a0` |
| `STARTDATE` | `2019-07-22` |
| API alertas v2 | `https://deforestation-data-mt.sccon.com.br/api-v2` |
| API alertas v1 | `https://deforestation-data-mt.sccon.com.br/api` |
| GAMA plataforma | `https://plataforma.sccon.com.br/gama-api` |
| GAMA alertas | `https://plataforma-alertas.sccon.com.br/gama-api` |

---

## 1. Token público (obrigatório)

Login “anônimo” do dashboard público.

```http
GET https://plataforma.sccon.com.br/gama-api/auth/token-public-layer?organizationUUID=597953b9-ee78-4113-80f9-803dbbaa60a0
Accept: application/json
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
Origin: https://alertas.sccon.com.br
Referer: https://alertas.sccon.com.br/matogrosso/
```

**Resposta 200 (exemplo):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "iss": "plataforma.sccon.com.br",
  "sub": "sema-mt-svc-usr@sccon.com.br",
  "name": "Usuário de Serviço SEMA/MT",
  "exp": 1784666175490,
  "iat": 1784061375490,
  "roles": ["ACCESS_DASHBOARD_PF", "DOWNLOAD_ALERTS", "ACCESS_DASHBOARD_MT", "VIEW"]
}
```

- `exp` está em **milissegundos** Unix.
- Usar em todas as chamadas REST: `Authorization: Bearer {access_token}`.
- Alternativa que também responde:  
  `https://plataforma-alertas.sccon.com.br/gama-api/auth/token-public-layer?organizationUUID=...`  
  (iss diferente: `gamaagricultura.com.br` — preferir o da config `GAMA_PLATAFORMA`).

**Erros comuns**

| HTTP | Situação |
|------|----------|
| 403 | Token em host errado (`deforestation-data-mt.../auth/token-public-layer`) |
| 500 `Login faill` | `organizationUUID` inválido / mal formatado |

---

## 2. Usuário do token (opcional, mas útil para WFS)

```http
GET https://plataforma-alertas.sccon.com.br/gama-api/users/user
Authorization: Bearer {token}
```

Retorna `id` do usuário de serviço, usado como `userToken` nos **viewparams** do GeoServer.

Exemplo: `"id": "536206bd-62dc-4fc9-9efb-c918e15b68d9"`.

---

## 3. Classes de alerta

```http
GET https://plataforma-alertas.sccon.com.br/gama-api/organizations/uuid/597953b9-ee78-4113-80f9-803dbbaa60a0
Authorization: Bearer {token}
```

Campo `alertClasses` (exemplo MT):

| classType | label (pt) |
|-----------|------------|
| `CUT` | Desmatamento - Corte Raso |
| `SELECTIVE_EXTRACTION` | Desmatamento - Degradação |
| `DEGRADATION_SELECTIVE_CUT` | Corte Seletivo |
| `BURN_SCAR` | Cicatriz de Queimada |
| `FOCUS_OF_BURN` | Foco de Queimada |
| `MINERAL_EXTRACTION` | Extração Mineral |
| `DEGRADATION_CHEMICAL_AGENT` | Degradação por agente químico |
| `LANDSLIDES` | Supressão natural - Deslizamentos |
| `BLOW_DOWN` | Supressão natural - Blowdown |
| `AIRSTRIP_OPENING` / `AIRSTRIP_EXPANSION` | Pista de pouso |
| `ACCESS` | Acesso |

Para AUAS (conversão de vegetação), filtrar preferencialmente:  
`CUT`, `SELECTIVE_EXTRACTION`, `DEGRADATION_SELECTIVE_CUT`, `BURN_SCAR`, `MINERAL_EXTRACTION`, …

Também existe:

```http
GET https://plataforma-alertas.sccon.com.br/gama-api/alert-class/user/?language=pt
Authorization: Bearer {token}
```

---

## 4. Camadas WMS/WFS de alertas (recomendado)

Gera metadados das camadas do mapa (incluindo `viewparams` com token embutido).

```http
POST https://deforestation-data-mt.sccon.com.br/api-v2/alerts/layers/?lang=pt
Authorization: Bearer {token}
Content-Type: application/json
Origin: https://alertas.sccon.com.br
```

**Body:**

```json
{
  "classTypes": [
    "CUT",
    "SELECTIVE_EXTRACTION",
    "DEGRADATION_SELECTIVE_CUT",
    "BURN_SCAR",
    "MINERAL_EXTRACTION",
    "DEGRADATION_CHEMICAL_AGENT",
    "FOCUS_OF_BURN"
  ],
  "selectedFilters": [
    {
      "localType": "STATE",
      "localIds": null,
      "parentLocalIds": []
    }
  ],
  "rangeDate": [
    { "start": "2019-07-22", "end": "2026-07-10" }
  ],
  "areaRange": null,
  "alertStatusTypesIds": [],
  "organizationUUID": "597953b9-ee78-4113-80f9-803dbbaa60a0",
  "cdCars": []
}
```

**Resposta (camadas úteis):**

| name | layersName | url base |
|------|------------|----------|
| Todos os alertas | `vw_v2_dashboard_alerts_all_defo-data_prod-mt` | `https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wms` |
| Cluster de alertas | `vw_v2_dashboard_alerts_points_defo_cluster_mt` | idem |
| Faixas de área (0–6) | `dashboard_alerts_defo-data_prod-mt` | idem (+ `range:N` no viewparams) |

`viewparams` típico (copiar do JSON da API; aspas e `\,` importam):

```text
userToken:'536206bd-62dc-4fc9-9efb-c918e15b68d9';orgToken:'597953b9-ee78-4113-80f9-803dbbaa60a0';fromDate:'2019-07-22';toDate:'2026-07-10';parentLocalType1:'STATE';classes:'CUT'\,'SELECTIVE_EXTRACTION'\,'BURN_SCAR';inspectionFilter:'ALL'
```

---

## 5. WFS GetFeature — polígonos no bbox (caminho estável)

```http
GET https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs
  ?service=WFS
  &version=1.1.0
  &request=GetFeature
  &typeName=dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt
  &outputFormat=application/json
  &srsName=EPSG:4674
  &bbox={minx},{miny},{maxx},{maxy},EPSG:4674
  &viewparams={VIEWPARAMS_URLENCODED}
  &maxFeatures=10000
```

**Capabilities:**  
`GET .../geoserver/dashboards/wfs?service=WFS&request=GetCapabilities`

**Propriedades retornadas (camada “Todos os alertas”):**

| Campo | Tipo | Notas |
|-------|------|--------|
| `idt_local_alert` | int | ID local — usar no endpoint `/localAlerts/{id}` |
| `qualification` | string | ex.: `CUT` |
| `area_m2`, `area_ha`, `area_ha_tx` | number/string | área |
| `geometry` | MultiPolygon | **sem data de detecção** nesta view |

A data **não** vem no WFS; é preciso o passo 6.

---

## 6. Detalhe do alerta com data (obrigatório para AUAS)

```http
GET https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{idt_local_alert}
Authorization: Bearer {token}
Accept: application/json
```

**Resposta (resumo):**

```json
{
  "id": 1033877,
  "alert": {
    "id": 7817,
    "classType": "CUT",
    "localAlertIds": [403582],
    "alertDetectedDate": "2020-03-17T12:36:54",
    "area": 107215.97,
    "geometry": {
      "type": "Polygon",
      "crs": { "type": "name", "properties": { "name": "EPSG:4674" } },
      "coordinates": [ /* ... */ ]
    },
    "status": "PROCESSED",
    "image": "20200317_123654_104b",
    "imageBefore": "20200203_132815_0f35"
  }
}
```

Campo de data para AUAS: **`alert.alertDetectedDate`** (ISO datetime).  
Geometria de trabalho: **`alert.geometry`** (EPSG:4674).

Paralelizar com pool de ~8–12 workers; 100–500 IDs é rotina.

---

## 7. Listagem paginada de alertas (alternativa / estadual)

```http
POST https://deforestation-data-mt.sccon.com.br/api-v2/alerts/search
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "classTypes": ["CUT"],
  "selectedFilters": [
    { "localType": "STATE", "localIds": null, "parentLocalIds": [] }
  ],
  "rangeDate": [{ "start": "2024-01-01", "end": "2024-06-30" }],
  "areaRange": null,
  "alertStatusTypesIds": [],
  "organizationUUID": "597953b9-ee78-4113-80f9-803dbbaa60a0",
  "cdCars": [],
  "page": 0,
  "pageSize": 50,
  "frontFilter": null,
  "idsLocalAlerts": null
}
```

Retorna array com `alertDetectedDate` + `geometry`, mas **sem filtro espacial automático** (estado inteiro).  
Útil com `page`/`pageSize` e filtro espacial no cliente, ou com `idsLocalAlerts` se a semântica de ID bater com o filtro da UI.

---

## 8. Busca por geometria (NÃO confiável para períodos longos)

Usada no front do relatório, hard-coded:

```http
POST https://deforestation-data-mt.sccon.com.br/api/alerts/search?oldGeomCompatibility=true
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "fromDate": "2019-07-22",
  "toDate": "2026-07-10",
  "localIds": null,
  "localType": "STATE",
  "customGeometryAsGeoJson": "{\"type\":\"Polygon\",\"coordinates\":[[[...]]]}",
  "classTypes": ["CUT", "SELECTIVE_EXTRACTION"]
}
```

Observações de produção:

- `customGeometryAsGeoJson` no front costuma ser **string JSON** (`JSON.stringify(geometry)`).
- Em períodos longos + bbox grande: **timeout / HTTP 504** frequente.
- **Não usar como caminho principal** da automação AUAS.

---

## 9. Outros endpoints (referência, não obrigatórios)

| Método | URL | Uso |
|--------|-----|-----|
| GET | `{GAMA}/locals/localType` | filtros geográficos (município, etc.) |
| POST | `{DEFORESTATION}/dashboard-alerts/total-items` | totais do dashboard |
| GET | `{DEFORESTATION}/dashboard/config/?organizationUuid=` | config backend (pode 403 sem permissão) |
| GET | `https://plataforma-mt.sccon.com.br/gama-api/layers/reference` | mosaicos de referência |
| WMS GetMap | `geoserver-dashboard-mt.../wms` | visualização (não extrai data tabular) |

---

## Headers recomendados (todas as chamadas REST)

```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36
Accept: application/json, text/plain, */*
Origin: https://alertas.sccon.com.br
Referer: https://alertas.sccon.com.br/matogrosso/
Authorization: Bearer {access_token}   # exceto token-public-layer e assets
Content-Type: application/json         # em POST
```

Sem `User-Agent` de browser, Cloudflare pode retornar **403** no domínio `alertas.sccon.com.br`.

---

## Resumo: endpoints mínimos para reimplementar

```
1. GET  plataforma.sccon.com.br/gama-api/auth/token-public-layer?organizationUUID=...
2. GET  plataforma-alertas.sccon.com.br/gama-api/users/user
3. GET  geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs  (GetFeature + viewparams + bbox)
4. GET  deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}   (N vezes, paralelo)
5. [local] spatial join → atualizar ABERTURA no AUAS
```
