import { describe, expect, it } from "vitest";

import { derivePhases, readPhaseReport, type DerivePhasesInput } from "./phases";
import { computeSupersededReportUrls } from "./report";

// Cada uma das 3 análises tem o SEU laudo baixável. Antes existia um slot só por
// job (`reportPdfUrl`) e a geração seguinte apagava o arquivo da anterior: rodar
// a Fase 3 fazia o PDF da Fase 1 sumir do storage.

function base(input: Partial<DerivePhasesInput> = {}): DerivePhasesInput {
  return {
    jobId: "job-1",
    auasPolygonCount: 2,
    acPolygonCount: 1,
    runningPhase: null,
    ...input,
  };
}

function artifact(phase: string) {
  return {
    reportPdfUrl: `https://storage.local/${phase}.pdf`,
    reportDocxUrl: `https://storage.local/${phase}.docx`,
    reportPdfGeneratedAt: "2026-08-23T12:00:00.000Z",
    reportPdfFilename: `SIMCAR_Laudo_${phase}.pdf`,
  };
}

describe("readPhaseReport", () => {
  it("devolve os links da fase pedida", () => {
    const links = readPhaseReport({ PRE_2008: artifact("f1") }, "PRE_2008");
    expect(links?.pdfUrl).toBe("https://storage.local/f1.pdf");
    expect(links?.docxUrl).toBe("https://storage.local/f1.docx");
    expect(links?.filename).toBe("SIMCAR_Laudo_f1.pdf");
  });

  it("null quando a fase não gerou laudo, e null sem PDF", () => {
    expect(readPhaseReport({ PRE_2008: artifact("f1") }, "AC_VEG")).toBeNull();
    expect(readPhaseReport({ AC_VEG: { reportDocxUrl: "x" } }, "AC_VEG")).toBeNull();
    expect(readPhaseReport(undefined, "POS_2008")).toBeNull();
  });

  it("DOCX ausente não invalida o laudo (o PDF é a peça final)", () => {
    const links = readPhaseReport({ POS_2008: { reportPdfUrl: "https://s/f2.pdf" } }, "POS_2008");
    expect(links?.pdfUrl).toBe("https://s/f2.pdf");
    expect(links?.docxUrl).toBeNull();
  });
});

describe("derivePhases expõe um laudo por fase", () => {
  it("as 3 fases carregam laudos distintos ao mesmo tempo", () => {
    const phases = derivePhases(
      base({
        phaseReports: {
          PRE_2008: artifact("f1"),
          POS_2008: artifact("f2"),
          AC_VEG: artifact("f3"),
        },
      }),
    );
    expect(phases.phases.PRE_2008.report?.pdfUrl).toBe("https://storage.local/f1.pdf");
    expect(phases.phases.POS_2008.report?.pdfUrl).toBe("https://storage.local/f2.pdf");
    expect(phases.phases.AC_VEG.report?.pdfUrl).toBe("https://storage.local/f3.pdf");
  });

  it("fase sem laudo vem com report null, sem herdar o da vizinha", () => {
    const phases = derivePhases(base({ phaseReports: { PRE_2008: artifact("f1") } }));
    expect(phases.phases.PRE_2008.report).not.toBeNull();
    expect(phases.phases.POS_2008.report).toBeNull();
    expect(phases.phases.AC_VEG.report).toBeNull();
  });

  it("sem phaseReports nenhum card mostra download", () => {
    const phases = derivePhases(base());
    for (const phase of ["PRE_2008", "POS_2008", "AC_VEG"] as const) {
      expect(phases.phases[phase].report).toBeNull();
    }
  });
});

describe("limpeza do laudo anterior não atropela as outras fases", () => {
    const UID = "user-1";
    const url = (nome: string) => `/api/storage/users/${UID}/simcar/analysis/${nome}`;

    const persistido = {
        // topo aponta para o último gerado (Fase 1, neste caso)
        reportPdfUrl: url("f1.pdf"),
        reportDocxUrl: url("f1.docx"),
        phaseReports: {
            PRE_2008: { reportPdfUrl: url("f1.pdf"), reportDocxUrl: url("f1.docx") },
            POS_2008: { reportPdfUrl: url("f2.pdf"), reportDocxUrl: url("f2.docx") },
        },
    };

    it("gerar a Fase 3 não apaga os laudos da Fase 1 nem da Fase 2", () => {
        // Regressão: sem `phase`, a limpeza levava o PDF do topo — que era o da
        // Fase 1 — e o usuário perdia o laudo ao rodar a fase seguinte.
        const alvos = computeSupersededReportUrls(
            UID,
            persistido,
            { reportPdfUrl: url("f3.pdf"), reportDocxUrl: url("f3.docx") },
            "AC_VEG",
        );
        expect(alvos).toEqual([]);
    });

    it("refazer a MESMA fase apaga só os arquivos dela", () => {
        const alvos = computeSupersededReportUrls(
            UID,
            persistido,
            { reportPdfUrl: url("f2-novo.pdf"), reportDocxUrl: url("f2-novo.docx") },
            "POS_2008",
        );
        expect(alvos.sort()).toEqual([url("f2.docx"), url("f2.pdf")].sort());
    });

    it("fluxo sem fase (laudo clássico AC/AVN) segue trocando o slot de topo", () => {
        const alvos = computeSupersededReportUrls(
            UID,
            { reportPdfUrl: url("velho.pdf"), reportDocxUrl: url("velho.docx") },
            { reportPdfUrl: url("novo.pdf"), reportDocxUrl: url("novo.docx") },
        );
        expect(alvos.sort()).toEqual([url("velho.docx"), url("velho.pdf")].sort());
    });

    it("nunca apaga arquivo de outro usuário", () => {
        const alvos = computeSupersededReportUrls(
            UID,
            { reportPdfUrl: "/api/storage/users/outro-uid/simcar/analysis/x.pdf" },
            { reportPdfUrl: url("novo.pdf"), reportDocxUrl: "" },
            "PRE_2008",
        );
        expect(alvos).toEqual([]);
    });
});
