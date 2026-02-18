/**
 * Binary Shapefile writer (.shp, .shx, .dbf).
 * Supports Polygon (type 5) shapefiles — MultiPolygons are flattened into multi-part Polygon records.
 */

/* ─── Types ──────────────────────────────────────────────────── */

export type DbfFieldDef = {
    name: string;        // max 11 chars
    type: "C" | "N" | "F" | "D" | "L";
    length: number;      // field length in bytes
    decimals: number;
};

export type ShpRecord = {
    rings: number[][][];                 // outer + holes, each ring is [[x,y],...]
    attributes: Record<string, string | number | null>;
};

/* ─── DBF Schema Reader ──────────────────────────────────────── */

export function parseDbfSchema(dbfBuffer: Buffer): DbfFieldDef[] {
    if (dbfBuffer.length < 32) return [];
    const numRecords = dbfBuffer.readInt32LE(4);
    const headerBytes = dbfBuffer.readUInt16LE(8);
    const fields: DbfFieldDef[] = [];
    let offset = 32;
    while (offset + 32 <= headerBytes && dbfBuffer[offset] !== 0x0d) {
        const nameRaw = dbfBuffer.subarray(offset, offset + 11).toString("ascii");
        const name = nameRaw.replace(/\0+$/, "").trim();
        const type = String.fromCharCode(dbfBuffer[offset + 11]) as DbfFieldDef["type"];
        const length = dbfBuffer[offset + 16];
        const decimals = dbfBuffer[offset + 17];
        if (name) {
            fields.push({ name, type, length, decimals });
        }
        offset += 32;
    }
    return fields;
}

/* ─── SHP Writer ─────────────────────────────────────────────── */

function writeShpHeader(buf: Buffer, fileLengthWords: number, shapeType: number, bbox: number[]) {
    buf.writeInt32BE(9994, 0);       // file code
    buf.writeInt32BE(fileLengthWords, 24);
    buf.writeInt32LE(1000, 28);      // version
    buf.writeInt32LE(shapeType, 32); // shape type
    // bounding box
    buf.writeDoubleLE(bbox[0], 36);  // xMin
    buf.writeDoubleLE(bbox[1], 44);  // yMin
    buf.writeDoubleLE(bbox[2], 52);  // xMax
    buf.writeDoubleLE(bbox[3], 60);  // yMax
    // zMin, zMax, mMin, mMax = 0 (no Z/M)
}

export function buildShpAndShx(
    records: ShpRecord[],
    shapeType: number = 5,
): { shp: Buffer; shx: Buffer } {
    if (!records.length) {
        // Empty shapefile: just headers
        const shp = Buffer.alloc(100, 0);
        writeShpHeader(shp, 50, shapeType, [0, 0, 0, 0]);
        const shx = Buffer.alloc(100, 0);
        writeShpHeader(shx, 50, shapeType, [0, 0, 0, 0]);
        return { shp, shx };
    }

    // First pass: compute total size and per-record sizes
    const recordInfos: Array<{ numParts: number; numPoints: number; contentBytes: number }> = [];
    let totalContentBytes = 0;
    let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;

    for (const rec of records) {
        let numParts = 0;
        let numPoints = 0;
        for (const ring of rec.rings) {
            numParts++;
            numPoints += ring.length;
            for (const [x, y] of ring) {
                if (x < gxMin) gxMin = x;
                if (y < gyMin) gyMin = y;
                if (x > gxMax) gxMax = x;
                if (y > gyMax) gyMax = y;
            }
        }
        // Shape type (4) + bbox (32) + numParts (4) + numPoints (4) + parts array + points array
        const contentBytes = 4 + 32 + 4 + 4 + numParts * 4 + numPoints * 16;
        recordInfos.push({ numParts, numPoints, contentBytes });
        totalContentBytes += 8 + contentBytes; // 8 = record header
    }

    // File length in 16-bit words
    const shpFileLength = 100 + totalContentBytes;
    const shpFileLengthWords = shpFileLength / 2;

    const shp = Buffer.alloc(shpFileLength, 0);
    writeShpHeader(shp, shpFileLengthWords, shapeType, [gxMin, gyMin, gxMax, gyMax]);

    // SHX: 100 header + 8 bytes per record
    const shxFileLength = 100 + records.length * 8;
    const shxFileLengthWords = shxFileLength / 2;
    const shx = Buffer.alloc(shxFileLength, 0);
    writeShpHeader(shx, shxFileLengthWords, shapeType, [gxMin, gyMin, gxMax, gyMax]);

    let shpOffset = 100;
    let shxOffset = 100;

    for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const info = recordInfos[i];
        const contentLengthWords = info.contentBytes / 2;

        // SHX entry
        shx.writeInt32BE(shpOffset / 2, shxOffset);
        shx.writeInt32BE(contentLengthWords, shxOffset + 4);
        shxOffset += 8;

        // Record header
        shp.writeInt32BE(i + 1, shpOffset);              // record number (1-based)
        shp.writeInt32BE(contentLengthWords, shpOffset + 4);
        shpOffset += 8;

        // Shape type
        shp.writeInt32LE(shapeType, shpOffset);
        shpOffset += 4;

        // Bounding box for this record
        let rxMin = Infinity, ryMin = Infinity, rxMax = -Infinity, ryMax = -Infinity;
        for (const ring of rec.rings) {
            for (const [x, y] of ring) {
                if (x < rxMin) rxMin = x;
                if (y < ryMin) ryMin = y;
                if (x > rxMax) rxMax = x;
                if (y > ryMax) ryMax = y;
            }
        }
        shp.writeDoubleLE(rxMin, shpOffset);
        shp.writeDoubleLE(ryMin, shpOffset + 8);
        shp.writeDoubleLE(rxMax, shpOffset + 16);
        shp.writeDoubleLE(ryMax, shpOffset + 24);
        shpOffset += 32;

        // NumParts, NumPoints
        shp.writeInt32LE(info.numParts, shpOffset);
        shp.writeInt32LE(info.numPoints, shpOffset + 4);
        shpOffset += 8;

        // Parts array (index of first point in each ring)
        let pointCursor = 0;
        for (const ring of rec.rings) {
            shp.writeInt32LE(pointCursor, shpOffset);
            shpOffset += 4;
            pointCursor += ring.length;
        }

        // Points array
        for (const ring of rec.rings) {
            for (const [x, y] of ring) {
                shp.writeDoubleLE(x, shpOffset);
                shp.writeDoubleLE(y, shpOffset + 8);
                shpOffset += 16;
            }
        }
    }

    return { shp, shx };
}

