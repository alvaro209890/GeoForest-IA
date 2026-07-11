import { describe, expect, it } from "vitest";
import proj4 from "proj4";

import { detectPrjDatum, detectUtmProj, resolveShapefileCrs } from "./geo-utils";

/* ─── .prj reais (formato Esri/ArcMap) ───────────────────────── */

const UTM_TAIL =
    `PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],` +
    `PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-57.0],` +
    `PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

const PRJ_SIRGAS_UTM21S =
    `PROJCS["SIRGAS_2000_UTM_Zone_21S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",` +
    `SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],${UTM_TAIL}`;

const PRJ_SAD69_UTM21S =
    `PROJCS["SAD_1969_UTM_Zone_21S",GEOGCS["GCS_South_American_1969",DATUM["D_South_American_1969",` +
    `SPHEROID["GRS_1967_Truncated",6378160.0,298.25]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],${UTM_TAIL}`;

const PRJ_CORREGO_UTM21S =
    `PROJCS["Corrego_Alegre_UTM_Zone_21S",GEOGCS["GCS_Corrego_Alegre",DATUM["D_Corrego_Alegre",` +
    `SPHEROID["International_1924",6378388.0,297.0]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],${UTM_TAIL}`;

const PRJ_WGS84_UTM21S =
    `PROJCS["WGS_1984_UTM_Zone_21S",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",` +
    `SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],${UTM_TAIL}`;

const PRJ_DESCONHECIDO_UTM21S =
    `PROJCS["Datum_Local_UTM_Zone_21S",GEOGCS["GCS_Datum_Local",DATUM["D_Datum_Local",` +
    `SPHEROID["Elipsoide_Local",6378388.0,297.0]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],${UTM_TAIL}`;

const PRJ_SIRGAS_GEO =
    `GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],` +
    `PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

const PRJ_SAD69_GEO =
    `GEOGCS["GCS_South_American_1969",DATUM["D_South_American_1969",` +
    `SPHEROID["GRS_1967_Truncated",6378160.0,298.25]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]]`;

const PRJ_POLICONICA_SIRGAS =
    `PROJCS["SIRGAS_2000_Brazil_Polyconic",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",` +
    `SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],` +
    `UNIT["Degree",0.0174532925199433]],PROJECTION["Polyconic"],` +
    `PARAMETER["False_Easting",5000000.0],PARAMETER["False_Northing",10000000.0],` +
    `PARAMETER["Central_Meridian",-54.0],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;

/** Distância aproximada em metros entre dois pontos lon/lat próximos. */
function distMeters(a: [number, number], b: [number, number]): number {
    const latRad = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const dx = (a[0] - b[0]) * 111320 * Math.cos(latRad);
    const dy = (a[1] - b[1]) * 110540;
    return Math.hypot(dx, dy);
}

// Ponto de teste em MT (zona UTM 21S)
const PONTO_MT: [number, number] = [-56.0, -12.0];

describe("detectPrjDatum", () => {
    it("reconhece SIRGAS 2000, WGS84, SAD69 e Córrego Alegre", () => {
        expect(detectPrjDatum(PRJ_SIRGAS_UTM21S)?.id).toBe("sirgas2000");
        expect(detectPrjDatum(PRJ_SIRGAS_GEO)?.id).toBe("sirgas2000");
        expect(detectPrjDatum(PRJ_WGS84_UTM21S)?.id).toBe("wgs84");
        expect(detectPrjDatum(PRJ_SAD69_UTM21S)?.id).toBe("sad69");
        expect(detectPrjDatum(PRJ_SAD69_GEO)?.id).toBe("sad69");
        expect(detectPrjDatum(PRJ_CORREGO_UTM21S)?.id).toBe("corrego_alegre");
        expect(detectPrjDatum(PRJ_DESCONHECIDO_UTM21S)).toBeNull();
    });
});

describe("detectUtmProj", () => {
    it("mantém zona/hemisfério e usa o datum do próprio .prj", () => {
        const sirgas = detectUtmProj(PRJ_SIRGAS_UTM21S)!;
        expect(sirgas).toContain("+proj=utm +zone=21 +south");
        expect(sirgas).toContain("+ellps=GRS80 +towgs84=0,0,0");

        const sad69 = detectUtmProj(PRJ_SAD69_UTM21S)!;
        expect(sad69).toContain("+ellps=aust_SA +towgs84=-67.35,3.88,-38.22");

        const corrego = detectUtmProj(PRJ_CORREGO_UTM21S)!;
        expect(corrego).toContain("+ellps=intl +towgs84=-206.05,168.28,-3.82");

        const wgs = detectUtmProj(PRJ_WGS84_UTM21S)!;
        expect(wgs).toContain("+datum=WGS84");
    });

    it("faz round-trip exato para SIRGAS 2000 UTM", () => {
        const def = detectUtmProj(PRJ_SIRGAS_UTM21S)!;
        const utm = proj4("EPSG:4326", def, PONTO_MT) as [number, number];
        const volta = proj4(def, "EPSG:4326", utm) as [number, number];
        expect(distMeters(volta, PONTO_MT)).toBeLessThan(0.01);
    });

    it("corrige o deslocamento de ~65 m que o datum WGS84 forçado causava em SAD69", () => {
        const sad69Def = detectUtmProj(PRJ_SAD69_UTM21S)!;
        // Coordenadas UTM que um levantamento em SAD69 atribuiria ao ponto real:
        const utmSad69 = proj4("EPSG:4326", sad69Def, PONTO_MT) as [number, number];

        // Comportamento novo: volta ao ponto real.
        const corrigido = proj4(sad69Def, "EPSG:4326", utmSad69) as [number, number];
        expect(distMeters(corrigido, PONTO_MT)).toBeLessThan(0.01);

        // Comportamento antigo (datum=WGS84 fixo): deslocava dezenas de metros.
        const defAntigo = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
        const antigo = proj4(defAntigo, "EPSG:4326", utmSad69) as [number, number];
        const erroAntigo = distMeters(antigo, PONTO_MT);
        expect(erroAntigo).toBeGreaterThan(40);
        expect(erroAntigo).toBeLessThan(100);
    });

    it("corrige o deslocamento (~80 m em MT) para Córrego Alegre", () => {
        const corregoDef = detectUtmProj(PRJ_CORREGO_UTM21S)!;
        const utmCorrego = proj4("EPSG:4326", corregoDef, PONTO_MT) as [number, number];

        const corrigido = proj4(corregoDef, "EPSG:4326", utmCorrego) as [number, number];
        expect(distMeters(corrigido, PONTO_MT)).toBeLessThan(0.01);

        // O vetor geocêntrico Córrego Alegre→SIRGAS tem ~266 m; a componente
        // horizontal em MT (lon -56°, lat -12°) fica em ~80 m.
        const defAntigo = "+proj=utm +zone=21 +south +datum=WGS84 +units=m +no_defs";
        const antigo = proj4(defAntigo, "EPSG:4326", utmCorrego) as [number, number];
        const erroAntigo = distMeters(antigo, PONTO_MT);
        expect(erroAntigo).toBeGreaterThan(50);
        expect(erroAntigo).toBeLessThan(320);
    });
});

describe("resolveShapefileCrs", () => {
    it("aceita UTM com datum conhecido e devolve o projDef correspondente", () => {
        expect(resolveShapefileCrs(PRJ_SIRGAS_UTM21S).projDef).toContain("+ellps=GRS80");
        expect(resolveShapefileCrs(PRJ_WGS84_UTM21S).projDef).toContain("+datum=WGS84");
        expect(resolveShapefileCrs(PRJ_SAD69_UTM21S).projDef).toContain("+towgs84=-67.35,3.88,-38.22");
        expect(resolveShapefileCrs(PRJ_CORREGO_UTM21S).projDef).toContain("+towgs84=-206.05,168.28,-3.82");
    });

    it("rejeita UTM com datum desconhecido (antes era assumido WGS84 em silêncio)", () => {
        expect(() => resolveShapefileCrs(PRJ_DESCONHECIDO_UTM21S)).toThrow(/datum.*não foi reconhecido/i);
    });

    it("rejeita projeção não-UTM mesmo em SIRGAS (metros seriam lidos como graus)", () => {
        expect(() => resolveShapefileCrs(PRJ_POLICONICA_SIRGAS)).toThrow(/projeção.*não é suportada/i);
    });

    it("geográfico SIRGAS/WGS84 dispensa reprojeção; SAD69 geográfico é transformado", () => {
        expect(resolveShapefileCrs(PRJ_SIRGAS_GEO).projDef).toBeNull();

        const { projDef } = resolveShapefileCrs(PRJ_SAD69_GEO);
        expect(projDef).toContain("+proj=longlat");
        expect(projDef).toContain("+ellps=aust_SA");

        // A transformação geográfica SAD69→SIRGAS move o ponto ~65 m.
        const transformado = proj4(projDef!, "EPSG:4326", PONTO_MT) as [number, number];
        const shift = distMeters(transformado, PONTO_MT);
        expect(shift).toBeGreaterThan(40);
        expect(shift).toBeLessThan(100);
    });

    it("rejeita CRS totalmente desconhecido com a mensagem original", () => {
        expect(() =>
            resolveShapefileCrs(`GEOGCS["GCS_Misterioso",DATUM["D_Misterioso",SPHEROID["X",6378137.0,298.0]]]`),
        ).toThrow(/não é SIRGAS 2000/i);
    });
});
