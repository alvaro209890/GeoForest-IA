import { describe, expect, it } from 'vitest';
import { normalizeNdviScene } from './mapDoc';

/**
 * O `/api/ndvi/search` devolve o contrato em português. A UI ja tinha o selo
 * "SLC-off", mas ele nunca aparecia porque o normalizador so lia `slcOff` —
 * e foi assim que uma cena Landsat 7 de 2007 (pos SLC-off, 27% de faixas sem
 * dado) foi processada sem nenhum aviso.
 */
describe('normalizeNdviScene — contrato do /api/ndvi/search', () => {
  const base = {
    itemId: 'LE07_L2SP_224069_20070928_02_T1',
    acquiredAt: '2007-09-28T13:40:00Z',
    path: '224',
    row: '069',
    platform: 'landsat-7',
  };

  it('mapeia sensorDegradado para slcOff', () => {
    const scene = normalizeNdviScene({ ...base, sensorDegradado: true });
    expect(scene?.slcOff).toBe(true);
  });

  it('mapeia coberturaParcial para coversArea, invertendo', () => {
    expect(normalizeNdviScene({ ...base, coberturaParcial: true })?.coversArea).toBe(false);
    expect(normalizeNdviScene({ ...base, coberturaParcial: false })?.coversArea).toBe(true);
  });

  it('prefere os nomes em ingles quando os dois vem', () => {
    const scene = normalizeNdviScene({
      ...base,
      slcOff: false,
      sensorDegradado: true,
      coversArea: true,
      coberturaParcial: true,
    });
    expect(scene?.slcOff).toBe(false);
    expect(scene?.coversArea).toBe(true);
  });

  it('deixa indefinido quando nenhuma das formas vem', () => {
    const scene = normalizeNdviScene(base);
    expect(scene?.slcOff).toBeUndefined();
    expect(scene?.coversArea).toBeUndefined();
  });

  it('nao confunde valor nao-booleano com flag ligada', () => {
    const scene = normalizeNdviScene({ ...base, sensorDegradado: 'sim' });
    expect(scene?.slcOff).toBeUndefined();
  });
});
