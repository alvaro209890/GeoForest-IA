import type { Express } from "express";

const APF_CONSULTA_URL =
  "https://monitoramento.sema.mt.gov.br/apfruralconsulta/index.aspx";

// ── types ──────────────────────────────────────────────────────────

type ApfSearchItem = {
  /** Número da APF, ex: "31708/2020" */
  numero: string;
  /** Situação: ATIVA, CANCELADA, VENCIDA, etc. */
  situacao: string;
  /** Nome do imóvel */
  imovel: string;
  /** Número do CAR estadual */
  car: string;
  /** Nome e CPF do responsável */
  responsavel: string;
  /** Atividade */
  atividade: string;
  /** Município */
  municipio: string;
  /** Data de emissão */
  dataEmissao: string;
  /** Data de validade */
  dataValidade: string;
  /** Última atualização */
  ultimaAtualizacao: string;
};

type ApfSearchResult = {
  total: number;
  items: ApfSearchItem[];
};

// ── helpers ────────────────────────────────────────────────────────

function onlyDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCpfCnpj(value: unknown): string {
  return String(value || "")
    .replace(/[^\d.\-/]/g, "")
    .slice(0, 14);
}

function normalizeCpf(value: unknown): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return digits;
}

function normalizeApfNumber(value: unknown): string {
  const str = String(value || "").trim();
  // Must match: NUMBER/YEAR e.g. 31708/2020
  if (/^\d+\/\d{4}$/.test(str)) return str;
  return str;
}

function normalizeCarNumber(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function safeFilename(value: unknown, fallback: string): string {
  const cleaned = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
  return cleaned || fallback;
}

// ── ASP.NET scraping core ──────────────────────────────────────────

type HiddenFields = Record<string, string>;

async function getPage(): Promise<{ html: string; hidden: HiddenFields; cookies: string[] }> {
  const response = await fetch(APF_CONSULTA_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`APF_GET_${response.status}`);
  }

  const html = await response.text();
  const setCookie = response.headers.get("set-cookie");
  const cookies = setCookie ? [setCookie] : [];

  const hidden: HiddenFields = {};
  const re = /<input type="hidden"\s+name="([^"]+)"\s+id="[^"]*"\s+value="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    hidden[m[1]] = m[2];
  }

  return { html, hidden, cookies };
}

function buildFormBody(hidden: HiddenFields, overrides: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  params.set("__VIEWSTATE", hidden["__VIEWSTATE"] || "");
  params.set("__VIEWSTATEGENERATOR", hidden["__VIEWSTATEGENERATOR"] || "");
  params.set("__EVENTVALIDATION", hidden["__EVENTVALIDATION"] || "");
  params.set("__EVENTTARGET", overrides["__EVENTTARGET"] || "");
  params.set("__EVENTARGUMENT", overrides["__EVENTARGUMENT"] || "");
  params.set("__LASTFOCUS", overrides["__LASTFOCUS"] || "");
  params.set("txtCpfCnpjProprietario", overrides["txtCpfCnpjProprietario"] || "");
  params.set("txtCpfResponsavel", overrides["txtCpfResponsavel"] || "");
  params.set("txtNumeroApf", overrides["txtNumeroApf"] || "");
  params.set("rblNumeroCar", overrides["rblNumeroCar"] || "FEDERAL");
  params.set("txtNumeroSicar", overrides["txtNumeroSicar"] || "");
  if (overrides["btnBuscar"]) params.set("btnBuscar", overrides["btnBuscar"]);
  return params;
}

async function postForm(
  body: URLSearchParams,
  cookieHeader: string,
): Promise<string> {
  const response = await fetch(APF_CONSULTA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      Origin: "https://monitoramento.sema.mt.gov.br",
      Referer: APF_CONSULTA_URL,
      Cookie: cookieHeader,
    },
    body: body.toString(),
  });

  // If PDF, return raw buffer info
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const header = buffer.subarray(0, 5).toString("ascii");
    if (header !== "%PDF-") {
      throw new Error("APF_DOWNLOAD_INVALID_PDF");
    }
    // Return special marker for PDF
    return `__PDF__${buffer.toString("base64")}`;
  }

  return response.text();
}

