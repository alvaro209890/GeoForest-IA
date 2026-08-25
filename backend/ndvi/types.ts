/**
 * Tipos do pipeline NDVI. Contrato entre cálculo, publicação, estatística e laudo.
 */
import type { NdviClassId } from "./ndvi-math";

/**
 * Motivos de falha. Regra da casa: quando não dá para medir, o job **declara** o
 * motivo — nunca estima. Ver `client/src/pages/Dashboard.tsx` ("NÃO fabrique valores
 * de NDVI") e o plano doc 02 §2.7.
 */
export type NdviFailureCode =
  | "sem_cena_nir"
  | "cobertura_parcial"
  | "nuvem_excessiva"
  | "fonte_sem_reflectancia"
  | "sensor_degradado"
  | "area_pequena_demais"
  | "sem_geometria";

export const NDVI_FAILURE_MESSAGES: Record<NdviFailureCode, string> = {
  sem_cena_nir: "Não há cena com banda NIR disponível para o período solicitado.",
  cobertura_parcial: "A cena não cobre o imóvel inteiro; a medida se restringe à porção coberta.",
  nuvem_excessiva: "Cobertura de nuvem impediu uma medida representativa.",
  fonte_sem_reflectancia: "A fonte disponível não fornece reflectância; NDVI não é calculável.",
  sensor_degradado: "Cena Landsat 7 posterior a 31/05/2003 (SLC-off) apresenta faixas sem dado.",
  area_pequena_demais: "Feição pequena demais para medida confiável na resolução da cena.",
  sem_geometria: "O recorte não trouxe geometria utilizável para o cálculo.",
};

/** A cena escolhida, com tudo que o laudo precisa declarar sobre a origem do dado. */
export type NdviSceneRef = {
  itemId: string;
  collection: string;
  platform: string;
  platformLabel: string;
  path: string;
  row: string;
  acquiredAt: string;
  year: number;
  cloudCoverPct: number | null;
  epsg: number | null;
  /** `true` quando o footprint não contém o imóvel inteiro. */
  coberturaParcial: boolean;
  /** L7 pós-SLC-off. */
  sensorDegradado: boolean;
};

export type NdviZonalStat = {
  layer: string;
  featureIndex: number;
  areaHa: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  stdDev: number | null;
  validPixels: number;
  totalPixels: number;
  /** Fração 0–1 de pixels não-nodata. É a honestidade da medida; sempre exibir. */
  validPct: number;
  classe: NdviClassId | null;
  classeLabel: string | null;
  aviso: NdviFailureCode | null;
};

export type NdviRasterRef = {
  ndviLayerName: string;
  rgbLayerName: string;
  ndviHdPath: string;
  rgbHdPath: string;
  wmsPublicUrl: string;
  bytes: number;
};

export type NdviResult = {
  clipJobId: string;
  ndviJobId: string;
  generatedAt: string;
  scene: NdviSceneRef;
  /** Estatística do imóvel inteiro (união do ATP). */
  propertyStat: NdviZonalStat | null;
  /** Uma linha por feição. NUNCA pela união das feições. */
  stats: NdviZonalStat[];
  /** Feições que ficaram de fora por `NDVI_ZONAL_MAX_FEATURES`. */
  featuresOmitidas: number;
  raster: NdviRasterRef | null;
  failure: NdviFailureCode | null;
  avisos: string[];
};

export type NdviArchiveRecord = {
  ndviId: string;
  uid: string;
  ndviJobId: string;
  clipJobId: string;
  itemId: string;
  platform: string;
  path: string;
  row: string;
  year: string;
  acquiredAt: string;
  cloudCoverPct: number | null;
  ndviFilename: string;
  ndviHdPath: string;
  ndviLayerName: string;
  rgbFilename: string;
  rgbHdPath: string;
  rgbLayerName: string;
  bytes: number;
  wmsPublicUrl: string;
  createdAt: string;
  updatedAt: string;
  userDeletedAt?: string | null;
};

export type NdviProgressPatch = {
  stage?: string;
  percent?: number;
  message?: string;
  status?: string;
  error?: string | null;
};

export class NdviCancelError extends Error {
  constructor() {
    super("Job NDVI cancelado.");
    this.name = "NdviCancelError";
  }
}

/** Erro que o job sabe traduzir para um `NdviFailureCode` no laudo. */
export class NdviFailure extends Error {
  code: NdviFailureCode;
  constructor(code: NdviFailureCode, message?: string) {
    super(message || NDVI_FAILURE_MESSAGES[code]);
    this.name = "NdviFailure";
    this.code = code;
  }
}
