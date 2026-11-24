/** Contrato do relatório fotográfico (painel IMAP + seleção por IA). */
import type { Orientacao } from "../../shared/relatorio-fotografico/layout";


export class RelatorioFotoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "RelatorioFotoError";
  }
}

export type FotoEntrada = {
  id: string;
  nome: string;
  base64: string;
};

export type OrientacaoFoto = Orientacao;

export type FotoPronta = {
  id: string;
  nome: string;
  width: number;
  height: number;
  orientation: OrientacaoFoto;
  jpeg: Buffer;
};

export type FotoSelecionada = {
  id: string;
  motivo: string;
};

export type ParcialSelecao = {
  titulo: string;
  legenda: string;
  fotos: FotoSelecionada[];
};

export type FotoExcluida = {
  id: string;
  motivo: string;
};

export type SelecaoRelatorio = {
  resumo: string;
  parciais: ParcialSelecao[];
  excluidas: FotoExcluida[];
};

export const RELATORIO_FOTO_MODEL_PADRAO = "ocg/deepseek-v4.1-flash";
export const RELATORIO_FOTO_RACIOCINIO_PADRAO = "max";
export const RELATORIO_FOTO_MAX_FOTOS = 50;
