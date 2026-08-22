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
