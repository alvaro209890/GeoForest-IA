/**
 * Shapefile I/O — leitura e escrita binária de .shp, .dbf e ZIPs.
 * Funções puras, sem dependência de regras de negócio SIMCAR.
 * Extraído de simcar-clip.ts (Plano 02, Passo 2).
 */
import path from "path";
import { inflateRawSync } from "zlib";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import proj4 from "proj4";
import {
    polygon as turfPolygon,
    multiPolygon as turfMultiPolygon,
    union as turfUnion,
    buffer as turfBuffer,
    area as turfArea,
    featureCollection as turfFeatureCollection,
} from "@turf/turf";
import { ringSignedArea, type DbfFieldDef } from "../shapefile-writer";
import { extractZipEntries, resolveShapefileCrs } from "../geo-utils";
import { normalizePolygonGeometry, type SupportedPolygonGeometry } from "../wfs-intersection";
import { DIRECT_COPY_LAYERS } from "./constants";

/* ─── ZIP Parsing ──────────────────────────────────────────── */

export function extractZipEntriesByExtension(zipBuffer: Buffer, extensions: string[]) {
    const wanted = new Set(extensions.map((ext) => ext.toLowerCase()));
    const entries: Array<{ name: string; data: Buffer }> = [];
    const EOCD_SIG = 0x06054b50;
    const CEN_SIG = 0x02014b50;
    const LOC_SIG = 0x04034b50;
    const maxScan = Math.min(zipBuffer.length, 65557);

    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= zipBuffer.length - maxScan; i -= 1) {
        if (i < 0) break;
        if (zipBuffer.readUInt32LE(i) === EOCD_SIG) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) return entries;

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    let cenOffset = centralDirOffset;

    for (let i = 0; i < totalEntries; i += 1) {
        if (cenOffset + 46 > zipBuffer.length) break;
        if (zipBuffer.readUInt32LE(cenOffset) !== CEN_SIG) break;

        const method = zipBuffer.readUInt16LE(cenOffset + 10);
        const compressedSize = zipBuffer.readUInt32LE(cenOffset + 20);
        const fileNameLength = zipBuffer.readUInt16LE(cenOffset + 28);
        const extraLength = zipBuffer.readUInt16LE(cenOffset + 30);
        const commentLength = zipBuffer.readUInt16LE(cenOffset + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(cenOffset + 42);
        const fileNameStart = cenOffset + 46;
        const fileNameEnd = fileNameStart + fileNameLength;
        if (fileNameEnd > zipBuffer.length) break;
        const fileName = zipBuffer.subarray(fileNameStart, fileNameEnd).toString("utf8");
        const ext = path.extname(fileName).toLowerCase();

        cenOffset = fileNameEnd + extraLength + commentLength;
        if (!wanted.has(ext)) continue;
        if (localHeaderOffset + 30 > zipBuffer.length) continue;
        if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOC_SIG) continue;

        const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > zipBuffer.length) continue;

        const compressed = zipBuffer.subarray(dataStart, dataEnd);
        if (method === 0) {
            entries.push({ name: fileName, data: Buffer.from(compressed) });
        } else if (method === 8) {
            try {
                entries.push({ name: fileName, data: Buffer.from(inflateRawSync(compressed)) });
            } catch {
                continue;
            }
        }
    }

    return entries;
}

/* ─── SHP Binary Reading ──────────────────────────────────── */

