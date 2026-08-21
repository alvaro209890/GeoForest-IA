#!/usr/bin/env python3
"""Mede deslocamento real (pixels) entre cenas do acervo, no recorte do laudo.

Roda no server (GeoServer em 127.0.0.1:8081). Mesma janela para todas as cenas:
o envelope de um imóvel real de Querência (job 8d67f503), um pouco expandido.

Mesma data + GetMap = se o pico de correlação não está no (0,0), uma das
versões está deslocada. Isso o bbox NÃO vê: 30–300 m cabem dentro da variação
natural de enquadramento da órbita.

Uso:
    python3 scripts/auditar-deslocamento-acervo.py
"""
from __future__ import annotations

import io
import json
import math
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

WMS = os.environ.get("ACERVO_WMS_BASE_URL", "http://127.0.0.1:8081/geoserver/wms")
ROOT = Path(__file__).resolve().parents[1]
CATALOGO = ROOT / "config" / "acervo-landsat.json"
SAIDA = Path(os.environ.get("ACERVO_AUDIT_DIR", "/tmp/acervo-audit"))
# Imóvel real (Querência) + margem ~1,5 km para ter estrada/rio no quadro.
BBOX = (-52.422, -12.620, -52.340, -12.568)
WIDTH, HEIGHT = 512, 400
# 1 pixel ≈ 16 m nesta janela. 2 px ~ 32 m — abaixo disso é ruído de reamostragem.
LIMIAR_PX = 3


def getmap(layer: str) -> np.ndarray | None:
    q = {
        "service": "WMS",
        "request": "GetMap",
        "version": "1.1.1",
        "layers": layer,
        "styles": "",
        "format": "image/png",
        "transparent": "false",
        "srs": "EPSG:4326",
        "bbox": ",".join(str(v) for v in BBOX),
        "width": str(WIDTH),
        "height": str(HEIGHT),
    }
    url = WMS + "?" + urllib.parse.urlencode(q)
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
    except Exception as e:
        print(f"  GETMAP FAIL {layer}: {e}")
        return None
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        print(f"  GETMAP NOT PNG {layer}: {data[:80]!r}")
        return None
    img = Image.open(io.BytesIO(data)).convert("L")
    arr = np.asarray(img, dtype=np.float32)
    # Recusa quadro vazio (preto/branco).
    if arr.std() < 8:
        print(f"  GETMAP VAZIO std={arr.std():.1f} {layer}")
        return None
    return arr


def edges(a: np.ndarray) -> np.ndarray:
    """Sobel simples: o chão muda de ano para ano; estrada/rio/talhão não."""
    gx = np.zeros_like(a)
    gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]
    gy[1:-1, :] = a[2:, :] - a[:-2, :]
    mag = np.hypot(gx, gy)
    mag -= mag.mean()
    return mag


def phase_shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    """Deslocamento (dx, dy) em pixels de b em relação a a, e o pico (0–1)."""
    fa = np.fft.fft2(a)
    fb = np.fft.fft2(b)
    r = fa * np.conj(fb)
    denom = np.abs(r)
    denom[denom == 0] = 1
    r /= denom
    c = np.abs(np.fft.ifft2(r))
    peak_idx = np.unravel_index(np.argmax(c), c.shape)
    peak = float(c[peak_idx] / (c.size ** 0.0 + 1e-9))
    # normaliza o pico pelo segundo máximo para ter um score relativo
    flat = c.ravel().copy()
    flat.sort()
    second = float(flat[-2]) if flat.size > 1 else 1.0
    score = float(c[peak_idx] / (second + 1e-9))
    dy = int(peak_idx[0])
    dx = int(peak_idx[1])
    if dy > a.shape[0] / 2:
        dy -= a.shape[0]
    if dx > a.shape[1] / 2:
        dx -= a.shape[1]
    return float(dx), float(dy), score


def metros_por_pixel() -> tuple[float, float]:
    lat = (BBOX[1] + BBOX[3]) / 2
    mx = 111_320 * math.cos(lat * math.pi / 180) * (BBOX[2] - BBOX[0]) / WIDTH
    my = 111_320 * (BBOX[3] - BBOX[1]) / HEIGHT
    return mx, my


