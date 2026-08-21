/**
 * Convenções de nome das camadas do GeoServer da casa.
 *
 * ⚠️ Regressão real (21/08/2026): `platformFromText` usava `\bl7\b`, e `_` é
 * caractere de palavra em JS — então `..._l7_etm_...` nunca casava. Com toda a
 * plataforma voltando indefinida, a escolha de cena do laudo premiou uma cena
 * Landsat 7 **pós-falha do SLC** (31/05/2003), cheia de faixas de vazio, só por
 * ela estar 8 dias mais perto do marco de 22/07 que a Landsat 5 do mesmo ano.
 */
import { describe, expect, it } from "vitest";

import { compositionFromText, parseLandsatLayerName, platformFromText } from "./naming";

describe("platformFromText", () => {
    it("reconhece a plataforma entre underscores — era o furo", () => {
        expect(platformFromText("landsat_224_069_2003_l7_etm_224069_20030715_c543")).toBe("landsat-7");
        expect(platformFromText("landsat_224_069_2003_l5_tm_224069_20030707_c543")).toBe("landsat-5");
        expect(platformFromText("landsat_224_069_2023_l9_oli_l2sp_224069_20230722_c654")).toBe("landsat-9");
        expect(platformFromText("landsat_224_068_2013_l8_224_068_20130803_comp654_geo")).toBe("landsat-8");
    });

    it("continua reconhecendo as formas antigas", () => {
        expect(platformFromText("landsat_224_069_2005_lt05_224069_20051016")).toBe("landsat-5");
        expect(platformFromText("lc08_224069_20200603_comp654")).toBe("landsat-8");
        expect(platformFromText("lo82240702016288cub00_b6_5_4")).toBe("landsat-8");
    });

    it("não confunde dígito colado com identificador de plataforma", () => {
        // `l2sp` é nível de processamento, não Landsat 2.
        expect(platformFromText("l9_oli_l2sp_224069_20230722_c654")).toBe("landsat-9");
        expect(platformFromText("landsat_224_069_1996_lt05_224069_19960430_c543")).toBe("landsat-5");
    });

    it("nome sem plataforma reconhecível devolve undefined", () => {
        expect(platformFromText("landsat_224_069_2005_lt05x_sem_marca")).toBe("landsat-5");
        expect(platformFromText("mosaico_qualquer_2008")).toBeUndefined();
    });
});

describe("compositionFromText", () => {
    it("543 e 654 são falsa-cor, como os mosaicos da SEMA", () => {
        expect(compositionFromText("l5_tm_224069_20030707_c543")).toBe("false_color");
        expect(compositionFromText("lc08_224069_20200603_comp654")).toBe("false_color");
        expect(compositionFromText("landsat_5_tm_20060613_224_069_l2_band5_4_3")).toBe("false_color");
    });

    it("321 e 432 são cor natural", () => {
        expect(compositionFromText("landsat5_tm_20000612_224_068_c321")).toBe("natural_color");
        expect(compositionFromText("l8_224_068_2019_07_03_c432")).toBe("natural_color");
    });
});

describe("parseLandsatLayerName", () => {
    it("extrai órbita, ponto, ano e data da cena de 2008 mais próxima do marco", () => {
        const parsed = parseLandsatLayerName("landsat_224_069_2008_landsat_5_20080720_224_069_comp5431_geototal");
        expect(parsed).toMatchObject({ path: "224", row: "069", year: "2008", date: "20080720" });
        expect(parsed?.platform).toBe("landsat-5");
    });

    it("devolve o path/row da PASTA, que pode mentir sobre a cena", () => {
        // Arquivada em 224/068, mas a cena é 225/068. Quem desmente é o bbox,
        // não o nome — por isso `resolveAcervoLandsat` casa por bbox.
        const parsed = parseLandsatLayerName("landsat_224_068_2011_l5_225_068_20111008_comp543_geo");
        expect(parsed?.path).toBe("224");
        expect(parsed?.row).toBe("068");
    });

    it("nome fora do padrão devolve null", () => {
        expect(parseLandsatLayerName("spot_sema_querencia_mosaico")).toBeNull();
    });
});