/** Read ALL polygon records from a .shp buffer. Returns an array of polygon rings. */
export function readFullShapefile(shpBuffer: Buffer): number[][][][] {
    const polygons: number[][][][] = [];
    if (shpBuffer.length < 100) return polygons;

    let offset = 100; // skip header
    while (offset + 12 <= shpBuffer.length) {
        const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
        const contentLengthBytes = contentLengthWords * 2;
        const recStart = offset + 8;
        const recEnd = recStart + contentLengthBytes;
        if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

        const shapeType = shpBuffer.readInt32LE(recStart);
        // Polygon=5, PolygonZ=15, PolygonM=25
        if ((shapeType === 5 || shapeType === 15 || shapeType === 25) && contentLengthBytes >= 44) {
            const numParts = shpBuffer.readInt32LE(recStart + 36);
            const numPoints = shpBuffer.readInt32LE(recStart + 40);
            if (numParts > 0 && numPoints > 2) {
                const partsOffset = recStart + 44;
                const pointsOffset = partsOffset + numParts * 4;
                if (pointsOffset + numPoints * 16 <= recEnd) {
                    const partIndices: number[] = [];
                    for (let p = 0; p < numParts; p++) {
                        partIndices.push(shpBuffer.readInt32LE(partsOffset + p * 4));
                    }
                    partIndices.push(numPoints);

                    const rings: number[][][] = [];
                    for (let p = 0; p < numParts; p++) {
                        const ring: number[][] = [];
                        for (let i = partIndices[p]; i < partIndices[p + 1]; i++) {
                            const pOff = pointsOffset + i * 16;
                            const x = shpBuffer.readDoubleLE(pOff);
                            const y = shpBuffer.readDoubleLE(pOff + 8);
                            if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
                        }
                        if (ring.length >= 3) rings.push(ring);
                    }
                    if (rings.length > 0) polygons.push(rings);
                }
            }
        }
        offset = recEnd;
    }
    return polygons;
}

/* ─── DBF Binary Reading ──────────────────────────────────── */

export function getDbfRecordCount(dbfBuffer: Buffer): number {
    if (dbfBuffer.length < 12) return 0;
    return dbfBuffer.readInt32LE(4);
}

export function readDbfRecord(
    dbfBuffer: Buffer,
    fields: DbfFieldDef[],
    recordIndex: number,
): Record<string, unknown> {
    if (dbfBuffer.length < 32 || recordIndex < 0) return {};
    const headerBytes = dbfBuffer.readUInt16LE(8);
    const recordBytes = dbfBuffer.readUInt16LE(10);
    const offset = headerBytes + recordIndex * recordBytes;
    if (offset + recordBytes > dbfBuffer.length) return {};
    if (dbfBuffer[offset] === 0x2a) return {};

    const out: Record<string, unknown> = {};
    let fieldOffset = offset + 1;
    for (const field of fields) {
        const raw = dbfBuffer
            .subarray(fieldOffset, fieldOffset + field.length)
            .toString("latin1")
            .trim();
        fieldOffset += field.length;

        if (!raw) {
            out[field.name] = null;
        } else if (field.type === "N" || field.type === "F") {
            const num = Number(raw.replace(",", "."));
            out[field.name] = Number.isFinite(num) ? num : raw;
        } else {
            out[field.name] = raw;
        }
    }
    return out;
}

/* ─── Bbox Helpers ────────────────────────────────────────── */