def main() -> None:
    cat = json.loads(CATALOGO.read_text(encoding="utf-8"))
    SAIDA.mkdir(parents=True, exist_ok=True)
    mx, my = metros_por_pixel()
    print(f"janela {BBOX}  {WIDTH}x{HEIGHT}  ~{mx:.1f} m/px x {my:.1f} m/px")

    cache: dict[str, np.ndarray | None] = {}

    def arr(layer: str) -> np.ndarray | None:
        if layer not in cache:
            print(f"  fetch {layer.split(':')[-1][-70:]}")
            cache[layer] = getmap(layer)
        return cache[layer]

    ls = [x for x in cat["landsat"] if x["status"] != "descartado"]

    # 1) grupos mesma data
    grupos: dict[tuple, list] = defaultdict(list)
    for x in ls:
        if x.get("date"):
            grupos[(x["path"], x["row"], x["date"])].append(x)

    resultados_grupos = []
    print("\n=== MESMA DATA ===")
    for key, xs in sorted(grupos.items()):
        if len(xs) < 2:
            continue
        xs = sorted(xs, key=lambda s: s["rank"])
        imagens = [(s, arr(s["layer"])) for s in xs]
        imagens = [(s, a) for s, a in imagens if a is not None]
        if len(imagens) < 2:
            print(f"{key} sem pares válidos")
            continue
        ref_s, ref_a = imagens[0]
        print(f"\n{key[0]}/{key[1]} {key[2]}  ref=rank{ref_s['rank']}")
        linhas = []
        for s, a in imagens:
            dx, dy, score = phase_shift(edges(ref_a), edges(a))
            dist_m = math.hypot(dx * mx, dy * my)
            flag = "DESLOCADA" if max(abs(dx), abs(dy)) >= LIMIAR_PX and s is not ref_s else "ok"
            print(f"  rank{s['rank']} dx={dx:.0f} dy={dy:.0f} ({dist_m:.0f} m) score={score:.2f} {flag} {s['layer'].split(':')[-1][-55:]}")
            linhas.append({
                "layer": s["layer"],
                "rank": s["rank"],
                "dx": dx,
                "dy": dy,
                "metros": dist_m,
                "score": score,
                "flag": flag,
            })
        resultados_grupos.append({"key": key, "linhas": linhas})

    # 2) série 224/069 rank0 2003-2011 vs 2008 (a cena geototal)
    print("\n=== SÉRIE 224/069 rank0 vs 2008 ===")
    serie = [
        x for x in ls
        if x["path"] == "224" and x["row"] == "069" and x["rank"] == 0
        and 2003 <= x["year"] <= 2011
    ]
    serie = sorted(serie, key=lambda s: s["year"])
    ref = next((x for x in serie if x["year"] == 2008), None)
    ref_a = arr(ref["layer"]) if ref else None
    serie_out = []
    if ref_a is not None:
        for s in serie:
            a = arr(s["layer"])
            if a is None:
                continue
            dx, dy, score = phase_shift(edges(ref_a), edges(a))
            dist_m = math.hypot(dx * mx, dy * my)
            flag = "DESLOCADA" if max(abs(dx), abs(dy)) >= LIMIAR_PX and s["year"] != 2008 else "ok"
            print(f"  {s['year']} dx={dx:.0f} dy={dy:.0f} ({dist_m:.0f} m) score={score:.2f} {flag} {s['layer'].split(':')[-1][-50:]}")
            serie_out.append({
                "year": s["year"],
                "layer": s["layer"],
                "dx": dx, "dy": dy, "metros": dist_m, "score": score, "flag": flag,
            })

    # 3) pares consecutivos da série (pega deslocamento relativo ano a ano)
    print("\n=== PARES CONSECUTIVOS 224/069 ===")
    pares = []
    validos = [(s, arr(s["layer"])) for s in serie]
    validos = [(s, a) for s, a in validos if a is not None]
    for (s0, a0), (s1, a1) in zip(validos, validos[1:]):
        dx, dy, score = phase_shift(edges(a0), edges(a1))
        dist_m = math.hypot(dx * mx, dy * my)
        flag = "DESLOCADA" if max(abs(dx), abs(dy)) >= LIMIAR_PX else "ok"
        print(f"  {s0['year']}→{s1['year']} dx={dx:.0f} dy={dy:.0f} ({dist_m:.0f} m) score={score:.2f} {flag}")
        pares.append({
            "de": s0["year"], "para": s1["year"],
            "dx": dx, "dy": dy, "metros": dist_m, "score": score, "flag": flag,
        })

    out = {
        "bbox": BBOX,
        "m_por_px": [mx, my],
        "limiar_px": LIMIAR_PX,
        "grupos": [
            {"path": k[0], "row": k[1], "date": k[2], "linhas": g["linhas"]}
            for g in resultados_grupos
            for k in [g["key"]]
        ],
        "serie_224_069": serie_out,
        "pares": pares,
    }
    (SAIDA / "deslocamento.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\ngravado {SAIDA / 'deslocamento.json'}")


if __name__ == "__main__":
    main()
