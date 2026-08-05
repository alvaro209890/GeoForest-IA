/**
 * Job de download dos documentos do CAR, lote a lote.
 *
 * Regras do plano (docs/planos/simcar-lotes/02-arquitetura.md):
 *  - login uma vez por job, dentro da fila exclusiva da conta (sessão única SEMA);
 *  - erro de UM lote não derruba os demais — vira linha de erro no relatório;
 *  - cancelamento entrega o ZIP parcial com os lotes já concluídos (decisão A2);
 *  - credenciais vivem só na memória do job: nunca logadas, nunca persistidas.
 */
import { getSimcarTokenFor, withSimcarAuthRetryFor } from "../simcar-oraculo/client";
import { saveUserBuffer } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { baixarArtefatosDoLote } from "./downloader";
import { extrairPdfsDoEnvio, parseReciboPdf } from "./recibo-parse";
import { resolverCar } from "./resolver";
import { comSessaoExclusiva } from "./session-queue";
import { closeSubscribers, progress } from "./sse";
import type { PastaLote, ReciboParseado, RelatorioLote } from "./types";
import { montarZipLotes, nomePastaLote, nomeZipLotes } from "./zip-builder";

const CANCELADO = "cancel_requested";

function mensagemDeErro(error: any): string {
  const msg = String(error?.message || error || "Falha desconhecida.");
  if (/login SIMCAR 400|Tentativa \d+ de \d+|senha/i.test(msg)) {
    return "Login do SIMCAR recusado — confira o CPF e a senha.";
  }
  if (/fetch failed|ECONNRESET|ETIMEDOUT|Timeout SIMCAR|network/i.test(msg)) {
    return "Sem conexão com o SIMCAR. A SEMA só aceita acesso a partir do Brasil.";
  }
  return msg;
}

