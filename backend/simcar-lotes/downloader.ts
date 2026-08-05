/**
 * Baixa os artefatos de um CAR (decisão A1 do plano — só 3 por lote):
 *   Arquivo Enviado.zip / Arquivo Processado.zip → sessão técnica do usuário
 *   Recibo de Inscricao.pdf                      → API pública (sem login)
 *
 * HTTP 400 da SEMA = artefato inexistente no estado atual do CAR (ex.: CAR em
 * cadastramento não tem "Arquivo Processado"). Isso NÃO falha o lote: entra em
 * `faltantes` e o relatório mostra ⚠ para o usuário.
 */
import { SimcarHttpError, simcarDownload, withSimcarAuthRetryFor } from "../simcar-oraculo/client";
import { requerimentoIdPublico } from "./resolver";
import type { ArtefatoLote } from "./types";

const SIMCAR_PUBLIC_API =
  "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api/Publico";

/** Artefatos baixados com a sessão técnica, na ordem em que aparecem no relatório. */
export const ARTEFATOS_TECNICOS = [
  { nome: "Arquivo Enviado.zip", path: "Requerimento/DownloadArquivoEnviado", tipo: "zip" as const },
  { nome: "Arquivo Processado.zip", path: "Requerimento/DownloadArquivoProcessado", tipo: "zip" as const },
];

export const NOME_RECIBO = "Recibo de Inscricao.pdf";

function conteudoValido(buffer: Buffer, tipo: "zip" | "pdf"): boolean {
  if (!buffer?.length) return false;
  if (tipo === "pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  // ZIP local file header (PK\x03\x04) — ZIP vazio (PK\x05\x06) não interessa.
  return buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

function ausenteNaSema(error: unknown): boolean {
  if (error instanceof SimcarHttpError) return error.status === 400 || error.status === 404;
  return error instanceof Error && /\b(400|404)\b/.test(error.message);
}

export interface ResultadoDownloadLote {
  arquivos: ArtefatoLote[];
  faltantes: string[];
}

/** Baixa o recibo pela API pública. `null` quando indisponível (o job usa o PDF enviado). */
export async function baixarReciboPublico(
  carEstadual: string,
  requerimentoIdConhecido?: number | null,
): Promise<Buffer | null> {
  try {
    const id = requerimentoIdConhecido || (await requerimentoIdPublico(carEstadual));
    if (!id) return null;
    const url = `${SIMCAR_PUBLIC_API}/DownloadReciboCar/${encodeURIComponent(String(id))}`;
    // Sem corpo a SEMA responde 411 (Length Required); o retry com "{}" é o caminho bom.
    const pedir = (comCorpo: boolean) =>
      fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/pdf,*/*",
          "User-Agent": "Mozilla/5.0",
          ...(comCorpo ? { "Content-Type": "application/json" } : {}),
        },
        body: comCorpo ? "{}" : undefined,
      });
    let response = await pedir(true);
    if (!response.ok) response = await pedir(false);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return conteudoValido(buffer, "pdf") ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Baixa os artefatos de um lote.
 * `onArtefato` reporta progresso por arquivo (índice 1-based).
 */
export async function baixarArtefatosDoLote(args: {
  cpf: string;
  senha: string;
  requerimentoId: number;
  carEstadual: string;
  /** PDF do recibo que o usuário enviou — fallback quando o download público falha. */
  reciboEnviado?: Buffer | null;
  onArtefato?: (info: { nome: string; indice: number; total: number }) => void;
}): Promise<ResultadoDownloadLote> {
  const arquivos: ArtefatoLote[] = [];
  const faltantes: string[] = [];
  const total = ARTEFATOS_TECNICOS.length + 1;

  for (let i = 0; i < ARTEFATOS_TECNICOS.length; i += 1) {
    const artefato = ARTEFATOS_TECNICOS[i];
    args.onArtefato?.({ nome: artefato.nome, indice: i + 1, total });
    try {
      const { buffer } = await withSimcarAuthRetryFor(args.cpf, args.senha, (token) =>
        simcarDownload(token, `${artefato.path}/${args.requerimentoId}`),
      );
      if (!conteudoValido(buffer, artefato.tipo)) {
        faltantes.push(`${artefato.nome} (conteúdo inválido)`);
        continue;
      }
      arquivos.push({ nome: artefato.nome, buffer });
    } catch (error) {
      if (ausenteNaSema(error)) {
        faltantes.push(artefato.nome);
        continue;
      }
      throw error;
    }
  }

  args.onArtefato?.({ nome: NOME_RECIBO, indice: total, total });
  const recibo = await baixarReciboPublico(args.carEstadual);
  if (recibo) {
    arquivos.push({ nome: NOME_RECIBO, buffer: recibo });
  } else if (args.reciboEnviado?.length) {
    arquivos.push({ nome: NOME_RECIBO, buffer: args.reciboEnviado });
  } else {
    faltantes.push(NOME_RECIBO);
  }

  return { arquivos, faltantes };
}
