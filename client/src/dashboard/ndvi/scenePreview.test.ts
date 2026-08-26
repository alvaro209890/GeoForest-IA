import { describe, expect, it } from 'vitest';
import { buildScenePreviewLayout, ringFromBbox, type PreviewGeometry } from './scenePreview';

/** Cena Landsat 224/069: ~1,7° de lado, centrada perto de -12,5 / -51,5. */
function cena(): PreviewGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [-52.4, -13.4],
      [-50.7, -13.4],
      [-50.7, -11.7],
      [-52.4, -11.7],
      [-52.4, -13.4],
    ]],
  };
}

/** Imóvel de ~60 ha: ~0,008° de lado, dentro da cena. */
function imovel(lng = -51.5, lat = -12.5): PreviewGeometry {
  return {
    type: 'Polygon',
    coordinates: [[
      [lng, lat],
      [lng + 0.008, lat],
      [lng + 0.008, lat + 0.008],
      [lng, lat + 0.008],
      [lng, lat],
    ]],
  };
}

function viewBoxParts(viewBox: string): number[] {
  return viewBox.split(' ').map(Number);
}

describe('buildScenePreviewLayout', () => {
  it('devolve null quando não há geometria alguma', () => {
    expect(buildScenePreviewLayout({})).toBeNull();
    expect(buildScenePreviewLayout({ sceneGeometry: null, propertyGeometry: null })).toBeNull();
  });

  it('desenha a cena sozinha quando o imóvel não veio', () => {
    const layout = buildScenePreviewLayout({ sceneGeometry: cena() });
    expect(layout?.hasScene).toBe(true);
    expect(layout?.hasProperty).toBe(false);
    expect(layout?.marker).toBeNull();
    expect(layout?.scenePath.startsWith('M')).toBe(true);
    expect(layout?.scenePath.endsWith('Z')).toBe(true);
  });

  /**
   * O motivo do marcador: 60 ha dentro de uma cena de ~185 km ocupam menos de um
   * pixel. Sem ele o modal mostrava um retângulo aparentemente vazio.
   */
  it('marca com localizador o imóvel pequeno demais para a escala da cena', () => {
    const layout = buildScenePreviewLayout({ sceneGeometry: cena(), propertyGeometry: imovel() });
    expect(layout?.hasProperty).toBe(true);
    expect(layout?.marker).not.toBeNull();
    expect(layout!.marker!.r).toBeGreaterThan(0);
    // o localizador fica sobre o imóvel, não no centro da cena
    expect(layout!.marker!.cy).toBeCloseTo(12.496, 1);
  });

  it('não usa localizador quando o imóvel tem tamanho comparável ao da cena', () => {
    const grande: PreviewGeometry = {
      type: 'Polygon',
      coordinates: [[
        [-52.0, -13.0],
        [-51.0, -13.0],
        [-51.0, -12.0],
        [-52.0, -12.0],
        [-52.0, -13.0],
      ]],
    };
    const layout = buildScenePreviewLayout({ sceneGeometry: cena(), propertyGeometry: grande });
    expect(layout?.marker).toBeNull();
  });

  it('avisa quando o imóvel cai fora da cena', () => {
    const dentro = buildScenePreviewLayout({ sceneGeometry: cena(), propertyGeometry: imovel() });
    expect(dentro?.propertyOutside).toBe(false);

    const fora = buildScenePreviewLayout({ sceneGeometry: cena(), propertyGeometry: imovel(-49.0, -10.0) });
    expect(fora?.propertyOutside).toBe(true);
  });

  /**
   * Um grau de longitude é ~2% mais curto que um de latitude a -12°. Sem a
   * correção por cos(lat) uma cena quadrada em graus saía esticada na horizontal.
   */
  it('corrige a proporção pela latitude', () => {
    const layout = buildScenePreviewLayout({ sceneGeometry: cena() });
    const [, , width, height] = viewBoxParts(layout!.viewBox);
    // a cena tem o mesmo número de graus nos dois eixos (1,7)
    expect(width).toBeLessThan(height);
    expect(width / height).toBeGreaterThan(0.9);
  });

  it('cai para o bbox quando a cena não trouxe geometria', () => {
    const layout = buildScenePreviewLayout({
      sceneGeometry: null,
      sceneBbox: [-52.4, -13.4, -50.7, -11.7],
      propertyGeometry: imovel(),
    });
    expect(layout?.hasScene).toBe(true);
    expect(layout?.marker).not.toBeNull();
  });

  it('ignora bbox malformado', () => {
    expect(ringFromBbox(null)).toEqual([]);
    expect(ringFromBbox([1, 2])).toEqual([]);
    expect(ringFromBbox([-52.4, -13.4, Number.NaN, -11.7])).toEqual([]);
  });

  it('aceita MultiPolygon e descarta anel degenerado', () => {
    const multi: PreviewGeometry = {
      type: 'MultiPolygon',
      coordinates: [
        [[[-51.5, -12.5], [-51.4, -12.5], [-51.4, -12.4], [-51.5, -12.4], [-51.5, -12.5]]],
        [[[-51.2, -12.2], [-51.2, -12.2]]],
      ],
    };
    const layout = buildScenePreviewLayout({ sceneGeometry: cena(), propertyGeometry: multi });
    expect(layout?.hasProperty).toBe(true);
    // só o anel válido virou path
    expect(layout!.propertyPath.match(/Z/g)).toHaveLength(1);
  });
});