// ── search ─────────────────────────────────────────────────────────

async function searchApf(params: {
  cpfCnpj?: string;
  cpfResponsavel?: string;
  numeroApf?: string;
  carNumber?: string;
  carType?: "FEDERAL" | "ESTADUAL";
}): Promise<ApfSearchResult> {
  // Get fresh page
  const { hidden } = await getPage();

  // Submit search
  const overrides: Record<string, string> = {
    txtCpfCnpjProprietario: params.cpfCnpj || "",
    txtCpfResponsavel: params.cpfResponsavel || "",
    txtNumeroApf: params.numeroApf || "",
    rblNumeroCar: params.carType || "FEDERAL",
    txtNumeroSicar: params.carNumber || "",
    btnBuscar: "Buscar",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
  };

  const body = buildFormBody(hidden, overrides);
  const html = await postForm(body, "");

  // Check for error message
  const msgMatch = html.match(/id="spanMsg">([^<]+)</);
  if (msgMatch) {
    const msg = msgMatch[1]
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, " ");
    throw new Error(msg);
  }

  // Parse results from repeater
  const items: ApfSearchItem[] = [];
  const panelRe = /<div id="repeater_divApfInterno_(\d+)"[^>]*>([\s\S]*?)<div class="panel-footer"/g;
  let panelMatch: RegExpExecArray | null;
  while ((panelMatch = panelRe.exec(html)) !== null) {
    const panelHtml = panelMatch[2];
    const index = panelMatch[1];
    const getSpan = (id: string) => {
      const re = new RegExp(`id="repeater_${id}_${index}"[^>]*>([^<]*)<`);
      const m = re.exec(panelHtml);
      return m ? m[1].trim() : "";
    };

    items.push({
      numero: getSpan("labApfNumero"),
      situacao: getSpan("labSituacao"),
      imovel: getSpan("labImovel"),
      car: getSpan("labCarNumero"),
      responsavel: getSpan("labResponsavel"),
      atividade: getSpan("labAtividade"),
      municipio: getSpan("labMunicipio"),
      dataEmissao: getSpan("labDataEmissao"),
      dataValidade: getSpan("labDataValidade"),
      ultimaAtualizacao: getSpan("labUltimaAtualizacao"),
    });
  }

  // Get total count from label
  const qtyMatch = html.match(/id="lblQuantidadeResultado"[^>]*>([^<]*)</);
  let total = items.length;
  if (qtyMatch) {
    const qty = qtyMatch[1];
    const numMatch = qty.match(/(\d+)/);
    if (numMatch) total = Number(numMatch[1]);
  }

  return { total, items };
}

// ── download ───────────────────────────────────────────────────────

