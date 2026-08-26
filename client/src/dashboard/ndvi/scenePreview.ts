/**
 * Geometria da pré-visualização da cena NDVI.
 *
 * A pré-visualização antes montava um Google Maps só para desenhar dois
 * polígonos: carregava a API, os tiles e o basemap inteiro, e o quadro ficava
 * vazio até tudo chegar. A imagem de fundo não responde a pergunta que o modal
 * existe para responder — *onde a propriedade cai dentro da cena* —, então aqui
 * só se calcula o traçado, e o componente desenha em SVG, sem rede.
 *
 * Duas armadilhas tratadas:
 *
 * 1. **Escala.** Uma cena Landsat tem ~185 km de lado; um imóvel de 60 ha tem
 *    ~0,8 km. Desenhado em escala real o imóvel ocupa menos de um pixel e o
 *    usuário vê a cena vazia. Abaixo de {@link MIN_PROPERTY_FRACTION} do lado da
 *    cena, devolve-se também um marcador localizador.
 * 2. **Proporção.** Um grau de longitude é mais curto que um de latitude fora do
 *    equador. Sem corrigir por cos(lat) a cena sai esticada na horizontal.
 */

export type PreviewGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: any;
};

export type Ring = Array<[number, number]>;

/** Abaixo desta fração do lado da cena, o imóvel ganha marcador localizador. */
export const MIN_PROPERTY_FRACTION = 0.03;

/** Raio do marcador localizador, como fração do lado da cena. */
export const MARKER_FRACTION = 0.022;

/** Folga em volta do desenho, como fração do lado da cena. */
const PADDING_FRACTION = 0.04;

export type ScenePreviewLayout = {
  viewBox: string;
  scenePath: string;
  propertyPath: string;
  /** Presente quando o imóvel é pequeno demais para ser visto em escala real. */
  marker: { cx: number; cy: number; r: number } | null;
  hasScene: boolean;
  hasProperty: boolean;
  /** Centroide do imóvel fora do retângulo da cena. */
  propertyOutside: boolean;
};

export function previewRings(geometry?: PreviewGeometry | null): Ring[] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return (geometry.coordinates as Ring[]) || [];
  if (geometry.type === 'MultiPolygon') {
    return ((geometry.coordinates as Ring[][]) || []).flat();
  }
  return [];
}

/** `[minX, minY, maxX, maxY]` → anel retangular, para cenas que só trazem bbox. */
export function ringFromBbox(bbox?: number[] | null): Ring[] {
  if (!Array.isArray(bbox) || bbox.length < 4) return [];
  const [minX, minY, maxX, maxY] = bbox.map(Number);
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return [];
  return [[
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ]];
}

function validPoints(rings: Ring[]): Array<[number, number]> {
  return rings
    .flat()
    .map((point) => [Number(point?.[0]), Number(point?.[1])] as [number, number])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/**
 * Monta o traçado da cena e do imóvel num mesmo sistema de coordenadas.
 * Retorna `null` quando não há geometria alguma para desenhar.
 */
export function buildScenePreviewLayout(args: {
  sceneGeometry?: PreviewGeometry | null;
  sceneBbox?: number[] | null;
  propertyGeometry?: PreviewGeometry | null;
}): ScenePreviewLayout | null {
  const sceneRings = (() => {
    const fromGeometry = previewRings(args.sceneGeometry);
    return fromGeometry.length > 0 ? fromGeometry : ringFromBbox(args.sceneBbox);
  })();
  const propertyRings = previewRings(args.propertyGeometry);

  const scenePoints = validPoints(sceneRings);
  const propertyPoints = validPoints(propertyRings);
  const allPoints = [...scenePoints, ...propertyPoints];
  if (allPoints.length === 0) return null;

  // Um grau de longitude encurta por cos(lat); sem isso a cena sai esticada.
  // A latitude de referência vem do centro do bbox, não da média dos vértices:
  // pela média, um imóvel com muitos pontos puxaria o fator e a mesma cena seria
  // desenhada com forma um pouco diferente a cada imóvel.
  const lats = allPoints.map((point) => point[1]);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.max(0.05, Math.cos((centerLat * Math.PI) / 180));
  const project = ([lng, lat]: [number, number]): [number, number] => [lng * kx, -lat];

  const projected = allPoints.map(project);
  const xs = projected.map((point) => point[0]);
  const ys = projected.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Lado de referência: o da cena quando ela existe — é ele que dá a noção de
  // escala. Só cai para o desenho todo quando não há cena.
  const sceneProjected = scenePoints.map(project);
  const sceneSpan = sceneProjected.length > 0
    ? Math.max(
      Math.max(...sceneProjected.map((p) => p[0])) - Math.min(...sceneProjected.map((p) => p[0])),
      Math.max(...sceneProjected.map((p) => p[1])) - Math.min(...sceneProjected.map((p) => p[1])),
    )
    : Math.max(maxX - minX, maxY - minY);
  const span = Math.max(sceneSpan, 1e-9);
  const pad = span * PADDING_FRACTION;

  const width = Math.max(maxX - minX, span * 0.05) + pad * 2;
  const height = Math.max(maxY - minY, span * 0.05) + pad * 2;

  const ringToPath = (ring: Ring): string => {
    const points = ring
      .map((point) => [Number(point?.[0]), Number(point?.[1])] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      .map(project);
    if (points.length < 3) return '';
    return `${points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point[0])},${round(point[1])}`)
      .join(' ')} Z`;
  };

  const scenePath = sceneRings.map(ringToPath).filter(Boolean).join(' ');
  const propertyPath = propertyRings.map(ringToPath).filter(Boolean).join(' ');

  let marker: ScenePreviewLayout['marker'] = null;
  let propertyOutside = false;
  if (propertyPoints.length > 0) {
    const propProjected = propertyPoints.map(project);
    const pxs = propProjected.map((point) => point[0]);
    const pys = propProjected.map((point) => point[1]);
    const propSpan = Math.max(Math.max(...pxs) - Math.min(...pxs), Math.max(...pys) - Math.min(...pys));
    const cx = (Math.min(...pxs) + Math.max(...pxs)) / 2;
    const cy = (Math.min(...pys) + Math.max(...pys)) / 2;

    if (sceneProjected.length > 0) {
      const sxs = sceneProjected.map((point) => point[0]);
      const sys = sceneProjected.map((point) => point[1]);
      propertyOutside =
        cx < Math.min(...sxs) || cx > Math.max(...sxs) || cy < Math.min(...sys) || cy > Math.max(...sys);
    }

    if (propSpan < span * MIN_PROPERTY_FRACTION) {
      marker = { cx: round(cx), cy: round(cy), r: round(span * MARKER_FRACTION) };
    }
  }

  return {
    viewBox: `${round(minX - pad)} ${round(minY - pad)} ${round(width)} ${round(height)}`,
    scenePath,
    propertyPath,
    marker,
    hasScene: scenePath.length > 0,
    hasProperty: propertyPath.length > 0,
    propertyOutside,
  };
}
