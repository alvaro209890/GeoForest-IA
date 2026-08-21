#!/usr/bin/env python3
"""Aplica a curadoria medida em 21/08/2026 (GetMap + correlação de fase).

Não regenera o catálogo — só marca `descartado` / promove `confirmado` e
reordena o rank do que sobrou. Idempotente.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOGO = ROOT / "config" / "acervo-landsat.json"

# Camadas medidas deslocadas no recorte de laudo (Querência 224/069 ou
# Canarana 225/068). Distância no chão no GetMap da janela do imóvel.
DESCARTAR = {
    # 224/069 2004 L2 — 548 m vs as outras duas da mesma data
    "cbers:landsat_224_069_2004_landsat_5_tm_20040623_224_069_l2_comp543",
    # 224/069 2006 L2 — 1147 m vs a série 2003–2008; a de 17/09 está alinhada
    "cbers:landsat_224_069_2006_landsat_5_tm_20060613_224_069_l2_band5_4_3",
    # 224/069 2009 c543 — 1446 m; a lt05 …_geo da mesma data está alinhada
    "cbers:landsat_224_069_2009_landsat_5_tm_20090723_224_069_c543",
    # 224/069 2010 — única cena, 101 m e correlação fraca; SEMA é mais segura
    "cbers:landsat_224_069_2010_landsat_5_20100726_224_069_geo",
    # 224/069 2023 L9 — 4,3 km vs 2011/2021; a _v2 também (2,4 km da rank0)
    "cbers:landsat_224_069_2023_l9_oli_l2sp_224069_20230722_c654",
    "cbers:landsat_224_069_2023_l9_oli_l2sp_224069_20230722_c654_v2",
    # 225/068 2008 — só a …comp543_geo (rank0) alinhou com 2003
    "cbers:landsat_225_068_2008_landsat_5_tm_20080711_225_068_comp543",
    "cbers:landsat_225_068_2008_landsat_5_20080711_225_068_comp543_geo1",
    "cbers:landsat_225_068_2008_landsat_5_20080711_225_068_comp543_geo2",
    # 225/068 2009 — as duas deslocadas (1,4 km e 69 m)
    "cbers:landsat_225_068_2009_landsat_5_20090714_225_068_comp543",
    "cbers:landsat_225_068_2009_landsat_5_20090714_225_068_comp543_geo",
    # 225/068 2010 — a sem _geo 1,8 km; a _geo alinhou
    "cbers:landsat_225_068_2010_landsat_5_20100615_225_068_comp543",
    # 225/068 2007 — 95 m, correlação fraca; não entra em laudo
    "cbers:landsat_225_068_2007_landsat_5_20070927_225_068_comp543_geo",
}

# Cenas rank-0 da janela do laudo, medidas alinhadas (~0–34 m) contra a
# referência da órbita (2008 geototal em 224/069, 2003 em 225/068).
CONFIRMAR = {
    "cbers:landsat_224_069_2003_l5_tm_224069_20030707_c543",
    "cbers:landsat_224_069_2004_l5_tm_224069_20040623_c543",
    "cbers:landsat_224_069_2004_landsat_5_20040623_224_069_comp543_geo",
    "cbers:landsat_224_069_2005_lt05_224069_20051016",
    "cbers:landsat_224_069_2006_lc_5_224_069_20060917_comp654",
    "cbers:landsat_224_069_2007_landsat_5_20070702_224_069_comp543_geo",
    "cbers:landsat_224_069_2008_landsat_5_20080720_224_069_comp5431_geototal",
    "cbers:landsat_224_069_2009_lt05_2240_69_20090723_comp543_geo",
    "cbers:landsat_224_069_2011_l5_tm_27062011_224_069_c543",
    "cbers:landsat_224_069_2013_landsat_08_224_069_20130702",
    "cbers:landsat_224_069_2014_l8_22469_20140822_c654",
    "cbers:landsat_224_069_2015_l8_224069_20150724_c654",
    "cbers:landsat_224_069_2016_l8_oli_224069_20160811_c654",
    "cbers:landsat_224_069_2017_l8_224_069_20170729_comp654",
    "cbers:landsat_224_069_2018_l8_oli_224_069_20180902_c654",
    "cbers:landsat_224_069_2019_lc08_224069_20190820_comp654",
    "cbers:landsat_224_069_2020_lc08_224_069_20200907_comp654",
    "cbers:landsat_224_069_2021_lc08_224069_20210505_comp654",
    "cbers:landsat_225_068_2003_l5_tm_225068_20030730_c543",
    "cbers:landsat_225_068_2005_l5_tm_225068_20050719_c543",
    "cbers:landsat_225_068_2008_landsat_5_20080711_225_068_comp543_geo",
    "cbers:landsat_225_068_2010_landsat_5_20100615_225_068_comp543_geo",
}

MOTIVO = "deslocada no GetMap do recorte de laudo (correlação de fase, 21/08/2026)"


def main() -> None:
    cat = json.loads(CATALOGO.read_text(encoding="utf-8"))
    n_desc = n_conf = 0
    for cena in cat["landsat"]:
        layer = cena["layer"]
        if layer in DESCARTAR:
            cena["status"] = "descartado"
            cena["rank"] = 99
            cena["revisar"] = False
            cena["motivo"] = MOTIVO
            n_desc += 1
        elif layer in CONFIRMAR:
            cena["status"] = "confirmado"
            cena["revisar"] = False
            n_conf += 1
        elif cena.get("revisar") and cena["status"] != "descartado":
            # Grupo co-datado ainda não olhado nesta órbita: não serve em laudo.
            cena["revisar"] = True

    # Reordena rank do que ainda é servível, por (path,row,year).
    grupos: dict[tuple, list] = defaultdict(list)
    for cena in cat["landsat"]:
        if cena["status"] == "descartado":
            continue
        grupos[(cena["path"], cena["row"], cena["year"])].append(cena)
    for xs in grupos.values():
        xs.sort(key=lambda s: (0 if s["status"] == "confirmado" else 1, s.get("rank", 9)))
        for i, cena in enumerate(xs):
            cena["rank"] = i

    cat["curadoria"] = {
        "em": "2026-08-21",
        "metodo": "GetMap 512x400 no envelope de um imóvel real + correlação de fase em bordas",
        "limiar_px": 3,
        "descartadas": sorted(DESCARTAR),
        "confirmadas": sorted(CONFIRMAR),
    }
    CATALOGO.write_text(json.dumps(cat, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"descartadas={n_desc} confirmadas={n_conf} gravado {CATALOGO}")


if __name__ == "__main__":
    main()
