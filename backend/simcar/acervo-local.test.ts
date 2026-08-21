/**
 * Resolução de cenas do acervo local da IMAP.
 *
 * Os casos aqui não são hipotéticos: cada um reproduz uma armadilha medida no
 * acervo real em 21/08/2026 (levantamento em `docs/ACERVO_LANDSAT_LOCAL.md`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";

import {
    acervoCandidates,
    bboxContains,
    describeSceneProvenance,
    formatSceneDate,
    isMostlyEmptyRender,
    loadAcervoCatalog,
    matchesSensorFamily,
    measureEmptyRenderRatio,
    resetAcervoCatalogCache,
    resolveAcervoLandsat,
    resolveAcervoSpot,
    ACERVO_SOURCE,
    SEMA_SOURCE,
    type AcervoCatalog,
    type Bbox,
} from "./acervo-local";

/** Imóvel real do job 8d67f503, em Querência (órbita/ponto 224/069). */
const IMOVEL: Bbox = [-52.408, -12.606, -52.354, -12.582];
/** Envelope real da órbita 224/069 no acervo. */
const ORBITA_224_069: Bbox = [-53.0541, -13.9538, -50.8739, -12.0661];

let arquivoTemp = "";

function escreverCatalogo(catalog: Partial<AcervoCatalog>): void {
    const completo: AcervoCatalog = {
        geradoEm: "2026-08-21T12:00:00.000Z",
        fonte: "http://127.0.0.1:8081/geoserver/wms",
        workspace: "cbers",
        landsat: [],
        spot: [],
        ...catalog,
    };
    arquivoTemp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acervo-")), "acervo-landsat.json");
    fs.writeFileSync(arquivoTemp, JSON.stringify(completo), "utf8");
    process.env.ACERVO_LANDSAT_JSON = arquivoTemp;
    resetAcervoCatalogCache();
}

function cena(over: Partial<AcervoCatalog["landsat"][number]> = {}): AcervoCatalog["landsat"][number] {
    return {
        layer: "cbers:landsat_224_069_2003_l5_tm_224069_20030707_c543",
        path: "224",
        row: "069",
        year: 2003,
        date: "2003-07-07",
        platform: "landsat-5",
        composicao: "false_color",
        bbox: ORBITA_224_069,
        status: "automatico",
        rank: 0,
        ...over,
    };
}

beforeEach(() => {
    delete process.env.SIMCAR_ACERVO_LOCAL_ENABLED;
});

afterEach(() => {
    delete process.env.ACERVO_LANDSAT_JSON;
    delete process.env.SIMCAR_ACERVO_LOCAL_ENABLED;
    resetAcervoCatalogCache();
});

describe("bboxContains", () => {
    it("a órbita contém o imóvel", () => {
        expect(bboxContains(ORBITA_224_069, IMOVEL)).toBe(true);
    });

    it("cobrir só parte do imóvel não conta — a figura sairia pela metade", () => {
        const meia: Bbox = [-52.38, -12.606, -50.8, -12.582];
        expect(bboxContains(meia, IMOVEL)).toBe(false);
    });

    it("cena arquivada na órbita errada não contém nada daqui", () => {
        // `landsat_5_20041229_002_069_l2_comp543`: catalogada em 224/069, bbox no Peru.
        const peru: Bbox = [-70.0614, -13.9295, -67.87, -12.0942];
        expect(bboxContains(peru, IMOVEL)).toBe(false);
    });
});

describe("matchesSensorFamily", () => {
    it("Landsat 5 casa com landsat5_2003", () => {
        expect(matchesSensorFamily("landsat5_2003", "landsat-5")).toBe(true);
    });

    it("não rotula cena Landsat 7 como Landsat 5 — a legenda é declaração técnica", () => {
        expect(matchesSensorFamily("landsat5_2003", "landsat-7")).toBe(false);
    });

    it("cena sem plataforma reconhecida passa; nem todo nome carrega o sensor", () => {
        expect(matchesSensorFamily("landsat5_2003", undefined)).toBe(true);
    });

    it("Sentinel e SPOT não têm família Landsat", () => {
        expect(matchesSensorFamily("sentinel2_2019", "landsat-8")).toBe(false);
        expect(matchesSensorFamily("spot_2008", "landsat-5")).toBe(false);
    });
});

