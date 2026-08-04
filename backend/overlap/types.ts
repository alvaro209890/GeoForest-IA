/**
 * Tipos da análise de sobreposição (parcelas alvo, candidatos CAR e detalhes).
 */
import type { Feature, MultiPolygon, Polygon } from "geojson";

export type OverlapMode =
  | "sigef-car-estadual"
  | "sigef-car-federal"
  | "car-estadual-car-estadual";


export type PolyFeature = Feature<Polygon | MultiPolygon>;

export type TargetParcel = {
  id: string;
  label: string;
  parcelaCodigo?: string;
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

export type CarEstadualCandidate = {
  numeroEstadual: string;
  nomePropriedade: string;
  carFederal: string;
  situacao: string;
  situacaoRaw: string;
  protocolo: string;
  encontradoEm: string[];
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

export type CarFederalCandidate = {
  codImovel: string;
  status: string;
  condicao: string;
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

export type OverlapDetailEstadual = {
  targetId: string;
  targetLabel: string;
  targetAreaHa: number;
  numeroEstadual: string;
  nomePropriedade: string;
  carFederal: string;
  situacao: string;
  encontradoEm: string;
  carAreaHa: number;
  overlapHa: number;
  overlapPct: number;
  protocolo: string;
  isOwn: boolean;
  isCancelled: boolean;
};

export type OverlapDetailFederal = {
  targetId: string;
  targetLabel: string;
  targetAreaHa: number;
  codImovel: string;
  status: string;
  condicao: string;
  carAreaHa: number;
  overlapHa: number;
  overlapPct: number;
  isCancelled: boolean;
};

/* ─────────────────────────── util ─────────────────────────── */
