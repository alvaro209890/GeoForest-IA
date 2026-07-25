import { describe, expect, it } from 'vitest';
import { mapLandsatDocToHistoryItem, normalizeLandsatScene } from './mapDoc';

describe('normalizeLandsatScene', () => {
  it('maps a minimal scene payload', () => {
    const scene = normalizeLandsatScene({
      id: 'SCENE_1',
      source: 'local_wms',
      path: '224',
      row: '069',
      datetime: '2024-01-15T12:00:00Z',
      cloudCover: 8,
      composition: 'natural_color',
      coversArea: true,
      coveragePercent: 100,
      bbox: [-56, -15, -55, -14],
    });
    expect(scene?.id).toBe('SCENE_1');
    expect(scene?.source).toBe('local_wms');
    expect(scene?.composition).toBe('natural_color');
    expect(scene?.compositionLabel).toBe('Natural');
    expect(scene?.cloudCover).toBe(8);
    expect(scene?.bbox).toEqual([-56, -15, -55, -14]);
  });

  it('returns null for non-objects', () => {
    expect(normalizeLandsatScene(null)).toBeNull();
    expect(normalizeLandsatScene('x')).toBeNull();
  });
});

describe('mapLandsatDocToHistoryItem', () => {
  it('maps a minimal completed job doc', () => {
    const item = mapLandsatDocToHistoryItem('doc-1', {
      jobId: 'job-1',
      filename: 'area.zip',
      status: 'completed',
      percent: 100,
      message: 'Pronto',
      sceneId: 'SCENE_1',
      composition: 'false_color',
      scene: {
        id: 'SCENE_1',
        path: '224',
        row: '069',
        datetime: '2024-01-15T12:00:00Z',
        cloudCover: 12.5,
        bbox: [-56, -15, -55, -14],
        coversArea: true,
        coveragePercent: 100,
      },
      timestamp: '2024-01-16T10:00:00.000Z',
    });

    expect(item.id).toBe('doc-1');
    expect(item.jobId).toBe('job-1');
    expect(item.status).toBe('completed');
    expect(item.percent).toBe(100);
    expect(item.sceneId).toBe('SCENE_1');
    expect(item.scene?.id).toBe('SCENE_1');
    expect(item.composition).toBe('false_color');
    expect(item.timestamp).toBe('2024-01-16T10:00:00.000Z');
  });

  it('defaults unknown status to processing', () => {
    const item = mapLandsatDocToHistoryItem('doc-2', { status: 'queued' });
    expect(item.status).toBe('processing');
    expect(item.filename).toBe('LANDSAT');
  });
});
