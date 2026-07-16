/**
 * Binary Shapefile writer (.shp, .shx, .dbf).
 * Supports Polygon (type 5) and Point (type 1) / MultiPoint (type 8) shapefiles.
 * MultiPolygons are flattened into multi-part Polygon records.
 */

/* ─── Types ──────────────────────────────────────────────────── */

export type DbfFieldDef = {
    name: string;        // max 11 chars
    type: "C" | "N" | "F" | "D" | "L";
    length: number;      // field length in bytes
    decimals: number;
};

export type ShpRecord = {
    type: "polygon" | "point" | "multipoint";
    rings: number[][][];                 // polygon only: outer + holes, each ring is [[x,y],...]
    coordinates?: Array<[number, number]>; // point/multipoint: array of [x,y] coords
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

/**
 * Lê as linhas de atributos de um .dbf como strings (latin1, trim).
 * A linha i corresponde à feição i+1 do .shp (mesma ordem).
 */
export function readDbfRows(dbfBuffer: Buffer): Array<Record<string, string>> {
    const fields = parseDbfSchema(dbfBuffer);
    if (!fields.length || dbfBuffer.length < 32) return [];
    const numRecords = dbfBuffer.readInt32LE(4);
    const headerBytes = dbfBuffer.readUInt16LE(8);
    const recordBytes = dbfBuffer.readUInt16LE(10);
    const rows: Array<Record<string, string>> = [];
    for (let i = 0; i < numRecords; i += 1) {
        const start = headerBytes + i * recordBytes;
        if (start + recordBytes > dbfBuffer.length) break;
        let offset = start + 1; // pula o flag de deleção
        const row: Record<string, string> = {};
        for (const field of fields) {
            row[field.name] = dbfBuffer
                .subarray(offset, offset + field.length)
                .toString("latin1")
                .trim();
            offset += field.length;
        }
        rows.push(row);
    }
    return rows;
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

export type PointShpRecord = {
    coordinates: [number, number];   // [x, y]
    attributes: Record<string, string | number | null>;
};

export function buildPointShpAndShx(
    records: PointShpRecord[],
    shapeType: number = 1, // 1=Point, 11=PointZ, 21=PointM
): { shp: Buffer; shx: Buffer } {
    const pointShapeType = 1; // Always Point (type 1)

    if (!records.length) {
        const shp = Buffer.alloc(100, 0);
        writeShpHeader(shp, 50, pointShapeType, [0, 0, 0, 0]);
        const shx = Buffer.alloc(100, 0);
        writeShpHeader(shx, 50, pointShapeType, [0, 0, 0, 0]);
        return { shp, shx };
    }

    // Content per record: shapeType(4) + X(8) + Y(8) = 20 bytes
    const recordContentBytes = 4 + 8 + 8;
    let totalContentBytes = 0;
    let gxMin = Infinity, gyMin = Infinity, gxMax = -Infinity, gyMax = -Infinity;

    for (const rec of records) {
        const [x, y] = rec.coordinates;
        if (x < gxMin) gxMin = x;
        if (y < gyMin) gyMin = y;
        if (x > gxMax) gxMax = x;
        if (y > gyMax) gyMax = y;
        totalContentBytes += 8 + recordContentBytes; // 8 = record header
    }

    const shpFileLengthWords = (100 + totalContentBytes) / 2;
    const shp = Buffer.alloc(100 + totalContentBytes, 0);
    writeShpHeader(shp, shpFileLengthWords, pointShapeType, [gxMin, gyMin, gxMax, gyMax]);

    const shxFileLengthWords = (100 + records.length * 8) / 2;
    const shx = Buffer.alloc(100 + records.length * 8, 0);
    writeShpHeader(shx, shxFileLengthWords, pointShapeType, [gxMin, gyMin, gxMax, gyMax]);

    let shpOffset = 100;
    let shxOffset = 100;

    for (let i = 0; i < records.length; i++) {
        const [x, y] = records[i].coordinates;
        const contentLenWords = recordContentBytes / 2;

        // SHX entry
        shx.writeInt32BE(shpOffset / 2, shxOffset);
        shx.writeInt32BE(contentLenWords, shxOffset + 4);
        shxOffset += 8;

        // Record header
        shp.writeInt32BE(i + 1, shpOffset);
        shp.writeInt32BE(contentLenWords, shpOffset + 4);
        shpOffset += 8;

        // Shape type + X + Y
        shp.writeInt32LE(pointShapeType, shpOffset);
        shp.writeDoubleLE(x, shpOffset + 4);
        shp.writeDoubleLE(y, shpOffset + 12);
        shpOffset += 20;
    }

    return { shp, shx };
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

            buf.write(str, offset, field.length, "latin1");
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
/**
 * Calcula a área com sinal de um anel (2D) usando shoelace.
 * Positiva = CW (horário), Negativa = CCW (anti-horário).
 */
export function ringSignedArea(ring: number[][]): number {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return area / 2;
}

/**
 * Teste ponto-em-anel por ray casting. Um ponto na borda conta como dentro
 * para estabilizar a classificacao de aneis encostados.
 */
function pointInRing(point: number[], ring: number[][]): boolean {
    const [x, y] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y) || ring.length < 4) return false;

    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

        const dx = xj - xi;
        const dy = yj - yi;
        const cross = (x - xi) * dy - (y - yi) * dx;
        const onSegment =
            Math.abs(cross) <= 1e-12 &&
            x >= Math.min(xi, xj) - 1e-12 &&
            x <= Math.max(xi, xj) + 1e-12 &&
            y >= Math.min(yi, yj) - 1e-12 &&
            y <= Math.max(yi, yj) + 1e-12;
        if (onSegment) return true;

        const intersects = (yi > y) !== (yj > y);
        if (intersects) {
            const atX = xi + ((y - yi) * dx) / dy;
            if (x < atX) inside = !inside;
        }
    }

    return inside;
}

