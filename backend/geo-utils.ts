/**
 * Shared geo-processing utilities extracted from index.ts.
 * Used by both index.ts (geometry/bbox endpoint) and simcar-clip.ts.
 */
import proj4 from "proj4";
import { inflateRawSync } from "zlib";

/* ─── ZIP Parser ─────────────────────────────────────────────── */

export function extractZipEntries(zipBuffer: Buffer) {
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

        if (localHeaderOffset + 30 > zipBuffer.length) {
            cenOffset = fileNameEnd + extraLength + commentLength;
            continue;
        }
        if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOC_SIG) {
            cenOffset = fileNameEnd + extraLength + commentLength;
            continue;
        }
        const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > zipBuffer.length) {
            cenOffset = fileNameEnd + extraLength + commentLength;
            continue;
        }

        const compressed = zipBuffer.subarray(dataStart, dataEnd);
        let data: Buffer;
        if (method === 0) {
            data = Buffer.from(compressed);
        } else if (method === 8) {
            try {
                data = Buffer.from(inflateRawSync(compressed));
            } catch {
                cenOffset = fileNameEnd + extraLength + commentLength;
                continue;
            }
        } else {
            cenOffset = fileNameEnd + extraLength + commentLength;
            continue;
        }

        entries.push({ name: fileName, data });
        cenOffset = fileNameEnd + extraLength + commentLength;
    }

    return entries;
}

/* ─── Coordinate / Projection Utilities ──────────────────────── */

export function isLatLonBbox(bbox: [number, number, number, number]) {
    const [minX, minY, maxX, maxY] = bbox;
    return (
        Number.isFinite(minX) &&
        Number.isFinite(minY) &&
        Number.isFinite(maxX) &&
        Number.isFinite(maxY) &&
        minX >= -180 &&
        maxX <= 180 &&
        minY >= -90 &&
        maxY <= 90
    );
}

export function detectUtmProj(prjText: string) {
    const upper = prjText.toUpperCase();
    const zoneMatch =
        upper.match(/UTM[^0-9]*ZONE[^0-9]*(\d{1,2})\s*([NS])?/) ||
        upper.match(/ZONE[_\s]*(\d{1,2})\s*([NS])?/);
    if (!zoneMatch) return null;
    const zone = Number(zoneMatch[1]);
    if (!Number.isFinite(zone) || zone <= 0 || zone > 60) return null;
    const hemisphere =
        zoneMatch[2] ||
        (upper.includes("SOUTH") || upper.includes("SUL")
            ? "S"
            : zone >= 18 && zone <= 25
            ? "S"
            : "N");
    const south = hemisphere === "S";
    const proj = `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
    return proj.trim();
}

export function reprojectPolygon(polygon: Array<[number, number]>, projDef: string) {
    const points: Array<[number, number]> = [];
    for (const [x, y] of polygon) {
        const [lon, lat] = proj4(projDef, "EPSG:4326", [x, y]) as [number, number];
        if (Number.isFinite(lon) && Number.isFinite(lat)) points.push([lon, lat]);
    }
    return points;
}

export function reprojectBbox(bbox: [number, number, number, number], projDef: string) {
    const [minX, minY, maxX, maxY] = bbox;
    const corners: Array<[number, number]> = [
        [minX, minY],
        [minX, maxY],
        [maxX, minY],
        [maxX, maxY],
    ];
    const reprojected = corners.map(([x, y]) => proj4(projDef, "EPSG:4326", [x, y]) as [number, number]);
    const xs = reprojected.map((p) => p[0]).filter(Number.isFinite);
    const ys = reprojected.map((p) => p[1]).filter(Number.isFinite);
    if (!xs.length || !ys.length) return bbox;
    return [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
    ] as [number, number, number, number];
}