async function downloadApfPdf(
  numeroApf: string,
  cpfCnpj: string,
  pdfType: "apf" | "termo" = "apf",
): Promise<Buffer> {
  // First search to get the results page with VIEWSTATE
  const { hidden } = await getPage();

  const searchOverrides: Record<string, string> = {
    txtCpfCnpjProprietario: cpfCnpj,
    txtNumeroApf: numeroApf,
    btnBuscar: "Buscar",
    rblNumeroCar: "FEDERAL",
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    txtCpfResponsavel: "",
    txtNumeroSicar: "",
  };

  const searchBody = buildFormBody(hidden, searchOverrides);
  const searchHtml = await postForm(searchBody, "");

  // Check for error on search
  const msgMatch = searchHtml.match(/id="spanMsg">([^<]+)</);
  if (msgMatch) {
    const msg = msgMatch[1]
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, " ");
    throw new Error(msg);
  }

  // Extract hidden fields from search results
  const hidden2: HiddenFields = {};
  const re = /<input type="hidden"\s+name="([^"]+)"\s+id="[^"]*"\s+value="([^"]*)"/g;
  let m;
  while ((m = re.exec(searchHtml)) !== null) {
    hidden2[m[1]] = m[2];
  }

  // Now click the PDF button
  const eventTarget =
    pdfType === "termo"
      ? "repeater$ctl00$btnPdfTermo"
      : "repeater$ctl00$btnPdfApf";

  const downloadOverrides: Record<string, string> = {
    txtCpfCnpjProprietario: cpfCnpj,
    txtNumeroApf: numeroApf,
    rblNumeroCar: "FEDERAL",
    __EVENTTARGET: eventTarget,
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    txtCpfResponsavel: "",
    txtNumeroSicar: "",
  };

  const downloadBody = buildFormBody(hidden2, downloadOverrides);
  const result = await postForm(downloadBody, "");

  if (result.startsWith("__PDF__")) {
    return Buffer.from(result.slice(7), "base64");
  }

  // Might be HTML with error or no permission
  const errMatch = result.match(/id="spanMsg">([^<]+)</);
  if (errMatch) {
    const msg = errMatch[1]
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, " ");
    throw new Error(msg);
  }

  throw new Error("APF_DOWNLOAD_FAILED");
}

// ── routes ─────────────────────────────────────────────────────────

export function registerApfReceiptRoutes(app: Express) {
  app.post("/api/apf/search", async (req, res) => {
    try {
      const cpfCnpj = normalizeCpfCnpj(req.body?.cpfCnpj);
      const cpfResponsavel = normalizeCpf(req.body?.cpfResponsavel);
      const numeroApf = normalizeApfNumber(req.body?.numeroApf);
      const carNumber = normalizeCarNumber(req.body?.carNumber);
      const carType = req.body?.carType === "ESTADUAL" ? "ESTADUAL" : "FEDERAL";

      if (!cpfCnpj && !cpfResponsavel && !numeroApf && !carNumber) {
        res.status(400).json({
          error:
            "Informe pelo menos um filtro: CPF/CNPJ, CPF do Responsável, Número da APF ou Número do CAR.",
        });
        return;
      }

      const result = await searchApf({
        cpfCnpj,
        cpfResponsavel,
        numeroApf,
        carNumber,
        carType,
      });

      res.json(result);
    } catch (error: any) {
      const msg = String(error?.message || "");
      console.error("[APF] search failed:", msg);

      if (msg.includes("pelo menos um filtro")) {
        res.status(400).json({ error: msg });
      } else if (msg.includes("formato incorreto")) {
        res.status(400).json({ error: msg });
      } else {
        res.status(502).json({ error: "Falha ao consultar APF no portal da SEMA-MT." });
      }
    }
  });

  app.get("/api/apf/download", async (req, res) => {
    const numeroApf = normalizeApfNumber(req.query.numeroApf);
    const cpfCnpj = normalizeCpfCnpj(req.query.cpfCnpj);
    const pdfType = req.query.type === "termo" ? "termo" : "apf";

    if (!numeroApf || !cpfCnpj) {
      res.status(400).json({ error: "Informe número da APF e CPF/CNPJ." });
      return;
    }

    try {
      const pdf = await downloadApfPdf(numeroApf, cpfCnpj, pdfType);
      const filename = safeFilename(
        req.query.filename,
        `apf_${pdfType}_${numeroApf.replace("/", "_")}.pdf`,
      );
      const finalFilename = filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${finalFilename}"`,
      );
      res.send(pdf);
    } catch (error: any) {
      const msg = String(error?.message || "");
      console.error("[APF] download failed:", msg);

      if (msg.includes("APF_DOWNLOAD_INVALID_PDF")) {
        res.status(502).json({ error: "O arquivo retornado não é um PDF válido." });
      } else {
        res.status(502).json({ error: msg || "Falha ao baixar APF." });
      }
    }
  });
}
