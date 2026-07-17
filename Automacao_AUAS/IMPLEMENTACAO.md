# Guia de implementação em outro sistema

## Opção A — Python (referência pronta)

Arquivo: [`atualizar_datas_auas_sccon.py`](./atualizar_datas_auas_sccon.py)

```bash
cd Automacao_AUAS
pip install -r requirements.txt
python atualizar_datas_auas_sccon.py --auas "../Arquivo_Enviado_AUAS/AUAS.shp"
# data mais recente em vez da mais antiga:
python atualizar_datas_auas_sccon.py --max-date
```

Stack: `urllib` (HTTP) + `geopandas` + `shapely`.

---

## Opção B — Backend Node / TypeScript

### Dependências sugeridas

- `axios` ou `undici` — HTTP
- `@turf/turf` — intersects, bbox, booleanIntersects
- `shapefile` / `gdal-async` / PostGIS — I/O espacial

### Esqueleto de serviços

```ts
// sccon.client.ts
const ORG = "597953b9-ee78-4113-80f9-803dbbaa60a0";

export async function getPublicToken(): Promise<string> {
  const url =
    `https://plataforma.sccon.com.br/gama-api/auth/token-public-layer` +
    `?organizationUUID=${ORG}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 ... Chrome/126.0.0.0 Safari/537.36",
      Origin: "https://alertas.sccon.com.br",
      Referer: "https://alertas.sccon.com.br/matogrosso/",
    },
  });
  const data = await res.json();
  return data.access_token;
}

export async function getLocalAlert(id: number, token: string) {
  const res = await fetch(
    `https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/${id}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  return res.json();
}
```

WFS: montar query string com `URLSearchParams` e `viewparams` corretamente escapado.

Join espacial: `booleanIntersects` (turf) entre cada AUAS e cada alerta (ou índice R-tree com `rbush` + bbox prefilter).

---

## Opção C — PostGIS / pipeline GIS

1. ETL: baixar alertas (Python/Node) → `INSERT` em `sccon_alertas(geom, data_deteccao, class_type, local_id)`.
2. Atualizar AUAS:

```sql
UPDATE auas a
SET abertura = s.min_data
FROM (
  SELECT a.id,
         MIN(al.data_deteccao)::date AS min_data
  FROM auas a
  JOIN sccon_alertas al
    ON ST_Intersects(a.geom, al.geom)
  GROUP BY a.id
) s
WHERE a.id = s.id;
```

3. Pontos sem alerta:

```sql
CREATE TABLE auas_sem_alerta_pts AS
SELECT a.id,
       a.abertura,
       ST_PointOnSurface(a.geom) AS geom
FROM auas a
WHERE NOT EXISTS (
  SELECT 1 FROM sccon_alertas al
  WHERE ST_Intersects(a.geom, al.geom)
);
```

---

## Checklist de portabilidade

- [ ] Headers com User-Agent de browser (Cloudflare)
- [ ] Renovação de token se `exp` (ms) próximo
- [ ] WFS + localAlerts (não depender do search por geometria)
- [ ] CRS 4674 alinhado entre AUAS e alertas
- [ ] `make_valid` / limpeza de geometria
- [ ] Backup antes de sobrescrever SHP
- [ ] Relatório auditável por polígono
- [ ] Tratamento de 0 alertas no bbox (job ok, nada a atualizar)
- [ ] Timeout/retry em localAlerts (parcial falha ≠ abort total)
- [ ] Config externalizada: ORG_UUID, classes, STARTDATE, regra min/max
- [ ] Logs sem vazar token completo

## Variáveis de configuração sugeridas

```env
SCCON_ORG_UUID=597953b9-ee78-4113-80f9-803dbbaa60a0
SCCON_START_DATE=2019-07-22
SCCON_TOKEN_URL=https://plataforma.sccon.com.br/gama-api/auth/token-public-layer
SCCON_WFS_URL=https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs
SCCON_WFS_LAYER=dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt
SCCON_LOCAL_ALERT_URL=https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}
SCCON_DATE_RULE=min
SCCON_CLASSES=CUT,SELECTIVE_EXTRACTION,DEGRADATION_SELECTIVE_CUT,BURN_SCAR,MINERAL_EXTRACTION
SCCON_HTTP_CONCURRENCY=12
```

## Testes mínimos

| Teste | Esperado |
|-------|----------|
| Token GET | 200 + `access_token` |
| WFS bbox nulo/inválido | 0 features ou erro controlado |
| WFS bbox Macare (ex.) | dezenas–centenas de features |
| localAlerts ID válido | `alertDetectedDate` preenchido |
| Join AUAS vs alertas | n_atualizados ≥ 0; relatório bate com contagem |
| Reexecução | mesmo resultado se dados estáveis |
| AUAS sem hit | pontos gerados / data preservada |

## Observabilidade

Métricas úteis:

- latência token / WFS / localAlerts p50-p95
- taxa de falha por ID
- n_alertas, n_auas, n_atualizados, area_ha_sem_alerta
- versão da layer WFS (quando exposta)

## Segurança e compliance

- Dados públicos de monitoramento estadual; ainda assim: rate-limit e uso ético.
- Não versionar tokens em repositório.
- Cache local de alertas com TTL (ex.: 24h) reduz carga no SCCON.
- Documentar no produto que a data é **indicativa** (próprio disclaimer SCCON).

## Mapa de arquivos do projeto Macare (referência)

```text
Fazenda_Macare_1_a_7/
├── Automacao_AUAS/          ← esta documentação + script
├── Arquivo_Enviado_AUAS/
│   ├── AUAS.shp             ← atualizado
│   ├── AUAS_SEM_ALERTA_SCCON_PONTOS.shp
│   └── AUAS_backup_antes_sccon_*
├── sccon_alertas_macare.geojson
├── sccon_alertas_shapes/
├── RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json
└── atualizar_datas_auas_sccon.py  (cópia na raiz do projeto)
```
