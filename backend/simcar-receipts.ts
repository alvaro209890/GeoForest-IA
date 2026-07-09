import type { Express } from "express";

const SIMCAR_PUBLIC_API =
  "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api/Publico";

type SimcarPublicItem = {
  Id?: number;
  RId?: number;
  NumeroCompleto?: string;
  NumeroReciboFedederal?: string;
  Situacao?: string;
  PropriedadeNome?: string;
  MunicipioTexto?: string;
  DataUltimoEnvio?: string;
  SituacaoCompleta?: string;
  DinamizadoId?: number;
  DinamizadoSituacao?: string | null;
  DinamizadoDataProcessamento?: string | null;
};

type SimcarPublicListResponse = {
  QuantidadeTotal?: number;
  Itens?: SimcarPublicItem[];
};

function onlyDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function normalizeCpf(value: unknown): string {
  return onlyDigits(value).slice(0, 11);
}

function normalizeCarInput(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^MT-(\d+\/\d{4})$/, "MT$1");
}

function isFederalReceipt(value: string): boolean {
  return /^MT-\d{7}-[A-Z0-9]{20,}$/i.test(value);
}

function buildFilters(cpfRaw: unknown, carRaw: unknown): Record<string, string> {
  const filters: Record<string, string> = {};
  const cpf = normalizeCpf(cpfRaw);
  const car = normalizeCarInput(carRaw);

  if (cpfRaw && cpf.length !== 11) {
    throw new Error("CPF_INVALIDO");
  }
  if (cpf) filters.PROPRIETARIO_CPF = cpf;

  if (car) {
    if (isFederalReceipt(car)) {
      filters.NUMERO_CAR_FERERAL = car;
    } else {
      filters.NUMERO = car;
    }
  }

  if (!Object.keys(filters).length) {
    throw new Error("FILTRO_OBRIGATORIO");
  }
  return filters;
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

function mapPublicItem(item: SimcarPublicItem) {
  const id = Number(item.Id || 0);
  return {
    id,
    rid: Number(item.RId || 0) || null,
    numeroCompleto: String(item.NumeroCompleto || "").trim(),
    numeroReciboFederal: String(item.NumeroReciboFedederal || "").trim(),
    situacao: String(item.Situacao || "").trim(),
    situacaoCompleta: String(item.SituacaoCompleta || "").trim(),
    propriedadeNome: String(item.PropriedadeNome || "").trim(),
    municipioTexto: String(item.MunicipioTexto || "").trim(),
    dataUltimoEnvio: String(item.DataUltimoEnvio || "").trim(),
    dinamizadoId: Number(item.DinamizadoId || 0) || null,
    dinamizadoSituacao: item.DinamizadoSituacao || null,
    dinamizadoDataProcessamento: item.DinamizadoDataProcessamento || null,
  };
}

async function searchSimcarReceipts(filters: Record<string, string>) {
  const body = {
    Filtros: filters,
    ItensPorPagina: 1000,
    Pagina: 1,
    IsOrdenarCrescente: true,
    ColunaOrdenar: "",
    Colunas: [],
  };

  const response = await fetch(`${SIMCAR_PUBLIC_API}/ListarRequerimento`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`SIMCAR_SEARCH_${response.status}`);
  }

  const payload = (await response.json()) as SimcarPublicListResponse;
  const items = Array.isArray(payload.Itens) ? payload.Itens.map(mapPublicItem).filter((item) => item.id > 0) : [];

  return {
    total: Number(payload.QuantidadeTotal || items.length) || items.length,
    items,
  };
}

async function fetchReceiptPdf(requerimentoId: string): Promise<Buffer> {
  const url = `${SIMCAR_PUBLIC_API}/DownloadReciboCar/${encodeURIComponent(requerimentoId)}`;
  const request = async (withJsonBody: boolean) =>
    fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/pdf,*/*",
        "User-Agent": "Mozilla/5.0",
        ...(withJsonBody ? { "Content-Type": "application/json" } : {}),
      },
      body: withJsonBody ? "{}" : undefined,
    });

  let response = await request(false);
  if (!response.ok) response = await request(true);
  if (!response.ok) {
    throw new Error(`SIMCAR_DOWNLOAD_${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const header = buffer.subarray(0, 5).toString("ascii");
  if (header !== "%PDF-") {
    throw new Error("SIMCAR_DOWNLOAD_INVALID_PDF");
  }
  return buffer;
}

export function registerSimcarReceiptRoutes(app: Express) {
  app.post("/api/simcar/receipts/search", async (req, res) => {
    try {
      const filters = buildFilters(req.body?.cpf, req.body?.carNumber);
      const result = await searchSimcarReceipts(filters);
      res.json(result);
    } catch (error: any) {
      const code = String(error?.message || "");
      if (code === "CPF_INVALIDO") {
        res.status(400).json({ error: "Informe um CPF completo com 11 dígitos." });
        return;
      }
      if (code === "FILTRO_OBRIGATORIO") {
        res.status(400).json({ error: "Informe CPF, número do CAR ou recibo federal." });
        return;
      }
      console.error("[SIMCAR RECEIPTS] search failed:", error);
      res.status(502).json({ error: "Falha ao consultar recibos no SIMCAR público." });
    }
  });

  app.get("/api/simcar/receipts/download/:id", async (req, res) => {
    const requerimentoId = onlyDigits(req.params.id);
    if (!requerimentoId) {
      res.status(400).json({ error: "Id do requerimento inválido." });
      return;
    }

    try {
      const pdf = await fetchReceiptPdf(requerimentoId);
      const filename = safeFilename(req.query.filename, `recibo_simcar_${requerimentoId}.pdf`);
      const finalFilename = filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdf.length));
      res.setHeader("Content-Disposition", `attachment; filename="${finalFilename}"`);
      res.send(pdf);
    } catch (error) {
      console.error("[SIMCAR RECEIPTS] download failed:", error);
      res.status(502).json({ error: "Falha ao baixar o recibo no SIMCAR público." });
    }
  });
}
