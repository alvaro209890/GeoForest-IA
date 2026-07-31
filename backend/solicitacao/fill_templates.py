"""
Preenche templates .docx de Solicitação de Prioridade SEMA.

Uso: python fill_templates.py <pasta_pdfs> <pasta_saida>
Saída (stdout): caminho do ZIP final (ou linha iniciando com ERRO:)
Stderr: logs de progresso e diagnóstico
"""
import sys, os, re, json, zipfile, fitz
from pathlib import Path
from datetime import datetime
from typing import Optional

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

TEMPLATE_FILES = {
    "requerimento": "Requerimento_padrao_SEMA_TEMPLATE.docx",
    "oficio": "Oficio_Justificativa_PRIORIDADE_TEMPLATE.docx",
}

# ── marcadores esperados em cada template ──
EXPECTED_MARKERS = {
    "requerimento": ["{{LOTE_RURAL}}", "{{LOTE}}", "{{CPF}}", "{{BAIRRO}}"],
    "oficio": ["{{LOTE_RURAL}}", "{{LOTE}}", "{{PROPRIETARIO}}", "{{CPF}}", "{{SIMCAR}}", "{{MATRICULA}}"],
}

# Campos críticos que não podem ficar vazios
CRITICAL_FIELDS = ["lote", "proprietario", "cpf", "simcar"]


def log(msg: str) -> None:
    print(f"  {msg}", file=sys.stderr)


def fail(msg: str) -> None:
    print(f"ERRO: {msg}", file=sys.stderr)
    print(f"ERRO: {msg}")  # stdout para o Node capturar
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════
# VALIDAÇÃO DE PDFs
# ═══════════════════════════════════════════════════════════════

def validate_pdf(pdf_path: Path) -> dict:
    """Retorna {'ok': True, 'chars': N} ou {'ok': False, 'reason': ...}."""
    try:
        doc = fitz.open(str(pdf_path))
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        chars = len(text.strip())
        if chars < 20:
            return {"ok": False, "reason": f"PDF ilegível ou escaneado (apenas {chars} caracteres extraídos). "
                                            f"Use OCR ou forneça versão digital."}
        return {"ok": True, "chars": chars, "text": text}
    except Exception as e:
        return {"ok": False, "reason": f"Erro ao abrir PDF: {e}"}


def validate_pdfs(pdf_dir: Path) -> list[dict]:
    """Valida todos os PDFs, retorna lista de resultados."""
    results = []
    pdfs = sorted(pdf_dir.glob("*.pdf"))
    if not pdfs:
        fail("Nenhum PDF encontrado na pasta.")
    for p in pdfs:
        r = validate_pdf(p)
        r["name"] = p.name
        results.append(r)
        if r["ok"]:
            log(f"✓ {p.name} ({r['chars']} caracteres)")
        else:
            log(f"✗ {p.name}: {r['reason']}")
    return results


# ═══════════════════════════════════════════════════════════════
# VALIDAÇÃO DE TEMPLATES
# ═══════════════════════════════════════════════════════════════

def validate_template(template_path: Path, template_type: str) -> Optional[str]:
    """Valida integridade do template. Retorna None se OK, ou mensagem de erro."""
    if not template_path.exists():
        return f"Template não encontrado: {template_path}"

    try:
        with zipfile.ZipFile(template_path, 'r') as z:
            xml = z.read('word/document.xml').decode('utf-8')
    except Exception as e:
        return f"Template corrompido ou inválido: {e}"

    missing = [m for m in EXPECTED_MARKERS.get(template_type, []) if m not in xml]
    if missing:
        return f"Marcadores ausentes no template {template_type}: {', '.join(missing)}"
    return None


# ═══════════════════════════════════════════════════════════════
# EXTRAÇÃO DE DADOS
# ═══════════════════════════════════════════════════════════════

