/**
 * Camadas excluídas da entrega.
 *
 * `TIPOLOGIA_VEGETAL` é o mapa de tipologia do imóvel inteiro: cobre ~100% da
 * área, vem truncada pelo WFS em 50.000 feições e não declara nada. No pacote
 * entregue ela só polui — domina o ZIP e a tabela do laudo com um número que
 * não é sobreposição.
 *
 * O ponto delicado é o ZIP: ele repassa **todo** o `Modelo.zip`, então mesmo
 * sem recorte os arquivos vazios da camada entrariam pelo passthrough. É por
 * isso que a exclusão precisa valer para nome de arquivo, não só para nome de
 * camada.
 */
import { describe, expect, it } from "vitest";

import {
    EXPORT_EXCLUDED_LAYERS,
    isExcludedExportEntry,
    isExcludedFromExport,
    TEMPLATE_LAYERS,
} from "./constants";

describe("EXPORT_EXCLUDED_LAYERS", () => {
    it("exclui TIPOLOGIA_VEGETAL da entrega", () => {
        expect(isExcludedFromExport("TIPOLOGIA_VEGETAL")).toBe(true);
        expect([...EXPORT_EXCLUDED_LAYERS]).toContain("TIPOLOGIA_VEGETAL");
    });

    it("não exclui nenhuma camada que o laudo precisa", () => {
        for (const layer of ["AREA_CONSOLIDADA", "AVN", "AUAS", "ARL", "ATP", "AIR", "NASCENTE"]) {
            expect(isExcludedFromExport(layer), layer).toBe(false);
        }
    });

    it("é insensível a caixa e a espaço em branco", () => {
        expect(isExcludedFromExport(" tipologia_vegetal ")).toBe(true);
        expect(isExcludedFromExport("Tipologia_Vegetal")).toBe(true);
    });

    it("tolera valor ausente sem quebrar o pipeline", () => {
        expect(isExcludedFromExport(undefined)).toBe(false);
        expect(isExcludedFromExport(null)).toBe(false);
        expect(isExcludedFromExport("")).toBe(false);
    });

    it("a camada continua no TEMPLATE_LAYERS — é filtro de saída, não de análise", () => {
        // O recorte segue acontecendo: as fases que consultam a tipologia
        // continuam recebendo a camada. O que muda é o que sai no pacote.
        expect(TEMPLATE_LAYERS).toContain("TIPOLOGIA_VEGETAL");
        expect(TEMPLATE_LAYERS).toHaveLength(28);
    });
});

describe("isExcludedExportEntry (passthrough do Modelo.zip)", () => {
    it("pega as quatro extensões do shapefile", () => {
        for (const ext of ["shp", "shx", "dbf", "prj"]) {
            expect(isExcludedExportEntry(`TIPOLOGIA_VEGETAL.${ext}`), ext).toBe(true);
        }
    });

    it("pega o arquivo dentro de subpasta do template", () => {
        expect(isExcludedExportEntry("Modelo/TIPOLOGIA_VEGETAL.shp")).toBe(true);
        expect(isExcludedExportEntry("a/b/c/tipologia_vegetal.dbf")).toBe(true);
    });

    it("não leva junto arquivo de outra camada", () => {
        expect(isExcludedExportEntry("AREA_CONSOLIDADA.shp")).toBe(false);
        expect(isExcludedExportEntry("Modelo/AVN.dbf")).toBe(false);
    });

    it("não casa por substring — só o nome inteiro conta", () => {
        // Um `includes("TIPOLOGIA")` derrubaria estes arquivos junto.
        expect(isExcludedExportEntry("TIPOLOGIA_VEGETAL_ANEXO.shp")).toBe(false);
        expect(isExcludedExportEntry("RESUMO_TIPOLOGIA_VEGETAL.dbf")).toBe(false);
    });
});
