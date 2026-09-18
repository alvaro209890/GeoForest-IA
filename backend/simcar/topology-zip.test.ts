import { polygon } from "@turf/turf";
import { describe, expect, it } from "vitest";
import { extractZipEntries } from "../geo-utils";
import { buildTopologyAnomaliesZip } from "./topology-zip";

describe("buildTopologyAnomaliesZip", () => {
    it("gera ZIP com shapefiles de vazios e sobreposições e arquivo LEIAME", async () => {
        const gapGeom = polygon([[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]).geometry;
        const overlapGeom = polygon([[[0.0005, 0.0005], [0.0015, 0.0005], [0.0015, 0.0015], [0.0005, 0.0015], [0.0005, 0.0005]]]).geometry;

        const zipBuffer = await buildTopologyAnomaliesZip({
            topologyStats: {
                gapAreaM2: 123.45,
                landCoverOverlapAreaM2: 67.89,
                inundatedOverlapAreaM2: 12.34,
                gapsGeometry: gapGeom,
                overlaps: [
                    {
                        tipo: "SOBREPOSICAO",
                        subtipo: "AREA_CONSOLIDADA_x_AVN",
                        areaM2: 67.89,
                        geometry: overlapGeom,
                    },
                ],
            },
            propertyAreaHa: 500,
            airIdentificacao: "TESTE_TOPOLOGIA",
        });

        expect(zipBuffer).toBeInstanceOf(Buffer);
        expect(zipBuffer.length).toBeGreaterThan(500);

        const entries = extractZipEntries(zipBuffer);
        const names = entries.map((e) => e.name);

        expect(names).toContain("VAZIOS_OFICIAIS.shp");
        expect(names).toContain("VAZIOS_OFICIAIS.shx");
        expect(names).toContain("VAZIOS_OFICIAIS.dbf");
        expect(names).toContain("VAZIOS_OFICIAIS.prj");
        expect(names).toContain("VAZIOS_OFICIAIS.cst");

        expect(names).toContain("SOBREPOSICOES_OFICIAIS.shp");
        expect(names).toContain("SOBREPOSICOES_OFICIAIS.shx");
        expect(names).toContain("SOBREPOSICOES_OFICIAIS.dbf");
        expect(names).toContain("SOBREPOSICOES_OFICIAIS.prj");
        expect(names).toContain("SOBREPOSICOES_OFICIAIS.cst");

        expect(names).toContain("LEIAME_TOPOLOGIA.txt");

        const readme = entries.find((e) => e.name === "LEIAME_TOPOLOGIA.txt")?.data.toString("utf8");
        expect(readme).toContain("TESTE_TOPOLOGIA");
        expect(readme).toContain("123.45 m²");
        expect(readme).toContain("AREA_CONSOLIDADA_x_AVN");
    });
});
