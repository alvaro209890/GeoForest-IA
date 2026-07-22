#!/usr/bin/env python3
"""
Atualiza a coluna ABERTURA do shapefile AUAS com datas dos alertas SCCON (SEMA-MT).

Fluxo automático (sem download manual):
  1) Token público: plataforma.sccon.com.br/gama-api/auth/token-public-layer
  2) Camadas WMS/WFS: deforestation-data-mt.sccon.com.br/api-v2/alerts/layers
  3) Polígonos no bbox: geoserver-dashboard-mt.sccon.com.br/.../wfs
     layer dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt
  4) Datas por ID: deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}
  5) Spatial join com AUAS → ABERTURA = data mais antiga (primeira detecção)

Uso:
  python atualizar_datas_auas_sccon.py
  python atualizar_datas_auas_sccon.py --auas "Arquivo_Enviado_AUAS/AUAS.shp"
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import shutil
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import make_valid

ROOT = Path(__file__).resolve().parent
ORG_UUID = "597953b9-ee78-4113-80f9-803dbbaa60a0"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

TOKEN_URL = (
    "https://plataforma.sccon.com.br/gama-api/auth/token-public-layer"
    f"?organizationUUID={ORG_UUID}"
)
LAYERS_URL = "https://deforestation-data-mt.sccon.com.br/api-v2/alerts/layers/?lang=pt"
WFS_URL = "https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs"
WFS_LAYER = "dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt"
LOCAL_ALERT_URL = "https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}"

# Classes de desmate/degradação relevantes para data de abertura de AUAS
DEFAULT_CLASSES = [
    "CUT",
    "SELECTIVE_EXTRACTION",
    "DEGRADATION_SELECTIVE_CUT",
    "BURN_SCAR",
    "MINERAL_EXTRACTION",
    "DEGRADATION_CHEMICAL_AGENT",
    "FOCUS_OF_BURN",
    "LANDSLIDES",
    "BLOW_DOWN",
]

START_DATE = "2019-07-22"  # início dos alertas SCCON-MT
CTX = ssl.create_default_context()


def http_json(url: str, method: str = "GET", data=None, token: str | None = None, timeout: int = 60):
    headers = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://alertas.sccon.com.br",
        "Referer": "https://alertas.sccon.com.br/matogrosso/",
    }
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_token() -> str:
    data = http_json(TOKEN_URL)
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Token público não retornado: {data}")
    print(f"[ok] token público (roles={data.get('roles')})")
    return token


def bbox_from_auas(auas: gpd.GeoDataFrame) -> tuple[float, float, float, float]:
    g = auas.to_crs(4674) if auas.crs and auas.crs.to_epsg() != 4674 else auas
    minx, miny, maxx, maxy = g.total_bounds
    # pequena margem
    pad = 0.001
    return minx - pad, miny - pad, maxx + pad, maxy + pad


def fetch_wfs_alert_ids(bbox: tuple[float, float, float, float], classes: list[str], token: str) -> list[int]:
    # userToken vem do user id do token público (endpoint /users/user)
    user = http_json(
        "https://plataforma-alertas.sccon.com.br/gama-api/users/user",
        token=token,
    )
    user_id = user["id"]
    # Formato GeoServer SCCON: classes:'CUT'\,'SELECTIVE_EXTRACTION'\,...
    classes_param = "\\,".join(f"'{c}'" for c in classes)

    to_date = datetime.now().strftime("%Y-%m-%d")
    viewparams = (
        f"userToken:'{user_id}';"
        f"orgToken:'{ORG_UUID}';"
        f"fromDate:'{START_DATE}';"
        f"toDate:'{to_date}';"
        f"parentLocalType1:'STATE';"
        f"classes:{classes_param};"
        f"inspectionFilter:'ALL'"
    )

    minx, miny, maxx, maxy = bbox
    params = {
        "service": "WFS",
        "version": "1.1.0",
        "request": "GetFeature",
        "typeName": WFS_LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:4674",
        "bbox": f"{minx},{miny},{maxx},{maxy},EPSG:4674",
        "viewparams": viewparams,
        "maxFeatures": "10000",
    }
    url = WFS_URL + "?" + urllib.parse.urlencode(params)
    print("[..] WFS GetFeature no bbox da AUAS…")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120, context=CTX) as resp:
        fc = json.loads(resp.read().decode("utf-8"))
    features = fc.get("features") or []
    ids = sorted(
        {
            int(f["properties"]["idt_local_alert"])
            for f in features
            if f.get("properties", {}).get("idt_local_alert") is not None
        }
    )
    print(f"[ok] WFS: {len(features)} features, {len(ids)} ids locais")
    return ids


def fetch_alert_details(ids: list[int], token: str) -> gpd.GeoDataFrame:
    def one(i: int):
        url = LOCAL_ALERT_URL.format(id=i)
        try:
            d = http_json(url, token=token, timeout=45)
        except Exception as exc:
            return i, None, str(exc)
        alert = d.get("alert") or d
        geom = alert.get("geometry")
        date = alert.get("alertDetectedDate")
        if not geom or not date:
            return i, None, "sem geometry/data"
        return i, {
            "local_id": d.get("id", i),
            "alert_id": alert.get("id"),
            "classType": alert.get("classType"),
            "alertDetectedDate": date,
            "area": alert.get("area"),
            "geometry": geom,
        }, None

    print(f"[..] baixando detalhes de {len(ids)} alertas…")
    rows = []
    fails = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        for i, row, err in pool.map(one, ids):
            if row:
                rows.append(row)
            else:
                fails += 1
                print(f"  fail id={i}: {err}")
    if not rows:
        raise RuntimeError("Nenhum alerta com geometria/data retornado")
    from shapely.geometry import shape

    gdf = gpd.GeoDataFrame(
        [
            {
                "local_id": r["local_id"],
                "alert_id": r["alert_id"],
                "classType": r["classType"],
                "alertDetectedDate": r["alertDetectedDate"],
                "area": r["area"],
                "geometry": make_valid(shape(r["geometry"])),
            }
            for r in rows
        ],
        crs="EPSG:4674",
    )
    gdf["alertDetectedDate"] = pd.to_datetime(gdf["alertDetectedDate"], errors="coerce")
    print(
        f"[ok] alertas com data: {len(gdf)} | "
        f"{gdf['alertDetectedDate'].min()} → {gdf['alertDetectedDate'].max()}"
    )
    return gdf


def update_auas(
    auas_path: Path,
    alerts: gpd.GeoDataFrame,
    *,
    inplace: bool = True,
    use_min: bool = True,
) -> dict:
    auas_path = Path(auas_path)
    auas = gpd.read_file(auas_path)
    if "ABERTURA" not in auas.columns:
        raise RuntimeError("Shapefile AUAS sem coluna ABERTURA")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = auas_path.parent / f"AUAS_backup_antes_sccon_{stamp}"
    backup_dir.mkdir(exist_ok=True)
    for p in auas_path.parent.glob(auas_path.stem + ".*"):
        shutil.copy2(p, backup_dir / p.name)

    if alerts.crs != auas.crs:
        alerts = alerts.to_crs(auas.crs)
    auas = auas.copy()
    auas["geometry"] = auas.geometry.apply(lambda g: make_valid(g) if g is not None else g)
    alerts = alerts.copy()
    alerts["geometry"] = alerts.geometry.apply(lambda g: make_valid(g) if g is not None else g)

    joined = gpd.sjoin(
        auas,
        alerts[["alertDetectedDate", "classType", "local_id", "area", "geometry"]],
        how="left",
        predicate="intersects",
    )
    agg = joined.groupby(joined.index).agg(
        n_alertas=("alertDetectedDate", "count"),
        data_min=("alertDetectedDate", "min"),
        data_max=("alertDetectedDate", "max"),
        classes=("classType", lambda s: ",".join(sorted(set(str(x) for x in s.dropna())))),
    )

    def _parse_abert(series: pd.Series) -> pd.Series:
        """Aceita Date nativo, ISO YYYY-MM-DD ou brasileiro DD/MM/YYYY."""
        s = pd.to_datetime(series, errors="coerce", dayfirst=False)
        miss = s.isna()
        if miss.any():
            s.loc[miss] = pd.to_datetime(series.loc[miss], errors="coerce", dayfirst=True)
        return s

    def _fmt_br(v) -> str | None:
        """Formato brasileiro DD/MM/YYYY (XX/XX/XXXX) para tabela de atributos."""
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        try:
            if pd.isna(v):
                return None
        except (TypeError, ValueError):
            pass
        return pd.Timestamp(v).strftime("%d/%m/%Y")

    # Trabalhar em datetime e gravar ABERTURA como texto brasileiro DD/MM/YYYY
    abert_dt = _parse_abert(auas["ABERTURA"])
    auas = auas.copy()
    auas["ABERTURA"] = abert_dt  # temp datetime; convertido ao salvar

    has_id = "ID" in auas.columns
    updated = 0
    details = []
    for idx in auas.index:
        old = abert_dt.at[idx] if idx in abert_dt.index else None
        row = agg.loc[idx] if idx in agg.index else None
        new_ts = None
        n = 0
        if row is not None:
            pick = row["data_min"] if use_min else row["data_max"]
            if pd.notnull(pick):
                new_ts = pd.Timestamp(pick).normalize()
                n = int(row["n_alertas"])
                auas.at[idx, "ABERTURA"] = new_ts
                updated += 1

        details.append(
            {
                "index": int(idx),
                "ID": (
                    int(auas.at[idx, "ID"])
                    if has_id and pd.notnull(auas.at[idx, "ID"])
                    else None
                ),
                "ABERTURA_antes": _fmt_br(old),
                "ABERTURA_depois": _fmt_br(new_ts if new_ts is not None else old),
                "n_alertas_intersect": n,
                "data_alerta_min": (
                    pd.Timestamp(row["data_min"]).strftime("%d/%m/%Y")
                    if row is not None and pd.notnull(row["data_min"])
                    else None
                ),
                "data_alerta_max": (
                    pd.Timestamp(row["data_max"]).strftime("%d/%m/%Y")
                    if row is not None and pd.notnull(row["data_max"])
                    else None
                ),
                "classes": row["classes"] if row is not None else "",
                "atualizado": new_ts is not None,
            }
        )

    # Formato brasileiro XX/XX/XXXX na tabela de atributos (texto)
    auas["ABERTURA"] = pd.to_datetime(auas["ABERTURA"], errors="coerce").dt.strftime("%d/%m/%Y")
    auas.loc[auas["ABERTURA"].isna() | (auas["ABERTURA"] == "NaT"), "ABERTURA"] = ""
    out_path = auas_path if inplace else auas_path.with_name(auas_path.stem + "_sccon.shp")
    auas.to_file(out_path, driver="ESRI Shapefile")

    report = {
        "fonte": "SCCON Alertas Mato Grosso (SEMA-MT)",
        "dashboard": "https://alertas.sccon.com.br/matogrosso/#/dashboard/view-map",
        "endpoints": {
            "token": TOKEN_URL,
            "layers": LAYERS_URL,
            "wfs": WFS_URL,
            "layer": WFS_LAYER,
            "localAlerts": LOCAL_ALERT_URL,
        },
        "regra_data": (
            "ABERTURA = data mais antiga (min) dos alertas que intersectam o polígono"
            if use_min
            else "ABERTURA = data mais recente (max) dos alertas que intersectam o polígono"
        ),
        "periodo_alertas_inicio": START_DATE,
        "n_alertas": int(len(alerts)),
        "classes_alertas": alerts["classType"].value_counts().to_dict(),
        "n_auas": int(len(auas)),
        "n_atualizados": updated,
        "n_sem_intersecao": int(len(auas) - updated),
        "backup": str(backup_dir),
        "saida": str(out_path),
        "detalhes": details,
    }
    report_path = ROOT / "RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] {updated}/{len(auas)} polígonos atualizados → {out_path}")
    print(f"[ok] relatório → {report_path}")
    print(f"[ok] backup → {backup_dir}")
    return report


def main():
    parser = argparse.ArgumentParser(description="Atualiza datas AUAS via alertas SCCON")
    parser.add_argument(
        "--auas",
        default=str(ROOT / "Arquivo_Enviado_AUAS" / "AUAS.shp"),
        help="Caminho do AUAS.shp",
    )
    parser.add_argument(
        "--max-date",
        action="store_true",
        help="Usar data mais recente (max) em vez da mais antiga (min)",
    )
    parser.add_argument(
        "--alerts-geojson",
        default=str(ROOT / "sccon_alertas_macare.geojson"),
        help="Onde salvar o GeoJSON de alertas baixados",
    )
    args = parser.parse_args()

    auas_path = Path(args.auas)
    if not auas_path.exists():
        raise SystemExit(f"AUAS não encontrado: {auas_path}")

    auas = gpd.read_file(auas_path)
    print(f"[ok] AUAS: {len(auas)} polígonos | CRS={auas.crs}")

    token = get_token()
    bbox = bbox_from_auas(auas)
    print(f"[ok] bbox: {bbox}")

    ids = fetch_wfs_alert_ids(bbox, DEFAULT_CLASSES, token)
    if not ids:
        raise SystemExit("Nenhum alerta WFS no bbox da AUAS")

    alerts = fetch_alert_details(ids, token)
    gj_path = Path(args.alerts_geojson)
    alerts.to_file(gj_path, driver="GeoJSON")
    print(f"[ok] alertas salvos em {gj_path}")

    update_auas(auas_path, alerts, inplace=True, use_min=not args.max_date)


if __name__ == "__main__":
    main()
