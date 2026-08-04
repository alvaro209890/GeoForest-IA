import { describe, expect, it } from 'vitest';
import { formatKm, routeColor, ROUTE_COLORS } from './routePreview';

describe('routePreview — desenho', () => {
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
