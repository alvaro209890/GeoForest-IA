"""
Preenche os templates .docx de Solicitação de Prioridade SEMA.

Uso: python fill_templates.py <pasta_pdfs> <pasta_saida>
Extrai dados dos PDFs e preenche os 2 templates .docx.
"""
import sys, os, re, json, zipfile, shutil, fitz
from pathlib import Path
from datetime import datetime

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

TEMPLATE_FILES = {
    "requerimento": "Requerimento_padrao_SEMA_TEMPLATE.docx",
    "oficio": "Oficio_Justificativa_PRIORIDADE_TEMPLATE.docx",
}


def extract_text_from_pdf(pdf_path: str) -> str:
    """Extrai texto de um PDF usando pymupdf."""
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text


def find_in_text(text: str, pattern: str) -> str | None:
    """Busca um padrão regex no texto e retorna o primeiro grupo."""
    m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
    return m.group(1).strip() if m else None


def extract_data_from_pdfs(pdf_dir: str) -> dict:
    """Extrai todos os dados necessários dos PDFs na pasta."""
    pdf_dir = Path(pdf_dir)
    data = {}

    # Varre todos os PDFs e concatena o texto
    all_text = ""
    for pdf_path in sorted(pdf_dir.glob("*.pdf")):
        try:
            text = extract_text_from_pdf(str(pdf_path))
            all_text += f"\n=== {pdf_path.name} ===\n{text}"
        except Exception as e:
            print(f"  [AVISO] Erro ao extrair {pdf_path.name}: {e}", file=sys.stderr)

    # Extrai dados do CAR (fonte mais confiável)
    data["lote"] = find_in_text(all_text, r"LOTE RURAL (\d+)") or ""
    data["proprietario"] = find_in_text(all_text, r"Proprietários.*?Nome/Razão Social\s+CPF/CNPJ\s+(\S[^\n]+?)\s+\d{3}\.\d{3}",) or ""
    data["cpf"] = find_in_text(all_text, r"(\d{3}\.\d{3}\.\d{3}-\d{2})") or ""
    data["simcar"] = find_in_text(all_text, r"Nº CAR Estadual.*?(MT\d+/\d+)") or ""
    data["matricula"] = find_in_text(all_text, r"Certidão de registro:\s*(\d[\d.]*)") or ""
    data["municipio"] = find_in_text(all_text, r"Município\s+(\S[^\n]+)") or "Querência"
    data["area_ha"] = find_in_text(all_text, r"Área \(ha\).*?(\d+[\d,.]*)") or ""

    # Dados da Procuração
    data["nacionalidade"] = find_in_text(all_text, r"(brasileir[oa])") or "brasileira"
    data["estado_civil"] = find_in_text(all_text, r"(solteir[oa]|casad[oa]|divorciad[oa]|viúv[oa])") or ""
    data["profissao"] = find_in_text(all_text, r"(empresári[oa]|engenheir[oa]|agricultor[ao]|pecuarista)") or ""
    data["rg_cnh"] = find_in_text(all_text, r"(Habilitação|Identidade).*?nº\s*(\d+)") or ""
    # Tenta grupo 2 se disponível
    m = re.search(r"(Habilitação|Identidade).*?[nN][º°]\s*(\d[\d.]+)", all_text)
    data["rg_cnh"] = m.group(2).strip() if m else ""

    # Procuração - procurador
    data["procurador"] = find_in_text(all_text, r"procurador[ae]s?\s*(?:para agirem.*?:)?\s*([A-Z][a-zà-ú]+(?:\s+[A-Z][a-zà-ú]+)+)") or ""
    # Fallback: procura pelo nome completo após "procurador"
    m = re.search(r"constitui suas procurador[ae]s.*?:\s*(\S[^\n,]+)", all_text, re.DOTALL)
    data["procurador"] = (m.group(1).strip() if m else "") or data.get("procurador", "")

    # Endereço (do comprovante de energia)
    data["endereco"] = ""
    m = re.search(r"(VLA SETOR|SETOR|RUA|AVENIDA|RODOVIA)\s*.{5,60}?\d{5}-\d{3}", all_text)
    if m:
        data["endereco"] = m.group(0).strip()
    if not data["endereco"]:
        # Fallback da procuração
        data["endereco"] = find_in_text(all_text, r"(Rua\s+[^,]+,\s*n[º°]\s*\d+)") or ""

    # Bairro
    data["bairro"] = find_in_text(all_text, r"(PINGO D[ ']?ÁGUA|Pingo D[ ']?[áa]gua|Setor\s+\w+)") or ""

    # Data atual para o documento
    data["data"] = datetime.now().strftime("%d de %B de %Y")
    # Traduz meses para português
    meses = {"January": "janeiro", "February": "fevereiro", "March": "março", "April": "abril",
             "May": "maio", "June": "junho", "July": "julho", "August": "agosto",
             "September": "setembro", "October": "outubro", "November": "novembro", "December": "dezembro"}
    for en, pt in meses.items():
        data["data"] = data["data"].replace(en, pt)

    # AI e TE - busca números no PDF de embargo
    data["ai_numero"] = find_in_text(all_text, r"(?:AUTO DE INFRAÇÃO|AI).*?[nN][º°]\s*(\d[\d.-]*\w)") or ""
    data["te_numero"] = find_in_text(all_text, r"(?:TERMO DE EMBARGO|TE).*?[nN][º°]\s*(\d[\d.-]*\w)") or ""
    data["processo_ibama"] = find_in_text(all_text, r"(?:Processo|PROCESSO).*?[nN][º°]?\s*(\d{5}\.\d{6}/\d{4}-\d{2})") or ""

    # Telefone
    data["telefone"] = find_in_text(all_text, r"(\(\d{2}\)\s*\d[\d\s.-]{7,})") or ""

    print(f"  Dados extraídos: {json.dumps(data, indent=2, ensure_ascii=False)}", file=sys.stderr)
    return data


