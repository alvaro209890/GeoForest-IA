import { describe, expect, it } from 'vitest';
import { landsatArchiveZipFilename, landsatArchiveZipUrl } from './filenames';

describe('landsat filenames', () => {
  it('builds archive zip filename from scene id', () => {
    expect(
      landsatArchiveZipFilename({
        id: 'LC08_L2SP_224069_20240101',
        source: 'usgs_stac',
        path: '224',
        row: '069',
        orbit: '224_069',
        year: '2024',
        date: '20240101',
        datetime: '2024-01-01T00:00:00Z',
        cloudCover: 10,
        composition: 'false_color',
        compositionLabel: 'Falsa-cor',
        bbox: null,
      }),
    ).toBe('LC08_L2SP_224069_20240101.zip');
  });

  it('prefers explicit outputFilename', () => {
    expect(
      landsatArchiveZipFilename({
        jobId: 'job-1',
        id: 'job-1',
        filename: 'x',
        timestamp: '2024-01-01T00:00:00.000Z',
        status: 'completed',
        percent: 100,
        outputFilename: 'custom_scene.tif',
      }),
    ).toBe('custom_scene.zip');
  });

  it('builds archive zip url from layerName', () => {
    expect(
      landsatArchiveZipUrl({
        wmsLayerName: 'landsat:scene_a',
        id: 'job-1',
        jobId: 'job-1',
        filename: 'x',
        timestamp: '2024-01-01T00:00:00.000Z',
        status: 'completed',
        percent: 100,
      }),
    ).toBe('/api/landsat/wms-download?layerName=landsat%3Ascene_a');
  });

  it('prefers direct wmsDownloadUrl', () => {
    expect(
      landsatArchiveZipUrl({
        wmsDownloadUrl: '/api/landsat/wms-download?layerName=direct',
        wmsLayerName: 'ignored',
        id: 'job-1',
        jobId: 'job-1',
        filename: 'x',
        timestamp: '2024-01-01T00:00:00.000Z',
        status: 'completed',
        percent: 100,
      }),
    ).toBe('/api/landsat/wms-download?layerName=direct');
  });
});