describe("resolveAcervoLandsat", () => {
    it("devolve a cena do ano que cobre o imóvel", () => {
        escreverCatalogo({ landsat: [cena()] });
        const achadas = resolveAcervoLandsat(2003, IMOVEL);
        expect(achadas).toHaveLength(1);
        expect(achadas[0].date).toBe("2003-07-07");
    });

    it("respeita o rank: a escolha primária vem primeiro", () => {
        escreverCatalogo({
            landsat: [
                cena({ layer: "reserva", rank: 1, date: "2003-07-15", platform: "landsat-7" }),
                cena({ layer: "primaria", rank: 0 }),
            ],
        });
        expect(resolveAcervoLandsat(2003, IMOVEL).map((c) => c.layer)).toEqual(["primaria", "reserva"]);
    });

    it("nunca serve entrada descartada", () => {
        escreverCatalogo({ landsat: [cena({ status: "descartado" })] });
        expect(resolveAcervoLandsat(2003, IMOVEL)).toHaveLength(0);
    });

    it("não serve automatico com revisar:true — o rank já escolheu a deslocada", () => {
        escreverCatalogo({ landsat: [cena({ revisar: true, status: "automatico" })] });
        expect(resolveAcervoLandsat(2003, IMOVEL)).toHaveLength(0);
    });

    it("cena confirmada entra mesmo se ainda tiver a marca de revisão", () => {
        escreverCatalogo({ landsat: [cena({ revisar: true, status: "confirmado" })] });
        expect(resolveAcervoLandsat(2003, IMOVEL)).toHaveLength(1);
    });

    it("ano sem cena devolve vazio — quem chama emenda a SEMA", () => {
        escreverCatalogo({ landsat: [cena()] });
        expect(resolveAcervoLandsat(2004, IMOVEL)).toHaveLength(0);
    });

    it("a chave de desligamento devolve tudo para a SEMA", () => {
        escreverCatalogo({ landsat: [cena()] });
        process.env.SIMCAR_ACERVO_LOCAL_ENABLED = "false";
        expect(resolveAcervoLandsat(2003, IMOVEL)).toHaveLength(0);
    });

    it("sem catálogo no disco, nada quebra", () => {
        process.env.ACERVO_LANDSAT_JSON = path.join(os.tmpdir(), "nao-existe-acervo.json");
        resetAcervoCatalogCache();
        expect(loadAcervoCatalog()).toBeNull();
        expect(resolveAcervoLandsat(2003, IMOVEL)).toHaveLength(0);
    });
});

describe("resolveAcervoSpot", () => {
    it("mosaico municipal antes de tile — o tile corta o imóvel ao meio", () => {
        escreverCatalogo({
            spot: [
                { layer: "tile", municipio: "querencia", tipo: "tile", bbox: ORBITA_224_069, status: "automatico", rank: 0 },
                { layer: "mosaico", municipio: "querencia", tipo: "mosaico", bbox: ORBITA_224_069, status: "automatico", rank: 9 },
            ],
        });
        expect(resolveAcervoSpot(IMOVEL).map((s) => s.layer)).toEqual(["mosaico", "tile"]);
    });
});

describe("acervoCandidates", () => {
    it("Sentinel-2 não tem acervo: trocar por Landsat mudaria o sensor sem mudar o rótulo", () => {
        escreverCatalogo({ landsat: [cena({ year: 2019, platform: "landsat-8" })] });
        expect(acervoCandidates("sentinel2_2019", 2019, IMOVEL)).toHaveLength(0);
    });

    it("ResourceSat também não", () => {
        escreverCatalogo({ landsat: [cena({ year: 2012 })] });
        expect(acervoCandidates("resourcesat_2012", 2012, IMOVEL)).toHaveLength(0);
    });

    it("descarta cena de família diferente da que a chave promete", () => {
        escreverCatalogo({ landsat: [cena({ platform: "landsat-7" })] });
        expect(acervoCandidates("landsat5_2003", 2003, IMOVEL)).toHaveLength(0);
    });

    it("a candidata do acervo carrega o endpoint do acervo", () => {
        escreverCatalogo({ landsat: [cena()] });
        const [candidata] = acervoCandidates("landsat5_2003", 2003, IMOVEL);
        expect(candidata.source.id).toBe("acervo");
        expect(candidata.source.base).not.toContain("sema.mt.gov.br");
        expect(candidata.scene?.date).toBe("2003-07-07");
    });

    it("SPOT resolve pelos mosaicos, com o município na proveniência", () => {
        escreverCatalogo({
            spot: [{ layer: "cbers:spot_sema_querencia_mosaico", municipio: "querencia", tipo: "mosaico", bbox: ORBITA_224_069, status: "automatico", rank: 0 }],
        });
        const [candidata] = acervoCandidates("spot_2008", 2008, IMOVEL);
        expect(candidata.scene?.municipio).toBe("querencia");
    });

    it("automatico+revisar não vira candidata de laudo", () => {
        escreverCatalogo({ landsat: [cena({ revisar: true, status: "automatico" })] });
        expect(acervoCandidates("landsat5_2003", 2003, IMOVEL)).toHaveLength(0);
    });
});

