import { describe, expect, it } from "vitest";
import archiver from "archiver";
import type { Polygon } from "geojson";
import proj4 from "proj4";
import { findSedePoint, readPointShapefile } from "./sede";

/** Monta um .shp de pontos em memória (Point=1, PointZ=11, MultiPoint=8). */
function makePointShp(
  points: Array<[number, number]>,
  shapeType = 1,
): Buffer {
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0); // file code
  header.writeInt32BE(50 + points.length * 10, 24); // file length em words
  header.writeInt32LE(1000, 28); // version
  header.writeInt32LE(shapeType, 32); // shape type

  const records: Buffer[] = [];
  if (shapeType === 8) {
    // MultiPoint: shapeType + bbox (32 bytes) + numPoints + pontos
    const rec = Buffer.alloc(8 + 4 + 32 + 4 + points.length * 16);
    rec.writeInt32BE(1, 0);
    rec.writeInt32BE((4 + 32 + 4 + points.length * 16) / 2, 4);
    rec.writeInt32LE(8, 8);
    // bbox de 32 bytes fica zerado — o leitor não usa
    rec.writeInt32LE(points.length, 44);
    points.forEach(([x, y], i) => {
      rec.writeDoubleLE(x, 48 + i * 16);
      rec.writeDoubleLE(y, 56 + i * 16);
    });
    records.push(rec);
    return Buffer.concat([header, ...records]);
  }
  points.forEach(([x, y], i) => {
    const rec = Buffer.alloc(28);
    rec.writeInt32BE(i + 1, 0); // record number
    rec.writeInt32BE(10, 4); // content length em words (20 bytes)
    rec.writeInt32LE(shapeType, 8);
    rec.writeDoubleLE(x, 12);
    rec.writeDoubleLE(y, 20);
    records.push(rec);
  });
  return Buffer.concat([header, ...records]);
}

/** Monta um .shp de polígono (um quadrado) em memória — deve ser ignorado. */
function makePolygonShp(): Buffer {
  const ring = [
    [-52.2, -12.0],
    [-51.9, -12.0],
    [-51.9, -11.8],
    [-52.2, -11.8],
    [-52.2, -12.0],
  ];
  const rec = Buffer.alloc(8 + 128);
  rec.writeInt32BE(1, 0);
  rec.writeInt32BE(64, 4); // 128 bytes = 64 words
  rec.writeInt32LE(5, 8); // shape type Polygon
  // bbox (32 bytes) fica zerado — o leitor de pontos nem olha
  rec.writeInt32LE(1, 44); // numParts
  rec.writeInt32LE(5, 48); // numPoints
  rec.writeInt32LE(0, 52); // parts[0]
  ring.forEach(([x, y], i) => {
    rec.writeDoubleLE(x, 56 + i * 16);
    rec.writeDoubleLE(y, 64 + i * 16);
  });
  return Buffer.concat([Buffer.alloc(100), rec]);
}

function makeZip(entries: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c) => chunks.push(Buffer.from(c)));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
    for (const entry of entries) archive.append(entry.data, { name: entry.name });
    void archive.finalize();
  });
}

const QUADRADO: Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-52.2, -12.0],
      [-51.9, -12.0],
      [-51.9, -11.8],
      [-52.2, -11.8],
      [-52.2, -12.0],
    ],
  ],
};

// Mesmo .prj do padrão IMAP: SIRGAS 2000 / UTM zone 22S (ESRI WKT).
const PRJ_UTM_22S =
  'PROJCS["SIRGAS 2000 / UTM zone 22S",GEOGCS["GCS_SIRGAS_2000",' +
  'DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
  'PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],' +
  'PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-51.0],' +
  'PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],' +
  'UNIT["Meter",1.0]]';

describe("sede da propriedade (layer de pontos no ZIP da ATP)", () => {
  it("lê .shp de pontos simples (Point) e MultiPoint", () => {
    const pontos = readPointShapefile(
      makePointShp(
        [
          [-52.1, -11.9],
          [-52.0, -11.85],
        ],
        1,
      ),
    );
    expect(pontos).toHaveLength(2);
    expect(pontos[0][0]).toBeCloseTo(-52.1, 6);
    expect(pontos[1][1]).toBeCloseTo(-11.85, 6);

    const multiponto = readPointShapefile(
      makePointShp([[-52.05, -11.9], [-52.0, -11.88]], 8),
    );
    expect(multiponto).toHaveLength(2);
    expect(multiponto[0][0]).toBeCloseTo(-52.05, 6);
  });

  it("ignora .shp de polígono (não confunde com layer de pontos)", () => {
    expect(readPointShapefile(makePolygonShp())).toHaveLength(0);
  });

  it("encontra a sede: ponto do layer dentro do polígono da ATP", async () => {
    const zip = await makeZip([
      { name: "ATP.shp", data: makePolygonShp() },
      { name: "SEDE.shp", data: makePointShp([[-52.05, -11.9]]) },
    ]);
    const sede = findSedePoint(zip, QUADRADO);
    expect(sede).not.toBeNull();
    expect(sede!.lon).toBeCloseTo(-52.05, 6);
    expect(sede!.lat).toBeCloseTo(-11.9, 6);
  });

  it("devolve null quando nenhum ponto cai dentro do imóvel", async () => {
    const zip = await makeZip([
      { name: "ATP.shp", data: makePolygonShp() },
      { name: "SEDE.shp", data: makePointShp([[-52.5, -12.5]]) }, // fora
    ]);
    expect(findSedePoint(zip, QUADRADO)).toBeNull();
  });

  it("devolve null quando o ZIP só tem o polígono (sem layer de pontos)", async () => {
    const zip = await makeZip([{ name: "ATP.shp", data: makePolygonShp() }]);
    expect(findSedePoint(zip, QUADRADO)).toBeNull();
  });

  it("reprojeta o ponto UTM (mesmo .prj do polígono) para o interior", async () => {
    // Centroide do quadrado em graus → UTM 22S (mesma def que o .prj gera).
    const projDef =
      "+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs";
    const [utmX, utmY] = proj4("EPSG:4326", projDef, [-52.05, -11.9]) as [
      number,
      number,
    ];

    const zip = await makeZip([
      { name: "SEDE.shp", data: makePointShp([[utmX, utmY]]) },
      { name: "SEDE.prj", data: Buffer.from(PRJ_UTM_22S, "utf8") },
    ]);
    const sede = findSedePoint(zip, QUADRADO);
    expect(sede).not.toBeNull();
    expect(sede!.lon).toBeCloseTo(-52.05, 5);
    expect(sede!.lat).toBeCloseTo(-11.9, 5);
  });
});