/* ─── DBF Writer ─────────────────────────────────────────────── */

export function buildDbfBuffer(
    records: Array<Record<string, string | number | null>>,
    fieldDefs: DbfFieldDef[],
): Buffer {
    const numRecords = records.length;
    const numFields = fieldDefs.length;
    const headerSize = 32 + numFields * 32 + 1; // +1 for 0x0D terminator
    const recordSize = 1 + fieldDefs.reduce((sum, f) => sum + f.length, 0); // +1 for deletion flag

    const buf = Buffer.alloc(headerSize + numRecords * recordSize + 1, 0);
    let offset = 0;

    // DBF header
    buf[0] = 0x03; // dBASE III
    // Date: YY, MM, DD
    const now = new Date();
    buf[1] = now.getFullYear() - 1900;
    buf[2] = now.getMonth() + 1;
    buf[3] = now.getDate();
    buf.writeInt32LE(numRecords, 4);
    buf.writeUInt16LE(headerSize, 8);
    buf.writeUInt16LE(recordSize, 10);
    offset = 32;

    // Field descriptors
    for (const field of fieldDefs) {
        const nameBytes = Buffer.alloc(11, 0);
        nameBytes.write(field.name.slice(0, 11), "ascii");
        nameBytes.copy(buf, offset);
        buf[offset + 11] = field.type.charCodeAt(0);
        buf[offset + 16] = field.length;
        buf[offset + 17] = field.decimals;
        offset += 32;
    }

    // Header terminator
    buf[offset] = 0x0d;
    offset += 1;

    // Records
    for (const rec of records) {
        buf[offset] = 0x20; // not deleted
        offset += 1;

        for (const field of fieldDefs) {
            const rawValue = rec[field.name];
            let str: string;

            if (rawValue === null || rawValue === undefined) {
                str = "";
            } else if (field.type === "N" || field.type === "F") {
                const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
                if (!Number.isFinite(num)) {
                    str = "";
                } else if (field.decimals > 0) {
                    str = num.toFixed(field.decimals);
                } else {
                    str = Math.round(num).toString();
                }
                // Right-justify numeric fields
                str = str.slice(0, field.length).padStart(field.length, " ");
            } else if (field.type === "D") {
                // Date: YYYYMMDD
                str = String(rawValue ?? "").replace(/\D/g, "").slice(0, 8).padEnd(8, " ");
            } else if (field.type === "L") {
                const v = rawValue as unknown;
                str = v === true || v === "T" || v === "Y" || v === 1 ? "T" : "F";
            } else {
                // Character field — left-justify, pad with spaces
                str = String(rawValue ?? "").slice(0, field.length).padEnd(field.length, " ");
            }

            // Ensure exact field length
            if (str.length > field.length) {
                str = str.slice(0, field.length);
            } else if (str.length < field.length) {
                str = (field.type === "N" || field.type === "F")
                    ? str.padStart(field.length, " ")
                    : str.padEnd(field.length, " ");
            }

            buf.write(str, offset, field.length, "ascii");
            offset += field.length;
        }
    }

    // EOF marker
    buf[offset] = 0x1a;

    return buf;
}

/* ─── Helpers for GeoJSON → ShpRecord conversion ────────────── */

/**
 * Convert a GeoJSON Polygon or MultiPolygon geometry to ShpRecord rings.
 * Coordinates must already be in the target CRS.
 */
export function geojsonToShpRings(
    geometry: { type: string; coordinates: number[][][] | number[][][][] },
): number[][][] {
    if (geometry.type === "Polygon") {
        return ensureClosedRings(geometry.coordinates as number[][][]);
    }
    if (geometry.type === "MultiPolygon") {
        const allRings: number[][][] = [];
        for (const poly of geometry.coordinates as number[][][][]) {
            allRings.push(...ensureClosedRings(poly));
        }
        return allRings;
    }
    return [];
}

function ensureClosedRings(rings: number[][][]): number[][][] {
    return rings.map((ring) => {
        if (ring.length < 2) return ring;
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            return [...ring, [first[0], first[1]]];
        }
        return ring;
    });
}
