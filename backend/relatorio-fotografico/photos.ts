/** Normaliza o upload: EXIF em pé, JPEG, teto de tamanho para a IA e para o Word. */
import sharp from "sharp";
import {
  RELATORIO_FOTO_MAX_FOTOS,
  RelatorioFotoError,
  type FotoEntrada,
  type FotoPronta,
  type OrientacaoFoto,
} from "./types";

const MAX_BASE64_CHARS = 8_000_000;

function decodeBase64(value: string): Buffer {
  const raw = String(value || "").trim();
  const payload = raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw;
  if (!payload || payload.length > MAX_BASE64_CHARS) {
    throw new RelatorioFotoError(
      "Uma fotografia passou do tamanho aceito. Envie imagens já reduzidas.",
      400,
      "FOTO_GRANDE",
    );
  }
  const buffer = Buffer.from(payload, "base64");
  if (!buffer.length) {
    throw new RelatorioFotoError("Uma fotografia veio vazia.", 400, "FOTO_VAZIA");
  }
  return buffer;
}

export function orientacaoDe(width: number, height: number): OrientacaoFoto {
  return height > width ? "portrait" : "landscape";
}

export async function prepareFoto(entrada: FotoEntrada, alvo: "ia" | "docx"): Promise<FotoPronta> {
  const id = String(entrada.id || "").trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
    throw new RelatorioFotoError("Identificador de foto inválido.", 400, "FOTO_ID");
  }
  const nome = String(entrada.nome || "foto.jpg")
    .replace(/[/\\]/g, " ")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 180) || "foto.jpg";
  const maxEdge = alvo === "ia" ? 768 : 1900;
  const quality = alvo === "ia" ? 70 : 88;
  try {
    const jpeg = await sharp(decodeBase64(entrada.base64), { failOn: "none" })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toBuffer();
    const meta = await sharp(jpeg).metadata();
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
    if (width < 1 || height < 1) {
      throw new Error("sem dimensão");
    }
    return { id, nome, width, height, orientation: orientacaoDe(width, height), jpeg };
  } catch (error) {
    if (error instanceof RelatorioFotoError) throw error;
    throw new RelatorioFotoError(
      `Não foi possível ler a fotografia ${nome}.`,
      400,
      "FOTO_INVALIDA",
    );
  }
}

export async function prepareFotos(entradas: FotoEntrada[], alvo: "ia" | "docx"): Promise<FotoPronta[]> {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new RelatorioFotoError("Envie pelo menos uma fotografia.", 400, "SEM_FOTOS");
  }
  if (entradas.length > RELATORIO_FOTO_MAX_FOTOS) {
    throw new RelatorioFotoError(
      `O limite é ${RELATORIO_FOTO_MAX_FOTOS} fotografias por relatório.`,
      400,
      "MUITAS_FOTOS",
    );
  }
  const ids = new Set<string>();
  const fotos: FotoPronta[] = [];
  for (const entrada of entradas) {
    const foto = await prepareFoto(entrada, alvo);
    if (ids.has(foto.id)) {
      throw new RelatorioFotoError("Há duas fotografias com o mesmo identificador.", 400, "FOTO_ID_REPETIDO");
    }
    ids.add(foto.id);
    fotos.push(foto);
  }
  return fotos;
}
