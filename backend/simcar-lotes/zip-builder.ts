/**
 * ZIP final: uma pasta por lote (`MT10005-2019 - LOTE_RURAL_81/`) + relatório TXT.
 */
import archiver from "archiver";
import type { PastaLote, RelatorioLote } from "./types";

/** Sanitiza para nome de arquivo/pasta (NFD → ASCII), evitando mojibake no Windows. */
export function safeFilename(value: unknown, fallback: string): string {
  const cleaned = String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/** `MT10005/2019` + `LOTE RURAL 81` → `MT10005-2019 - LOTE_RURAL_81`. */
export function nomePastaLote(carEstadual: string | null, propriedade: string | null): string {
  const car = safeFilename(String(carEstadual || "").replace(/\//g, "-"), "CAR_SEM_NUMERO");
  const prop = propriedade ? safeFilename(propriedade, "") : "";
  return prop ? `${car} - ${prop}` : car;
}

/** Garante nomes de pasta únicos no ZIP (dois lotes podem ter o mesmo nome). */
export function desambiguarPastas(nomes: string[]): string[] {
  const usados = new Map<string, number>();
  return nomes.map((nome) => {
    const vezes = usados.get(nome) || 0;
    usados.set(nome, vezes + 1);
    return vezes === 0 ? nome : `${nome} (${vezes + 1})`;
  });
}

export function montarRelatorioTxt(relatorio: RelatorioLote[], cancelado = false): string {
  const linhas: string[] = [
    "RELATORIO — LOTES SIMCAR",
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    `Lotes processados: ${relatorio.length}`,
  ];
  if (cancelado) linhas.push("ATENCAO: processamento CANCELADO pelo usuario — ZIP parcial.");
  linhas.push("");
  for (const lote of relatorio) {
    linhas.push(`- ${lote.car || lote.filename}${lote.propriedade ? ` — ${lote.propriedade}` : ""}`);
    if (lote.municipio) linhas.push(`  Municipio: ${lote.municipio}`);
    if (lote.pasta) linhas.push(`  Pasta: ${lote.pasta}/`);
    linhas.push(`  Baixados: ${lote.baixados.length ? lote.baixados.join(", ") : "(nenhum)"}`);
    if (lote.faltantes.length) linhas.push(`  Faltantes na SEMA: ${lote.faltantes.join(", ")}`);
    if (lote.erro) linhas.push(`  ERRO: ${lote.erro}`);
    linhas.push("");
  }
  return linhas.join("\n");
}

/** Monta o ZIP único com uma pasta por lote e o relatório na raiz. */
export function montarZipLotes(
  lotes: PastaLote[],
  relatorio: RelatorioLote[] = [],
  cancelado = false,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    const nomes = desambiguarPastas(lotes.map((lote) => lote.nomePasta));
    lotes.forEach((lote, index) => {
      for (const arquivo of lote.arquivos) {
        archive.append(arquivo.buffer, { name: `${nomes[index]}/${arquivo.nome}` });
      }
    });
    if (relatorio.length) {
      archive.append(montarRelatorioTxt(relatorio, cancelado), { name: "RELATORIO.txt" });
    }
    void archive.finalize();
  });
}

/** `lotes_simcar_20260805-140233.zip`. */
export function nomeZipLotes(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `lotes_simcar_${stamp}.zip`;
}
