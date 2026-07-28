export type CroquiJobStatus =
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'deleted';

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
};
