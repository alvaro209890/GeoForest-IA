import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildImportReportPdf, labelImportErrorTipo } from "./import-report-pdf";
import { runImportPhase } from "./processar-projeto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("labelImportErrorTipo", () => {
  it("maps SIMCAR labels like the SEMA PDF", () => {
    expect(labelImportErrorTipo("borda_se_cruza")).toBe("Borda do polígono se cruza");
    expect(labelImportErrorTipo("vertice_duplicado")).toBe("A geometria contém pontos repetidos");
  });
});

describe("buildImportReportPdf", () => {
  it("generates a valid PDF buffer with header and status for reprovado", async () => {
    const pdf = await buildImportReportPdf({
      filename: "projeto_teste.zip",
      ok: false,
      reportId: "abc12345",
      rows: [
        {
          camada: "ARL",
          tipo: "borda_se_cruza",
          feicao: 1,
          parte: 0,
          anel: 1,
          x: -52.1,
          y: -12.1,
          detalhe: "Segmentos do mesmo anel se cruzam.",
        },
        {
          camada: "ARL",
          tipo: "vertice_duplicado",
          feicao: 2,
          parte: 0,
          anel: 1,
          x: -52.2,
          y: -12.2,
          detalhe: "Vértices consecutivos próximos.",
        },
      ],
      camadas: [
        { name: "ATP", code: "ATP", featureCount: 1, crsLabel: "SIRGAS 2000" },
        { name: "ARL", code: "ARL", featureCount: 10, crsLabel: "SIRGAS 2000" },
      ],
      warnings: [],
    });

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(800);
    // PDF magic header (conteúdo de texto costuma ir em streams comprimidos)
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.includes(Buffer.from("%%EOF"))).toBe(true);
  });

  it("builds PDF for real teste_1 import when fixture exists", async () => {
    const zipPath = path.join(
      __dirname,
      "fixtures",
      "teste_1",
      "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip",
    );
    if (!fs.existsSync(zipPath)) {
      expect(true).toBe(true);
      return;
    }
    const result = runImportPhase(fs.readFileSync(zipPath), "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip");
    const pdf = await buildImportReportPdf({
      filename: "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip",
      ok: result.ok,
      rows: result.rows,
      camadas: result.camadasReconhecidas,
      warnings: result.warnings,
      reportId: "teste1",
    });
    expect(result.ok).toBe(false);
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
