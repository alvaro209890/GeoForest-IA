import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLocalSimcarBboxFeatures, resolveLocalSimcarWfsLayer } from "./local-wfs-client";

afterEach(() => vi.unstubAllGlobals());

describe("base local SIMCAR", () => {
    it("mapeia as camadas publicadas e não inventa as ausentes", () => {
        expect(resolveLocalSimcarWfsLayer("AREA_CONSOLIDADA"))
            .toBe("cbers:car_digital_simcar_d_simcar_d_area_consolidada");
        expect(resolveLocalSimcarWfsLayer("VEREDA"))
            .toBe("cbers:car_digital_simcar_d_simcar_d_veredas");
        expect(resolveLocalSimcarWfsLayer("AREA_ALTITUDE_1800")).toBeNull();
    });

    it("consulta somente o GeoServer local", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ features: [] }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        await fetchLocalSimcarBboxFeatures("cbers:car_digital_simcar_d_simcar_d_auas", [-52.5, -12.7, -52.4, -12.6]);
        const requestUrl = String(fetchMock.mock.calls[0][0]);
        expect(requestUrl).toContain("127.0.0.1:8081/geoserver/cbers/ows");
        expect(requestUrl).not.toContain("sema.mt.gov.br");
        expect(requestUrl).toContain("typeNames=cbers%3Acar_digital_simcar_d_simcar_d_auas");
    });
});
