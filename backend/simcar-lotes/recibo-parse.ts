/**
 * Leitura do "Recibo de Inscrição CAR – MT" (PDF) → nº do CAR, propriedade, município.
 *
 * Layout real (pdf-parse, recibo estadual da SEMA-MT — rótulos e valores em linhas
 * separadas, colunas coladas sem separador):
 *
 *   Nº CAR EstadualSituação EstadualTipo
 *   MT10005/2019AtivoDeclarado
 *   Nº Recibo Federal
 *   MT-5107065-AEC311BDEA79437099F3D97F9D599345
 *   PropriedadeUFMunicípio
 *   LOTE RURAL 81MTQuerência
 *
 * Por isso os campos são lidos na LINHA SEGUINTE ao rótulo, com fallback global.
 */
import { extractZipEntries } from "../geo-utils";
import type { ReciboParseado } from "./types";

// Sem `\b` no fim: no PDF a coluna seguinte vem colada ("MT10005/2019AtivoDeclarado"),
// e `\b` entre "9" e "A" não existe. O lookahead garante ano de 4 dígitos exatos.
const RX_CAR_ESTADUAL = /\bMT[-\s]?(\d{2,9})\s*\/\s*(\d{4})(?!\d)/i;
const RX_RECIBO_FEDERAL = /\bMT-\d{7}-[A-Z0-9]{20,}(?![A-Z0-9])/i;
const RX_CPF_CNPJ = /\s*(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\s*$/;

const RX_ROTULO_CAR = /N[º°o]?\s*CAR\s*Estadual/i;
const RX_ROTULO_FEDERAL = /N[º°o]?\s*Recibo\s*Federal/i;
const RX_ROTULO_PROPRIEDADE = /^Propriedade\s*UF\s*Munic[ií]pio/i;
const RX_ROTULO_PROPRIETARIO = /Nome\s*\/\s*Raz[ãa]o\s*Social/i;

let cachedPdfParser: null | ((buffer: Buffer) => Promise<{ text?: string }>) = null;

async function pdfText(buffer: Buffer): Promise<string> {
  if (!cachedPdfParser) {
    const mod: any = await import("pdf-parse");
    const parser = (mod?.default || mod) as (input: Buffer) => Promise<{ text?: string }>;
    if (typeof parser !== "function") throw new Error("pdf-parse indisponível.");
    cachedPdfParser = parser;
  }
  const parsed = await cachedPdfParser(buffer);
  return String(parsed?.text || "");
}

/** "MT-10005 / 2019" → "MT10005/2019". */
export function normalizarCarEstadual(value: unknown): string | null {
  const match = String(value || "").match(RX_CAR_ESTADUAL);
  if (!match) return null;
  return `MT${match[1]}/${match[2]}`;
}

function linhasUteis(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Primeiro casamento de `rx` nas N linhas seguintes ao rótulo (0 = a própria linha). */
function valorAposRotulo(
  linhas: string[],
  rotulo: RegExp,
  extrair: (linha: string) => string | null,
  janela = 3,
): string | null {
  for (let i = 0; i < linhas.length; i += 1) {
    if (!rotulo.test(linhas[i])) continue;
    for (let j = i; j <= Math.min(i + janela, linhas.length - 1); j += 1) {
      const valor = extrair(linhas[j]);
      if (valor) return valor;
    }
  }
  return null;
}

/**
 * "LOTE RURAL 81MTQuerência" → propriedade + município.
 * A UF é sempre MT (SIMCAR é estadual); o `.*` guloso pega o ÚLTIMO "MT" da linha,
 * preservando nomes de propriedade que contenham "MT".
 */
function separarPropriedadeMunicipio(linha: string): { propriedade: string; municipio: string } | null {
  const match = linha.match(/^(.*\S)\s*MT\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'´`.\- ]*)$/);
  if (!match) return null;
  const propriedade = match[1].trim();
  const municipio = match[2].trim();
  if (!propriedade || !municipio) return null;
  return { propriedade, municipio };
}

/** Extrai os campos do texto já convertido do PDF. */
export function parseReciboText(text: string, filename: string): ReciboParseado {
  const linhas = linhasUteis(text);

  const carEstadual =
    valorAposRotulo(linhas, RX_ROTULO_CAR, (linha) => normalizarCarEstadual(linha)) ||
    normalizarCarEstadual(text);

  const reciboFederal =
    valorAposRotulo(linhas, RX_ROTULO_FEDERAL, (linha) => {
      const m = linha.match(RX_RECIBO_FEDERAL);
      return m ? m[0].toUpperCase() : null;
    }) || (text.match(RX_RECIBO_FEDERAL)?.[0]?.toUpperCase() ?? null);

  let propriedade: string | null = null;
  let municipio: string | null = null;
  for (let i = 0; i < linhas.length; i += 1) {
    if (!RX_ROTULO_PROPRIEDADE.test(linhas[i])) continue;
    const separado = linhas[i + 1] ? separarPropriedadeMunicipio(linhas[i + 1]) : null;
    if (separado) {
      propriedade = separado.propriedade;
      municipio = separado.municipio;
      break;
    }
  }
  if (!propriedade) {
    // Layout alternativo (recibo federal/SICAR): rótulo e valor na mesma linha.
    propriedade = text.match(/Propriedade\s*:\s*(.+)/i)?.[1]?.trim() || null;
  }
  if (!municipio) {
    municipio = text.match(/Munic[ií]pio\s*:\s*(.+)/i)?.[1]?.trim() || null;
  }

  const proprietario = valorAposRotulo(linhas, RX_ROTULO_PROPRIETARIO, (linha) => {
    if (RX_ROTULO_PROPRIETARIO.test(linha)) return null;
    const nome = linha.replace(RX_CPF_CNPJ, "").trim();
    return nome && /[A-Za-zÀ-ÿ]/.test(nome) ? nome : null;
  });

  const identificado = Boolean(carEstadual || reciboFederal);
  return {
    filename,
    carEstadual,
    reciboFederal,
    propriedade,
    municipio,
    proprietario,
    erro: identificado ? null : `Não foi possível identificar o CAR no arquivo ${filename}.`,
  };
}

/** Lê um PDF de recibo. Nunca lança: PDF ilegível vira `erro` na linha do lote. */
export async function parseReciboPdf(buffer: Buffer, filename: string): Promise<ReciboParseado> {
  try {
    const text = await pdfText(buffer);
    if (!text.trim()) {
      return {
        filename,
        carEstadual: null,
        reciboFederal: null,
        propriedade: null,
        municipio: null,
        proprietario: null,
        erro: `O PDF ${filename} não tem texto (recibo escaneado?). Informe o CAR manualmente.`,
      };
    }
    return parseReciboText(text, filename);
  } catch (error: any) {
    return {
      filename,
      carEstadual: null,
      reciboFederal: null,
      propriedade: null,
      municipio: null,
      proprietario: null,
      erro: `Falha ao ler o PDF ${filename}: ${error?.message || error}`,
    };
  }
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function isZip(buffer: Buffer): boolean {
  return buffer.subarray(0, 2).toString("ascii") === "PK";
}

/** PDFs de um envio: um PDF solto ou um ZIP (aceita aninhamento; dedupe por nome). */
export function extrairPdfsDoEnvio(
  buffer: Buffer,
  fallbackName = "recibo.pdf",
): Array<{ name: string; data: Buffer }> {
  if (isPdf(buffer)) return [{ name: fallbackName, data: buffer }];
  if (!isZip(buffer)) return [];

  const vistos = new Set<string>();
  const saida: Array<{ name: string; data: Buffer }> = [];
  const visitar = (zip: Buffer, profundidade: number): void => {
    for (const entry of extractZipEntries(zip)) {
      if (entry.name.endsWith("/")) continue;
      const base = entry.name.split("/").pop() || entry.name;
      if (base.startsWith(".") || base.startsWith("__MACOSX")) continue;
      if (/\.pdf$/i.test(base)) {
        const chave = base.toLowerCase();
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        saida.push({ name: base, data: entry.data });
        continue;
      }
      if (/\.zip$/i.test(base) && profundidade < 3) visitar(entry.data, profundidade + 1);
    }
  };
  visitar(buffer, 0);
  return saida;
}

/** Lê todos os recibos de um envio (PDF ou ZIP), preservando a ordem do arquivo. */
export async function parseRecibosDoEnvio(
  buffer: Buffer,
  fallbackName = "recibo.pdf",
): Promise<ReciboParseado[]> {
  const pdfs = extrairPdfsDoEnvio(buffer, fallbackName);
  if (!pdfs.length) throw new Error("Nenhum recibo PDF encontrado no arquivo enviado.");
  const lotes: ReciboParseado[] = [];
  for (const pdf of pdfs) lotes.push(await parseReciboPdf(pdf.data, pdf.name));
  return lotes;
}
