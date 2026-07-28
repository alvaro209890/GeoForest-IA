import pathlib
import re
import zipfile
import pdfplumber

OUT = pathlib.Path(r"C:/Users/Usuario/AppData/Local/Temp/croqui_model_analysis.txt")
lines: list[str] = []


def log(s: str = "") -> None:
    lines.append(s)
    print(s)


def read_kml(p: pathlib.Path) -> None:
    t = p.read_text(encoding="utf-8", errors="replace")
    log(f"=== KML {p.name} ({p.stat().st_size} bytes) ===")
    for m in re.finditer(r"<Style[^>]*id=\"([^\"]+)\"[^>]*>([\s\S]*?)</Style>", t):
        body = re.sub(r"\s+", " ", m.group(2))[:300]
        log(f" STYLE #{m.group(1)}: {body}")
    names = re.findall(r"<name>(.*?)</name>", t, flags=re.I | re.S)
    log(f" placemarks/folders: {len(names)}")
    for n in names:
        log(f"  - {n[:100]}")
    log(f" LineString={t.count('LineString')} Polygon={t.count('Polygon')} Point={t.count('<Point')}")
    # sample style blocks from google earth
    if "StyleMap" in t:
        log(" has StyleMap (Google Earth export)")
    if "gx:" in t:
        log(" has Google extensions")
    log("")


def read_docx(p: pathlib.Path) -> None:
    log(f"=== DOCX {p.name} ===")
    with zipfile.ZipFile(p) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    paras = re.findall(r"<w:p[^>]*>([\s\S]*?)</w:p>", xml)
    log(f" paragraphs: {len(paras)}")
    for i, pxml in enumerate(paras[:2]):
        texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", pxml)
        log(f" P{i}: {''.join(texts)[:600]}")
    fonts = set(re.findall(r'w:ascii="([^"]+)"', xml))
    sizes = sorted(set(re.findall(r'<w:sz w:val="(\d+)"', xml)))
    log(f" fonts: {fonts}")
    log(f" sizes (half-pt): {sizes}")
    log("")


def analyze_pdf(p: pathlib.Path) -> None:
    log(f"=== PDF {p.name} ({p.stat().st_size} bytes) ===")
    with pdfplumber.open(p) as pdf:
        page = pdf.pages[0]
        log(f" page: {page.width}x{page.height}, images={len(page.images)}")
        words = page.extract_words() or []
        for w in sorted(words, key=lambda x: (round(x["top"], 0), x["x0"]))[:50]:
            log(
                f"  y={w['top']:.0f} x={w['x0']:.0f} "
                f"sz={w.get('size', '?')} txt={w['text'][:60]}"
            )
    log("")


models: list[pathlib.Path] = []
for root in [
    pathlib.Path(r"C:/Users/Usuario/Downloads/CAR/Lote_04_Lauri_Pingo_Dgua"),
    pathlib.Path(r"C:/Users/Usuario/Downloads/CAR/Lote 181 - PA São Manoel"),
]:
    if not root.exists():
        continue
    for item in root.rglob("*"):
        if not item.is_file():
            continue
        name = item.name.lower()
        parent = str(item.parent).lower()
        if name.endswith(".kml") and ("croqui" in parent or "lote 181" in parent or "pingo" in parent):
            models.append(item)
        if name.endswith(".docx") and ("croqui" in name or "pingos" in name or "são manoel" in name.lower()):
            models.append(item)
        if name.endswith(".pdf") and "croqui" in name.lower() and item.stat().st_size > 1_000_000:
            models.append(item)

for p in sorted(set(models)):
    if p.suffix.lower() == ".kml":
        read_kml(p)
    elif p.suffix.lower() == ".docx":
        read_docx(p)
    elif p.suffix.lower() == ".pdf":
        analyze_pdf(p)

OUT.write_text("\n".join(lines), encoding="utf-8")
log(f"\nWrote {OUT}")
