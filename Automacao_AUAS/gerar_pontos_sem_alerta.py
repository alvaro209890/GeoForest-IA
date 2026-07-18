#!/usr/bin/env python3
"""
Gera shapefile de PONTOS nas AUAS que não intersectam alertas SCCON.

Uso:
  python gerar_pontos_sem_alerta.py \\
    --auas ../Arquivo_Enviado_AUAS/AUAS.shp \\
    --alertas ../sccon_alertas_macare.geojson \\
    --out ../Arquivo_Enviado_AUAS/AUAS_SEM_ALERTA_SCCON_PONTOS.shp
"""
from __future__ import annotations

import argparse
from pathlib import Path

import geopandas as gpd
from shapely import make_valid


def utm_epsg_for(gdf: gpd.GeoDataFrame) -> int:
    """EPSG UTM SIRGAS 2000 (fuso S) pela longitude média do dado."""
    g = gdf.to_crs(4674) if gdf.crs and gdf.crs.to_epsg() != 4674 else gdf
    minx, _, maxx, _ = g.total_bounds
    lon = (minx + maxx) / 2.0
    zone = int((lon + 180) // 6) + 1  # 20, 21 ou 22 em MT
    return 31960 + zone  # 31980=20S, 31981=21S, 31982=22S


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--auas", required=True)
    p.add_argument("--alertas", required=True, help="GeoJSON/SHP de alertas com geometry")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    auas = gpd.read_file(args.auas)
    alerts = gpd.read_file(args.alertas)
    if alerts.crs is None:
        alerts = alerts.set_crs(4674)
    if alerts.crs != auas.crs:
        alerts = alerts.to_crs(auas.crs)

    auas = auas.copy()
    auas["geometry"] = auas.geometry.apply(lambda g: make_valid(g) if g is not None else g)
    alerts["geometry"] = alerts.geometry.apply(lambda g: make_valid(g) if g is not None else g)

    joined = gpd.sjoin(auas, alerts[["geometry"]], how="left", predicate="intersects")
    has = joined["index_right"].notna().groupby(joined.index).any()
    sem = auas.loc[~has].copy()

    # Zona UTM SIRGAS 2000 por longitude do centroide (MT abrange 20S/21S/22S),
    # em vez de 31982 fixo — evita área distorcida no oeste do estado.
    sem_m = sem.to_crs(utm_epsg_for(sem))
    sem_m["area_ha"] = sem_m.geometry.area / 10000.0
    pts_m = sem_m.copy()
    pts_m["geometry"] = sem_m.geometry.representative_point()
    pts = pts_m.to_crs(auas.crs).reset_index().rename(columns={"index": "idx_auas"})

    import pandas as pd

    if "ABERTURA" in pts.columns:
        abert = pd.to_datetime(pts["ABERTURA"], errors="coerce", dayfirst=True)
        if abert.isna().all():
            abert = pd.to_datetime(pts["ABERTURA"], errors="coerce", dayfirst=False)
        abert_txt = abert.dt.strftime("%d/%m/%Y")
        abert_txt = abert_txt.where(abert_txt.notna() & (abert_txt != "NaT"), "")
    else:
        abert_txt = ""
    out = gpd.GeoDataFrame(
        {
            "ID": pts["ID"] if "ID" in pts.columns else None,
            "ABERTURA": abert_txt,
            "area_ha": pts["area_ha"].round(6),
            "idx_auas": pts["idx_auas"].astype("int64"),
            "motivo": "sem_alerta_SCCON",
            "geometry": pts.geometry,
        },
        crs=auas.crs,
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_file(out_path)
    print(f"Pontos: {len(out)} | área ha: {out['area_ha'].sum():.4f} | {out_path}")


if __name__ == "__main__":
    main()
