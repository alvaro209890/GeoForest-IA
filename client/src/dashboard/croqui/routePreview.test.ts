import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  buildProjection,
  formatKm,
  routeColor,
  ROUTE_COLORS,
  toPolylinePoints,
  type LonLat,
} from './routePreview';

const QUADRADO: LonLat[] = [
  [-52.3, -12.6],
  [-52.1, -12.6],
  [-52.1, -12.4],
  [-52.3, -12.4],
];

describe('routePreview — enquadramento', () => {
  it('acha os limites de vários traçados juntos', () => {
    const bounds = boundsOf([QUADRADO, [[-52.5, -12.2]]]);
    expect(bounds).toEqual({ minLon: -52.5, minLat: -12.6, maxLon: -52.1, maxLat: -12.2 });
  });

  it('ignora coordenadas inválidas', () => {
    const bounds = boundsOf([[[Number.NaN, -12.5], [-52.2, -12.5]]]);
    expect(bounds).toEqual({ minLon: -52.2, minLat: -12.5, maxLon: -52.2, maxLat: -12.5 });
  });

  it('não projeta sem coordenada nenhuma', () => {
    expect(boundsOf([])).toBeNull();
    expect(buildProjection([], 100, 100)).toBeNull();
  });

  it('mantém tudo dentro da área desenhável', () => {
    const projection = buildProjection([QUADRADO], 400, 300, 10);
    expect(projection).not.toBeNull();
    for (const [lon, lat] of QUADRADO) {
      const [x, y] = projection!.project(lon, lat);
      expect(x).toBeGreaterThanOrEqual(9.9);
      expect(x).toBeLessThanOrEqual(390.1);
      expect(y).toBeGreaterThanOrEqual(9.9);
      expect(y).toBeLessThanOrEqual(290.1);
    }
  });

  it('põe o norte em cima e o leste à direita', () => {
    const projection = buildProjection([QUADRADO], 400, 300)!;
    const [xOeste] = projection.project(-52.3, -12.5);
    const [xLeste] = projection.project(-52.1, -12.5);
    const [, yNorte] = projection.project(-52.2, -12.4);
    const [, ySul] = projection.project(-52.2, -12.6);
    expect(xLeste).toBeGreaterThan(xOeste);
    expect(yNorte).toBeLessThan(ySul);
  });

  it('preserva a proporção (não estica um eixo)', () => {
    const projection = buildProjection([QUADRADO], 400, 300)!;
    const [x0, y0] = projection.project(-52.3, -12.6);
    const [x1, y1] = projection.project(-52.1, -12.4);
    // 0,2° de longitude e 0,2° de latitude: o lado maior domina os dois eixos.
    const razao = Math.abs(x1 - x0) / Math.abs(y1 - y0);
    expect(razao).toBeGreaterThan(0.9);
    expect(razao).toBeLessThan(1.1);
  });
});

describe('routePreview — desenho', () => {
  it('gera os pontos do polyline com uma casa decimal', () => {
    const projection = buildProjection([QUADRADO], 400, 300)!;
    const pontos = toPolylinePoints(QUADRADO, projection).split(' ');
    expect(pontos).toHaveLength(4);
    for (const ponto of pontos) expect(ponto).toMatch(/^-?\d+\.\d,-?\d+\.\d$/);
  });

  it('dá uma cor estável por posição e volta ao início', () => {
    expect(routeColor(0)).toBe(ROUTE_COLORS[0]);
    expect(routeColor(1)).toBe(ROUTE_COLORS[1]);
    expect(routeColor(ROUTE_COLORS.length)).toBe(ROUTE_COLORS[0]);
  });

  it('formata distância no padrão brasileiro', () => {
    expect(formatKm(29400)).toBe('29,4 km');
    expect(formatKm(950)).toBe('0,9 km');
    expect(formatKm(1000)).toBe('1,0 km');
  });
});