def find_in_text(text: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else None


def extract_data_from_pdfs(pdf_dir: Path) -> dict:
    results = validate_pdfs(pdf_dir)

    # Concatena apenas PDFs legíveis
    all_text = ""
    failed = []
    for r in results:
        if r["ok"]:
            all_text += f"\n=== {r['name']} ===\n{r['text']}"
        else:
            failed.append(r["name"])

    if not all_text.strip():
        fail("Nenhum PDF legível encontrado. Todos os PDFs estão escaneados ou corrompidos.")

    if failed:
        log(f"⚠ {len(failed)} PDF(s) ignorados (escaneados/ilegíveis): {', '.join(failed)}")

    data: dict = {}

    # CAR
    data["lote"] = find_in_text(all_text, r"LOTE RURAL (\d+)") or ""
    data["proprietario"] = find_in_text(
        all_text,
        r"Proprietários.*?Nome/Razão Social\s+CPF/CNPJ\s+(\S[^\n]+?)\s+\d{3}\.\d{3}",
    ) or ""
    data["cpf"] = find_in_text(all_text, r"(\d{3}\.\d{3}\.\d{3}-\d{2})") or ""
    data["simcar"] = find_in_text(all_text, r"N[º°] CAR Estadual.*?(MT\d+/\d+)") or ""
    data["matricula"] = find_in_text(all_text, r"Certid[aã]o de registro:\s*(\d[\d.]*)") or ""
    data["municipio"] = find_in_text(all_text, r"Munic[ií]pio\s+(\S[^\n]+)") or "Querência"
    data["area_ha"] = find_in_text(all_text, r"Área\s*\(ha\).*?(\d+[\d,.]*)") or ""

    # Procuração
    data["nacionalidade"] = find_in_text(all_text, r"(brasileir[oa])") or "brasileira"
    data["estado_civil"] = find_in_text(all_text, r"(solteir[oa]|casad[oa]|divorciad[oa]|viúv[oa])") or ""
    data["profissao"] = find_in_text(all_text, r"(empresári[oa]|engenheir[oa]|agricultor[ao]|pecuarista)") or ""

    m = re.search(r"(Habilitação|Identidade).*?[nN][º°]\s*(\d[\d.]+)", all_text)
    data["rg_cnh"] = m.group(2).strip() if m else ""

    # Procurador
    m = re.search(r"constitui suas procurador[ae]s.*?:\s*(\S[^\n,]+)", all_text, re.DOTALL)
    data["procurador"] = m.group(1).strip() if m else ""
    if not data["procurador"]:
        data["procurador"] = find_in_text(
            all_text,
            r"procurador[ae]s?\s*(?:para agirem.*?:)?\s*([A-Z][a-zà-ú]+(?:\s+[A-Z][a-zà-ú]+)+)",
        ) or ""

    # Endereço
    data["endereco"] = ""
    m = re.search(r"(VLA SETOR|SETOR|RUA|AVENIDA|RODOVIA)\s*.{5,60}?\d{5}-\d{3}", all_text)
    if m:
        data["endereco"] = m.group(0).strip()
    if not data["endereco"]:
        data["endereco"] = find_in_text(all_text, r"(Rua\s+[^,]+,\s*n[º°]\s*\d+)") or ""

    # Bairro
    data["bairro"] = find_in_text(all_text, r"(PINGO D[ ']?ÁGUA|Pingo D[ ']?[áa]gua|Setor\s+\w+)") or ""

    # Data
    data["data"] = datetime.now().strftime("%d de %B de %Y")
    meses = {
        "January": "janeiro", "February": "fevereiro", "March": "março", "April": "abril",
        "May": "maio", "June": "junho", "July": "julho", "August": "agosto",
        "September": "setembro", "October": "outubro", "November": "novembro", "December": "dezembro",
    }
    for en, pt in meses.items():
        data["data"] = data["data"].replace(en, pt)

    # AI / TE
    data["ai_numero"] = find_in_text(all_text, r"(?:AUTO DE INFRAÇÃO|AI).*?[nN][º°]\s*(\d[\d.-]*\w)") or ""
    data["te_numero"] = find_in_text(all_text, r"(?:TERMO DE EMBARGO|TE).*?[nN][º°]\s*(\d[\d.-]*\w)") or ""
    data["processo_ibama"] = find_in_text(all_text, r"(?:Processo|PROCESSO).*?[nN][º°]?\s*(\d{5}\.\d{6}/\d{4}-\d{2})") or ""

    # Telefone
    data["telefone"] = find_in_text(all_text, r"(\(\d{2}\)\s*\d[\d\s.-]{7,})") or ""

    # ── validação de campos críticos ──
    missing_critical = [f for f in CRITICAL_FIELDS if not data.get(f)]
    if missing_critical:
        fail(
            f"Dados insuficientes nos PDFs. Campos não encontrados: {', '.join(missing_critical)}. "
            f"Verifique se o CAR está em formato digital (não escaneado)."
        )

    log(f"Dados extraídos: {json.dumps(data, indent=2, ensure_ascii=False)}")
    return data


# ═══════════════════════════════════════════════════════════════
# PREENCHIMENTO DE TEMPLATES
# ═══════════════════════════════════════════════════════════════

def fill_template_xml(xml: str, data: dict, template_type: str) -> str:
    if template_type == "requerimento":
        mappings = {
            r"\{\{LOTE_RURAL\}\}": f"Lote Rural {data['lote']}",
            r"\{\{LOTE\}\}": f"Lote {data['lote']}",
            r"\{\{CPF\}\}": data["cpf"],
            r"\{\{BAIRRO\}\}": data.get("bairro", ""),
            r"Juliana\s*</w:t>.*?<w:t>Durel</w:t>": data["proprietario"],
            r"\{\{SIMCAR\}\}": data["simcar"],
            r"\{\{MATRICULA\}\}": data.get("matricula", ""),
            r"\{\{ENDERECO\}\}": data.get("endereco", ""),
            r"\{\{DATA\}\}": data["data"],
            r"\(\d{2}\)\s*\d[\d\s.-]{7,}": data.get("telefone") or "(66) 00000-0000",
        }
    else:
        mappings = {
            r"\{\{LOTE_RURAL\}\}": f"Lote Rural {data['lote']}",
            r"\{\{LOTE\}\}": f"Lote {data['lote']}",
            r"\{\{PROPRIETARIO\}\}": data["proprietario"],
            r"\{\{CPF\}\}": data["cpf"],
            r"\{\{SIMCAR\}\}": data["simcar"],
            r"\{\{MATRICULA\}\}": data.get("matricula", ""),
            r"data da assinatura digital": data["data"],
        }

    for pattern, replacement in mappings.items():
        xml, count = re.subn(pattern, replacement, xml, flags=re.DOTALL)
        status = f"({count}x)" if count else "NÃO encontrado"
        log(f"[{template_type}] {pattern[:50]:<50} → {status}")

    return xml


def fill_template(template_path: str, output_path: str, data: dict, template_type: str) -> bool:
    try:
        with zipfile.ZipFile(template_path, 'r') as zin:
            xml = zin.read('word/document.xml').decode('utf-8')

        xml = fill_template_xml(xml, data, template_type)

        tmp = output_path + ".tmp"
        with zipfile.ZipFile(template_path, 'r') as zin:
            with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    content = zin.read(item.filename)
                    if item.filename == 'word/document.xml':
                        content = xml.encode('utf-8')
                    zout.writestr(item, content)
        os.replace(tmp, output_path)
        return True
    except Exception as e:
        log(f"[ERRO] {template_type}: {e}")
        return False


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 3:
        fail(f"Uso: {sys.argv[0]} <pasta_pdfs> <pasta_saida>")

    pdf_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Validar templates ──
    log("Validando templates...")
    for key, fname in TEMPLATE_FILES.items():
        err = validate_template(TEMPLATES_DIR / fname, key)
        if err:
            fail(err)
    log("✓ Templates OK")

    # ── 2. Extrair dados ──
    log(f"Extraindo dados de: {pdf_dir}")
    data = extract_data_from_pdfs(pdf_dir)

    # ── 3. Preencher ──
    log("Preenchendo templates...")
    results = {}
    for key, fname in TEMPLATE_FILES.items():
        template_path = TEMPLATES_DIR / fname
        output_name = fname.replace("_TEMPLATE", "").replace(
            "PRIORIDADE_TEMPLATE",
            f"PRIORIDADE_Lote_{data['lote']}_{data['proprietario'].replace(' ', '_')}"
        )
        output_path = output_dir / output_name
        ok = fill_template(str(template_path), str(output_path), data, key)
        results[key] = output_name if ok else None

    if not any(results.values()):
        fail("Falha ao preencher todos os templates.")

    # ── 4. Criar ZIP ──
    zip_path = output_dir / f"Solicitacao_Prioridade_Lote_{data['lote']}.zip"
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for key, fname in results.items():
            if fname:
                zout.write(output_dir / fname, fname)
                log(f"Adicionado: {fname}")

    log(f"\nZIP final: {zip_path}")
    print(str(zip_path))


if __name__ == "__main__":
    main()
