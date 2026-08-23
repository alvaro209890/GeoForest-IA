import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { detectReportKind, reportPhotoAnnexHeading } from "./report-theme";
import { compressReportFigure } from "./report-text";
import { persistSceneForReport, sceneWorthPersisting } from "../analise-pos-recorte/scene-persistence";

// O anexo fotográfico existia só na Fase 1. As Fases 2 e 3 guardavam apenas a
// URL crua do WMS (sem overlay, sem garantia de recorte), então o laudo delas
// saía sem figura nenhuma.

describe("reportPhotoAnnexHeading", () => {
    it("as 3 fases têm cabeçalho de anexo, cada uma com a sua série", () => {
        const f1 = reportPhotoAnnexHeading("AUAS_PRE2008")!;
        const f2 = reportPhotoAnnexHeading("AUAS_POS2008")!;
        const f3 = reportPhotoAnnexHeading("AC_VEG")!;
        expect(f1.title).toContain("2003–2008");
        expect(f2.title).toContain("2009–2019");
        expect(f3.title).toContain("Área Consolidada");
        for (const h of [f1, f2, f3]) {
            // Sem o aviso de falsa-cor o RT lê o mosaico como foto aérea.
            expect(h.subtitle.toLowerCase()).toContain("overlay vermelho");
        }
    });

    it("laudo que não é de fase não ganha anexo", () => {
        expect(reportPhotoAnnexHeading("AC_AVN")).toBeNull();
        expect(reportPhotoAnnexHeading("AUAS_V1")).toBeNull();
        expect(reportPhotoAnnexHeading("GENERICO")).toBeNull();
    });

    it("o kind das 3 fases é detectado pelo meta persistido", () => {
        expect(detectReportKind({ rulesVersion: "auas-pre2008-v2", schemaVersion: 2 })).toBe("AUAS_PRE2008");
        expect(detectReportKind({ phase: "POS_2008" })).toBe("AUAS_POS2008");
        expect(detectReportKind({ phase: "AC_VEG" })).toBe("AC_VEG");
    });
});

describe("sceneWorthPersisting", () => {
    it("persiste o que a visão consegue olhar", () => {
        expect(sceneWorthPersisting("USABLE")).toBe(true);
        expect(sceneWorthPersisting("CLOUD_OR_OCCLUSION")).toBe(true);
        expect(sceneWorthPersisting("LOW_RESOLUTION")).toBe(true);
    });

    it("não persiste o que não tem figura para mostrar", () => {
        expect(sceneWorthPersisting("MISSING")).toBe(false);
        expect(sceneWorthPersisting("INVALID")).toBe(false);
        expect(sceneWorthPersisting("BELOW_MIN_RESOLUTION")).toBe(false);
    });
});

describe("persistSceneForReport", () => {
    it("cena sem buffer ou inutilizável não vira figura", async () => {
        const semBuffer = { polygonId: "AUAS-0001", year: 2008, usability: "USABLE" };
        expect(await persistSceneForReport(semBuffer, { uid: "u", phase: "auas_f1" })).toBeUndefined();

        const inutil = { polygonId: "AUAS-0001", year: 2008, usability: "MISSING", imageBuffer: Buffer.from("x") };
        expect(await persistSceneForReport(inutil, { uid: "u", phase: "auas_f2" })).toBeUndefined();
        expect(inutil.publicImageUrl).toBeUndefined();
    });
});

describe("compressReportFigure", () => {
    it("derruba o peso da cena mantendo imagem válida", async () => {
        // Gradiente com textura suave imita cena de satélite: é o caso em que o
        // PNG fica pesado e o JPEG ganha. (Ruído puro seria o pior caso do JPEG
        // e não representa nada que o WMS devolva.)
        const largura = 1600;
        const altura = 900;
        const raw = Buffer.alloc(largura * altura * 3);
        for (let y = 0; y < altura; y++) {
            for (let x = 0; x < largura; x++) {
                const o = (y * largura + x) * 3;
                const onda = Math.sin(x / 40) * 18 + Math.cos(y / 55) * 14;
                raw[o] = Math.max(0, Math.min(255, Math.round(70 + (x / largura) * 90 + onda)));
                raw[o + 1] = Math.max(0, Math.min(255, Math.round(120 + (y / altura) * 70 - onda)));
                raw[o + 2] = Math.max(0, Math.min(255, Math.round(60 + onda * 2)));
            }
        }
        const png = await sharp(raw, { raw: { width: largura, height: altura, channels: 3 } }).png().toBuffer();

        const comprimido = await compressReportFigure(png);
        expect(comprimido.length).toBeLessThan(png.length);
        const meta = await sharp(comprimido).metadata();
        expect(meta.format).toBe("jpeg");
        expect(meta.width).toBe(largura); // sem upscale nem corte: só recompressão
    });

    it("buffer inválido volta como veio, sem derrubar o laudo", async () => {
        const lixo = Buffer.from("não é imagem");
        expect(await compressReportFigure(lixo)).toBe(lixo);
    });
});
