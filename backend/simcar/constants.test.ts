/**
 * Regressão das constantes de camadas do recorte SIMCAR.
 *
 * O commit 74a5c3b11 (extração do Plano 02) trocou TEMPLATE_LAYERS (28 camadas
 * canônicas) por 12 nomes errados e RIVER_CLIP_LAYERS (5 rios) por
 * APP/RESERVA_LEGAL/AREA_CONSOLIDADA — o recorte passou a fazer buffer em AC e a
 * não puxar as camadas de rio e demais camadas no WFS. Estes testes travam a
 * lista canônica contra o próprio Arquivo Modelo.zip.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import {
    DIRECT_COPY_LAYERS,
    MODELO_ZIP_PATH,
    RIVER_CLIP_EXTENSION_METERS,
    RIVER_CLIP_LAYERS,
    SPRING_LAYER_NAME,
    TEMPLATE_LAYERS,
    WHOLE_FEATURE_BUFFER_LAYERS,
} from "./constants";
import { extractZipEntries } from "../geo-utils";

describe("constants SIMCAR — camadas do recorte (regressão plano 02)", () => {
    it("TEMPLATE_LAYERS tem as 28 camadas canônicas do Arquivo Modelo", () => {
        expect(TEMPLATE_LAYERS).toHaveLength(28);
        expect([...TEMPLATE_LAYERS].sort()).toEqual(
            [
                "AIR", "AREA_ALTITUDE_1800", "AREA_CONSOLIDADA", "AREA_DECLIVIDADE",
                "AREA_TOPO_MORRO", "AREA_UMIDA", "AREA_USO_RESTRITO", "ARL", "ARLREM",
                "ATP", "AUAS", "AURD", "AVN", "BORDA_CHAPADA", "INTERESSE_SOCIAL",
                "LAGOA_NATURAL", "MANGUEZAL", "NASCENTE", "RESERVATORIO_ARTIFICIAL",
                "RESTINGA", "RIO_10_A_50", "RIO_200_A_600", "RIO_50_A_200",
                "RIO_ACIMA_600", "RIO_ATE_10", "TIPOLOGIA_VEGETAL", "UTILIDADE_PUBLICA",
                "VEREDA",
            ].sort(),
        );
    });

    it("não contém nomes que não existem no template/WFS", () => {
        for (const nomeRuim of ["RESERVA_LEGAL", "APP", "HIDROGRAFIA", "SERVIDAO_ADMINISTRATIVA"]) {
            expect(TEMPLATE_LAYERS).not.toContain(nomeRuim);
        }
    });

    it("cada camada do template tem .shp correspondente no Arquivo Modelo.zip", () => {
        expect(fs.existsSync(MODELO_ZIP_PATH), `modelo em ${MODELO_ZIP_PATH}`).toBe(true);
        const shps = new Set(
            extractZipEntries(fs.readFileSync(MODELO_ZIP_PATH)).map((e) =>
                e.name.toUpperCase().replace(/\.SHP$/, ""),
            ),
        );
        for (const layer of TEMPLATE_LAYERS) {
            expect(shps.has(layer), `camada ${layer} ausente no Arquivo Modelo.zip`).toBe(true);
        }
    });

    it("RIVER_CLIP_LAYERS = só os 5 rios (buffer de 500m)", () => {
        expect([...RIVER_CLIP_LAYERS].sort()).toEqual(
            ["RIO_10_A_50", "RIO_200_A_600", "RIO_50_A_200", "RIO_ACIMA_600", "RIO_ATE_10"].sort(),
        );
        for (const nomeErrado of ["APP", "RESERVA_LEGAL", "AREA_CONSOLIDADA"]) {
            expect(RIVER_CLIP_LAYERS.has(nomeErrado)).toBe(false);
        }
        expect(RIVER_CLIP_EXTENSION_METERS).toBe(500);
    });

    it("categorias de cópia direta e feições inteiras intactas", () => {
        expect([...DIRECT_COPY_LAYERS].sort()).toEqual(["AIR", "ATP"]);
        expect([...WHOLE_FEATURE_BUFFER_LAYERS].sort()).toEqual([
            "LAGOA_NATURAL",
            "RESERVATORIO_ARTIFICIAL",
        ]);
        expect(SPRING_LAYER_NAME).toBe("NASCENTE");
    });
});
