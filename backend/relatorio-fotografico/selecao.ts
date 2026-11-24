/**
 * Interpreta o JSON da seleção. A IA vê as fotos; aqui só se aceita id que
 * realmente foi enviado e cada foto entra uma única vez.
 */
import { RelatorioFotoError, type SelecaoRelatorio } from "./types";

export function extractJsonObject(text: string): unknown {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json/gi, "")
    .replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) {
    throw new RelatorioFotoError(
      "A IA não devolveu um JSON utilizável. Tente de novo.",
      502,
      "IA_SEM_JSON",
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          throw new RelatorioFotoError(
            "A IA devolveu um JSON inválido. Tente de novo.",
            502,
            "IA_JSON_INVALIDO",
          );
        }
      }
    }
  }
  throw new RelatorioFotoError(
    "A IA devolveu um JSON incompleto. Tente de novo.",
    502,
    "IA_JSON_INCOMPLETO",
  );
}

/**
 * O Word já escreve "Figura N." antes de cada legenda. Se a IA mandar o prefixo,
 * ele sai daqui para não virar "Figura 1. Figura 1. ...".
 */
export function limparLegenda(texto: string): string {
  return String(texto || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:fig(?:ura)?\.?\s*\d*\s*[.:\-–—]\s*)+/i, "")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fotoId(entry: unknown): { id: string; motivo: string } | null {
  if (typeof entry === "string") {
    const id = entry.trim();
    return id ? { id, motivo: "" } : null;
  }
  const record = asRecord(entry);
  if (!record) return null;
  const id = String(record.id || record.foto || "").trim();
  if (!id) return null;
  return { id, motivo: String(record.motivo || record.razao || "").trim() };
}

export function normalizeSelecao(rawText: string, knownIds: string[]): SelecaoRelatorio {
  const parsed = asRecord(extractJsonObject(rawText));
  if (!parsed) {
    throw new RelatorioFotoError(
      "A IA não devolveu a seleção no formato esperado.",
      502,
      "IA_FORMATO",
    );
  }

  const known = new Set(knownIds);
  const used = new Set<string>();
  const parciaisEntrada = Array.isArray(parsed.parciais) ? parsed.parciais : [];
  const parciais: SelecaoRelatorio["parciais"] = [];

  parciaisEntrada.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) return;
    const fotosBrutas = Array.isArray(record.fotos) ? record.fotos : [];
    const fotos = [];
    for (const entry of fotosBrutas) {
      const foto = fotoId(entry);
      if (!foto || !known.has(foto.id) || used.has(foto.id)) continue;
      used.add(foto.id);
      fotos.push({
        id: foto.id,
        motivo: foto.motivo || "Selecionada para o objetivo do relatório.",
      });
    }
    if (!fotos.length) return;
    const legenda = limparLegenda(String(record.legenda || record.caption || record.descricao || ""));
    parciais.push({
      titulo: String(record.titulo || `Parcial ${index + 1}`).trim().slice(0, 120) || `Parcial ${index + 1}`,
      legenda: (legenda || "Registro fotográfico conforme o objetivo informado.").slice(0, 1200),
      fotos,
    });
  });

  if (!parciais.length) {
    throw new RelatorioFotoError(
      "A IA não selecionou nenhuma fotografia. Ajuste o objetivo ou tente de novo.",
      502,
      "IA_SEM_SELECAO",
    );
  }

  const motivosExcluidas = new Map<string, string>();
  const excluidasEntrada = Array.isArray(parsed.excluidas) ? parsed.excluidas : [];
  for (const entry of excluidasEntrada) {
    const foto = fotoId(entry);
    if (!foto || !known.has(foto.id) || used.has(foto.id)) continue;
    motivosExcluidas.set(foto.id, foto.motivo || "Ficou de fora da seleção.");
  }

  const excluidas = knownIds
    .filter((id) => !used.has(id))
    .map((id) => ({
      id,
      motivo: motivosExcluidas.get(id) || "Não entrou na seleção da IA.",
    }));

  return {
    resumo: String(parsed.resumo || parsed.summary || "").trim().slice(0, 800),
    parciais,
    excluidas,
  };
}
