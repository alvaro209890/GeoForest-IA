import { describe, expect, it } from 'vitest';
import { overlapDownloadUrl, overlapZipFilename } from './filenames';
import { mapOverlapDocToHistoryItem } from './mapDoc';

describe('sobreposicoes filenames', () => {
  it('builds zip filename from history item', () => {
    expect(overlapZipFilename({ filename: 'SIGEF lotes.zip' } as any)).toBe('SIGEF_lotes.zip');
  });

  it('builds download url from jobId', () => {
    expect(overlapDownloadUrl({ jobId: 'abc-123' } as any)).toBe('/api/overlap/download/abc-123');
  });
});

describe('sobreposicoes mapDoc', () => {
  it('maps minimal doc', () => {
    const item = mapOverlapDocToHistoryItem('job-1', {
      filename: 'sigef.zip',
      status: 'completed',
      percent: 100,
      downloadUrl: '/api/overlap/download/job-1',
      modes: ['sigef-car-estadual'],
    });
    expect(item.jobId).toBe('job-1');
    expect(item.status).toBe('completed');
    expect(item.modes).toEqual(['sigef-car-estadual']);
    expect(item.percent).toBe(100);
  });

  it('defaults unknown status to processing', () => {
    const item = mapOverlapDocToHistoryItem('doc-2', { status: 'queued' });
    expect(item.status).toBe('processing');
    expect(item.filename).toBe('SOBREPOSICOES');
  });
});
