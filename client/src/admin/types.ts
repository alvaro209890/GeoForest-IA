/**
 * Tipos do painel administrativo (armazenamento e métricas do servidor).
 */
export type SourceSummary = {
  source: string;
  count: number;
  bytes: number;
};

export type UserSummary = {
  uid: string;
  email?: string;
  fullName?: string;
  fileCount: number;
  bytes: number;
  userStorageBytes?: number;
  userStorageCount?: number;
  sharedRasterBytes?: number;
  sharedRasterCount?: number;
  lastModifiedAt?: string;
  byCategory?: Array<{ category: string; count: number; bytes: number }>;
  bySource?: SourceSummary[];
};

export type BreakdownItem = {
  name: string;
  label: string;
  count: number;
  bytes: number;
};

export type AdminStorageFile = {
  id: string;
  uid: string;
  name: string;
  relativePath: string;
  publicUrl?: string;
  category: string;
  source: "user_storage" | "raster_archive";
  extension: string;
  bytes: number;
  modifiedAt?: string;
  createdAt?: string;
  imageId?: string;
  wmsPublicUrl?: string;
  userDeletedAt?: string;
  adminDeletedAt?: string;
};

export type SummaryPayload = {
  ok: boolean;
  totalBytes: number;
  totalFiles: number;
  userStorageBytes?: number;
  sharedRasterBytes?: number;
  userStorageFiles?: number;
  sharedRasterFiles?: number;
  byCategory?: Array<{ category: string; count: number; bytes: number }>;
  byExtension?: Array<{ extension: string; count: number; bytes: number }>;
  bySource?: SourceSummary[];
  users: UserSummary[];
};

export type ServerStorageMetric = {
  device: string;
  kind: "ssd" | "hd";
  model?: string;
  mountpoint: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usagePercent: number;
};

export type ServerProcess = {
  pid: number;
  command: string;
  cpuPercent: number;
  memPercent: number;
};

export type ServerMetricsPayload = {
  ok: boolean;
  updatedAt: string;
  host: {
    hostname: string;
    platform: string;
    release: string;
    uptimeSec: number;
  };
  cpu: {
    model: string;
    cores: number;
    loadAvg: [number, number, number];
    usagePercent: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usagePercent: number;
  };
  temperature: {
    available: boolean;
    cpuPackageC: number | null;
    hottestCoreC: number | null;
    readings: Array<{ label: string; valueC: number }>;
  };
  storage: ServerStorageMetric[];
  processes: {
    totalVisible: number;
    top: ServerProcess[];
  };
};


