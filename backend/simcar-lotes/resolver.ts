/**
 * nº do CAR (estadual ou recibo federal) → RequerimentoId no SIMCAR técnico.
 *
 * `Requerimento/ListarRasc` é o mesmo endpoint da aba "Listar" do tecnico.app.
 * O body genérico dá 400: só o corpo completo abaixo funciona. A SEMA às vezes
 * ignora o filtro e devolve a conta inteira, então re-filtramos `NumeroCompleto`
 * pelo valor exato.
 */
import { simcarPost } from "../simcar-oraculo/client";
import { normalizarCarEstadual } from "./recibo-parse";
import type { ResolucaoCar } from "./types";

const SIMCAR_PUBLIC_API =
  "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api/Publico";

type ItemRequerimento = {
  Id?: number;
  RId?: number;
  NumeroCompleto?: string;
  NumeroReciboFedederal?: string;
  Situacao?: string;
  PropriedadeNome?: string;
  MunicipioTexto?: string;
};

type ListaRequerimento = { QuantidadeTotal?: number; Itens?: ItemRequerimento[] };

export class CarNaoLocalizadoError extends Error {
  constructor(numero: string) {
    super(`CAR ${numero} não localizado na conta SIMCAR informada.`);
    this.name = "CarNaoLocalizadoError";
  }
}

function corpoListagem(filtros: Record<string, string>): Record<string, unknown> {
  return {
    Filtros: filtros,
    ItensPorPagina: 50,
    Pagina: 1,
    IsOrdenarCrescente: false,
    ColunaOrdenar: "NumeroCompleto",
    Colunas: [],
  };
}

function itens(payload: unknown): ItemRequerimento[] {
  const lista = (payload || {}) as ListaRequerimento;
  return Array.isArray(lista.Itens) ? lista.Itens : [];
}

function mesmoNumero(item: ItemRequerimento, alvo: string): boolean {
  return normalizarCarEstadual(item.NumeroCompleto) === alvo;
}

/**
 * Consulta a API **pública** (sem login) — usada para resolver o CAR estadual a
 * partir do recibo federal e para descobrir o Id do recibo em PDF.
 */
export async function listarPublico(filtros: Record<string, string>): Promise<ItemRequerimento[]> {
  const response = await fetch(`${SIMCAR_PUBLIC_API}/ListarRequerimento`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(corpoListagem(filtros)),
  });
  if (!response.ok) throw new Error(`SIMCAR_PUBLICO_${response.status}`);
  return itens(await response.json());
}

/** Recibo federal → nº do CAR estadual, pela API pública. */
export async function carEstadualPorReciboFederal(reciboFederal: string): Promise<string | null> {
  const encontrados = await listarPublico({ NUMERO_CAR_FERERAL: reciboFederal.toUpperCase() });
  for (const item of encontrados) {
    const numero = normalizarCarEstadual(item.NumeroCompleto);
    if (numero) return numero;
  }
  return null;
}

/** Id público do requerimento (usado no `Publico/DownloadReciboCar/{id}`). */
export async function requerimentoIdPublico(carEstadual: string): Promise<number | null> {
  const encontrados = await listarPublico({ NUMERO: carEstadual });
  const exato = encontrados.find((item) => mesmoNumero(item, carEstadual)) || encontrados[0];
  const id = Number(exato?.Id || 0);
  return id > 0 ? id : null;
}

/**
 * Resolve o requerimento na conta técnica. Lança `CarNaoLocalizadoError` quando o
 * CAR não pertence à conta — o job registra o erro no lote e segue para o próximo.
 */
export async function resolverCar(args: {
  carEstadual: string | null;
  reciboFederal: string | null;
  token: string;
}): Promise<ResolucaoCar> {
  let numero = normalizarCarEstadual(args.carEstadual);
  if (!numero && args.reciboFederal) {
    numero = await carEstadualPorReciboFederal(args.reciboFederal);
  }
  if (!numero) {
    throw new Error("Recibo sem nº de CAR estadual nem recibo federal utilizável.");
  }

  const payload = await simcarPost(args.token, "Requerimento/ListarRasc", corpoListagem({ NUMERO: numero }));
  const encontrados = itens(payload);
  const exato = encontrados.find((item) => mesmoNumero(item, numero!));
  if (!exato || !Number(exato.Id)) throw new CarNaoLocalizadoError(numero);

  return {
    requerimentoId: Number(exato.Id),
    numeroCompleto: String(exato.NumeroCompleto || numero).trim(),
    situacao: String(exato.Situacao || "").trim(),
    propriedade: String(exato.PropriedadeNome || "").trim(),
    municipio: String(exato.MunicipioTexto || "").trim(),
  };
}
