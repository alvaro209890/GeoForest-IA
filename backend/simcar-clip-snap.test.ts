import { describe, expect, it } from "vitest";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { snapClippedGeometryToBoundary } from "./simcar-clip";

// Casos montados no equador: 1e-6 grau ≈ 0,111 m (lon e lat).
const METER_LON = 1 / 111320;
const METER_LAT = 1 / 111132;

function square(minX: number, minY: number, maxX: number, maxY: number): Polygon {
    return {
        type: "Polygon",
        coordinates: [[
            [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
        ]],
    };
}

function feat(geom: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
    return { type: "Feature", properties: {}, geometry: geom };
}

// divisa: quadrado de ~111 m de lado
const boundary = feat(square(0, 0, 0.001, 0.001));

describe("snapClippedGeometryToBoundary", () => {
    it("encosta na divisa uma borda a 0,7 m dela (caso SIGEF)", () => {
        // recorte que ficou 0,7 m aquém da divisa oeste, com vértices ao longo
        // da borda deslocada (como numa feição real)
        const gap = 0.7 * METER_LON;
        const clipped: Polygon = {
            type: "Polygon",
            coordinates: [[
                [gap, 0], [0.001, 0], [0.001, 0.001], [gap, 0.001],
                [gap, 0.0007], [gap, 0.0003], [gap, 0],
            ]],
        };
        const out = snapClippedGeometryToBoundary(clipped, boundary, 1.5);
        expect(out).not.toBeNull();
        const ring = (out as Polygon).coordinates[0];
        expect(Math.min(...ring.map((c) => c[0]))).toBe(0); // borda oeste na divisa
        // os vértices intermediários da borda deslocada foram projetados na divisa
        expect(ring.filter((c) => c[0] === 0).length).toBeGreaterThanOrEqual(2);
        expect(Math.max(...ring.map((c) => c[0]))).toBeCloseTo(0.001, 12);
    });

    it("não mexe em borda a 5 m da divisa (fora da tolerância)", () => {
        const clipped = square(5 * METER_LON, 5 * METER_LAT, 0.001 - 5 * METER_LON, 0.001 - 5 * METER_LAT);
        expect(snapClippedGeometryToBoundary(clipped, boundary, 1.5)).toBeNull();
    });

    it("tolerância 0 desliga o snap", () => {
        const clipped = square(0.7 * METER_LON, 0, 0.001, 0.001);
        expect(snapClippedGeometryToBoundary(clipped, boundary, 0)).toBeNull();
    });

    it("preserva buraco interno e move só a borda externa", () => {
        const gap = 0.7 * METER_LON;
        const withHole: Polygon = {
            type: "Polygon",
            coordinates: [
                [
                    [gap, 0], [0.001, 0], [0.001, 0.001], [gap, 0.001],
                    [gap, 0.0005], [gap, 0],
                ],
                // buraco no miolo, longe da divisa
                [[0.0004, 0.0004], [0.0004, 0.0006], [0.0006, 0.0006], [0.0006, 0.0004], [0.0004, 0.0004]],
            ],
        };
        const out = snapClippedGeometryToBoundary(withHole, boundary, 1.5) as Polygon;
        expect(out).not.toBeNull();
        expect(Math.min(...out.coordinates[0].map((c) => c[0]))).toBe(0);
        expect(out.coordinates[1]).toEqual(withHole.coordinates[1]);
    });

    it("mantém o original quando o snap colapsaria a peça em linha", () => {
        // sliver inteiro a <1,5 m da divisa oeste: todos os vértices cairiam na mesma reta
        const sliver: Polygon = {
            type: "Polygon",
            coordinates: [[
                [0.3 * METER_LON, 0.0002],
                [1.0 * METER_LON, 0.0005],
                [0.3 * METER_LON, 0.0008],
                [0.3 * METER_LON, 0.0002],
            ]],
        };
        expect(snapClippedGeometryToBoundary(sliver, boundary, 1.5)).toBeNull();
    });

    it("MultiPolygon: snap por parte, descartando partes degeneradas", () => {
        const gap = 0.7 * METER_LON;
        const multi: MultiPolygon = {
            type: "MultiPolygon",
            coordinates: [
                [[
                    [gap, 0], [0.0005, 0], [0.0005, 0.001], [gap, 0.001],
                    [gap, 0.0005], [gap, 0],
                ]],
                square(0.0006, 0.0002, 0.0009, 0.0008).coordinates, // interna, intocada
            ],
        };
        const out = snapClippedGeometryToBoundary(multi, boundary, 1.5) as MultiPolygon;
        expect(out).not.toBeNull();
        expect(out.type).toBe("MultiPolygon");
        expect(Math.min(...out.coordinates[0][0].map((c) => c[0]))).toBe(0);
        expect(out.coordinates[1]).toEqual(multi.coordinates[1]);
    });

    it("não altera geometria já colada na divisa", () => {
        const clipped = square(0, 0, 0.001, 0.001);
        expect(snapClippedGeometryToBoundary(clipped, boundary, 1.5)).toBeNull();
    });
});