describe("describeSceneProvenance", () => {
    it("cena do acervo cita data e órbita/ponto", () => {
        expect(describeSceneProvenance(ACERVO_SOURCE, { date: "2008-07-20", path: "224", row: "069" }))
            .toBe("cena 20/07/2008, órbita/ponto 224/069, acervo IMAP");
    });

    it("SPOT do acervo cita o mosaico municipal", () => {
        expect(describeSceneProvenance(ACERVO_SOURCE, { municipio: "querencia" }))
            .toBe("mosaico de Querencia, acervo IMAP");
    });

    it("mosaico estadual não inventa data que não tem", () => {
        const texto = describeSceneProvenance(SEMA_SOURCE, null);
        expect(texto).toBe("mosaico SEMA-MT");
        expect(texto).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it("formatSceneDate ignora lixo em vez de inventar", () => {
        expect(formatSceneDate("2003-07-07")).toBe("07/07/2003");
        expect(formatSceneDate("sem data")).toBe("");
        expect(formatSceneDate(undefined)).toBe("");
    });
});

describe("catálogo curado (config/acervo-landsat.json)", () => {
    const originalJson = process.env.ACERVO_LANDSAT_JSON;

    beforeEach(() => {
        delete process.env.ACERVO_LANDSAT_JSON;
        resetAcervoCatalogCache();
    });

    afterEach(() => {
        if (originalJson) process.env.ACERVO_LANDSAT_JSON = originalJson;
        else delete process.env.ACERVO_LANDSAT_JSON;
        resetAcervoCatalogCache();
    });

    it("2006 224/069 não devolve a L2 deslocada — devolve a de 17/09 alinhada", () => {
        const achadas = resolveAcervoLandsat(2006, IMOVEL);
        expect(achadas.length).toBeGreaterThan(0);
        expect(achadas[0].layer).toContain("20060917");
        expect(achadas[0].status).toBe("confirmado");
        expect(achadas.some((c) => c.layer.includes("20060613"))).toBe(false);
    });

    it("2009 224/069 devolve a lt05 _geo alinhada, não a c543 de 1,4 km", () => {
        const achadas = resolveAcervoLandsat(2009, IMOVEL);
        expect(achadas[0].layer).toContain("20090723_comp543_geo");
        expect(achadas[0].status).toBe("confirmado");
        expect(achadas.some((c) => /20090723_224_069_c543$/.test(c.layer))).toBe(false);
    });

    it("2010 e 2023 da órbita 224/069 caem na SEMA — as cenas locais estão deslocadas", () => {
        const so224069 = (year: number) =>
            resolveAcervoLandsat(year, IMOVEL).filter((c) => c.path === "224" && c.row === "069");
        expect(so224069(2010)).toHaveLength(0);
        expect(so224069(2023)).toHaveLength(0);
    });
});

describe("measureEmptyRenderRatio", () => {
    async function png(cor: { r: number; g: number; b: number }): Promise<Buffer> {
        return sharp({ create: { width: 120, height: 90, channels: 3, background: cor } }).png().toBuffer();
    }

    it("mosaico sem cobertura volta 100% preto — foi o caso do SPOT de Canarana", async () => {
        const ratio = await measureEmptyRenderRatio(await png({ r: 0, g: 0, b: 0 }));
        expect(ratio).toBeCloseTo(1, 2);
        expect((await isMostlyEmptyRender(await png({ r: 0, g: 0, b: 0 }))).empty).toBe(true);
    });

    it("nodata do GeoServer é branco puro", async () => {
        expect((await isMostlyEmptyRender(await png({ r: 255, g: 255, b: 255 }))).empty).toBe(true);
    });

    it("cena de satélite real não é considerada vazia", async () => {
        // Ruído: nenhum pixel saturado nos três canais.
        const largura = 120;
        const altura = 90;
        const raw = Buffer.alloc(largura * altura * 3);
        for (let i = 0; i < raw.length; i += 3) {
            raw[i] = 40 + (i % 120);
            raw[i + 1] = 90 + (i % 100);
            raw[i + 2] = 30 + (i % 140);
        }
        const buf = await sharp(raw, { raw: { width: largura, height: altura, channels: 3 } }).png().toBuffer();
        const { empty, ratio } = await isMostlyEmptyRender(buf);
        expect(ratio).toBeLessThan(0.05);
        expect(empty).toBe(false);
    });

    it("buffer que não é imagem não derruba a análise", async () => {
        expect((await isMostlyEmptyRender(Buffer.from("nao sou png"))).empty).toBe(false);
    });
});
