/**
 * Timbrado da IMAP no laudo PDF.
 *
 * O que estes testes protegem:
 *  - a geometria continua sendo a do Ofício (se alguém "arredondar" as margens,
 *    o laudo deixa de bater com os .docx do sistema de acompanhamento);
 *  - o PNG do timbrado continua no pacote e é a folha A4 inteira;
 *  - desenhar o timbrado não suja o estado de texto do pdfkit — é isso que
 *    mantém o parágrafo na fonte/cor certas quando a quebra de página cai no
 *    meio de um `text()`.
 */
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";

import {
    createImapTimbrado,
    loadTimbradoImapPng,
    IMAP_ADDRESS_LINES,
    IMAP_CONTENT_WIDTH,
    IMAP_FOOTER,
    IMAP_HEADER,
    IMAP_PAGE,
} from "./report-imap";

function novoDoc() {
    return new PDFDocument({
        size: "A4",
        margins: {
            top: IMAP_PAGE.marginTop,
            bottom: IMAP_PAGE.marginBottom,
            left: IMAP_PAGE.marginLeft,
            right: IMAP_PAGE.marginRight,
        },
        bufferPages: true,
    });
}

describe("geometria do Ofício", () => {
    it("converte as margens do sectPr (twips) para pontos", () => {
        expect(IMAP_PAGE.marginTop).toBeCloseTo(107.7, 4); // 2154 twips
        expect(IMAP_PAGE.marginBottom).toBeCloseTo(85, 4); // 1700 twips
        expect(IMAP_PAGE.marginLeft).toBeCloseTo(70.9, 4); // 1418 twips
        expect(IMAP_PAGE.marginRight).toBeCloseTo(70.9, 4);
        expect(IMAP_CONTENT_WIDTH).toBeCloseTo(453.48, 2);
    });

    it("as duas colunas do rodapé somam a largura útil (7511 + 1559 twips)", () => {
        expect(IMAP_FOOTER.addressWidth + IMAP_FOOTER.pageCellWidth).toBeCloseTo(IMAP_CONTENT_WIDTH, 1);
    });

    it("o fio verde começa depois da logo e para na margem direita", () => {
        expect(IMAP_HEADER.ruleX0).toBeGreaterThan(IMAP_PAGE.marginLeft);
        expect(IMAP_HEADER.ruleX1).toBeCloseTo(IMAP_PAGE.width - IMAP_PAGE.marginRight, 4);
        // Título e fio ficam acima da margem superior, no espaço do cabeçalho.
        expect(IMAP_HEADER.titleY).toBeLessThan(IMAP_HEADER.ruleY);
        expect(IMAP_HEADER.ruleY).toBeLessThan(IMAP_PAGE.marginTop);
    });

    it("o rodapé inteiro cabe na margem inferior", () => {
        const inicio = IMAP_PAGE.height - IMAP_PAGE.marginBottom;
        expect(IMAP_FOOTER.ruleY).toBeGreaterThan(inicio);
        const fim = IMAP_FOOTER.addressY + IMAP_FOOTER.lineStep * IMAP_ADDRESS_LINES.length;
        expect(fim).toBeLessThan(IMAP_PAGE.height);
        expect(IMAP_FOOTER.metaY + IMAP_FOOTER.metaSize).toBeLessThan(IMAP_PAGE.height);
    });
});

describe("asset do timbrado", () => {
    it("acompanha o pacote e é a folha A4 de 1240×1754", () => {
        const png = loadTimbradoImapPng();
        expect(png).not.toBeNull();
        expect(png!.subarray(1, 4).toString("ascii")).toBe("PNG");
        // IHDR: largura e altura ficam nos bytes 16..24.
        expect(png!.readUInt32BE(16)).toBe(1240);
        expect(png!.readUInt32BE(20)).toBe(1754);
    });
});

describe("desenho do timbrado", () => {
    it("devolve fonte, cor e cursor depois do cabeçalho", () => {
        const doc = novoDoc();
        const timbrado = createImapTimbrado(doc, { headerTitle: "LAUDO TÉCNICO SIMCAR" });
        doc.font("Helvetica-Oblique").fontSize(11).fillColor("#CC0000");
        doc.x = 123;
        doc.y = 456;
        const fonteAntes = (doc as any)._font;

        timbrado.drawHeader();

        expect((doc as any)._font).toBe(fonteAntes);
        expect((doc as any)._fontSize).toBe(11);
        expect((doc as any)._fillColor[0]).toBe("#CC0000");
        // O cabeçalho recoloca o cursor no canto da área útil da página nova.
        expect(doc.x).toBeCloseTo(IMAP_PAGE.marginLeft, 4);
        expect(doc.y).toBeCloseTo(IMAP_PAGE.marginTop, 4);
        doc.end();
    });

    it("o rodapé não mexe no cursor nem na margem inferior", () => {
        const doc = novoDoc();
        const timbrado = createImapTimbrado(doc, { headerTitle: "LAUDO", footerMeta: "job-teste" });
        doc.font("Helvetica").fontSize(9).fillColor("#334155");
        doc.x = 200;
        doc.y = 300;

        timbrado.drawFooter(3);

        expect(doc.x).toBe(200);
        expect(doc.y).toBe(300);
        expect(doc.page.margins.bottom).toBeCloseTo(IMAP_PAGE.marginBottom, 4);
        expect((doc as any)._fillColor[0]).toBe("#334155");
        doc.end();
    });

    it("carimba o cabeçalho em toda página nova, sem abrir página extra", async () => {
        const doc = novoDoc();
        const timbrado = createImapTimbrado(doc, { headerTitle: "LAUDO" });
        doc.on("pageAdded", () => timbrado.drawHeader());
        expect(timbrado.hasTimbrado).toBe(true);

        const chunks: Buffer[] = [];
        doc.on("data", (c: Buffer) => chunks.push(c));
        const pronto = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

        doc.addPage();
        doc.addPage();
        const total = doc.bufferedPageRange().count;
        for (let i = 0; i < total; i += 1) {
            doc.switchToPage(i);
            timbrado.drawFooter(i + 1);
        }
        doc.end();
        const pdf = await pronto;

        expect(total).toBe(3);
        expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
        // O PNG entra uma vez só; 3 cópias de 84 KB estourariam com folga.
        expect(pdf.length).toBeLessThan(250_000);
    });
});
