/**
 * Tipos compartilhados da aba "Lotes SIMCAR" (download automático dos documentos do CAR).
 * Plano: docs/planos/simcar-lotes/.
 */

/** Resultado da leitura de um recibo de inscrição (PDF), sem tocar na SEMA. */
export interface ReciboParseado {
  /** Nome do arquivo dentro do ZIP enviado (ou do PDF solto). */
  filename: string;
  /** "MT10005/2019" — normalizado (sem hífen/espaços). */
  carEstadual: string | null;
  /** "MT-5107065-AEC311BDEA79437099F3D97F9D599345". */
  reciboFederal: string | null;
  propriedade: string | null;
  municipio: string | null;
  proprietario: string | null;
  /** Preenchido quando o PDF não pôde ser lido/identificado. */
  erro: string | null;
}

/** Identificação do requerimento no SIMCAR técnico. */
export interface ResolucaoCar {
  requerimentoId: number;
  numeroCompleto: string;
  situacao: string;
  propriedade: string;
  municipio: string;
}

/** Um arquivo dentro da pasta do lote no ZIP final. */
export interface ArtefatoLote {
  nome: string;
  buffer: Buffer;
}

/** Pasta de um lote no ZIP final. */
export interface PastaLote {
  nomePasta: string;
  arquivos: ArtefatoLote[];
}

/** Linha do relatório final, uma por recibo enviado. */
export interface RelatorioLote {
  filename: string;
  car: string | null;
  propriedade: string | null;
  municipio: string | null;
  /** Nome da pasta no ZIP (null quando o lote falhou antes de montar a pasta). */
  pasta: string | null;
  /** Artefatos efetivamente incluídos. */
  baixados: string[];
  /** Artefatos ausentes na SEMA (HTTP 400) — não são erro. */
  faltantes: string[];
  /** Erro que impediu o lote (não interrompe os demais). */
  erro: string | null;
}

/** Fases reportadas via SSE. */
export type FaseLotes =
  | "lendo"
  /** Monitor SIMCAR acusou EM USO: o job espera o navegador de alguém sair. */
  | "aguardando_simcar"
  | "login"
  | "resolvendo"
  | "baixando"
  /** Alguém logou no meio do lote e derrubou a sessão; o lote será repetido. */
  | "sessao_interrompida"
  | "zipando";
