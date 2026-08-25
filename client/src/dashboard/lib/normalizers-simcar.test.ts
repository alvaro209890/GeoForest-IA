import { describe, expect, it } from 'vitest';

import { inferSimcarStageFromEndpoint } from './normalizers-simcar';

describe('inferSimcarStageFromEndpoint', () => {
  it('acompanha somente o import no cabeçalho vetorizado', () => {
    expect(
      inferSimcarStageFromEndpoint('/api/simcar/clip/import-vectorized', 'vectorized-analysis'),
    ).toMatchObject({ stage: 'importing' });

    expect(
      inferSimcarStageFromEndpoint('/api/simcar/clip/analyze', 'vectorized-analysis'),
    ).toEqual({});
    expect(
      inferSimcarStageFromEndpoint('/api/simcar/clip/analyze-auas', 'vectorized-analysis'),
    ).toEqual({});
    expect(
      inferSimcarStageFromEndpoint('/api/simcar/clip/analyze-ac-vegetacao', 'vectorized-analysis'),
    ).toEqual({});
  });

  it('preserva os endpoints legados do recorte automático', () => {
    expect(inferSimcarStageFromEndpoint('/api/simcar/clip', 'auto-clip')).toMatchObject({
      stage: 'importing',
    });
    expect(inferSimcarStageFromEndpoint('/api/simcar/clip/analyze', 'auto-clip')).toMatchObject({
      message: 'Análise AC/AVN em processamento no servidor...',
    });
  });
});
