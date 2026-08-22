/**
 * Persistência do modo vetorizado — "manter salvo cada análise igual a aba de
 * recorte faz".
 *
 * As duas abas gravam no MESMO documento (`users/<uid>/simcar_clips/<jobId>`),
 * por caminhos diferentes: o recorte grava tudo pelo backend; o vetorizado
 * grava o cabeçalho pelo backend (`persistSimcarClipProcessingState`, na rota
 * de import) e o resto pelas rotas de análise, que são as mesmas dos dois
 * fluxos.
 *
 * O que estes testes travam é o **contrato de merge**: cada etapa acrescenta
 * campos sem apagar os da etapa anterior. Uma sobrescrita silenciosa aqui
 * significa card que volta vazio depois do F5 — que é exatamente o sintoma que
 * se quer evitar.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const UID = "uid-vetorizado";
const JOB = "job-vetorizado-1";

let storageRoot = "";
let hydration: typeof import("./hydration");

/** Lê o JSON cru do documento, como o backend faz na hora de gerar o laudo. */
function lerDoc(): Record<string, any> | null {
    return hydration.readPersistedSimcarClipForUid(UID, JOB);
}

beforeAll(async () => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-vetorizado-"));
    process.env.LOCAL_DATA_ROOT = storageRoot;
    vi.resetModules();
    hydration = await import("./hydration");
});

afterAll(() => {
    delete process.env.LOCAL_DATA_ROOT;
    if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("ciclo de vida do card vetorizado", () => {
    it("1. import grava o cabeçalho com sourceMode vetorizado", async () => {
        await hydration.persistSimcarClipProcessingState({
            uid: UID,
            jobId: JOB,
            filename: "santa_clara.zip",
            sourceMode: "vectorized-analysis",
            status: "completed",
            result: {
                downloadUrl: "/api/simcar/clip/download/job-vetorizado-1",
                inputZipUrl: `/api/storage/users/${UID}/simcar/input/in.zip`,
                outputZipUrl: `/api/storage/users/${UID}/simcar/output/out.zip`,
                contextUrl: `/api/storage/users/${UID}/simcar/context/ctx.json`,
                summary: {
                    propertyAreaHa: 38037.3,
                    crs: "EPSG:4674",
                    layersProcessed: 28,
                    layersWithData: 13,
                    totalFeaturesClipped: 797,
                    processingTimeMs: 0,
                    layers: [{ name: "AVN", source: "wfs", features: 238, areaHa: 62578.16 }],
                },
            },
        });
        const doc = lerDoc()!;
        expect(doc.sourceMode).toBe("vectorized-analysis");
        expect(doc.contextUrl).toContain("ctx.json");
        expect(doc.summary?.propertyAreaHa).toBeCloseTo(38037.3, 1);
    });

    it("2. etapa AC/AVN acrescenta a análise sem apagar o cabeçalho", async () => {
        await hydration.persistSimcarClipArtifacts({
            uid: UID,
            jobId: JOB,
            patch: {
                analysisImages: [{ url: "/img/spot.png", caption: "SPOT 2008" }],
                analysisMessages: [{ role: "ai", text: "Achados AC/AVN.", images: ["/img/spot.png"] }],
                analysisMeta: { globalVerdict: { acForaShape: "NAO", confidence: "ALTA" } },
                analysisRulesVersion: "acavn-fixed-v5",
            },
        });
        const doc = lerDoc()!;
        // o que veio agora
        expect(doc.analysisMessages?.[0]?.text).toBe("Achados AC/AVN.");
        expect(doc.analysisMeta?.globalVerdict?.acForaShape).toBe("NAO");
        // e o que já existia
        expect(doc.sourceMode).toBe("vectorized-analysis");
        expect(doc.contextUrl).toContain("ctx.json");
    });

    it("3. etapa AUAS acrescenta o laudo unificado sem apagar o AC/AVN", async () => {
        await hydration.persistSimcarClipArtifacts({
            uid: UID,
            jobId: JOB,
            patch: {
                auasAnalysisImages: [{ url: "/img/auas.png", caption: "AUAS 2019" }],
                auasAnalysisMessages: [{ role: "ai", text: "Laudo integrado AC/AVN + AUAS." }],
                auasMeta: { finalStatus: "AUAS_VALIDA" },
            },
        });
        const doc = lerDoc()!;
        expect(doc.auasAnalysisMessages?.[0]?.text).toContain("Laudo integrado");
        // A etapa AC/AVN precisa sobreviver: é dela que o laudo tira a seção AC.
        expect(doc.analysisMessages?.[0]?.text).toBe("Achados AC/AVN.");
        expect(doc.analysisMeta?.globalVerdict?.acForaShape).toBe("NAO");
    });

    it("4. o laudo (PDF + DOCX) grava as duas URLs sem apagar as análises", async () => {
        await hydration.persistSimcarClipArtifacts({
            uid: UID,
            jobId: JOB,
            patch: {
                reportPdfUrl: `/api/storage/users/${UID}/simcar/output/laudo.pdf`,
                reportPdfDownloadUrl: `/api/storage/users/${UID}/simcar/output/laudo.pdf`,
                reportPdfStatus: "ready",
                reportDocxUrl: `/api/storage/users/${UID}/simcar/output/laudo.docx`,
                reportDocxDownloadUrl: `/api/storage/users/${UID}/simcar/output/laudo.docx`,
            },
        });
        const doc = lerDoc()!;
        expect(doc.reportPdfStatus).toBe("ready");
        expect(doc.reportDocxUrl).toContain(".docx");
        expect(doc.auasAnalysisMessages?.[0]?.text).toContain("Laudo integrado");
        expect(doc.analysisMessages?.[0]?.text).toBe("Achados AC/AVN.");
    });

    it("5. o card restaurado tem tudo que a aba precisa para reabrir", () => {
        const doc = lerDoc()!;
        // Mesmo conjunto que o modo recorte grava — é isto que o F5 recarrega.
        for (const campo of [
            "sourceMode",
            "summary",
            "contextUrl",
            "outputZipUrl",
            "analysisMessages",
            "analysisImages",
            "analysisMeta",
            "auasAnalysisMessages",
            "auasAnalysisImages",
            "auasMeta",
            "reportPdfUrl",
            "reportDocxUrl",
        ]) {
            expect(doc[campo], `campo ausente no card: ${campo}`).toBeTruthy();
        }
    });

    it("não vaza para o card de outro usuário", () => {
        expect(hydration.readPersistedSimcarClipForUid("outro-uid", JOB)).toBeNull();
    });
});

describe("posse dos arquivos do laudo", () => {
    it("só apaga arquivo dentro de users/<uid>/", () => {
        expect(hydration.storagePathBelongsToUid(UID, `/api/storage/users/${UID}/simcar/output/laudo.docx`)).toBe(true);
        expect(hydration.storagePathBelongsToUid(UID, "/api/storage/users/outro/simcar/output/laudo.docx")).toBe(false);
        expect(hydration.storagePathBelongsToUid(UID, "https://exemplo.com/laudo.docx")).toBe(false);
        expect(hydration.storagePathBelongsToUid(UID, "")).toBe(false);
    });
});
