import archiver from "archiver";
import { area as turfArea, polygon as turfPolygon, multiPolygon as turfMultiPolygon } from "@turf/turf";
import type { MultiPolygon, Polygon } from "geojson";
import {
    buildDbfBuffer,
    buildShpAndShx,
    geojsonToShpRecords,
    type DbfFieldDef,
    type ShpRecord,
} from "../shapefile-writer";
import type { CoverageTopologyStats } from "./coverage-topology";

export const SIRGAS_2000_GEOGRAPHIC_PRJ =
    'GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]';

export const TOPOLOGY_FIELD_DEFS: DbfFieldDef[] = [
    { name: "ID", type: "N", length: 6, decimals: 0 },
    { name: "TIPO", type: "C", length: 20, decimals: 0 },
    { name: "SUBTIPO", type: "C", length: 30, decimals: 0 },
    { name: "AREA_M2", type: "N", length: 14, decimals: 2 },
    { name: "AREA_HA", type: "N", length: 14, decimals: 4 },
];

function extractPolygonRecords(
    geometry: Polygon | MultiPolygon,
    tipo: "VAZIO" | "SOBREPOSICAO",
    subtipo: string,
    startId = 1,
): ShpRecord[] {
    const records: ShpRecord[] = [];
    let currentId = startId;

    if (geometry.type === "Polygon") {
        const feature = turfPolygon(geometry.coordinates);
        const areaM2 = turfArea(feature);
        if (areaM2 > 0.001) {
            const shpRecs = geojsonToShpRecords(geometry, {
                ID: currentId,
                TIPO: tipo,
                SUBTIPO: subtipo,
                AREA_M2: Number(areaM2.toFixed(2)),
                AREA_HA: Number((areaM2 / 10000).toFixed(4)),
            });
            records.push(...shpRecs);
        }
    } else if (geometry.type === "MultiPolygon") {
        for (const polyCoords of geometry.coordinates) {
            const polyGeom: Polygon = { type: "Polygon", coordinates: polyCoords };
            const feature = turfPolygon(polyCoords);
            const areaM2 = turfArea(feature);
            if (areaM2 > 0.001) {
                const shpRecs = geojsonToShpRecords(polyGeom, {
                    ID: currentId,
                    TIPO: tipo,
                    SUBTIPO: subtipo,
                    AREA_M2: Number(areaM2.toFixed(2)),
                    AREA_HA: Number((areaM2 / 10000).toFixed(4)),
                });
                records.push(...shpRecs);
                currentId += 1;
            }
        }
    }

    return records;
}