def fill_template_xml(xml: str, data: dict, template_type: str) -> str:
    """
    Substitui placeholders no XML do template.
    Usa regex para lidar com texto quebrado em múltiplos runs.
    """
    # Mapeamento de placeholders → valores
    if template_type == "requerimento":
        mappings = {
            r"\{\{LOTE_RURAL\}\}": f"Lote Rural {data.get('lote', '')}",
            r"\{\{LOTE\}\}": f"Lote {data.get('lote', '')}",
            r"\{\{CPF\}\}": data.get("cpf", ""),
            r"\{\{BAIRRO\}\}": data.get("bairro", ""),
            # Para o nome, precisamos lidar com texto quebrado
            r"Juliana\s*</w:t>.*?<w:t>Durel</w:t>": f"{data.get('proprietario', '')}",
            r"\{\{SIMCAR\}\}": data.get("simcar", ""),
            r"\{\{MATRICULA\}\}": data.get("matricula", ""),
            r"\{\{ENDERECO\}\}": data.get("endereco", ""),
            r"\{\{DATA\}\}": data.get("data", ""),
            # Telefone - se existir
            r"\(\d{2}\)\s*\d[\d\s.-]{7,}": data.get("telefone") or "(66) 00000-0000",
        }
    else:  # oficio
        mappings = {
            r"\{\{LOTE_RURAL\}\}": f"Lote Rural {data.get('lote', '')}",
            r"\{\{LOTE\}\}": f"Lote {data.get('lote', '')}",
            r"\{\{PROPRIETARIO\}\}": data.get("proprietario", ""),
            r"\{\{CPF\}\}": data.get("cpf", ""),
            r"\{\{SIMCAR\}\}": data.get("simcar", ""),
            r"\{\{MATRICULA\}\}": data.get("matricula", ""),
            # Data
            r"data da assinatura digital": data.get("data", ""),
        }

    for pattern, replacement in mappings.items():
        xml, count = re.subn(pattern, replacement, xml, flags=re.DOTALL)
        if count > 0:
            print(f"  [{template_type}] Substituído: {pattern[:50]}... ({count}x)", file=sys.stderr)
        else:
            print(f"  [{template_type}] NÃO encontrado: {pattern[:50]}...", file=sys.stderr)

    return xml


def fill_template(template_path: str, output_path: str, data: dict, template_type: str) -> bool:
    """Preenche um template .docx com os dados extraídos."""
    try:
        with zipfile.ZipFile(template_path, 'r') as zin:
            xml = zin.read('word/document.xml').decode('utf-8')

        xml = fill_template_xml(xml, data, template_type)

        # Escreve o .docx preenchido
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
        print(f"  [ERRO] {template_type}: {e}", file=sys.stderr)
        return False


def main():
    if len(sys.argv) < 3:
        print(f"Uso: {sys.argv[0]} <pasta_pdfs> <pasta_saida>", file=sys.stderr)
        sys.exit(1)

    pdf_dir = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    print(f"Extraindo dados de: {pdf_dir}", file=sys.stderr)
    data = extract_data_from_pdfs(pdf_dir)

    print(f"Preenchendo templates...", file=sys.stderr)

    results = {}
    for key, fname in TEMPLATE_FILES.items():
        template_path = TEMPLATES_DIR / fname
        if not template_path.exists():
            print(f"  [ERRO] Template não encontrado: {template_path}", file=sys.stderr)
            results[key] = None
            continue

        output_name = fname.replace("_TEMPLATE", "").replace("PRIORIDADE_TEMPLATE", f"PRIORIDADE_Lote_{data.get('lote', 'XX')}_{data.get('proprietario', 'NOME').replace(' ', '_')}")
        output_path = os.path.join(output_dir, output_name)
        ok = fill_template(str(template_path), output_path, data, key)
        results[key] = output_name if ok else None

    # Cria ZIP
    zip_path = os.path.join(output_dir, f"Solicitacao_Prioridade_Lote_{data.get('lote', 'XX')}.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for key, fname in results.items():
            if fname:
                zout.write(os.path.join(output_dir, fname), fname)
                print(f"  Adicionado: {fname}", file=sys.stderr)

    print(f"\nZIP final: {zip_path}", file=sys.stderr)
    print(zip_path)  # stdout para o Node.js capturar


if __name__ == "__main__":
    main()
