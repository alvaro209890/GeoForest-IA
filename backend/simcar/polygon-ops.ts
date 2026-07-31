/**
 * Operações geométricas puras — simplificação, união, clipping e cálculo de área.
 * Funções sem dependência de regras de negócio SIMCAR.
 * Extraído de simcar-clip.ts (Plano 02, Passo 3).
 */
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import {
    area as turfArea,
    booleanPointInPolygon as turfBooleanPointInPolygon,
    featureCollection as turfFeatureCollection,
    point as turfPoint,
    union as turfUnion,
} from "@turf/turf";
import { toPolygonOrMultiFeature } from "../wfs-intersection";

/* ─── Douglas-Peucker Simplification ─────────────────────── */

/** Douglas-Peucker line simplification algorithm. */
export function douglasPeucker(points: number[][], tolerance: number): number[][] {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const dist = perpendicularDistance(points[i], first, last);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance);
        const right = douglasPeucker(points.slice(maxIdx), tolerance);
        return [...left.slice(0, -1), ...right];
    }

    return [first, last];
}

/** Perpendicular distance from point to line segment. */
export function perpendicularDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const lineLenSq = dx * dx + dy * dy;
    if (lineLenSq === 0) {
        const pdx = point[0] - lineStart[0];
        const pdy = point[1] - lineStart[1];
        return Math.sqrt(pdx * pdx + pdy * pdy);
    }
    const t = Math.max(0, Math.min(1, ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / lineLenSq));
    const projX = lineStart[0] + t * dx;
    const projY = lineStart[1] + t * dy;
    const distX = point[0] - projX;
    const distY = point[1] - projY;
    return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Simplify a geometry for overlay rendering (SVG).
 * Uses Douglas-Peucker with tolerance proportional to polygon extent.
 * Reduces SVG complexity and token usage in prompts.
 */
export function simplifyGeometryForOverlay(
    geom: Geometry,
    maxVertices = 1200,
): Geometry {
    const countVertices = (g: Geometry): number => {
        if (g.type === "Polygon") {
            return (g.coordinates as number[][][]).reduce((s, r) => s + r.length, 0);
        }
        if (g.type === "MultiPolygon") {
            return (g.coordinates as number[][][][]).reduce(
                (s, poly) => s + poly.reduce((s2, r) => s2 + r.length, 0), 0,
            );
        }
        return 0;
    };

    const vertices = countVertices(geom);
    if (vertices <= maxVertices) return geom;

    const simplifyRing = (ring: number[][], tolerance: number): number[][] => {
        if (ring.length <= 4) return ring;
        const simplified = douglasPeucker(ring, tolerance);
        if (simplified.length >= 3) {
            const first = simplified[0];
            const last = simplified[simplified.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                simplified.push([first[0], first[1]]);
            }
        }
        return simplified.length >= 4 ? simplified : ring;
    };

    let allCoords: number[][] = [];
    if (geom.type === "Polygon") {
        allCoords = (geom.coordinates as number[][][]).flat();
    } else if (geom.type === "MultiPolygon") {
        allCoords = (geom.coordinates as number[][][][]).flat(2);
    }
    if (allCoords.length === 0) return geom;

    const xs = allCoords.map(c => c[0]);
    const ys = allCoords.map(c => c[1]);
    const extent = Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
    );
    const ratio = Math.max(1, vertices / maxVertices);
    const tolerance = extent * 0.00004 * Math.sqrt(ratio);

    if (geom.type === "Polygon") {
        return {
            type: "Polygon",
            coordinates: (geom.coordinates as number[][][]).map(ring => simplifyRing(ring, tolerance)),
        };
    }
    if (geom.type === "MultiPolygon") {
        return {
            type: "MultiPolygon",
            coordinates: (geom.coordinates as number[][][][]).map(
                poly => poly.map(ring => simplifyRing(ring, tolerance)),
            ),
        };
    }
    return geom;
}

/* ─── Point Operations ───────────────────────────────────── */

export function isPointOrMultiPoint(
    geometry: Geometry | null | undefined,
): geometry is Geometry & { type: "Point" | "MultiPoint" } {
    if (!geometry) return false;
    return geometry.type === "Point" || geometry.type === "MultiPoint";
}

/** Check if a coordinate is inside the given polygon (boundary counts as inside). */
export function pointInsidePolygon(
    coord: [number, number],
    polygon: Feature<Polygon | MultiPolygon>,
): boolean {
    const [x, y] = coord;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !polygon.geometry) return false;
    try {
        return turfBooleanPointInPolygon(turfPoint(coord), polygon, { ignoreBoundary: false });
    } catch {
        return false;
    }
}

export function pointInsideAnyPolygon(
    coord: [number, number],
    polygons: Array<Feature<Polygon | MultiPolygon>>,
): boolean {
    return polygons.some((polygon) => pointInsidePolygon(coord, polygon));
}

/** Extract point coordinates from Point/MultiPoint geometry. Returns null for non-point types. */
export function extractPointCoords(geometry: Geometry): Array<[number, number]> | null {
    if (geometry.type === "Point") {
        return [(geometry as any).coordinates as [number, number]];
    }
    if (geometry.type === "MultiPoint") {
        return (geometry as any).coordinates as Array<[number, number]>;
    }
    return null;
}

/* ─── Union Operations ───────────────────────────────────── */

/** Union an array of polygon features into a single feature. */
export function unionPolygonFeatures(features: Array<Feature<Polygon | MultiPolygon>>): Feature<Polygon | MultiPolygon> | null {
    if (features.length === 0) return null;
    let merged = features[0];
    for (let i = 1; i < features.length; i += 1) {
        try {
            const unioned = turfUnion(turfFeatureCollection([merged, features[i]]) as any) as
                | Feature<Polygon | MultiPolygon>
                | null;
            if (unioned) merged = unioned;
        } catch {
            // Keep partial union.
        }
    }
    return merged;
}

/** Union an array of raw Geometry objects into a single feature. */
export function unionPolygonGeometries(geometries: Geometry[] | undefined): Feature<Polygon | MultiPolygon> | null {
    if (!Array.isArray(geometries) || geometries.length === 0) return null;
    const polygonFeatures = geometries
        .map((geometry) => toPolygonOrMultiFeature(geometry))
        .filter((feature): feature is Feature<Polygon | MultiPolygon> => Boolean(feature));
    return unionPolygonFeatures(polygonFeatures);
}

/* ─── Area Calculation ───────────────────────────────────── */

/** Compute area in hectares from a polygon feature. */
export function computeAreaHa(feature: Feature<Polygon | MultiPolygon> | null | undefined): number {
    if (!feature) return 0;
    try {
        return turfArea(feature) / 10000;
    } catch {
        return 0;
    }
}