export async function buildTopologyAnomaliesZip(args: {
    topologyStats: CoverageTopologyStats;
    propertyAreaHa?: number;
    airIdentificacao?: string;
    crs?: string;
}): Promise<Buffer> {
    const { topologyStats, propertyAreaHa = 0, airIdentificacao = "", crs = "EPSG:4674" } = args;

    // 1. Montar registros de vazios (gaps)
    const gapRecords: ShpRecord[] = [];
    if (topologyStats.gapsGeometry) {
        gapRecords.push(
            ...extractPolygonRecords(
                topologyStats.gapsGeometry,
                "VAZIO",
                "VAZIO_COBERTURA",
                1,
            ),
        );
    }

    // 2. Montar registros de sobreposições (overlaps)
    const overlapRecords: ShpRecord[] = [];
    let overlapId = 1;
    for (const ov of topologyStats.overlaps || []) {
        const recs = extractPolygonRecords(
            ov.geometry,
            "SOBREPOSICAO",
            ov.subtipo,
            overlapId,
        );
        overlapRecords.push(...recs);
        overlapId += recs.length;
    }

    // 3. Gerar arquivos Shapefile para Vazios
    const gapsShp = buildShpAndShx(gapRecords, 5);
    const gapsDbf = buildDbfBuffer(
        gapRecords.map((r) => r.attributes),
        TOPOLOGY_FIELD_DEFS,
    );

    // 4. Gerar arquivos Shapefile para Sobreposições
    const overlapsShp = buildShpAndShx(overlapRecords, 5);
    const overlapsDbf = buildDbfBuffer(
        overlapRecords.map((r) => r.attributes),
        TOPOLOGY_FIELD_DEFS,
    );

    // 5. Metadados e LEIAME
    const prjBuffer = Buffer.from(SIRGAS_2000_GEOGRAPHIC_PRJ, "utf8");
    const cstBuffer = Buffer.from("UTF-8", "utf8");

    const now = new Date().toISOString();
    const readmeLines = [
        "================================================================================",
        " GeoForest-IA — Inconsistências Topológicas da Base Oficial (SIMCAR Digital)",
        "================================================================================",
        `Data de extração: ${now}`,
        `Imóvel / Identificação: ${airIdentificacao || "Não informado"}`,
        `Área total do imóvel: ${propertyAreaHa.toFixed(4)} ha`,
        `Sistema de Coordenadas: ${crs} (SIRGAS 2000 geográfico)`,
        "",
        "CAMADAS GERADAS NESTE PACOTE:",
        "--------------------------------------------------------------------------------",
        "1. VAZIOS_OFICIAIS (.shp, .shx, .dbf, .prj, .cst)",
        `   - Polígonos de vazio / frestas entre feições oficiais: ${gapRecords.length} feição(ões)`,
        `   - Área total de vazios: ${topologyStats.gapAreaM2.toFixed(2)} m² (${(topologyStats.gapAreaM2 / 10000).toFixed(4)} ha)`,
        "   - Descrição: Lacunas espaciais não cobertas por nenhuma classe oficial (AC, AUAS, AVN ou água).",
        "",
        "2. SOBREPOSICOES_OFICIAIS (.shp, .shx, .dbf, .prj, .cst)",
        `   - Polígonos de sobreposição detectados: ${overlapRecords.length} feição(ões)`,
        `   - Sobreposição entre classes de solo: ${topologyStats.landCoverOverlapAreaM2.toFixed(2)} m²`,
        `   - Sobreposição de cobertura com água: ${topologyStats.inundatedOverlapAreaM2.toFixed(2)} m²`,
        ...((topologyStats.overlaps || []).map((ov) => `     * ${ov.subtipo}: ${ov.areaM2.toFixed(2)} m²`)),
        "   - Descrição: Interseções espaciais existentes na base oficial entre classes terrestres e hidrografia.",
        "",
        "NOTA TÉCNICA:",
        "Estas divergências constam originalmente na base oficial cadastrada no SIMCAR Digital / SEMA-MT.",
        "O GeoForest-IA preserva a fidelidade aos shapes oficiais do Estado, NÃO inventando filetes",
        "artificiais nem deformando as divisas declaradas.",
        "================================================================================",
    ];
    const readmeBuffer = Buffer.from(readmeLines.join("\r\n"), "utf8");

    // 6. Empacotar ZIP
    return new Promise((resolve, reject) => {
        const archive = archiver("zip", { zlib: { level: 6 } });
        const chunks: Buffer[] = [];

        archive.on("data", (chunk: Buffer) => chunks.push(chunk));
        archive.on("error", reject);
        archive.on("end", () => resolve(Buffer.concat(chunks)));

        // Vazios
        archive.append(gapsShp.shp, { name: "VAZIOS_OFICIAIS.shp" });
        archive.append(gapsShp.shx, { name: "VAZIOS_OFICIAIS.shx" });
        archive.append(gapsDbf, { name: "VAZIOS_OFICIAIS.dbf" });
        archive.append(prjBuffer, { name: "VAZIOS_OFICIAIS.prj" });
        archive.append(cstBuffer, { name: "VAZIOS_OFICIAIS.cst" });

        // Sobreposições
        archive.append(overlapsShp.shp, { name: "SOBREPOSICOES_OFICIAIS.shp" });
        archive.append(overlapsShp.shx, { name: "SOBREPOSICOES_OFICIAIS.shx" });
        archive.append(overlapsDbf, { name: "SOBREPOSICOES_OFICIAIS.dbf" });
        archive.append(prjBuffer, { name: "SOBREPOSICOES_OFICIAIS.prj" });
        archive.append(cstBuffer, { name: "SOBREPOSICOES_OFICIAIS.cst" });

        // Relatório
        archive.append(readmeBuffer, { name: "LEIAME_TOPOLOGIA.txt" });

        archive.finalize();
    });
}
