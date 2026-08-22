/**
 * Janela temporal das análises SIMCAR — trava a série de mosaicos contra o que a
 * SEMA-MT realmente publica e contra os marcos legais que a definem.
 *
 * Referência do acervo: GetCapabilities de `geo.sema.mt.gov.br` lido em
 * 2026-08-20 (ver `docs/IMAGENS_E_CAMADAS_LAUDO.md`). Buracos reais do acervo:
 * 2001 não existe, 2002 só tem Landsat 7 e 2012 só tem ResourceSat.
 */
import { afterEach, describe, expect, it } from "vitest";

import { AUAS_SATELLITE_KEYS, getFixedAcAvnSatelliteKeys, getOrderedSatelliteKeys } from "./analysis";

const YEAR_OF_KEY = (key: string): number => Number(key.match(/_(\d{4})$/)?.[1] || 0);

describe("janela AC/AVN (marco de 22/07/2008)", () => {
    afterEach(() => {
        delete process.env.SIMCAR_ACAVN_SATELLITE_KEYS;
    });

    it("cobre de 2003 a 2008 — 2003 é o marco do pousio da IN SEMA 04/2023", () => {
        const keys = getFixedAcAvnSatelliteKeys();
        const years = keys.map(YEAR_OF_KEY);
        expect(Math.min(...years)).toBe(2003);
        expect(Math.max(...years)).toBe(2008);
        expect(keys).toContain("landsat5_2003");
    });

    it("não pula nenhum ano entre 2003 e 2008 — desmate datável exige série contígua", () => {
        const years = new Set(getFixedAcAvnSatelliteKeys().map(YEAR_OF_KEY));
        for (let year = 2003; year <= 2008; year += 1) {
            expect(years.has(year), `ano ${year} fora da janela AC/AVN`).toBe(true);
        }
    });

    it("mantém o SPOT 2008 como cena de maior peso (2,5 m, base da Nota Técnica 001/2017)", () => {
        expect(getFixedAcAvnSatelliteKeys()).toContain("spot_2008");
    });

    it("não estoura o custo: no máximo 8 cenas por análise", () => {
        // 6 anos (2003-2008) + a segunda cena de 2008 (SPOT) = 7. O teto de 8
        // deixa uma folga para fechar algum vão do acervo sem virar análise cara.
        expect(getFixedAcAvnSatelliteKeys().length).toBeLessThanOrEqual(8);
    });

    it("aceita override por env e ignora chave inexistente", () => {
        process.env.SIMCAR_ACAVN_SATELLITE_KEYS = "spot_2008, landsat5_2007 ,camada_que_nao_existe";
        expect(getFixedAcAvnSatelliteKeys()).toEqual(["spot_2008", "landsat5_2007"]);
    });

    it("override inteiramente inválido cai na janela padrão em vez de zerar a análise", () => {
        process.env.SIMCAR_ACAVN_SATELLITE_KEYS = "nada,aqui,existe";
        expect(getFixedAcAvnSatelliteKeys().length).toBeGreaterThan(0);
        expect(getFixedAcAvnSatelliteKeys()).toContain("spot_2008");
    });
});

describe("série temporal AUAS", () => {
    it("vai do marco até o mosaico mais recente publicado (2008 → 2025)", () => {
        const years = AUAS_SATELLITE_KEYS.map(YEAR_OF_KEY);
        expect(Math.min(...years)).toBe(2008);
        expect(Math.max(...years)).toBe(2025);
    });

    it("não pula nenhum ano — 2012 é ResourceSat, o único mosaico do ano", () => {
        const years = new Set(AUAS_SATELLITE_KEYS.map(YEAR_OF_KEY));
        for (let year = 2008; year <= 2025; year += 1) {
            expect(years.has(year), `ano ${year} fora da série AUAS`).toBe(true);
        }
        expect(AUAS_SATELLITE_KEYS).toContain("resourcesat_2012");
        expect(AUAS_SATELLITE_KEYS).toContain("sentinel2_2025");
    });

    it("toda chave da série existe no catálogo de camadas", () => {
        expect(getOrderedSatelliteKeys([...AUAS_SATELLITE_KEYS])).toHaveLength(
            new Set(AUAS_SATELLITE_KEYS).size,
        );
    });
});

describe("catálogo de camadas", () => {
    it("expõe os anos que fechavam vãos da série estadual", () => {
        expect(getOrderedSatelliteKeys(["landsat7_2002"])).toEqual(["landsat7_2002"]);
        expect(getOrderedSatelliteKeys(["resourcesat_2012"])).toEqual(["resourcesat_2012"]);
        expect(getOrderedSatelliteKeys(["sentinel2_2025"])).toEqual(["sentinel2_2025"]);
    });

    it("não inventa 2001, que a SEMA não publica", () => {
        expect(getOrderedSatelliteKeys(["landsat5_2001"])).toEqual(["spot_2008"]);
    });

    it("ordena a série por ano", () => {
        expect(getOrderedSatelliteKeys(["sentinel2_2025", "landsat7_2002", "resourcesat_2012"])).toEqual([
            "landsat7_2002",
            "resourcesat_2012",
            "sentinel2_2025",
        ]);
    });
});
