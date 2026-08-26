/**
 * Tipos da análise de fiscalização (IBAMA / SEMA / SIGA) sobre uma ATP.
 */
import type { Feature, MultiPolygon, Point, Polygon } from "geojson";

export type FiscalizacaoSource = "ibama" | "sema" | "siga";

export const FISCALIZACAO_SOURCES: FiscalizacaoSource[] = ["ibama", "sema", "siga"];

/** Natureza do ato — define a cor do polígono no mapa e a aba na planilha. */
export type FiscalizacaoKind = "embargo" | "auto" | "desembargo";

export type FiscalizacaoGeometry = Polygon | MultiPolygon | Point;

/**
 * Registro normalizado. Cada fonte tem um esquema de atributos diferente
 * (PAMGIA usa `nome_embargado`/`cpf_cnpj_embargado`, as camadas SEMA usam
 * `NOME`/`CPF_CNPJ` e as SIGA usam `NOME_RAZAO`/`CPFCNPJ`), então tudo é
 * convertido para esta forma única antes de virar mapa, planilha ou shapefile.
 */
export type FiscalizacaoRecord = {
  source: FiscalizacaoSource;
  /** Rótulo da camada de origem, como aparece na legenda do mapa. */
  layerLabel: string;
  kind: FiscalizacaoKind;
  nome: string;
  cpfCnpj: string;
  /** Nº do TAD, termo de embargo ou auto de infração. */
  documento: string;
  numeroProcesso: string;
  /** Data do ato em ISO (YYYY-MM-DD) quando conhecida. */
  data: string;
  /** Ano do ato — usado nos rótulos do mapa. */
  ano: string;
  municipio: string;
  imovel: string;
  descricao: string;
  situacao: string;
  /** Área declarada pela fonte, em hectares (0 quando não informada). */
  areaDeclaradaHa: number;
  /** Área do polígono calculada pelo GeoForest, em hectares. */
  areaGeomHa: number;
  /** Área sobreposta à ATP, em hectares (0 para pontos). */
  sobreposicaoHa: number;
  /** Percentual da ATP coberto por esta feição. */
  percentualAtp: number;
  /** Distância até a ATP em metros (0 quando incide ou confronta). */
  distanciaM: number;
  /** true quando há sobreposição de área efetiva com a ATP. */
  incidente: boolean;
  geometry: FiscalizacaoGeometry;
};

export type FiscalizacaoSourceResult = {
  source: FiscalizacaoSource;
  label: string;
  records: FiscalizacaoRecord[];
  /** Quantas feições sobrepõem a ATP de fato. */
  incidentes: number;
  /** Erro da fonte, quando ela falhou (as demais seguem normalmente). */
  error?: string;
};

export type AtpFeature = Feature<Polygon | MultiPolygon>;

export type FiscalizacaoJobStatus =
  | "uploaded"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "deleted";
