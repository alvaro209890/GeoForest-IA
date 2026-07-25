import { describe, expect, it } from 'vitest';
import { mapCbersDocToHistoryItem } from './mapDoc';

describe('mapCbersDocToHistoryItem', () => {
  it('maps a minimal completed job doc', () => {
    const item = mapCbersDocToHistoryItem('doc-1', {
      jobId: 'job-1',
      filename: 'area.zip',
      status: 'completed',
      percent: 100,
      message: 'Pronto',
      itemId: 'SCENE_1',
      scene: {
        id: 'SCENE_1',
        datetime: '2024-01-15T12:00:00Z',
        cloudCover: 12.5,
        bbox: [-56, -15, -55, -14],
        assetKeys: ['BAND3'],
        coversArea: true,
        coveragePercent: 100,
      },
      timestamp: '2024-01-16T10:00:00.000Z',
    });

    expect(item.id).toBe('doc-1');
    expect(item.jobId).toBe('job-1');
    expect(item.status).toBe('completed');
    expect(item.percent).toBe(100);
    expect(item.itemId).toBe('SCENE_1');
    expect(item.scene?.id).toBe('SCENE_1');
    expect(item.scene?.cloudCover).toBe(12.5);
    expect(item.scene?.bbox).toEqual([-56, -15, -55, -14]);
    expect(item.timestamp).toBe('2024-01-16T10:00:00.000Z');
  });

  it('defaults unknown status to processing', () => {
    const item = mapCbersDocToHistoryItem('doc-2', { status: 'queued' });
    expect(item.status).toBe('processing');
    expect(item.filename).toBe('CBERS-4A/WPM');
  });
});
