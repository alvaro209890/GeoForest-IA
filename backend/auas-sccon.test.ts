import { describe, it, expect } from "vitest";
import { bbox as turfBbox, polygon as turfPolygon } from "@turf/turf";
import {
    updateAuasWithAlerts,
    buildSemAlertaPoints,
    type AuasLayer,
    type ScconAlert,
} from "./auas-sccon";
import { readDbfRows, type DbfFieldDef } from "./shapefile-writer";

/** Quadrado fechado (EPSG:4674) centrado em (cx, cy) com meio-lado d. */
function square(cx: number, cy: number, d = 0.01): number[][] {
    return [
        [cx - d, cy - d],
        [cx + d, cy - d],
        [cx + d, cy + d],
        [cx - d, cy + d],
        [cx - d, cy - d],
    ];
}

function alert(cx: number, cy: number, iso: string, cls = "CUT", localId = 1): ScconAlert {
    const feature = turfPolygon([square(cx, cy, 0.005)]);
    return {
        localId,
        classType: cls,
        date: new Date(iso),
        feature,
        bbox: turfBbox(feature) as [number, number, number, number],
    };
}

function makeLayer(): AuasLayer {
    const fields: DbfFieldDef[] = [
        { name: "ID", type: "C", length: 6, decimals: 0 },
        { name: "ABERTURA", type: "C", length: 10, decimals: 0 },
    ];
    return {
        name: "AUAS",
        basename: "AUAS",
        shp: Buffer.alloc(0),
        shx: Buffer.alloc(0),
        dbf: Buffer.alloc(0),
        records: [
            { feature: 1, rings: [square(-52.0, -12.0)] },
            { feature: 2, rings: [square(-53.0, -13.0)] },
        ],
        rows: [
            { ID: "1", ABERTURA: "01/01/2016" },
            { ID: "2", ABERTURA: "01/01/2016" },
        ],
        fields,
        projDef: "EPSG:4674",
        crsLabel: "EPSG:4674",
        missingCrs: false,
    };
}

describe("updateAuasWithAlerts", () => {
    it("grava a data MIN dos alertas que intersectam e preserva as sem alerta", () => {
        const layer = makeLayer();
        const alerts: ScconAlert[] = [
            alert(-52.0, -12.0, "2021-05-01T10:00:00", "CUT", 10), // toca poly 1
            alert(-52.0, -12.0, "2020-03-17T12:36:54", "CUT", 11), // toca poly 1 (mais antiga)
            // nenhum alerta toca poly 2
        ];

        const res = updateAuasWithAlerts(layer, alerts, { dateRule: "min" });

        expect(res.updated).toBe(1);
        expect(res.semIntersecao).toBe(1);
        expect(res.semAlertaFeatures).toEqual([2]);

        const rows = readDbfRows(res.dbf);
        expect(rows[0].ABERTURA).toBe("17/03/2020"); // MIN
        expect(rows[1].ABERTURA).toBe("01/01/2016"); // preservada

        const d0 = res.details[0];
        expect(d0.atualizado).toBe(true);
        expect(d0.n_alertas_intersect).toBe(2);
        expect(d0.data_alerta_min).toBe("17/03/2020");
        expect(d0.data_alerta_max).toBe("01/05/2021");
    });

    it("usa a data MAX quando dateRule=max", () => {
        const layer = makeLayer();
        const alerts: ScconAlert[] = [
            alert(-52.0, -12.0, "2020-03-17T12:36:54", "CUT", 11),
            alert(-52.0, -12.0, "2021-05-01T10:00:00", "SELECTIVE_EXTRACTION", 10),
        ];
        const res = updateAuasWithAlerts(layer, alerts, { dateRule: "max" });
        const rows = readDbfRows(res.dbf);
        expect(rows[0].ABERTURA).toBe("01/05/2021"); // MAX
        expect(res.details[0].classes).toBe("CUT,SELECTIVE_EXTRACTION");
    });
});

describe("buildSemAlertaPoints", () => {
    it("gera um ponto por AUAS sem alerta, com atributos", () => {
        const layer = makeLayer();
        const pts = buildSemAlertaPoints(layer, [2]);
        expect(pts.count).toBe(1);
        expect(pts.areaHaTotal).toBeGreaterThan(0);

        const rows = readDbfRows(pts.dbf);
        expect(rows).toHaveLength(1);
        expect(rows[0].motivo).toBe("sem_alerta_SCCON");
        expect(rows[0].idx_auas).toBe("1"); // feature 2 → idx 1
        expect(rows[0].ID).toBe("2");
    });
});
