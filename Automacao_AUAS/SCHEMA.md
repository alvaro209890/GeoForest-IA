# Schemas e contratos de dados

## 1. Entrada: AUAS (SIMCAR)

Shapefile típico do pacote “Arquivo Enviado”:

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `geometry` | Polygon / MultiPolygon | sim | Área de uso alternativo |
| `ABERTURA` | texto `DD/MM/YYYY` (brasileiro XX/XX/XXXX) | sim | Data de conversão/abertura |
| `ID` | integer | recomendado | Identificador do polígono no projeto |

- CRS validado: **EPSG:4674** (SIRGAS 2000).
- Vários registros podem compartilhar o mesmo `ID` (multipart / explodido).
- Placeholder comum quando desconhecido: `2016-01-01`.

### Exemplo de atributos (Macare)

```text
ID       ABERTURA
2613856  2023-07-02   # atualizado via SCCON
2614173  2016-01-01   # sem alerta
```

---

## 2. Feature WFS (ids no bbox)

Layer: `dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt`

```json
{
  "type": "Feature",
  "id": "vw_v2_dashboard_alerts_all_defo-data_prod-mt.fid-...",
  "geometry": {
    "type": "MultiPolygon",
    "coordinates": [[[[ -52.48, -12.44 ], ... ]]]
  },
  "properties": {
    "idt_local_alert": 1467514,
    "qualification": "CUT",
    "area_m2": 115278.80,
    "area_ha": 11.52788,
    "area_ha_tx": "11,5279"
  }
}
```

**Não há data de detecção nesta view.**

---

## 3. Detalhe `localAlerts/{id}`

```typescript
interface LocalAlertResponse {
  id: number;                    // = idt_local_alert do WFS
  alert: {
    id: number;                  // id interno do alerta
    classType: string;           // "CUT" | "SELECTIVE_EXTRACTION" | ...
    localAlertIds: number[];     // ids de exibição (podem diferir de `id`)
    alertDetectedDate: string;   // ISO "2020-03-17T12:36:54"
    area: number;                // m²
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    status: string;              // "PROCESSED" | ...
    image?: string;
    imageBefore?: string;
    // ... campos extras (municipios, car, etc.)
  };
}
```

### Feature normalizada para o join

```json
{
  "type": "Feature",
  "properties": {
    "local_id": 1033877,
    "alert_id": 7817,
    "classType": "CUT",
    "alertDetectedDate": "2020-03-17T12:36:54",
    "area": 107215.97
  },
  "geometry": { "type": "Polygon", "coordinates": [/* EPSG:4674 */] }
}
```

---

## 4. Saída: relatório JSON

Arquivo: `RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json`

```typescript
interface RelatorioAtualizacao {
  fonte: string;
  endpoints: Record<string, string>;
  periodo_alertas?: string;
  n_alertas_bbox: number;
  classes_alertas: Record<string, number>;
  regra_data: string;
  n_auas: number;
  n_atualizados: number;
  n_sem_intersecao: number;
  backup: string;
  detalhes: DetalhePoligono[];
}

interface DetalhePoligono {
  index: number;
  ID: number | null;
  ABERTURA_antes: string | null;
  ABERTURA_depois: string | null;
  n_alertas_intersect: number;
  data_alerta_min: string | null;  // YYYY-MM-DD
  data_alerta_max: string | null;
  classes: string;                 // "CUT,SELECTIVE_EXTRACTION"
  atualizado: boolean;
}
```

---

## 5. Saída: pontos sem alerta

Shapefile: `AUAS_SEM_ALERTA_SCCON_PONTOS.shp`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `geometry` | Point | `representative_point` do polígono AUAS |
| `ID` | int | ID do polígono AUAS |
| `ABERTURA` | string | data atual (não atualizada) |
| `area_ha` | float | área do polígono (métrica UTM) |
| `idx_auas` | int | índice na camada AUAS original |
| `motivo` | string | `sem_alerta_SCCON` |

CRS: o mesmo da AUAS (4674).

---

## 6. Token JWT (payload útil)

```json
{
  "iss": "plataforma.sccon.com.br",
  "sub": "sema-mt-svc-usr@sccon.com.br",
  "name": "Usuário de Serviço SEMA/MT",
  "exp": 1784666175490,
  "iat": 1784061375490,
  "roles": ["DOWNLOAD_ALERTS", "ACCESS_DASHBOARD_MT", "VIEW", "..."]
}
```

Validação prática: se `Date.now() > exp - margem`, renovar token.

---

## 7. Classes (`classType`) — filtro sugerido

### Prioridade alta (desmate / conversão)

- `CUT`
- `SELECTIVE_EXTRACTION`
- `DEGRADATION_SELECTIVE_CUT`
- `MINERAL_EXTRACTION`

### Opcional (fogo / natural)

- `BURN_SCAR`, `FOCUS_OF_BURN`
- `LANDSLIDES`, `BLOW_DOWN`, `DEGRADATION_CHEMICAL_AGENT`

### Baixa relevância para AUAS

- `ACCESS`, `AIRSTRIP_*` (avaliar caso a caso)

---

## 8. viewparams (contrato GeoServer)

Formato string (separador `;`, valores com aspas simples):

```text
userToken:'{UUID_USER}';orgToken:'{ORG_UUID}';fromDate:'YYYY-MM-DD';toDate:'YYYY-MM-DD';parentLocalType1:'STATE';classes:'CUT'\,'SELECTIVE_EXTRACTION';inspectionFilter:'ALL'
```

- Separador entre classes: sequência literal **`\,`** (barra + vírgula), não só `,`.
- URL-encode o parâmetro `viewparams` no query string.
- `parentLocalType1:'STATE'` com `localIds` nulos = estado inteiro, recortado pelo `bbox` do WFS.
