export type CroquiJobStatus =
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deleted';

/** Um caminho de acesso possível, para o usuário escolher antes de gerar. */
export type CroquiRouteOption = {
  id: string;
  label: string;
  side: string | null;
  totalDistanceM: number;
  roads: string[];
  recommended: boolean;
  coordinates: [number, number][];
};

export type CroquiRouteOptionsResponse = {
  municipioNome: string;
  options: CroquiRouteOption[];
  atp: [number, number][][];
  start: [number, number] | null;
  basemap: {
    dataUrl: string;
    provider: string;
    bboxLonLat: [number, number, number, number];
    imageWidthPx: number;
    imageHeightPx: number;
    centerLon: number;
    centerLat: number;
    zoom: number;
  } | null;
};

export type CroquiHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  title?: string;
  propertyName?: string;
  municipioNome?: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: CroquiJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  files?: string[];
  downloadUrl?: string;
  outputUrl?: string;
  /** Nome do caminho escolhido, quando o croqui não usou o traçado padrão. */
  routeLabel?: string;
};

/** Resumo de um upload de ATP salvo, disponível para reuso na aba de croqui. */
export type CroquiUploadSummary = {
  uploadId: string;
  filename: string;
  polygonCount: number;
  municipioNome: string | null;
  createdAt: string;
};
