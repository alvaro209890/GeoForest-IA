#!/usr/bin/env bash
# Exemplo: WFS GetFeature no bbox (Macare-like) + 1 localAlert
set -euo pipefail

ORG="597953b9-ee78-4113-80f9-803dbbaa60a0"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

TOKEN=$(curl -sS -A "$UA" -H "Accept: application/json" \
  "https://plataforma.sccon.com.br/gama-api/auth/token-public-layer?organizationUUID=${ORG}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

USER_ID=$(curl -sS -A "$UA" -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json" \
  "https://plataforma-alertas.sccon.com.br/gama-api/users/user" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

# viewparams: classes com separador \,
VIEWPARAMS="userToken:'${USER_ID}';orgToken:'${ORG}';fromDate:'2019-07-22';toDate:'2026-07-10';parentLocalType1:'STATE';classes:'CUT'\\,'SELECTIVE_EXTRACTION'\\,'BURN_SCAR';inspectionFilter:'ALL'"

# bbox EPSG:4674 (exemplo Macare)
BBOX="-52.58697163,-12.48368858,-52.3563967,-12.19805283,EPSG:4674"

curl -sS -G -A "$UA" \
  --data-urlencode "service=WFS" \
  --data-urlencode "version=1.1.0" \
  --data-urlencode "request=GetFeature" \
  --data-urlencode "typeName=dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt" \
  --data-urlencode "outputFormat=application/json" \
  --data-urlencode "srsName=EPSG:4674" \
  --data-urlencode "bbox=${BBOX}" \
  --data-urlencode "viewparams=${VIEWPARAMS}" \
  --data-urlencode "maxFeatures=100" \
  "https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs" \
  -o /tmp/wfs_sample.json

python3 - <<'PY'
import json
fc=json.load(open("/tmp/wfs_sample.json"))
feats=fc.get("features") or []
print("features", len(feats))
if feats:
    p=feats[0]["properties"]
    print("sample props", p)
    print("idt_local_alert", p.get("idt_local_alert"))
PY

ID=$(python3 -c "import json; f=json.load(open('/tmp/wfs_sample.json')).get('features') or []; print(f[0]['properties']['idt_local_alert'] if f else '')")
if [[ -n "$ID" ]]; then
  echo "=== localAlerts/${ID} ==="
  curl -sS -A "$UA" -H "Authorization: Bearer ${TOKEN}" -H "Accept: application/json" \
    "https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/${ID}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); a=d.get('alert') or {}; print({k:a.get(k) for k in ['id','classType','alertDetectedDate','area']})"
fi
