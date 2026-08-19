import { describe, expect, it } from 'vitest';
import { isNativeAttachmentZipUrl, zipUrlPathname } from './download-actions';

describe('download-actions zip routing', () => {
  it('parses pathname from relative and absolute download URLs', () => {
    expect(zipUrlPathname('/api/cbers-wpm/wms-download?imageId=abc')).toBe(
      '/api/cbers-wpm/wms-download',
    );
    expect(
      zipUrlPathname('https://geoforest-api.cursar.space/api/cbers-wpm/wms-download?itemId=x'),
    ).toBe('/api/cbers-wpm/wms-download');
    expect(zipUrlPathname('')).toBe('');
  });

  it('sends multi-GB WMS rasters through native attachment download, not fetch+blob', () => {
    expect(isNativeAttachmentZipUrl('/api/cbers-wpm/wms-download?imageId=abc')).toBe(true);
    expect(isNativeAttachmentZipUrl('/api/landsat/wms-download?layerName=x')).toBe(true);
    expect(isNativeAttachmentZipUrl('/api/raster/213_129/file.TIF')).toBe(true);
    expect(isNativeAttachmentZipUrl('/api/simcar/clip/download/job-1')).toBe(false);
    expect(isNativeAttachmentZipUrl('/api/cbers-wpm/jobs/abc/status')).toBe(false);
  });
});
