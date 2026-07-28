export type OverlapMode =
  | 'sigef-car-estadual'
  | 'sigef-car-federal'
  | 'car-estadual-car-estadual';

export type OverlapJobStatus = 'processing' | 'completed' | 'failed' | 'cancelled' | 'uploaded' | 'deleted';

export type OverlapModeOption = {
  id: OverlapMode;
  label: string;
};

export type OverlapHistoryItem = {
  id: string;
  jobId: string;
  filename: string;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  status: OverlapJobStatus;
  stage?: string;
  percent: number;
  message?: string;
  error?: string;
  modes?: OverlapMode[];
  files?: string[];
  targetCount?: number;
  downloadUrl?: string;
  outputUrl?: string;
  warnings?: string[];
};
