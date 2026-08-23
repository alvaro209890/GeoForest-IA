import { describe, expect, it } from "vitest";

import { reportPdfWinAnsiText } from "./report-text";

// As fontes padrão do PDFKit só codificam WinAnsi. Antes disto o laudo saía com
// `2007!’SPOT 2008` no lugar de "2007→SPOT 2008" e `AC A)VN` no lugar de
// "AC∩AVN" — texto ilegível no meio de uma frase que parecia normal.
describe("reportPdfWinAnsiText", () => {
    it("translitera a seta da transição 2007→SPOT 2008", () => {
        const out = reportPdfWinAnsiText("mudança na transição 2007→SPOT 2008");
        expect(out).not.toContain("→");
        expect(out).toContain("2007 -> SPOT 2008");
    });

    it("translitera o símbolo de interseção usado em AC∩AVN", () => {
        expect(reportPdfWinAnsiText("Sobreposição AC∩AVN")).toBe("Sobreposição AC x AVN");
    });

    it("preserva acentuação portuguesa e travessão", () => {
        const frase = "Área de Uso Alternativo do Solo — inconclusivo; ação não datável";
        expect(reportPdfWinAnsiText(frase)).toBe(frase);
    });

    it("preserva aspas curvas, reticências e bullet do CP1252", () => {
        const frase = "“aspas” ‘simples’ … • – —";
        expect(reportPdfWinAnsiText(frase)).toBe(frase);
    });

    it("troca por '?' o que não tem representação nenhuma", () => {
        expect(reportPdfWinAnsiText("status 🌳 ok")).toBe("status ? ok");
    });

    it("translitera comparadores e checks usados em resumo", () => {
        expect(reportPdfWinAnsiText("área ≤ 0,01 ha")).toBe("área <= 0,01 ha");
        expect(reportPdfWinAnsiText("≥ 1 ha")).toBe(">= 1 ha");
        expect(reportPdfWinAnsiText("✓ conferido")).toBe("OK conferido");
    });
});