function ringRepresentativePoint(ring: number[][]): number[] | null {
    if (ring.length < 4) return null;
    const lastIndex = ring.length - 1;
    for (let i = 0; i < lastIndex; i += 1) {
        const point = ring[i];
        if (point?.every(Number.isFinite)) return point;
    }
    return null;
}

function ringNestingDepth(ring: number[][], ringIndex: number, rings: number[][][]): number {
    const point = ringRepresentativePoint(ring);
    if (!point) return 0;

    const ringArea = Math.abs(ringSignedArea(ring));
    let depth = 0;
    for (let i = 0; i < rings.length; i += 1) {
        if (i === ringIndex) continue;
        const candidate = rings[i];
        const candidateArea = Math.abs(ringSignedArea(candidate));
        if (candidateArea <= ringArea + 1e-18) continue;
        if (pointInRing(point, candidate)) depth += 1;
    }
    return depth;
}

/**
 * Garante a orientação esperada pelo ESRI Shapefile: shells em CW e buracos
 * em CCW. Algumas camadas do WFS (especialmente AREA_UMIDA) chegam apos o
 * intersect com varios aneis externos no mesmo Polygon; por isso a decisao
 * precisa ser por profundidade espacial, nao pela posicao do anel no array.
 */
function enforceShapefileRingOrientation(rings: number[][][]): number[][][] {
    if (rings.length === 0) return rings;

    return rings.map((ring, index) => {
        if (ring.length < 4) return ring;
        const signedArea = ringSignedArea(ring);
        if (Math.abs(signedArea) <= 1e-18) return ring;

        const depth = ringNestingDepth(ring, index, rings);
        const shouldBeClockwise = depth % 2 === 0;
        const isClockwise = signedArea > 0;
        if (isClockwise !== shouldBeClockwise) {
            return [...ring].reverse();
        }
        return ring;
    });
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

/**
 * Converte GeoJSON Polygon ou MultiPolygon para array de grupos de rings,
 * onde cada grupo representa UM polígono independente (não buracos).
 *
 * Antes: MultiPolygon era achatado num array único de rings, tratando
 * o segundo polígono como buraco do primeiro → shapefile inválido.
 *
 * Agora: retorna um array de { rings }, um por polígono.
 * Isto permite que buildShpAndShx crie registros separados.
 */
export function geojsonToPolyRecords(
    geometry: { type: string; coordinates: number[][][] | number[][][][] },
): Array<{ rings: number[][][] }> {
    if (geometry.type === "Polygon") {
        const rings = enforceShapefileRingOrientation(ensureClosedRings(geometry.coordinates as number[][][]));
        return [{ rings }];
    }
    if (geometry.type === "MultiPolygon") {
        const records: Array<{ rings: number[][][] }> = [];
        for (const poly of geometry.coordinates as number[][][][]) {
            const rings = enforceShapefileRingOrientation(ensureClosedRings(poly));
            if (rings.length > 0) {
                records.push({ rings });
            }
        }
        return records;
    }
    return [];
}

export function geojsonToShpRecords(
    geometry: { type: string; coordinates: number[][][] | number[][][][] },
    attributes: Record<string, string | number | null>,
): ShpRecord[] {
    return geojsonToPolyRecords(geometry).map(({ rings }) => ({
        type: "polygon",
        rings,
        attributes: { ...attributes },
    }));
}

/**
 * @deprecated Use geojsonToPolyRecords em vez desta função.
 * Mantida para compatibilidade, mas retorna array vazio.
 */
export function geojsonToShpRings(
    geometry: { type: string; coordinates: number[][][] | number[][][][] },
): number[][][] {
    const records = geojsonToPolyRecords(geometry);
    if (records.length === 0) return [];
    // Para compatibilidade com código existente que espera um array único
    // (ex: clipe local que usa um feature por vez)
    return records[0].rings;
}