export function bboxIntersects(
    a: [number, number, number, number],
    b: [number, number, number, number],
): boolean {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function featureBbox(feature: Feature<Polygon | MultiPolygon>): [number, number, number, number] {
    const coords =
        feature.geometry.type === "Polygon"
            ? feature.geometry.coordinates.flat()
            : feature.geometry.coordinates.flat(2);
    const xs = coords.map((coord) => coord[0]).filter(Number.isFinite);
    const ys = coords.map((coord) => coord[1]).filter(Number.isFinite);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/* ─── Ring → Feature Conversion ───────────────────────────── */

export function ringsToFeature(rings: number[][][]): Feature<Polygon | MultiPolygon> | null {
    const closedRings = rings
        .map((ring) => {
            if (ring.length < 3) return [];
            const first = ring[0];
            const last = ring[ring.length - 1];
            const closed = first[0] === last[0] && first[1] === last[1]
                ? ring
                : [...ring, [first[0], first[1]]];
            return closed.length >= 4 ? closed : [];
        })
        .filter((ring) => ring.length >= 4);
    if (!closedRings.length) return null;

    const polygons: number[][][][] = [];
    for (const ring of closedRings) {
        const area = ringSignedArea(ring);
        if (area > 0) {
            polygons.push([ring]);
        } else {
            if (polygons.length > 0) {
                polygons[polygons.length - 1].push(ring);
            } else {
                polygons.push([ring]);
            }
        }
    }

    if (polygons.length === 0) return null;

    try {
        if (polygons.length === 1) {
            return turfPolygon(polygons[0]);
        } else {
            return turfMultiPolygon(polygons);
        }
    } catch {
        return null;
    }
}

/* ─── User Shapefile Parsing (ZIP → Feature) ─────────────── */

/**
 * Parses a user-uploaded shapefile ZIP into the property boundary.
 * Reprojects from .prj CRS (SAD69/Córrego Alegre treated with official
 * parameters; unknown datum or non-UTM projection rejected with clear error).
 * Keeps each polygon/lot separate (never unions lots) — the clip runs per lot.
 */
export function parseUserShapefile(zipBuffer: Buffer): {
    polygon: Feature<Polygon | MultiPolygon>;
    polygons: Feature<Polygon | MultiPolygon>[];
    geometry: SupportedPolygonGeometry;
    areaHa: number;
} {
    const entries = extractZipEntries(zipBuffer);
    const shpEntry = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
    const prjEntry = entries.find((e) => e.name.toLowerCase().endsWith(".prj"));

    if (!shpEntry) throw new Error("ZIP não contém arquivo .shp válido.");

    const allPolygons = readFullShapefile(shpEntry.data);
    if (!allPolygons.length) throw new Error("Shapefile não contém polígonos válidos.");

    // Detect CRS from .prj and reproject if needed.
    // resolveShapefileCrs valida datum + projeção: SAD69/Córrego Alegre são
    // transformados com os parâmetros oficiais (antes eram tratados como
    // WGS84, deslocando o recorte em ~65 m / ~200 m); datum desconhecido ou
    // projeção não-UTM são rejeitados com erro claro.
    let needsReproject = false;
    let projDef: string | null = null;
    if (prjEntry) {
        const prjText = prjEntry.data.toString("utf8");
        projDef = resolveShapefileCrs(prjText).projDef;
        needsReproject = projDef !== null;
    } else {
        // No .prj file — check if coordinates look like geographic (lat/lon)
        const hasLatLonExtent = allPolygons.some(polygon =>
            polygon.some(ring =>
                ring.some(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90)
            )
        );
        if (!hasLatLonExtent) {
            throw new Error(
                "Não foi possível identificar o sistema de coordenadas do shapefile " +
                "(arquivo .prj não encontrado no ZIP). " +
                "Certifique-se de que o shapefile está em SIRGAS 2000 (EPSG:4674) " +
                "e inclua o arquivo .prj no ZIP."
            );
        }
    }

    // Reproject all rings if needed
    let processedPolygons = allPolygons;
    if (needsReproject && projDef) {
        processedPolygons = allPolygons.map((rings) =>
            rings.map((ring) =>
                ring.map(([x, y]) => {
                    const [lon, lat] = proj4(projDef!, "EPSG:4326", [x, y]) as [number, number];
                    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : [x, y];
                }),
            ),
        );
    }

    // Build turf features and union them
    const features: Feature<Polygon | MultiPolygon>[] = [];
    for (const rings of processedPolygons) {
        try {
            const feat = ringsToFeature(rings);
            if (feat) {
                features.push(feat);
            }
        } catch {
            // Skip invalid polygons
        }
    }

    if (!features.length) throw new Error("Nenhum polígono válido encontrado no Shapefile.");

    // Mantém cada polígono do shapefile separado (NÃO une os lotes).
    // Cada lote é corrigido individualmente via buffer(0) para sanar
    // auto-interseções, e será recortado separadamente contra o WFS.
    const polygons: Feature<Polygon | MultiPolygon>[] = [];
    for (const feat of features) {
        let fixed = feat;
        try {
            const buffered = turfBuffer(feat, 0, { units: "meters" });
            if (buffered) fixed = buffered as Feature<Polygon | MultiPolygon>;
        } catch {
            // If buffer(0) fails, keep as-is
        }
        if (normalizePolygonGeometry(fixed.geometry)) {
            polygons.push(fixed);
        }
    }

    if (!polygons.length) throw new Error("Nenhum polígono válido encontrado no Shapefile.");

    // Geometria unificada apenas para usos agregados (bbox, área total,
    // snapshots WMS e consulta WFS). O recorte real usa `polygons`.
    let unified: Feature<Polygon | MultiPolygon> = polygons[0];
    for (let i = 1; i < polygons.length; i++) {
        try {
            const fc = turfFeatureCollection([unified, polygons[i]]) as FeatureCollection<Polygon | MultiPolygon>;
            const u = turfUnion(fc);
            if (u) unified = u as Feature<Polygon | MultiPolygon>;
        } catch {
            // Keep partial union
        }
    }

    const geometry = normalizePolygonGeometry(unified.geometry);
    if (!geometry) throw new Error("Geometria do imóvel não pôde ser validada.");

    // Área total = soma das áreas de cada lote (lotes do SIMCAR são distintos e
    // não se sobrepõem). Evita a subcontagem causada por artefatos do turf.union,
    // que pode descartar regiões ao unir polígonos adjacentes.
    const areaHa = Number(
        (polygons.reduce((acc, poly) => acc + turfArea(poly), 0) / 10000).toFixed(4),
    );

    return { polygon: unified, polygons, geometry, areaHa };
}

/* ─── Layer Name Mapping (Template → WFS) ────────────────────── */

export function discoverLayerMapping(
    templateLayers: readonly string[],
    wfsLayerNames: string[],
): Map<string, string> {
    const mapping = new Map<string, string>();
    const wfsLower = new Map(wfsLayerNames.map((n) => [n.toLowerCase(), n]));

    for (const tmpl of templateLayers) {
        if (DIRECT_COPY_LAYERS.has(tmpl)) continue;

        const lower = tmpl.toLowerCase();

        // SEMA-MT WFS uses "Geoportal:SIMCAR_D_<name>" for SIMCAR Digital layers
        // Also try SIMCAR_CAR_, CAR_, and bare name patterns
        const candidates = [
            `geoportal:simcar_d_${lower}`,       // Most common: SIMCAR Digital layers
            `geoportal:simcar_${lower}`,          // Some layers use SIMCAR_ without D_
            `geoportal:simcar_car_${lower}`,      // Some validated CAR layers
            `geoportal:car_${lower}`,             // CAR namespace
            `geoportal:${lower}`,                 // Bare name
            `semamt:simcar_d_${lower}`,
            `semamt:simcar_${lower}`,
            `semamt:${lower}`,
        ];

        // Handle special template name remappings
        const aliasMap: Record<string, string[]> = {
            "vereda": ["simcar_d_veredas", "simcar_d_vereda"],
            "area_uso_restrito": ["simcar_d_area_uso_restrito", "areas_uso_restrito"],
            "area_altitude_1800": ["simcar_d_area_altitude_1800", "simcar_d_altitude_1800"],
            "rio_acima_600": ["simcar_d_rio_acima_600", "simcar_d_rio_maior_600"],
            "arlrem": ["simcar_d_arlrem", "simcar_arld", "simcar_d_arld"],
        };
        const aliases = aliasMap[lower] || [];
        for (const alias of aliases) {
            candidates.push(`geoportal:${alias}`);
        }

        let matched = false;
        for (const candidate of candidates) {
            const found = wfsLower.get(candidate);
            if (found) {
                mapping.set(tmpl, found);
                matched = true;
                break;
            }
        }

        // Fallback: fuzzy — find a WFS layer whose suffix matches SIMCAR_D_<name> or just <name>
        if (!matched) {
            for (const [wfsLow, wfsOriginal] of wfsLower) {
                const wfsSuffix = (wfsLow.split(":")[1] || wfsLow).toLowerCase();
                if (
                    wfsSuffix === `simcar_d_${lower}` ||
                    wfsSuffix === `simcar_${lower}` ||
                    wfsSuffix === `simcar_car_${lower}` ||
                    wfsSuffix === `car_${lower}` ||
                    wfsSuffix === lower
                ) {
                    mapping.set(tmpl, wfsOriginal);
                    matched = true;
                    break;
                }
            }
        }

        // Last resort: partial match — WFS layer ending with _<TEMPLATE_NAME>
        if (!matched) {
            for (const [wfsLow, wfsOriginal] of wfsLower) {
                const wfsSuffix = (wfsLow.split(":")[1] || wfsLow).toLowerCase();
                if (wfsSuffix.endsWith(`_${lower}`) && wfsSuffix.includes("simcar")) {
                    mapping.set(tmpl, wfsOriginal);
                    break;
                }
            }
        }
    }

    console.log("[SIMCAR CLIP] Layer mapping results:");
    for (const [tmpl, wfs] of mapping) {
        console.log(`  ${tmpl} -> ${wfs}`);
    }

    return mapping;
}
