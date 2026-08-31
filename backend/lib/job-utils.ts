/**
 * Utilitários que os módulos de job (croqui, containment, overlap, vertices,
 * geometria, cbers, landsat, processar-projeto, solicitação) reimplementavam
 * idênticos arquivo a arquivo.
 *
 * Cada módulo continua exportando o nome que já exportava — aqui fica a única
 * implementação.
 */

/** Aguarda `ms` milissegundos. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sanitiza um pedaço de caminho/nome de arquivo: só `[A-Za-z0-9._-]`, sem
 * `_` nas pontas e no máximo 120 caracteres.
 */
export function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export type ParseBase64ZipMessages = {
  /** Erro quando nada chegou. */
  missing?: string;
  /** Erro quando o buffer é menor que o cabeçalho mínimo de um ZIP. */
  invalid?: string;
};

/**
 * Decodifica um ZIP enviado como base64 (com ou sem prefixo `data:`).
 * 22 bytes é o menor "end of central directory" possível de um ZIP válido.
 */
export function parseBase64Zip(raw: unknown, messages?: ParseBase64ZipMessages): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error(messages?.missing || "ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  if (!payload) throw new Error(messages?.missing || "ZIP não enviado.");
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error(messages?.invalid || "ZIP inválido ou vazio.");
  return buffer;
}

/** Escapa um valor para CSV separado por `;`. */
export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
