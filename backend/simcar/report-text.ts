/**
 * Helpers de texto compartilhados pelos dois formatos do laudo SIMCAR.
 *
 * Nasceram dentro do `report.ts` (PDF). Quando o laudo ganhou a versão `.docx`
 * (`report-docx.ts`), copiar essas funções seria garantir que os dois formatos
 * divergissem na primeira correção — então elas moram aqui, sem dependência de
 * pdfkit nem de docx.
 */

import type { SimcarReportImage } from "./types";

export type { SimcarReportImage };

/** Primeira resposta da IA numa lista de mensagens persistidas. */
export function extractFirstAiText(messages: unknown): string {
    if (!Array.isArray(messages)) return "";
    const found = messages.find((item: any) => item?.role === "ai" && String(item?.text || "").trim());
    return String((found as any)?.text || "").trim();
}

export function normalizeReportImages(value: unknown): SimcarReportImage[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item: any) => ({
            url: String(item?.url || "").trim(),
            caption: String(item?.caption || "").trim(),
        }))
        .filter((item) => item.url);
}

/**
 * Limpeza de texto para uso fora do renderizador de markdown (o renderizador
 * precisa dos `#` e dos `-`, então não passa por aqui).
 */
export function reportCleanText(value: unknown, maxChars = 5000): string {
    return String(value || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/\r/g, "")
        .trim()
        .slice(0, maxChars);
}

function breakLongToken(token: string, chunkSize = 28): string {
    if (token.length <= chunkSize) return token;
    const chunks: string[] = [];
    for (let i = 0; i < token.length; i += chunkSize) {
        chunks.push(token.slice(i, i + chunkSize));
    }
    return chunks.join(" ");
}

/**
 * Deixa um trecho seguro para o renderizador: sem base64, sem URL gigante, sem
 * token infinito. No PDF um token sem espaço estoura a coluna; no Word ele
 * empurra a tabela para fora da folha. O tratamento é o mesmo nos dois.
 */
export function reportPdfSafeText(value: unknown, maxChars = 5000): string {
    return String(value || "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/\r/g, "")
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[imagem incorporada]")
        .replace(/https?:\/\/\S+/gi, (rawUrl) => {
            const cleanUrl = rawUrl.replace(/[),.;:]+$/g, "");
            try {
                const parsed = new URL(cleanUrl);
                return `[link: ${parsed.hostname}]`;
            } catch {
                return "[link externo]";
            }
        })
        .replace(/[^\s]{42,}/g, (token) => breakLongToken(token))
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .trim()
        .slice(0, maxChars);
}

export function reportSingleLineText(value: unknown, maxChars = 120): string {
    const clean = reportPdfSafeText(value, maxChars * 2).replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

/**
 * Fontes padrão do PDFKit (Helvetica & cia) só codificam WinAnsi/CP1252.
 * Qualquer caractere fora dela sai como lixo no laudo — medido no PDF real:
 * "2007→SPOT 2008" imprimia `2007!’SPOT 2008` e "AC∩AVN" imprimia `AC A)VN`.
 * Como o texto vem de três origens (constantes do código, saída da IA e nomes
 * de camada do SIMCAR), tapar buraco string por string não segura: a
 * transliteração roda uma vez só, no desenho do PDF.
 *
 * Só o PDF passa por aqui — o `.docx` é UTF-8 e mantém os símbolos originais.
 */
const WIN_ANSI_REPLACEMENTS: Array<[RegExp, string]> = [
    [/\u2192/g, " -> "], // →
    [/\u2190/g, " <- "], // ←
    [/\u2194/g, " <-> "], // ↔
    [/\u2229/g, " x "], // ∩ (interseção)
    [/\u222A/g, " u "], // ∪
    [/\u2264/g, "<="], // ≤
    [/\u2265/g, ">="], // ≥
    [/\u2260/g, "!="], // ≠
    [/\u2248/g, "~"], // ≈
    [/\u00B1/g, "+/-"], // ±  (existe em WinAnsi, mas some em algumas visualizações)
    [/[\u2713\u2714]/g, "OK"], // ✓ ✔
    [/[\u2717\u2718\u274C]/g, "X"], // ✗ ✘ ❌
    [/\u26A0\uFE0F?/g, "!"], // ⚠
    [/\u00B0/g, "\u00B0"], // ° já é WinAnsi — mantido explícito para não ser "consertado"
];

/**
 * O que o CP1252 representa acima de U+00FF. Sem essa lista o descarte final
 * comeria o travessão (—) e as aspas curvas, que o laudo usa em quase toda
 * linha.
 */
const WIN_ANSI_HIGH_CODEPOINTS =
    "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D" +
    "\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";

/**
 * Transliterar é melhor que descartar: o leitor precisa entender a frase mesmo
 * sem o símbolo. O que sobrar fora do WinAnsi (emoji, ideograma) vira "?" — sem
 * isso o glifo errado passaria despercebido dentro de uma frase legível.
 */
export function reportPdfWinAnsiText(value: string): string {
    let out = value;
    for (const [pattern, replacement] of WIN_ANSI_REPLACEMENTS) out = out.replace(pattern, replacement);
    const keep = new Set(WIN_ANSI_HIGH_CODEPOINTS.split(""));
    return (
        [...out] // itera por code point: um emoji é um "?" só, não dois
            .map((ch) => (ch.codePointAt(0)! <= 0xff || keep.has(ch) ? ch : "?"))
            .join("")
            .replace(/\?{2,}/g, "?")
            .replace(/[ \t]{2,}/g, " ")
    );
}