export async function runLotesJob(args: {
  uid: string;
  jobId: string;
  zipBuffer: Buffer;
  filename: string;
  cpf: string;
  senha: string;
  /** CARs corrigidos na UI, por nome de arquivo do recibo. */
  carsManuais?: Record<string, string>;
}): Promise<void> {
  const { uid, jobId, zipBuffer, filename, cpf, senha } = args;
  const relatorio: RelatorioLote[] = [];
  const pastas: PastaLote[] = [];
  let cancelado = false;

  try {
    progress(uid, jobId, {
      status: "processing",
      fase: "lendo",
      percent: 2,
      message: "Lendo os recibos enviados.",
    });

    const pdfs = extrairPdfsDoEnvio(zipBuffer, filename);
    if (!pdfs.length) throw new Error("Nenhum recibo PDF encontrado no arquivo enviado.");

    const recibos: ReciboParseado[] = [];
    for (const pdf of pdfs) {
      const parsed = await parseReciboPdf(pdf.data, pdf.name);
      const manual = args.carsManuais?.[pdf.name];
      recibos.push(manual ? { ...parsed, carEstadual: manual, erro: null } : parsed);
    }
    const totalLotes = recibos.length;

    // Tudo que fala com a conta técnica acontece dentro da fila exclusiva.
    await comSessaoExclusiva(cpf, senha, async () => {
      progress(uid, jobId, {
        status: "processing",
        fase: "login",
        percent: 5,
        totalLotes,
        message: "Autenticando no SIMCAR.",
      });
      // Só aquece a sessão: credencial errada falha aqui, antes de varrer os lotes.
      // NÃO reusar este token no laço — ver o comentário do resolver abaixo.
      await getSimcarTokenFor(cpf, senha);

      for (let i = 0; i < recibos.length; i += 1) {
        if (isCancelRequested(jobId)) {
          cancelado = true;
          break;
        }
        const recibo = recibos[i];
        const pdfEnviado = pdfs.find((p) => p.name === recibo.filename)?.data || null;
        const base = Math.round(5 + (i / totalLotes) * 85);
        const linha: RelatorioLote = {
          filename: recibo.filename,
          car: recibo.carEstadual,
          propriedade: recibo.propriedade,
          municipio: recibo.municipio,
          pasta: null,
          baixados: [],
          faltantes: [],
          erro: null,
        };

        try {
          if (recibo.erro) throw new Error(recibo.erro);

          progress(uid, jobId, {
            status: "processing",
            fase: "resolvendo",
            percent: base,
            totalLotes,
            loteAtual: i + 1,
            loteNome: recibo.carEstadual || recibo.filename,
            message: `Localizando ${recibo.carEstadual || recibo.filename} no SIMCAR.`,
          });

          // Token pego por chamada, com retry em 401. A sessão da SEMA cai entre
          // lotes (sessão única por conta) e um token capturado antes do laço
          // envelhece: em produção o lote 1 passava e os seguintes davam
          // "sessão expirada" no ListarRasc. Os downloads já faziam isso.
          const resolucao = await withSimcarAuthRetryFor(cpf, senha, (token) =>
            resolverCar({
              carEstadual: recibo.carEstadual,
              reciboFederal: recibo.reciboFederal,
              token,
            }),
          );
          linha.car = resolucao.numeroCompleto;
          linha.propriedade = resolucao.propriedade || recibo.propriedade;
          linha.municipio = resolucao.municipio || recibo.municipio;

          const { arquivos, faltantes } = await baixarArtefatosDoLote({
            cpf,
            senha,
            requerimentoId: resolucao.requerimentoId,
            carEstadual: resolucao.numeroCompleto,
            reciboEnviado: pdfEnviado,
            onArtefato: ({ nome, indice, total }) => {
              progress(uid, jobId, {
                status: "processing",
                fase: "baixando",
                percent: base + Math.round((indice / total) * (85 / totalLotes)),
                totalLotes,
                loteAtual: i + 1,
                loteNome: linha.car,
                artefatoAtual: indice,
                totalArtefatos: total,
                message: `Lote ${i + 1}/${totalLotes} — baixando ${nome}.`,
              });
            },
          });

          linha.pasta = nomePastaLote(linha.car, linha.propriedade);
          linha.baixados = arquivos.map((a) => a.nome);
          linha.faltantes = faltantes;
          if (arquivos.length) pastas.push({ nomePasta: linha.pasta, arquivos });
        } catch (error: any) {
          linha.erro = mensagemDeErro(error);
        }

        relatorio.push(linha);
        progress(uid, jobId, { relatorio, lotesConcluidos: relatorio.length, totalLotes });
      }
    });

    if (!pastas.length && relatorio.every((l) => l.erro)) {
      throw new Error(relatorio[0]?.erro || "Nenhum documento pôde ser baixado.");
    }

    progress(uid, jobId, {
      status: "processing",
      fase: "zipando",
      percent: 92,
      message: "Montando o ZIP com as pastas dos lotes.",
    });

    const zip = await montarZipLotes(pastas, relatorio, cancelado);
    const nomeArquivo = nomeZipLotes();
    const stored = saveUserBuffer({
      uid,
      area: "simcar-lotes/output",
      filename: `${jobId.slice(0, 8)}_${nomeArquivo}`,
      buffer: zip,
    });

    progress(uid, jobId, {
      status: cancelado ? "cancelled" : "completed",
      fase: "concluido",
      percent: 100,
      cancelado,
      message: cancelado
        ? `Cancelado — ZIP parcial com ${pastas.length} lote(s).`
        : `Concluído: ${pastas.length} lote(s) no ZIP.`,
      outputRelativePath: stored.relativePath,
      downloadUrl: `/api/simcar-lotes/download/${jobId}`,
      outputFilename: nomeArquivo,
      outputBytes: zip.length,
      lotesConcluidos: pastas.length,
      relatorio,
      completedAt: new Date().toISOString(),
    });
    finishJob({ jobId, status: cancelado ? "cancelled" : "completed" });
  } catch (error: any) {
    const foiCancelado = cancelado || error?.message === CANCELADO;
    const message = foiCancelado ? "Processamento cancelado." : mensagemDeErro(error);
    progress(uid, jobId, {
      status: foiCancelado ? "cancelled" : "failed",
      fase: foiCancelado ? "cancelado" : "erro",
      percent: 100,
      message,
      error: message,
      relatorio,
    });
    finishJob({ jobId, status: foiCancelado ? "cancelled" : "failed", error: message });
  } finally {
    closeSubscribers(jobId);
  }
}
