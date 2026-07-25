import { area as turfArea, kinks as turfKinks } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

/**
 * Tolerância (em metros) para "encostar" os recortes na divisa do imóvel.
 * A base SIMCAR Digital da SEMA e limites vindos de outros cadastros (SIGEF/
 * INCRA, shapefile do usuário) divergem tipicamente 0,5–1 m; sem o snap, o
 * recorte sai com frestas/lascas sub-métricas ao longo do perímetro — o
 * "deslocamento para dentro da ATP". Vértices do recorte a até esta distância
 * da divisa são projetados exatamente sobre ela. 0 desliga.
 */
export const CLIP_SNAP_TOLERANCE_METERS = (() => {
    const raw = Number(process.env.SIMCAR_CLIP_SNAP_TOLERANCE_METERS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 1.5;
})();

type BoundarySegment = { ax: number; ay: number; bx: number; by: number };

function boundaryRingsOf(geom: Polygon | MultiPolygon): number[][][] {
    return geom.type === "Polygon"
        ? geom.coordinates
        : geom.coordinates.flat();
}

/**
 * Projeta sobre a divisa os vértices do recorte que estão a até `tolMeters`
 * dela (equiretangular local — suficiente para tolerâncias métricas). Retorna
 * null quando nada foi movido ou quando o resultado sairia degenerado ou com
 * auto-interseção; o chamador mantém a interseção original nesses casos.
 */
export function snapClippedGeometryToBoundary(
    geometry: Polygon | MultiPolygon,
    boundary: Feature<Polygon | MultiPolygon>,
    tolMeters: number,
): Polygon | MultiPolygon | null {
    if (!(tolMeters > 0) || !boundary.geometry) return null;

    const rings = boundaryRingsOf(boundary.geometry);
    if (!rings.length) return null;
    let latSum = 0;
    let latCount = 0;
    for (const ring of rings) {
        for (const c of ring) {
            latSum += c[1];
            latCount += 1;
        }
    }
    const lat0 = latCount > 0 ? latSum / latCount : 0;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const ky = 111132;
    const toXY = (c: number[]): [number, number] => [c[0] * kx, c[1] * ky];

    const segments: BoundarySegment[] = [];
    const nodes: Array<[number, number]> = [];
    for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i += 1) {
            const [ax, ay] = toXY(ring[i]);
            const [bx, by] = toXY(ring[i + 1]);
            nodes.push([ax, ay]);
            if (ax !== bx || ay !== by) segments.push({ ax, ay, bx, by });
        }
    }
    if (!segments.length) return null;

    let moved = false;
    const tol2 = tolMeters * tolMeters;
    const snapPoint = (c: number[]): number[] => {
        const [px, py] = toXY(c);
        // 1º: vértice da divisa dentro da tolerância (preserva cantos —
        // projetar um canto deslocado na aresta vizinha "cortaria" a quina)
        let bestD2 = tol2;
        let best: [number, number] | null = null;
        for (const n of nodes) {
            const d2 = (px - n[0]) * (px - n[0]) + (py - n[1]) * (py - n[1]);
            if (d2 <= bestD2) {
                bestD2 = d2;
                best = n;
            }
        }
        // 2º: projeção na aresta mais próxima
        if (!best) {
            for (const s of segments) {
                const dx = s.bx - s.ax;
                const dy = s.by - s.ay;
                const len2 = dx * dx + dy * dy;
                const t = len2 > 0
                    ? Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2))
                    : 0;
                const qx = s.ax + t * dx;
                const qy = s.ay + t * dy;
                const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
                if (d2 <= bestD2) {
                    bestD2 = d2;
                    best = [qx, qy];
                }
            }
        }
        if (!best) return c;
        if (bestD2 <= 1e-10) return c; // já está na divisa
        moved = true;
        return [best[0] / kx, best[1] / ky];
    };

    const snapRing = (ring: number[][]): number[][] | null => {
        const open = ring.length > 1 &&
            ring[0][0] === ring[ring.length - 1][0] &&
            ring[0][1] === ring[ring.length - 1][1]
            ? ring.slice(0, -1)
            : ring;
        const out: number[][] = [];
        for (const c of open) {
            const s = snapPoint(c);
            const prev = out[out.length - 1];
            // remove vértices consecutivos colapsados pelo snap (< ~1 mm)
            if (prev && Math.abs(prev[0] - s[0]) * kx < 1e-3 && Math.abs(prev[1] - s[1]) * ky < 1e-3) continue;
            out.push(s);
        }
        while (
            out.length > 1 &&
            Math.abs(out[0][0] - out[out.length - 1][0]) * kx < 1e-3 &&
            Math.abs(out[0][1] - out[out.length - 1][1]) * ky < 1e-3
        ) out.pop();
        if (out.length < 3) return null;
        out.push([out[0][0], out[0][1]]);
        return out;
    };

    const snapPolygon = (coords: number[][][]): number[][][] | null => {
        const outer = snapRing(coords[0]);
        if (!outer) return null;
        const polys: number[][][] = [outer];
        for (let i = 1; i < coords.length; i += 1) {
            const hole = snapRing(coords[i]);
            if (hole) polys.push(hole);
        }
        return polys;
    };

    let snapped: Polygon | MultiPolygon;
    if (geometry.type === "Polygon") {
        const coords = snapPolygon(geometry.coordinates);
        if (!coords) return null;
        snapped = { type: "Polygon", coordinates: coords };
    } else {
        const parts = geometry.coordinates
            .map((poly) => snapPolygon(poly))
            .filter((p): p is number[][][] => p !== null);
        if (!parts.length) return null;
        snapped = parts.length === 1
            ? { type: "Polygon", coordinates: parts[0] }
            : { type: "MultiPolygon", coordinates: parts };
    }
    if (!moved) return null;

    try {
        if (turfKinks({ type: "Feature", properties: {}, geometry: snapped } as any).features.length > 0) {
            return null; // snap criaria auto-interseção — mantém o original
        }
        if (!(turfArea({ type: "Feature", properties: {}, geometry: snapped } as any) > 0)) {
            return null; // colapsou em linha — mantém o original
        }
    } catch {
        return null;
    }
    return snapped;
}

