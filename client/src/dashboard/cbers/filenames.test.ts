import { describe, expect, it } from 'vitest';
import {
  CAR_ESTADUAL_EXAMPLE,
  CAR_ESTADUAL_PLACEHOLDER,
  cbersArchiveZipFilename,
  cbersArchiveZipUrl,
  cbersBatchZipFilename,
  cbersDownloadFilename,
  cbersOutputFilename,
  cbersSceneZipFilename,
  cbersSceneZipPath,
} from './filenames';

describe('cbers filenames', () => {
  it('builds output filename from item id', () => {
    expect(cbersOutputFilename('CBERS4A_WPM_213_129_20240101')).toBe(
      'CBERS4A_WPM_213_129_20240101_C342_PAN.TIF',
    );
  });

  it('falls back when item id is empty', () => {
    expect(cbersOutputFilename(null)).toBe('CBERS_4A_WPM_C342_PAN.TIF');
  });

  it('prefers explicit outputFilename for download', () => {
    expect(
      cbersDownloadFilename({
        outputFilename: 'custom.tif',
        itemId: 'ignored',
        jobId: 'job1',
      }),
    ).toBe('custom.tif');
  });

  it('builds archive zip filename from scene id', () => {
    expect(
      cbersArchiveZipFilename({
        itemId: 'SCENE_A',
        scene: { id: 'SCENE_A' } as any,
      }),
    ).toBe('SCENE_A_C342_PAN.zip');
  });

  it('builds archive zip url from archiveImageId', () => {
    expect(
      cbersArchiveZipUrl({
        archiveImageId: 'img-1',
        itemId: 'SCENE_A',
      }),
    ).toBe('/api/cbers-wpm/wms-download?imageId=img-1');
  });

  it('builds batch zip filename with job suffix', () => {
    expect(cbersBatchZipFilename('abcdefghijklmnop')).toBe(
      'CBERS_4A_WPM_LOTE_abcdefgh_C342_PAN.zip',
    );
  });

  it('uses the state CAR example, not the federal SICAR number', () => {
    expect(CAR_ESTADUAL_EXAMPLE).toBe('MT274719/2025');
    expect(CAR_ESTADUAL_PLACEHOLDER).toBe('Ex: MT274719/2025');
    expect(CAR_ESTADUAL_EXAMPLE.startsWith('MT-')).toBe(false);
  });

  it('builds a scene zip path from wmsDownloadUrl or archiveImageId', () => {
    expect(
      cbersSceneZipPath({
        id: 'SCENE_A',
        wmsDownloadUrl: '/api/cbers-wpm/wms-download?imageId=img-1',
      }),
    ).toBe('/api/cbers-wpm/wms-download?imageId=img-1');
    expect(
      cbersSceneZipPath({
        id: 'SCENE_A',
        archiveImageId: 'img-2',
      }),
    ).toBe('/api/cbers-wpm/wms-download?imageId=img-2');
    expect(cbersSceneZipPath({ id: 'SCENE_A' })).toBe(
      '/api/cbers-wpm/wms-download?itemId=SCENE_A',
    );
  });

  it('names the scene zip from archive filename or item id', () => {
    expect(cbersSceneZipFilename({ id: 'SCENE_A', archiveFilename: 'folha.TIF' })).toBe('folha.zip');
    expect(cbersSceneZipFilename({ id: 'SCENE_A' })).toBe('SCENE_A_C342_PAN.zip');
  });
});
