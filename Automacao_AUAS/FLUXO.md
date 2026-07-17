# Fluxo operacional — AUAS + alertas SCCON

## Diagrama (alto nível)

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ AUAS.shp    │     │ Token público    │     │ WFS GeoServer       │
│ (polígonos) │     │ JWT Bearer       │────▶│ bbox + viewparams   │
└──────┬──────┘     └────────┬─────────┘     └──────────┬──────────┘
       │                     │                           │
       │                     │              ids: idt_local_alert[]
       │                     │                           │
       │                     ▼                           ▼
       │              ┌──────────────────┐     ┌─────────────────────┐
       │              │ GET localAlerts  │◀────│ pool paralelo N IDs │
       │              │ /{id}            │     └─────────────────────┘
       │              └────────┬─────────┘
       │                       │ GeoJSON alertas
       │                       │ (geom + alertDetectedDate)
       ▼                       ▼
┌──────────────────────────────────────────┐
│ Spatial join (intersects)                │
│ por polígono AUAS:                       │
│   ABERTURA = MIN(alertDetectedDate)      │
│   sem hit → mantém data anterior         │
└──────────────────┬───────────────────────┘
                   ▼
        ┌────────────────────┐
        │ AUAS atualizado    │
        │ relatório JSON     │
        │ pontos sem alerta  │
        └────────────────────┘
```

## Passos detalhados

### 1. Ler AUAS e calcular bbox

1. Abrir `AUAS.shp` (ou equivalente PostGIS/GeoJSON).
2. Garantir CRS de trabalho: **EPSG:4674** (SIRGAS 2000 geográfico) para bater com o GeoServer.
3. `bbox = total_bounds` com pequena margem (~0,001° ≈ 100 m).

### 2. Autenticar

1. `GET token-public-layer?organizationUUID=...`
2. Guardar `access_token`.
3. (Opcional) `GET /users/user` → `user.id` para `userToken` no WFS.

### 3. Extrair IDs no bbox (WFS)

1. Montar `viewparams` com:
   - `userToken`, `orgToken`
   - `fromDate` = `2019-07-22` (STARTDATE)
   - `toDate` = hoje (ou data do job)
   - `parentLocalType1:'STATE'`
   - `classes:'CUT'\,'SELECTIVE_EXTRACTION'\,...`
   - `inspectionFilter:'ALL'`
2. `GetFeature` na layer `dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt`.
3. Coletar `properties.idt_local_alert` únicos.

### 4. Enriquecer com data e geometria

Para cada ID:

```text
GET /api-v2/localAlerts/{id}
→ alert.alertDetectedDate
→ alert.geometry
→ alert.classType
```

Montar FeatureCollection / GeoDataFrame em EPSG:4674.

### 5. Spatial join e regra de data

```text
para cada polígono AUAS:
  alertas_tocantes = alertas WHERE intersects(auas_geom, alerta_geom)
  se vazio:
    manter ABERTURA original
  senão:
    ABERTURA = format(MIN(alertDetectedDate), "YYYY-MM-DD")
```

**Por que MIN (mais antiga)?**  
`ABERTURA` no SIMCAR representa conversão / abertura de uso. A **primeira** detecção de desmate que intersecta o polígono é a melhor aproximação automática pós-2019.

Alternativa configurável: `MAX` (última detecção) — útil se o produto quiser “data do alerta mais recente”.

### 6. Validar geometrias

Antes do join:

- `make_valid` / buffer(0) em AUAS e alertas.
- Opcional: reprojetar para **EPSG:31982** (UTM 22S) se for calcular áreas ou buffers em metros.

### 7. Persistência e auditoria

1. Backup dos sidecars `AUAS.*` antes de sobrescrever.
2. Salvar shapefile (DBF: data como string `YYYY-MM-DD` se necessário).
3. Relatório JSON por feature: antes/depois, n_alertas, min/max, classes.
4. Cache opcional: GeoJSON/SHP dos alertas baixados (evita re-hit na API).

### 8. AUAS sem alerta → shape de pontos

```text
auas_sem = AUAS WHERE NOT intersects(any alerta)
ponto = representative_point(poligono)   # sempre dentro do polígono
atributos: ID, ABERTURA, area_ha, motivo="sem_alerta_SCCON"
```

## Regras de negócio

| Regra | Valor recomendado |
|-------|-------------------|
| Predicado espacial | `intersects` |
| Data gravada | `MIN(alertDetectedDate)` |
| Formato `ABERTURA` | **Brasileiro `DD/MM/YYYY`** (ex.: `02/07/2023`) — XX/XX/XXXX na tabela de atributos |
| Classes default | CUT, SELECTIVE_EXTRACTION, DEGRADATION_SELECTIVE_CUT, BURN_SCAR, … |
| Período mínimo | desde 2019-07-22 |
| Sem interseção | não inventar data; manter original ou flag |
| Buffer | 0 m default; 5–20 m só se calibrado (falso positivo) |

## Limitações

1. **Pré-2019:** SCCON não cobre; datas antigas permanecem placeholder (ex.: 2016-01-01) ou fonte externa (PRODES, MapBiomas, etc.).
2. **Fragmentos pequenos** de AUAS podem não intersectar o polígono do alerta mesmo vizinhos a grandes desmates.
3. **Instabilidade** do `POST /api/alerts/search` por geometria em range longo.
4. **Mudança de nome de layer** no GeoServer quebra o WFS — monitorar `alerts/layers`.
5. Token/serviço público pode mudar política de acesso.

## Pseudocódigo

```python
token = get_public_token(ORG)
user_id = get_user(token)["id"]
bbox = bounds(auas)  # EPSG:4674
ids = wfs_get_local_alert_ids(bbox, user_id, classes, from_date, to_date)
alerts = parallel_map(lambda i: get_local_alert(i, token), ids)
# alerts: geom + alertDetectedDate

for poly in auas:
    hits = [a for a in alerts if poly.intersects(a.geom)]
    if hits:
        poly.ABERTURA = min(a.date for a in hits).date().isoformat()

save(auas)
save_points([p.representative_point() for p in auas if not updated(p)])
```

## Integração em outro sistema (módulos sugeridos)

| Módulo | Responsabilidade |
|--------|------------------|
| `ScconAuthClient` | token + user |
| `ScconAlertsClient` | WFS + localAlerts + layers |
| `AuasDateUpdater` | join espacial + regras |
| `AuasStorage` | ler/gravar SHP/PostGIS/S3 |
| `JobRunner` | fila, retry, logs, relatório |

Idempotência: reexecutar com a mesma regra MIN/MAX deve produzir o mesmo `ABERTURA` se o conjunto de alertas for o mesmo (salvo novos alertas no período).
